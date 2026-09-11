#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import secrets
import sys
import unicodedata
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


DEFAULT_RUNS_ROOT = Path(
    "/home/node/workspace/projects"
)
SELECTION_FILE = "selection.json"
DISCOVERY_PLAN_FILE = "discovery-plan.json"
MAX_JSON_BYTES = 8 * 1024 * 1024
PLACE_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,256}")
HOSTNAME_PATTERN = re.compile(
    r"(?=.{1,253}\Z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+"
    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
)

CATEGORY_CATALOG = (
    {"family": "food", "query": "independent restaurants and cafes"},
    {"family": "food", "query": "bakeries and dessert shops"},
    {"family": "food", "query": "food trucks and taquerias"},
    {"family": "food", "query": "coffee shops and juice bars"},
    {"family": "personal-care", "query": "salons and barber shops"},
    {"family": "personal-care", "query": "spas and beauty studios"},
    {"family": "automotive", "query": "independent auto repair shops"},
    {"family": "automotive", "query": "auto detailing and tint shops"},
    {"family": "automotive", "query": "tire and wheel shops"},
    {"family": "home-services", "query": "landscapers and lawn care services"},
    {"family": "home-services", "query": "plumbing and HVAC contractors"},
    {"family": "home-services", "query": "roofing and remodeling contractors"},
    {"family": "home-services", "query": "residential cleaning services"},
    {"family": "retail", "query": "boutiques and specialty retail"},
    {"family": "retail", "query": "florists and gift shops"},
    {"family": "fitness", "query": "gyms and fitness studios"},
    {"family": "fitness", "query": "dance and martial arts studios"},
    {"family": "pets", "query": "pet groomers and pet services"},
    {"family": "creative", "query": "photographers and videographers"},
    {"family": "events", "query": "event venues and party services"},
    {"family": "business-services", "query": "printing and sign shops"},
    {"family": "business-services", "query": "computer repair and IT services"},
    {"family": "household-services", "query": "laundromats and dry cleaners"},
    {"family": "household-services", "query": "moving and storage services"},
)


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalized_identity(value: Any) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return " ".join(re.findall(r"[\w]+", normalized, flags=re.UNICODE))


def _required_text(value: Any, *, field: str, maximum: int) -> str:
    normalized = re.sub(r"\s+", " ", str(value or "")).strip()
    if not normalized:
        raise ValueError(f"{field} is required")
    if len(normalized) > maximum:
        raise ValueError(f"{field} must be at most {maximum} characters")
    return normalized


def _optional_text(value: Any, *, maximum: int) -> str:
    normalized = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(normalized) > maximum:
        raise ValueError(f"value must be at most {maximum} characters")
    return normalized


def _runs_root(value: str | Path) -> Path:
    root = Path(value).expanduser().resolve(strict=True)
    if not root.is_dir() or root.is_symlink():
        raise ValueError("runs root must be a real directory")
    return root


def _run_dir(value: str | Path, root: Path) -> Path:
    supplied = Path(value).expanduser()
    if supplied.is_symlink():
        raise ValueError("run directory must not be a symbolic link")
    run_dir = supplied.resolve(strict=True)
    if run_dir.parent != root or not run_dir.is_dir() or run_dir.is_symlink():
        raise ValueError("run directory must be an immediate real child of runs root")
    return run_dir


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_JSON_BYTES:
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name(
        f".{path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp"
    )
    payload = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


@contextmanager
def _history_lock(root: Path, *, exclusive: bool) -> Iterator[None]:
    lock_path = root / ".candidate-history.lock"
    descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        with os.fdopen(descriptor, "r+") as stream:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
            yield
            fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
    finally:
        os.chmod(lock_path, 0o600)


def _checkpoint_fields(run_dir: Path) -> dict[str, str]:
    path = run_dir / "CHECKPOINT.md"
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 256 * 1024:
        return {}
    fields: dict[str, str] = {}
    patterns = {
        "city": re.compile(r"^- City:\s*`?([^`]+?)`?\s*$", re.IGNORECASE),
        "businessName": re.compile(
            r"^- Selected business:\s*`?([^`]+?)`?\s*$", re.IGNORECASE
        ),
        "hostname": re.compile(r"^- Hostname:\s*`?([^`]+?)`?\s*$", re.IGNORECASE),
        "status": re.compile(r"^- Stage:\s*`?([^`]+?)`?\s*$", re.IGNORECASE),
    }
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return {}
    for line in lines:
        for field, pattern in patterns.items():
            match = pattern.match(line.strip())
            if match:
                fields[field] = match.group(1).strip()
    return fields


