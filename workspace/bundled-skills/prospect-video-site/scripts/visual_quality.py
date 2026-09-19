"""Versioned evidence and continuous-frame checks; never certifies art direction."""
from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
from fractions import Fraction
from pathlib import Path


class QualityError(RuntimeError):
    pass


def require(value, message):
    if not value:
        raise QualityError(message)


def text(value):
    return isinstance(value, str) and bool(value.strip())


def local_file(root, relative, private=False):
    require(text(relative), 'A project-relative evidence/asset path is required')
    path = Path(relative)
    require(not path.is_absolute() and '..' not in path.parts,
            'Paths must remain within the project')
    if private:
        require(path.parts[0] != 'site', 'Research/QA evidence must remain private')
    target = root / path
    require(target.resolve().is_relative_to(root.resolve()), 'Path escapes the project')
    require(not any((root / Path(*path.parts[:i])).is_symlink()
                    for i in range(1, len(path.parts) + 1)), 'Symlinks are not allowed')
    require(target.is_file() and target.stat().st_size > 0, f'Missing or empty file: {relative}')
    return target


def read_json(root, name):
    try:
        data = json.loads(local_file(root, name, private=True).read_text())
    except (ValueError, OSError) as exc:
        raise QualityError(f'Cannot read {name}: {exc}') from exc
    require(isinstance(data, dict), f'{name} must contain an object')
    return data


def required(root, state=None):
    state = state or {}
    brief = root / 'WEBSITE-BRIEF.json'
    experience = json.loads(brief.read_text()).get('experience', {}) if brief.exists() else {}
    return (state.get('qualityVersion', 1) >= 2 or experience.get('qualityVersion', 1) >= 2
            or experience.get('templateSkill') == 'local-business-website-builder')


def validate_direction(root):
    doc = read_json(root, 'BUSINESS-VISUAL-BRIEF.json')
    require(doc.get('schemaVersion') == 1, 'BUSINESS-VISUAL-BRIEF schemaVersion must be 1')
    selection = read_json(root, 'selection.json')
    require(doc.get('placeId') == selection.get('placeId') and text(doc.get('placeId')),
            'Visual research must match the selected business')
    coverage = doc.get('photoCoverage', {})
    require(isinstance(coverage, dict), 'photoCoverage must be an object')
    status = coverage.get('status')
    require(status in {'inspected', 'no-photos', 'unavailable'}, 'Record photo coverage outcome')
    require(text(coverage.get('scope')) and text(coverage.get('limitations')),
            'Record photo gallery coverage and limitations (including API-only access)')
    local_file(root, coverage.get('evidencePath'), private=True)
    observed = doc.get('observations')
    require(isinstance(observed, list), 'Record visual observations as a list')
    ids = set()
    for item in observed:
        require(isinstance(item, dict), 'Visual observations must be objects')
        require(text(item.get('id')) and item['id'] not in ids, 'Observation IDs must be unique')
        ids.add(item['id'])
        require(all(text(item.get(f)) for f in ['sourceUrl', 'observation', 'confidence']),
                'Observation requires source, visible detail and confidence')
    if status == 'inspected':
        require(type(coverage.get('inspectedCount')) is int and coverage['inspectedCount'] > 0
                and observed, 'Inspected photos require actual observations and count')
    else:
        require(text(doc.get('fallbackDirectionReason')), 'Unavailable photos require a supported fallback direction')
    decisions = doc.get('designDecisions')
    require(isinstance(decisions, list) and decisions, 'Record business-to-design decisions')
    structural = False
    for decision in decisions:
        require(isinstance(decision, dict), 'Design decisions must be objects')
        require(all(text(decision.get(f)) for f in ['feature', 'customerBenefit', 'implementationTarget']),
                'Design decisions need feature, customer benefit and implementation target')
        refs = decision.get('observationIds')
        require(isinstance(refs, list) and all(ref in ids for ref in refs), 'Invalid observation reference')
        if status == 'inspected':
            require(refs, 'Link design decisions to inspected business observations')
        structural |= decision.get('kind') in {'layout', 'content', 'interaction'}
    require(structural, 'Photo-led design must affect layout, content or interaction, not only color')
    return doc


def validate_assets(root, doc, manifest):
    policy = doc.get('assetPolicy', {})
    require(isinstance(policy, dict), 'assetPolicy must be an object')
    generation = policy.get('generation', {})
    require(isinstance(generation, dict), 'assetPolicy.generation must be an object')
    exceptions = policy.get('stockExceptions', [])
    require(isinstance(exceptions, list) and all(isinstance(e, dict) for e in exceptions),
            'stockExceptions must contain objects')
    by_id = {e.get('assetId'): e for e in exceptions}
    for asset in manifest['assets']:
        origin = asset.get('origin')
        require(origin in {'authentic', 'generated', 'stock', 'original-ui'},
                f"Record origin for asset {asset.get('id')}")
        source = str(asset.get('sourceUrl', '')).lower()
        if 'pexels.com/' in source:
            require(origin == 'stock', 'Pexels derivatives must retain stock origin')
        if origin == 'generated':
            local_file(root, asset.get('generationEvidencePath'), private=True)
        if origin != 'stock':
            continue
        exception = by_id.get(asset.get('id'), {})
        basis = exception.get('basis')
        require(basis in {'user-requested', 'generation-unavailable', 'generation-unsuitable'}
                and text(exception.get('reason')), f"Stock asset {asset.get('id')} requires a justified exception")
        local_file(root, exception.get('evidencePath'), private=True)
        if basis != 'user-requested':
            wanted = {'generation-unavailable': {'unavailable', 'failed'},
                      'generation-unsuitable': {'attempted', 'completed'}}[basis]
            require(generation.get('status') in wanted, 'Stock fallback requires recorded provider discovery/attempt')
            local_file(root, generation.get('evidencePath'), private=True)


