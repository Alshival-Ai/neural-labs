#!/usr/bin/env python3
"""Manage the one-pass prospect/video preview lifecycle.

The helper owns durable state and validates handoffs between discovery, build,
and release. It never researches, deploys, or sends notifications itself.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from candidates import published_evidence
from visual_quality import QualityError, validate_quality


RUNS_ROOT = Path(
    os.environ.get(
        "NEURAL_LABS_PROJECTS_ROOT",
        "/home/node/workspace/projects",
    )
)
STATE_FILE = "PIPELINE-STATE.json"
BUILD_RESULT_FILE = "BUILD-RESULT.json"
RELEASE_RESULT_FILE = "RELEASE-RESULT.json"
VERIFICATION_FILE = "RELEASE-VERIFICATION.json"
LIVE_QA_RESULT_FILE = Path("release-qa") / "QA-RESULT.json"
LOCK_FILE = ".pipeline.lock"
MAX_FILES = 200
MAX_BYTES = 50 * 1024 * 1024
RUN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,100}$")
PLACE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,256}$")
HOSTNAME_RE = re.compile(
    r"(?=.{1,253}\Z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+"
    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
)
RELEASE_ID_RE = re.compile(r"^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$")
CINEMATIC_MEDIA_FIRST = "cinematic-media-first"
PRESENTATION_PROFILES = {"evidence-led", CINEMATIC_MEDIA_FIRST}
EXECUTABLE_SCRIPT_TYPES = {
    "",
    "application/ecmascript",
    "application/javascript",
    "module",
    "text/ecmascript",
    "text/javascript",
}


class PipelineError(RuntimeError):
    pass


def validate_visual_quality(run_dir, state, manifest=None):
    try:
        return validate_quality(run_dir, state, manifest)
    except QualityError as exc:
        raise PipelineError(str(exc)) from exc


class PublisherCspParser(HTMLParser):
    def __init__(self, source: str):
        super().__init__(convert_charrefs=True)
        self.source = source
        self.inline_executable_scripts: list[str] = []
        self.inline_event_handlers: list[str] = []
        self.javascript_urls: list[str] = []
        self.script_sources: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {name.casefold(): value or "" for name, value in attrs}
        line, _ = self.getpos()
        location = f"{self.source}:{line}"
        for name, value in attributes.items():
            if name.startswith("on") and value.strip():
                self.inline_event_handlers.append(f"{location} {tag}[{name}]")
            if name in {"action", "formaction", "href", "src"} and re.match(
                r"^\s*javascript:", value, flags=re.IGNORECASE
            ):
                self.javascript_urls.append(f"{location} {tag}[{name}]")
        if tag.casefold() != "script":
            return
        source = clean_text(attributes.get("src"))
        script_type = clean_text(attributes.get("type")).casefold()
        if source:
            self.script_sources.append((location, source))
        elif script_type in EXECUTABLE_SCRIPT_TYPES:
            self.inline_executable_scripts.append(location)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_path, 0o600)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise PipelineError(f"Missing required file: {path.name}") from exc
    except json.JSONDecodeError as exc:
        raise PipelineError(f"Invalid JSON in {path.name}: {exc}") from exc
    if not isinstance(payload, dict):
        raise PipelineError(f"{path.name} must contain a JSON object")
    return payload


def require_nonempty(path: Path) -> None:
    if not path.is_file() or not path.read_text(encoding="utf-8", errors="replace").strip():
        raise PipelineError(f"Missing or empty artifact: {path.name}")


def resolve_run_dir(raw: str) -> Path:
    root = RUNS_ROOT.resolve(strict=True)
    supplied = Path(raw).expanduser()
    if supplied.is_symlink():
        raise PipelineError("Run directory must not be a symbolic link")
    candidate = supplied.resolve(strict=True)
    if candidate.parent != root or not RUN_ID_RE.fullmatch(candidate.name):
        raise PipelineError(f"Run directory must be a direct project child of {root}")
    if candidate.is_symlink():
        raise PipelineError("Run directory must not be a symbolic link")
    return candidate


def locked(run_dir: Path):
    class Lock:
        def __enter__(self):
            self.handle = (run_dir / LOCK_FILE).open("a+", encoding="utf-8")
            os.chmod(run_dir / LOCK_FILE, 0o600)
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX)
            return self.handle

        def __exit__(self, exc_type, exc, traceback):
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            self.handle.close()

    return Lock()


def load_state(run_dir: Path) -> dict[str, Any]:
    return load_json(run_dir / STATE_FILE)


def save_state(run_dir: Path, state: dict[str, Any]) -> None:
    state["updatedAtUtc"] = utc_now()
    atomic_json(run_dir / STATE_FILE, state)


def require_stage(state: dict[str, Any], allowed: set[str]) -> str:
    stage = clean_text(state.get("stage"))
    if stage not in allowed:
        raise PipelineError(f"Pipeline stage is {stage or 'unknown'}; expected {sorted(allowed)}")
    return stage


def validate_selection(run_dir: Path) -> dict[str, Any]:
    selection = load_json(run_dir / "selection.json")
    required = ("city", "placeId", "businessName", "hostname", "category", "businessKind")
    for field in required:
        if not clean_text(selection.get(field)):
            raise PipelineError(f"selection.json.{field} is required")
    if not PLACE_ID_RE.fullmatch(clean_text(selection.get("placeId"))):
        raise PipelineError("selection.json.placeId has an invalid format")
    hostname = clean_text(selection.get("hostname")).lower()
    if not HOSTNAME_RE.fullmatch(hostname) or not hostname.endswith(".alshival.dev"):
        raise PipelineError("selection.json.hostname must be below alshival.dev")
    if hostname != selection.get("hostname"):
        raise PipelineError("selection.json.hostname must be lowercase")
    if selection["businessKind"] not in {"general", "restaurant"}:
        raise PipelineError("selection.json.businessKind must be general or restaurant")
    if selection.get("runId") != run_dir.name:
        raise PipelineError("selection.json.runId does not match the run directory")
    return selection


def site_manifest(site_dir: Path) -> tuple[list[dict[str, Any]], int, str]:
    if not site_dir.is_dir() or site_dir.is_symlink():
        raise PipelineError("site/ is missing or invalid")
    index = site_dir / "index.html"
    if not index.is_file() or index.is_symlink():
        raise PipelineError("site/ must contain a regular index.html")

    files: list[dict[str, Any]] = []
    total_bytes = 0
    digest = hashlib.sha256()
    for path in sorted(site_dir.rglob("*")):
        if path.is_symlink():
            raise PipelineError(f"site/ contains a symbolic link: {path.relative_to(site_dir)}")
        if not path.is_file():
            continue
        relative = path.relative_to(site_dir).as_posix()
        size = path.stat().st_size
        sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
        files.append({"path": relative, "bytes": size, "sha256": sha256})
        total_bytes += size
        digest.update(f"{relative}\0{size}\0{sha256}\n".encode())
    if len(files) > MAX_FILES:
        raise PipelineError(f"site/ exceeds the {MAX_FILES}-file limit")
    if total_bytes > MAX_BYTES:
        raise PipelineError(f"site/ exceeds the {MAX_BYTES}-byte limit")
    return files, total_bytes, digest.hexdigest()


def validate_publisher_csp(site_dir: Path) -> None:
    root = site_dir.resolve(strict=True)
    inline_scripts: list[str] = []
    inline_handlers: list[str] = []
    javascript_urls: list[str] = []
    script_sources: list[tuple[Path, str, str]] = []
    for html_path in sorted(site_dir.rglob("*.html")):
        if not html_path.is_file() or html_path.is_symlink():
            continue
        relative = html_path.relative_to(site_dir).as_posix()
        parser = PublisherCspParser(relative)
        parser.feed(html_path.read_text(encoding="utf-8", errors="replace"))
        inline_scripts.extend(parser.inline_executable_scripts)
        inline_handlers.extend(parser.inline_event_handlers)
        javascript_urls.extend(parser.javascript_urls)
        script_sources.extend(
            (html_path, location, source)
            for location, source in parser.script_sources
        )
    blocked = inline_scripts + inline_handlers + javascript_urls
    if blocked:
        raise PipelineError(
            "Publisher CSP blocks inline executable JavaScript; ship controllers as local "
            "external script files. Blocked locations: " + ", ".join(blocked)
        )
    for html_path, location, source in script_sources:
        parsed = urlsplit(source)
        if parsed.scheme or parsed.netloc or source.startswith("//"):
            raise PipelineError(
                f"Publisher CSP requires a local same-origin script at {location}: {source}"
            )
        script_path = unquote(parsed.path)
        if not script_path:
            raise PipelineError(f"Empty local script path at {location}")
        candidate = (
            site_dir / script_path.lstrip("/")
            if script_path.startswith("/")
            else html_path.parent / script_path
        ).resolve(strict=False)
        try:
            candidate.relative_to(root)
        except ValueError as exc:
            raise PipelineError(
                f"Local script escapes site/ at {location}: {source}"
            ) from exc
        if not candidate.is_file() or candidate.is_symlink():
            raise PipelineError(
                f"Local script is missing or invalid at {location}: {source}"
            )


def video_evidence(site_dir: Path, *, required: bool) -> dict[str, list[str]]:
    videos = sorted(
        path.relative_to(site_dir).as_posix()
        for path in site_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in {".mp4", ".webm"}
    )
    posters = sorted(
        path.relative_to(site_dir).as_posix()
        for path in site_dir.rglob("*")
        if path.is_file()
        and "poster" in path.stem.casefold()
        and path.suffix.lower() in {".avif", ".jpeg", ".jpg", ".png", ".webp"}
    )
    if required and not videos:
        raise PipelineError("video-scroll build requires at least one local video")
    if required and not posters:
        raise PipelineError("video-scroll build requires at least one named local poster")
    return {"videos": videos, "posters": posters}


def validate_research(run_dir: Path) -> dict[str, Any]:
    research = load_json(run_dir / "research.json")
    report = research.get("researchPass")
    if not isinstance(report, dict) or report.get("version") != 1:
        raise PipelineError("Complete researchPass version 1 before building; read business-research-and-media.md")
    selection = load_json(run_dir / "selection.json")
    if not report.get("placeId") or report["placeId"] != selection.get("placeId"):
        raise PipelineError("Research must match the selected Google Place ID")
    for field in ("businessSummary", "authenticMediaDecision"):
        if not clean_text(report.get(field)):
            raise PipelineError(f"researchPass.{field} is required")

    def evidence(value: Any) -> None:
        relative = Path(clean_text(value))
        if not clean_text(value) or relative.is_absolute() or ".." in relative.parts or relative.parts[0] == "site":
            raise PipelineError("Research evidence must be a private project-relative path")
        target = run_dir / relative
        if not target.resolve().is_relative_to(run_dir.resolve()) or any((run_dir / Path(*relative.parts[:i])).is_symlink() for i in range(1, len(relative.parts) + 1)):
            raise PipelineError("Research evidence cannot escape the project or use symlinks")
        require_nonempty(target)

    sources = report.get("sources")
    if not isinstance(sources, list):
        raise PipelineError("researchPass.sources is required")
    types = set()
    for source in sources:
        if not isinstance(source, dict):
            raise PipelineError("Research sources must be objects")
        for field in ("sourceType", "url", "checkedAt", "outcome"):
            if not clean_text(source.get(field)):
                raise PipelineError(f"Research source requires {field}")
        if urlsplit(source["url"]).scheme not in {"https", "http"} or not urlsplit(source["url"]).netloc:
            raise PipelineError("Research sources require public HTTP(S) URLs")
        try:
            datetime.fromisoformat(source["checkedAt"].replace("Z", "+00:00"))
        except ValueError as exc:
            raise PipelineError("Research checkedAt must be an ISO timestamp") from exc
        evidence(source.get("evidencePath"))
        types.add(source["sourceType"])
    if not {"official-website", "official-social", "google-places"}.issubset(types):
        raise PipelineError("Research must check official website, official social and Google Places sources")
    photos = report.get("googlePhotos")
    if not isinstance(photos, dict) or photos.get("status") not in {"inspected", "no-photos", "unavailable"}:
        raise PipelineError("Record a Google photo inspection or supported no-photos/unavailable result")
    for field in ("photoToolCalls", "inspectedPhotoCount"):
        if type(photos.get(field)) is not int or photos[field] < 0:
            raise PipelineError(f"googlePhotos.{field} must be a nonnegative integer")
    if photos["status"] == "inspected" and (photos["photoToolCalls"] < 1 or photos["inspectedPhotoCount"] < 1):
        raise PipelineError("Google photo inspection requires a photo-tool call and a viewed image")
    if not clean_text(photos.get("reason")):
        raise PipelineError("Google photo outcome needs a specific reason")
    evidence(photos.get("evidencePath"))
    require_nonempty(run_dir / "SOURCES.md")
    return report


def validate_media_manifest(run_dir: Path) -> dict[str, Any]:
    manifest = load_json(run_dir / "MEDIA.json")
    if manifest.get("schemaVersion") != 1:
        raise PipelineError("MEDIA.json.schemaVersion must be 1")
    search = manifest.get("authenticMediaSearch")
    if not isinstance(search, dict) or search.get("completed") is not True:
        raise PipelineError("MEDIA.json must record a completed authentic-media search")
    result = search.get("result")
    if result not in {"usable-found", "none-usable"}:
        raise PipelineError(
            "MEDIA.json.authenticMediaSearch.result must be usable-found or none-usable"
        )
    sources = search.get("sourcesChecked")
    if not isinstance(sources, list) or not sources:
        raise PipelineError("MEDIA.json authentic-media search requires sourcesChecked")
    for index, source in enumerate(sources):
        if not isinstance(source, dict):
            raise PipelineError(
                f"MEDIA.json authenticMediaSearch.sourcesChecked[{index}] must be an object"
            )
        for field in ("sourceType", "url", "outcome"):
            if not clean_text(source.get(field)):
                raise PipelineError(
                    "MEDIA.json authenticMediaSearch.sourcesChecked"
                    f"[{index}].{field} is required"
                )
    assets = manifest.get("assets")
    if not isinstance(assets, list) or not assets:
        raise PipelineError("MEDIA.json.assets must record the deployed media")
    identity_classes: list[str] = []
    for index, asset in enumerate(assets):
        if not isinstance(asset, dict):
            raise PipelineError(f"MEDIA.json.assets[{index}] must be an object")
        identity_class = asset.get("identityClass")
        if identity_class not in {"business-authentic", "conceptual-ui"}:
            raise PipelineError(
                f"MEDIA.json.assets[{index}].identityClass must be "
                "business-authentic or conceptual-ui"
            )
        if identity_class == "business-authentic":
            for field in ("sourceUrl", "localPath", "identityEvidence", "usageBasis", "credit"):
                if not clean_text(asset.get(field)):
                    raise PipelineError(f"Authentic asset requires {field}")
            if asset.get("rightsStatus") not in {"production-cleared", "public-preview-only"}:
                raise PipelineError("Authentic asset requires preview or production rightsStatus")
            if asset["rightsStatus"] == "public-preview-only" and not clean_text(asset.get("productionFollowUp")):
                raise PipelineError("Preview-only asset requires productionFollowUp")
        identity_classes.append(identity_class)
    if result == "usable-found" and "business-authentic" not in identity_classes:
        raise PipelineError(
            "MEDIA.json reports usable authentic media without a business-authentic asset"
        )
    if result == "none-usable" and "business-authentic" in identity_classes:
        raise PipelineError(
            "MEDIA.json reports no usable authentic media but records a business-authentic asset"
        )
    effects = manifest.get("scrollVideoEffects")
    if not isinstance(effects, list) or len(effects) > 2:
        raise PipelineError("MEDIA.json must record zero, one, or two scroll-video effects")
    effect_ids: set[str] = set()
    for index, effect in enumerate(effects):
        if not isinstance(effect, dict):
            raise PipelineError(f"MEDIA.json.scrollVideoEffects[{index}] must be an object")
        effect_id = clean_text(effect.get("id"))
        purpose = clean_text(effect.get("purpose"))
        if not effect_id or not purpose:
            raise PipelineError(
                f"MEDIA.json.scrollVideoEffects[{index}] requires id and purpose"
            )
        if effect_id in effect_ids:
            raise PipelineError("MEDIA.json scroll-video effect IDs must be unique")
        effect_ids.add(effect_id)
    return manifest


def validate_website_brief(
    run_dir: Path, state: dict[str, Any], qa: dict[str, Any]
) -> str:
    brief_path = run_dir / "WEBSITE-BRIEF.json"
    if not brief_path.exists():
        if state.get("mode") == "prospect":
            raise PipelineError("Prospect builds require WEBSITE-BRIEF.json")
        return "evidence-led"

    brief = load_json(brief_path)
    if brief.get("schemaVersion") != 1:
        raise PipelineError("WEBSITE-BRIEF.json.schemaVersion must be 1")
    experience = brief.get("experience")
    if not isinstance(experience, dict):
        raise PipelineError("WEBSITE-BRIEF.json.experience must be an object")
    profile = clean_text(experience.get("presentationProfile"))
    if profile not in PRESENTATION_PROFILES:
        raise PipelineError(
            "WEBSITE-BRIEF.json.experience.presentationProfile must be "
            "evidence-led or cinematic-media-first"
        )
    template = clean_text(experience.get("templateSkill"))
    if template and not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", template):
        raise PipelineError("experience.templateSkill must be a skill name")
    # Presentation is chosen in the brief, not implied by a template's name.
    # Retain the cinematic profile's geometry checks whenever it is selected.
    if profile != CINEMATIC_MEDIA_FIRST:
        return profile

    viewports = qa.get("viewports")
    if not isinstance(viewports, list):
        raise PipelineError("Cinematic profile QA requires viewport results")
    by_name = {
        clean_text(viewport.get("name")): viewport
        for viewport in viewports
        if isinstance(viewport, dict)
    }
    missing = [name for name in ("desktop", "tablet", "mobile") if name not in by_name]
    if missing:
        raise PipelineError(
            "Cinematic profile QA is missing viewports: " + ", ".join(missing)
        )
    failed = [
        name
        for name in ("desktop", "tablet", "mobile")
        if (
            (by_name[name].get("checks") or {}).get("cinematicMediaFirst") is not True
            or ((by_name[name].get("diagnostics") or {}).get("cinematicProfile") or {}).get(
                "requested"
            )
            is not True
            or clean_text(
                ((by_name[name].get("diagnostics") or {}).get("cinematicProfile") or {}).get(
                    "profile"
                )
            )
            != CINEMATIC_MEDIA_FIRST
        )
    ]
    if failed:
        raise PipelineError(
            "Cinematic profile geometry failed in: " + ", ".join(failed)
        )
    return profile


def validate_scroll_video_qa(qa: dict[str, Any], effect_count: int) -> None:
    viewports = qa.get("viewports")
    if not isinstance(viewports, list):
        raise PipelineError("Scroll-video motion QA requires viewport results")
    by_name = {
        clean_text(viewport.get("name")): viewport
        for viewport in viewports
        if isinstance(viewport, dict)
    }
    missing = [name for name in ("desktop", "tablet", "mobile") if name not in by_name]
    if missing:
        raise PipelineError(
            "Scroll-video motion QA is missing viewports: " + ", ".join(missing)
        )
    if effect_count == 0:
        unexpected = [
            name
            for name in ("desktop", "tablet", "mobile")
            if ((by_name[name].get("diagnostics") or {}).get("scrollVideoMotion") or {}).get(
                "requested"
            )
            is True
        ]
        if unexpected:
            raise PipelineError(
                "MEDIA.json declares no scroll-video effect but browser QA found one in: "
                + ", ".join(unexpected)
            )
        return
    failed = [
        name
        for name in ("desktop", "tablet", "mobile")
        if (
            (by_name[name].get("checks") or {}).get("scrollVideoMotion") is not True
            or (
                (motion := (
                    (by_name[name].get("diagnostics") or {}).get("scrollVideoMotion")
                    or {}
                )).get("requested")
                is not True
            )
            or motion.get("tested") is not True
            or motion.get("passed") is not True
            or clean_text(motion.get("motionState")) != "enhanced"
            or clean_text(motion.get("fallbackReason"))
            or (motion.get("narrative") or {}).get("passed") is not True
            or (motion.get("rapidScroll") or {}).get("tested") is not True
            or (motion.get("rapidScroll") or {}).get("passed") is not True
            or (
                (by_name[name].get("diagnostics") or {}).get("reducedMotionFallback")
                or {}
            ).get("tested")
            is not True
            or (
                (by_name[name].get("diagnostics") or {}).get("reducedMotionFallback")
                or {}
            ).get("passed")
            is not True
        )
    ]
    if failed:
        raise PipelineError(
            "Functional scroll-video motion QA failed in: " + ", ".join(failed)
        )


def validate_publisher_csp_qa(qa: dict[str, Any]) -> None:
    if qa.get("schemaVersion") != 3:
        raise PipelineError("Browser QA must use schemaVersion 3 with publisher CSP checks")
    viewports = qa.get("viewports")
    if not isinstance(viewports, list):
        raise PipelineError("Publisher CSP QA requires viewport results")
    by_name = {
        clean_text(viewport.get("name")): viewport
        for viewport in viewports
        if isinstance(viewport, dict)
    }
    failed = [
        name
        for name in ("desktop", "tablet", "mobile")
        if name not in by_name
        or (by_name[name].get("checks") or {}).get("publisherCsp") is not True
        or ((by_name[name].get("diagnostics") or {}).get("publisherCsp") or {}).get(
            "compatible"
        )
        is not True
    ]
    if failed:
        raise PipelineError("Publisher CSP browser QA failed in: " + ", ".join(failed))


def validate_build(run_dir: Path) -> dict[str, Any]:
    state = load_state(run_dir)
    selection = validate_selection(run_dir)
    for name in ("SOURCES.md", "DESIGN.md", "STORYBOARD.md", "VALIDATION.md"):
        require_nonempty(run_dir / name)
    validate_research(run_dir)
    media_manifest = validate_media_manifest(run_dir)
    visual_quality = validate_visual_quality(run_dir, state, media_manifest)
    if selection["businessKind"] == "restaurant":
        restaurant = load_json(run_dir / "restaurant.json")
        if restaurant.get("schemaVersion") != 1:
            raise PipelineError("restaurant.json.schemaVersion must be 1")

    qa = load_json(run_dir / "qa" / "QA-RESULT.json")
    if qa.get("passed") is not True:
        raise PipelineError("Browser QA did not pass")
    validate_publisher_csp(run_dir / "site")
    presentation_profile = validate_website_brief(run_dir, state, qa)
    validate_publisher_csp_qa(qa)
    scroll_effect_count = len(media_manifest["scrollVideoEffects"])
    validate_scroll_video_qa(qa, scroll_effect_count)
    manifest, total_bytes, digest = site_manifest(run_dir / "site")
    media = video_evidence(run_dir / "site", required=scroll_effect_count > 0)
    return {
        "selection": selection,
        "qa": qa,
        "manifest": manifest,
        "fileCount": len(manifest),
        "byteCount": total_bytes,
        "digest": digest,
        "media": media,
        "scrollEffectCount": scroll_effect_count,
        "presentationProfile": presentation_profile,
        "visualQuality": visual_quality,
    }


def cmd_init(args: argparse.Namespace) -> dict[str, Any]:
    run_dir = resolve_run_dir(args.run_dir)
    with locked(run_dir):
        state_path = run_dir / STATE_FILE
        if state_path.exists():
            state = load_state(run_dir)
            if state.get("mode") != args.mode or state.get("city") != args.city:
                raise PipelineError("Existing pipeline identity does not match init request")
            return {"ok": True, "idempotent": True, "state": state}
        state = {
            "schemaVersion": 1,
            "runId": run_dir.name,
            "mode": args.mode,
            "city": args.city,
            "stage": "initialized",
            "qualityVersion": 2,
            "createdAtUtc": utc_now(),
            "selection": None,
            "build": None,
            "release": None,
            "notifications": None,
        }
        save_state(run_dir, state)
        return {"ok": True, "idempotent": False, "state": state}


def cmd_record_selection(args: argparse.Namespace) -> dict[str, Any]:
    run_dir = resolve_run_dir(args.run_dir)
    with locked(run_dir):
        state = load_state(run_dir)
        stage = require_stage(state, {"initialized", "selected"})
        selection = validate_selection(run_dir)
        summary = {
            key: selection[key]
            for key in ("placeId", "businessName", "hostname", "category", "businessKind")
        }
        if stage == "selected":
            if state.get("selection") != summary:
                raise PipelineError("Recorded selection differs from selection.json")
            return {"ok": True, "idempotent": True, "state": state}
        state["stage"] = "selected"
        state["selection"] = summary
        save_state(run_dir, state)
        return {"ok": True, "idempotent": False, "state": state}


def cmd_begin_build(args: argparse.Namespace) -> dict[str, Any]:
    run_dir = resolve_run_dir(args.run_dir)
    with locked(run_dir):
        state = load_state(run_dir)
        published = published_evidence(run_dir)
        if published:
            raise PipelineError(f"Prospect already published ({published}); select a fresh business")
        stage = require_stage(state, {"selected", "build-ready"})
        validate_research(run_dir)
        validate_visual_quality(run_dir, state)
        if stage == "build-ready":
            return {"ok": True, "idempotent": True, "state": state}
        state["stage"] = "build-ready"
        state["build"] = {"beganAtUtc": utc_now(), "skill": "prospect-video-site"}
        save_state(run_dir, state)
        return {"ok": True, "idempotent": False, "state": state}


def cmd_complete_build(args: argparse.Namespace) -> dict[str, Any]:
    run_dir = resolve_run_dir(args.run_dir)
    with locked(run_dir):
        state = load_state(run_dir)
        stage = require_stage(state, {"build-ready", "qa-passed"})
        evidence = validate_build(run_dir)
        result = {
            "schemaVersion": 1,
            "status": "qa-passed",
            "runId": run_dir.name,
            "businessName": evidence["selection"]["businessName"],
            "businessKind": evidence["selection"]["businessKind"],
            "hostname": evidence["selection"]["hostname"],
            "siteDirectory": "site",
            "buildSkill": "prospect-video-site",
            "overlays": (
                ["cinematic-restaurant-builder"]
                if evidence["selection"]["businessKind"] == "restaurant"
                else []
            ),
            "qaResult": "qa/QA-RESULT.json",
            "fileCount": evidence["fileCount"],
            "byteCount": evidence["byteCount"],
            "siteDigest": evidence["digest"],
            "videoAssets": evidence["media"]["videos"],
            "posterAssets": evidence["media"]["posters"],
            "scrollVideoEffectCount": evidence["scrollEffectCount"],
            "presentationProfile": evidence["presentationProfile"],
            "visualQuality": evidence["visualQuality"],
            "physicalDeviceStatus": "not-tested",
            "validatedAtUtc": utc_now(),
        }
        if stage == "qa-passed":
            existing = load_json(run_dir / BUILD_RESULT_FILE)
            if existing.get("siteDigest") != result["siteDigest"]:
                raise PipelineError("Completed build digest no longer matches site/")
            return {"ok": True, "idempotent": True, "state": state, "result": existing}
        atomic_json(run_dir / BUILD_RESULT_FILE, result)
        state["stage"] = "qa-passed"
        state["build"].update({"completedAtUtc": utc_now(), "result": BUILD_RESULT_FILE})
        save_state(run_dir, state)
        return {"ok": True, "idempotent": False, "state": state, "result": result}


def cmd_status(args: argparse.Namespace) -> dict[str, Any]:
    run_dir = resolve_run_dir(args.run_dir)
    with locked(run_dir):
        return {"ok": True, "state": load_state(run_dir)}


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    subparsers = root.add_subparsers(dest="command", required=True)

    init = subparsers.add_parser("init")
    init.add_argument("--run-dir", required=True)
    init.add_argument("--mode", choices=("prospect", "named"), required=True)
    init.add_argument("--city", required=True)
    init.set_defaults(handler=cmd_init)

    selection = subparsers.add_parser("record-selection")
    selection.add_argument("--run-dir", required=True)
    selection.set_defaults(handler=cmd_record_selection)

    begin_build = subparsers.add_parser("begin-build")
    begin_build.add_argument("--run-dir", required=True)
    begin_build.set_defaults(handler=cmd_begin_build)

    complete_build = subparsers.add_parser("complete-build")
    complete_build.add_argument("--run-dir", required=True)
    complete_build.set_defaults(handler=cmd_complete_build)

    status = subparsers.add_parser("status")
    status.add_argument("--run-dir", required=True)
    status.set_defaults(handler=cmd_status)
    return root


def main() -> int:
    try:
        args = parser().parse_args()
        print(json.dumps(args.handler(args), indent=2, ensure_ascii=False))
        return 0
    except PipelineError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=os.sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