def _walk_objects(value: Any) -> Iterator[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk_objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_objects(child)


def _legacy_selection(run_dir: Path) -> dict[str, Any] | None:
    research = _read_json(run_dir / "research.json")
    if not research:
        return None
    selection = research.get("selection")
    if not isinstance(selection, dict):
        return None
    checkpoint = _checkpoint_fields(run_dir)
    place_id = str(
        selection.get("placeId")
        or selection.get("place_id")
        or selection.get("googlePlaceId")
        or selection.get("google_place_id")
        or ""
    ).strip()
    business_name = str(
        selection.get("business")
        or selection.get("businessName")
        or selection.get("selected_business")
        or checkpoint.get("businessName")
        or ""
    ).strip()
    if not PLACE_ID_PATTERN.fullmatch(place_id) or not business_name:
        return None

    address = str(
        selection.get("address")
        or selection.get("formattedAddress")
        or selection.get("formatted_address")
        or ""
    ).strip()
    if not address:
        for candidate in _walk_objects(research):
            candidate_id = str(
                candidate.get("placeId")
                or candidate.get("place_id")
                or candidate.get("googlePlaceId")
                or candidate.get("google_place_id")
                or ""
            ).strip()
            if candidate_id == place_id:
                address = str(
                    candidate.get("address")
                    or candidate.get("formattedAddress")
                    or candidate.get("formatted_address")
                    or ""
                ).strip()
                if address:
                    break

    return {
        "schemaVersion": 1,
        "runId": run_dir.name,
        "city": str(
            selection.get("city")
            or checkpoint.get("city")
            or (research.get("run") or {}).get("city")
            or ""
        ).strip(),
        "placeId": place_id,
        "businessName": business_name,
        "address": address,
        "hostname": str(
            selection.get("hostname") or checkpoint.get("hostname") or ""
        ).strip().lower(),
        "category": str(selection.get("category") or "").strip(),
        "businessKind": "general",
        "selectedAtUtc": _run_timestamp(run_dir.name),
        "status": checkpoint.get("status", "selected"),
        "source": "legacy-research",
    }


def _run_timestamp(run_name: str) -> str:
    try:
        value = datetime.strptime(run_name[:16], "%Y%m%dT%H%M%SZ").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        return ""
    return value.isoformat().replace("+00:00", "Z")


def published_evidence(run_dir: Path) -> str | None:
    """Release evidence wins over stale build-stage or scratch checkpoints."""
    for filename, statuses in (
        ("RELEASE-RESULT.json", {"active", "published", "deployed", "success"}),
        ("RELEASE-VERIFICATION.json", {"passed"}),
    ):
        record = _read_json(run_dir / filename) or {}
        if record.get("status") in statuses:
            return filename
    state = _read_json(run_dir / "PIPELINE-STATE.json") or {}
    release = state.get("release") or {}
    if isinstance(release, dict) and release.get("status") in {"active", "published", "deployed", "success"}:
        return "PIPELINE-STATE.json"
    return None


def _selection(run_dir: Path) -> dict[str, Any] | None:
    stored = _read_json(run_dir / SELECTION_FILE)
    return stored if stored else _legacy_selection(run_dir)


def _iter_run_dirs(root: Path) -> Iterator[Path]:
    for candidate in sorted(root.iterdir(), key=lambda path: path.name):
        if candidate.is_dir() and not candidate.is_symlink():
            yield candidate


def _inventory_unlocked(root: Path, city: str | None = None) -> dict[str, Any]:
    normalized_city = _normalized_identity(city) if city else ""
    selections: list[dict[str, Any]] = []
    for run_dir in _iter_run_dirs(root):
        selection = _selection(run_dir)
        if not selection:
            continue
        if normalized_city and _normalized_identity(selection.get("city")) != normalized_city:
            continue
        selections.append(selection)
    return {
        "runsRoot": str(root),
        "city": city or None,
        "count": len(selections),
        "excludePlaceIds": sorted(
            {
                str(item.get("placeId"))
                for item in selections
                if PLACE_ID_PATTERN.fullmatch(str(item.get("placeId") or ""))
            }
        ),
        "selections": selections,
        "timestamp": _timestamp(),
    }


def inventory(root: Path, city: str | None = None) -> dict[str, Any]:
    with _history_lock(root, exclusive=False):
        return _inventory_unlocked(root, city)


def migrate(root: Path) -> dict[str, Any]:
    migrated: list[str] = []
    skipped: list[str] = []
    with _history_lock(root, exclusive=True):
        for run_dir in _iter_run_dirs(root):
            target = run_dir / SELECTION_FILE
            if target.exists():
                skipped.append(run_dir.name)
                continue
            selection = _legacy_selection(run_dir)
            if not selection:
                skipped.append(run_dir.name)
                continue
            _atomic_json(target, selection)
            migrated.append(run_dir.name)
    return {"migrated": migrated, "skipped": skipped, "timestamp": _timestamp()}


def _selection_conflict(left: dict[str, Any], right: dict[str, Any]) -> str | None:
    if str(left.get("placeId")) == str(right.get("placeId")):
        return "placeId"
    left_hostname = str(left.get("hostname") or "").lower()
    right_hostname = str(right.get("hostname") or "").lower()
    if left_hostname and left_hostname == right_hostname:
        return "hostname"
    left_name = _normalized_identity(left.get("businessName"))
    right_name = _normalized_identity(right.get("businessName"))
    left_address = _normalized_identity(left.get("address"))
    right_address = _normalized_identity(right.get("address"))
    if left_name and left_name == right_name and left_address and left_address == right_address:
        return "businessName+address"
    return None


def reserve(
    root: Path,
    run_dir: Path,
    *,
    city: str,
    place_id: str,
    business_name: str,
    address: str,
    hostname: str,
    category: str,
    business_kind: str = "general",
) -> dict[str, Any]:
    normalized_place_id = _required_text(place_id, field="place_id", maximum=256)
    if not PLACE_ID_PATTERN.fullmatch(normalized_place_id):
        raise ValueError("place_id has an invalid format")
    normalized_hostname = _required_text(hostname, field="hostname", maximum=253).lower()
    if not HOSTNAME_PATTERN.fullmatch(normalized_hostname):
        raise ValueError("hostname has an invalid format")
    normalized_business_kind = _required_text(
        business_kind, field="business_kind", maximum=32
    ).lower()
    if normalized_business_kind not in {"general", "restaurant"}:
        raise ValueError("business_kind must be general or restaurant")
    candidate = {
        "schemaVersion": 1,
        "runId": run_dir.name,
        "city": _required_text(city, field="city", maximum=120),
        "placeId": normalized_place_id,
        "businessName": _required_text(
            business_name, field="business_name", maximum=200
        ),
        "address": _optional_text(address, maximum=300),
        "hostname": normalized_hostname,
        "category": _optional_text(category, maximum=160),
        "businessKind": normalized_business_kind,
        "selectedAtUtc": _timestamp(),
        "status": "selected",
        "source": "reservation",
    }
    with _history_lock(root, exclusive=True):
        published = published_evidence(run_dir)
        if published:
            return {"reserved": False, "conflict": "already-published", "evidence": published, "runId": run_dir.name}
        existing_target = _read_json(run_dir / SELECTION_FILE)
        if existing_target:
            fields = ("city", "placeId", "businessName", "address", "hostname", "businessKind")
            if all(existing_target.get(field) == candidate.get(field) for field in fields):
                return {"reserved": True, "idempotent": True, "selection": existing_target}
            raise RuntimeError("run directory already contains a different selection")
        for existing in _inventory_unlocked(root)["selections"]:
            if str(existing.get("runId")) == run_dir.name:
                continue
            conflict = _selection_conflict(existing, candidate)
            if conflict:
                return {
                    "reserved": False,
                    "conflict": conflict,
                    "existing": {
                        "runId": existing.get("runId"),
                        "businessName": existing.get("businessName"),
                        "placeId": existing.get("placeId"),
                        "hostname": existing.get("hostname"),
                    },
                }
        _atomic_json(run_dir / SELECTION_FILE, candidate)
    return {"reserved": True, "idempotent": False, "selection": candidate}


def _category_order(seed: str) -> list[dict[str, str]]:
    return sorted(
        (dict(item) for item in CATEGORY_CATALOG),
        key=lambda item: hashlib.sha256(
            f"{seed}\0{item['query']}".encode("utf-8")
        ).digest(),
    )


def _recent_queries(root: Path, run_dir: Path, city: str) -> list[str]:
    normalized_city = _normalized_identity(city)
    for candidate in reversed(list(_iter_run_dirs(root))):
        if candidate == run_dir:
            continue
        plan = _read_json(candidate / DISCOVERY_PLAN_FILE)
        if not plan or _normalized_identity(plan.get("city")) != normalized_city:
            continue
        queries = plan.get("initialQueries")
        if isinstance(queries, list):
            return [
                str(item.get("query"))
                for item in queries
                if isinstance(item, dict) and item.get("query")
            ]
    return []


def create_plan(
    root: Path,
    run_dir: Path,
    *,
    city: str,
    initial_count: int = 5,
    fallback_count: int = 3,
) -> dict[str, Any]:
    if not 3 <= initial_count <= 8:
        raise ValueError("initial_count must be between 3 and 8")
    if not 0 <= fallback_count <= 5:
        raise ValueError("fallback_count must be between 0 and 5")
    if initial_count + fallback_count > len(CATEGORY_CATALOG):
        raise ValueError("requested category count exceeds the catalog")
    normalized_city = _required_text(city, field="city", maximum=120)
    target = run_dir / DISCOVERY_PLAN_FILE
    with _history_lock(root, exclusive=True):
        existing = _read_json(target)
        if existing:
            return existing
        recent_queries = set(_recent_queries(root, run_dir, normalized_city))
        seed = secrets.token_hex(16)
        ordered = _category_order(seed)
        initial: list[dict[str, str]] = []
        used_queries: set[str] = set()
        used_families: set[str] = set()
        recent_overlap = 0

        for item in ordered:
            if len(initial) >= min(4, initial_count):
                break
            if item["family"] in used_families:
                continue
            is_recent = item["query"] in recent_queries
            if is_recent and recent_overlap >= 2:
                continue
            initial.append(item)
            used_queries.add(item["query"])
            used_families.add(item["family"])
            recent_overlap += int(is_recent)

        for item in ordered:
            if len(initial) >= initial_count:
                break
            if item["query"] in used_queries:
                continue
            is_recent = item["query"] in recent_queries
            if is_recent and recent_overlap >= 2:
                continue
            initial.append(item)
            used_queries.add(item["query"])
            recent_overlap += int(is_recent)

        fallback = [
            item for item in ordered if item["query"] not in used_queries
        ][:fallback_count]
        plan = {
            "schemaVersion": 1,
            "city": normalized_city,
            "seed": seed,
            "createdAtUtc": _timestamp(),
            "initialQueries": initial,
            "fallbackQueries": fallback,
            "recentQueries": sorted(recent_queries),
            "requirements": {
                "initialCategoryFamilies": len(
                    {item["family"] for item in initial}
                ),
                "recentQueryOverlap": recent_overlap,
                "targetFreshInCityCandidates": 12,
                "maximumProviderRequests": 8,
            },
        }
        _atomic_json(target, plan)
    return plan


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Plan and reserve non-duplicative prospect-site candidates."
    )
    parser.add_argument("--runs-root", default=str(DEFAULT_RUNS_ROOT))
    subparsers = parser.add_subparsers(dest="command", required=True)

    inventory_parser = subparsers.add_parser("inventory")
    inventory_parser.add_argument("--city", default="")

    subparsers.add_parser("migrate")

    plan_parser = subparsers.add_parser("plan")
    plan_parser.add_argument("--run-dir", required=True)
    plan_parser.add_argument("--city", required=True)
    plan_parser.add_argument("--initial-count", type=int, default=5)
    plan_parser.add_argument("--fallback-count", type=int, default=3)

    reserve_parser = subparsers.add_parser("reserve")
    reserve_parser.add_argument("--run-dir", required=True)
    reserve_parser.add_argument("--city", required=True)
    reserve_parser.add_argument("--place-id", required=True)
    reserve_parser.add_argument("--business-name", required=True)
    reserve_parser.add_argument("--address", default="")
    reserve_parser.add_argument("--hostname", required=True)
    reserve_parser.add_argument("--category", default="")
    reserve_parser.add_argument(
        "--business-kind", choices=("general", "restaurant"), default="general"
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        root = _runs_root(args.runs_root)
        if args.command == "inventory":
            result = inventory(root, args.city or None)
        elif args.command == "migrate":
            result = migrate(root)
        elif args.command == "plan":
            result = create_plan(
                root,
                _run_dir(args.run_dir, root),
                city=args.city,
                initial_count=args.initial_count,
                fallback_count=args.fallback_count,
            )
        elif args.command == "reserve":
            result = reserve(
                root,
                _run_dir(args.run_dir, root),
                city=args.city,
                place_id=args.place_id,
                business_name=args.business_name,
                address=args.address,
                hostname=args.hostname,
                category=args.category,
                business_kind=args.business_kind,
            )
        else:
            raise RuntimeError("unsupported command")
    except (OSError, RuntimeError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        return 2
    print(json.dumps({"ok": True, **result}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