def number(item, key, positive=True):
    value = item.get(key)
    require(type(value) in {int, float} and math.isfinite(value)
            and (value > 0 if positive else value >= 0), f'Invalid {key}')
    return value


def source_probe(path):
    try:
        result = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                                 '-show_entries', 'stream=avg_frame_rate,duration:format=duration',
                                 '-of', 'json', str(path)], capture_output=True, text=True, check=True)
        probe = json.loads(result.stdout)
        stream = probe['streams'][0]
        return float(Fraction(stream['avg_frame_rate'])), float(stream.get('duration') or probe['format']['duration'])
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, IndexError) as exc:
        raise QualityError('Cannot probe retained original motion source') from exc


def validate_frames(root, manifest, motion_qa=None):
    effects = manifest.get('scrollFrameEffects', [])
    require(isinstance(effects, list) and len(effects) <= 2, 'Record at most two continuous frame scenes')
    assets = {a.get('id'): a for a in manifest['assets']}
    require(len({e.get('id') for e in effects}) == len(effects), 'Frame effect IDs must be unique')
    for effect in effects:
        sequence = assets.get(effect.get('sequenceAssetId'), {})
        count = sequence.get('frameCount')
        require(type(count) is int and 2 <= count <= 200, 'Invalid frameCount')
        fps = number(sequence, 'frameRate')
        require(fps >= 20, f'Continuous motion is too sparse: {fps:g} fps; preserve native detail, normally 24-30 fps')
        start = number(sequence, 'sourceStartSeconds', positive=False)
        duration = number(sequence, 'sourceDurationSeconds')
        source = assets.get(sequence.get('derivedFrom'), {})
        source_path = local_file(root, source.get('localPath'), private=True)
        native_fps, source_duration = source_probe(source_path)
        require(fps <= native_fps + 0.1, 'Upsampling a sparse source does not create motion detail')
        require(start + duration <= source_duration + 0.1, 'Source window exceeds retained original')
        require(abs(count - duration * fps) <= 2, 'Frame count does not match sampled source duration')
        pattern = sequence.get('localPath', '')
        require(text(pattern) and len(re.findall(r'%0?[1-9]?d', pattern)) == 1,
                'Sequence needs one numbered frame pattern')
        require(pattern.startswith('site/'), 'Published sequence must be in site/')
        first = sequence.get('firstFrame', 1)
        require(type(first) is int and first >= 0, 'Invalid firstFrame')
        paths = [local_file(root, pattern % index) for index in range(first, first + count)]
        hashes = {hashlib.sha256(path.read_bytes()).digest() for path in paths}
        require(len(hashes) / count >= .9, 'Sequence contains excessive duplicate frames; re-extract native samples')
        # Decode all files; existence and metadata alone do not prove valid images.
        try:
            subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-framerate', str(fps),
                            '-start_number', str(first), '-i', str(root / pattern),
                            '-frames:v', str(count), '-f', 'null', '-'],
                           capture_output=True, check=True)
        except (OSError, subprocess.SubprocessError) as exc:
            raise QualityError('Sequence contains undecodable frames') from exc
        if motion_qa is not None:
            scenes = motion_qa.get('scenes', [])
            report = next((s for s in scenes if s.get('id') == effect.get('id')), {})
            require(report.get('observed') is True and text(report.get('browser'))
                    and text(report.get('viewport')), 'Frame QA needs actual browser/viewport observation')
            travel = number(report, 'activeScrollPx')
            require(travel / (count - 1) <= 18, 'Frame spacing is too coarse for active scroll travel')
            for check in ['continuousForward', 'continuousReverse', 'rapidAlternating', 'holdsAndRelease',
                          'resize', 'failedFrame', 'reducedMotion', 'noJs', 'saveData', 'mobile']:
                require(report.get('checks', {}).get(check) is True, f'Incomplete observed motion QA: {check}')
            local_file(root, report.get('evidencePath'), private=True)
    files = [p for p in (root / 'site').rglob('*') if p.is_file()]
    require(len(files) <= 200 and sum(p.stat().st_size for p in files) <= 50 * 1024 * 1024,
            'Sequence must fit the existing whole-site publication budget')
    return {'frameEffectCount': len(effects)}


def validate_quality(root, state=None, manifest=None):
    if not required(root, state):
        return {'qualityVersion': 1}
    doc = validate_direction(root)
    if manifest is None:
        return {'qualityVersion': 2, 'direction': 'recorded'}
    validate_assets(root, doc, manifest)
    html = '\n'.join(p.read_text() for p in (root / 'site').rglob('*.html'))
    if 'data-scroll-frame-sequence' in html:
        require(manifest.get('scrollFrameEffects'), 'Declared frame scenes require a manifest')
    qa = read_json(root, 'MOTION-QA.json') if manifest.get('scrollFrameEffects') else {}
    result = validate_frames(root, manifest, qa)
    review = doc.get('designReview', {})
    require(review.get('observed') is True, 'Record actual visual review against the decision ledger')
    local_file(root, review.get('evidencePath'), private=True)
    return {'qualityVersion': 2, **result}
