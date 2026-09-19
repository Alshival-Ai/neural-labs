# Version-2 project contract

The existing pipeline JSON schemas remain version 1. New PIPELINE-STATE.json
records `qualityVersion: 2`, and the brief's experience should record the same.
Do not erase this field or relabel a project to bypass a gate. Historical completed
projects are not silently migrated. `begin-build` checks visual direction;
`complete-build` additionally checks asset policy, frame sequences and recorded QA.
These checks validate evidence structure/media, not artistic quality. The agent
must inspect the page and make the visual judgment itself.

## BUSINESS-VISUAL-BRIEF.json

Store outside site/. Populate from actual observation, not this example:

```json
{
  "schemaVersion": 1,
  "placeId": "<same actual place ID as selection.json>",
  "photoCoverage": {
    "status": "inspected",
    "inspectedCount": 12,
    "scope": "Exterior, interiors, menu, work; browser gallery and official site",
    "limitations": "Sampled a larger gallery; recorded stopping reason in evidence",
    "evidencePath": "RESEARCH-EVIDENCE.md"
  },
  "observations": [{
    "id": "reading-corner",
    "sourceUrl": "<actual inspected source>",
    "observation": "<directly visible detail>",
    "confidence": "observed; date/currentness limitation recorded"
  }],
  "designDecisions": [{
    "observationIds": ["reading-corner"],
    "kind": "layout",
    "feature": "<original business-specific feature>",
    "customerBenefit": "<how this helps the visitor>",
    "implementationTarget": "<section/component>"
  }],
  "assetPolicy": {
    "generation": {"status": "completed", "evidencePath": "ASSET-EVIDENCE.md"},
    "stockExceptions": []
  },
  "designReview": {"observed": true, "evidencePath": "VALIDATION.md"}
}
```

Before build, omit designReview; fill it only after actual review. Photo status can
be `no-photos` or `unavailable` with evidence and `fallbackDirectionReason`; do not
invent observations or require inaccessible photos to finish. A palette-only
decision is insufficient when the place was inspected. See asset-policy.md for
origin fields and stock exceptions. Historical/source derivatives retain origin.

## Continuous numbered frames in MEDIA.json

Keep `scrollVideoEffects` and `scrollFrameEffects` separate. A frame effect has
`id`, `recipe: scroll-frame-sequence`, `sequenceAssetId`, `posterAssetId`, purpose
and fallback behavior. Its sequence asset has the existing identity/origin fields
plus `localPath: site/assets/sequence/frame-%03d.webp`, `frameCount`, `frameRate`,
`firstFrame`, `width`, `height`, `totalBytes`, `derivedFrom` (retained source asset
ID), `sourceStartSeconds`, and `sourceDurationSeconds`. The retained original is
outside site/. Choose the window and rate before extraction; count all site files.

For example, after probing a suitable native 24fps source, a 4s window yields
96 distinct frames. Extract from that original with FFmpeg (adjust known paths):

```sh
ffmpeg -ss 2 -i media-src/original.mp4 -t 4 -vf 'fps=24,scale=960:-2' -c:v libwebp -quality 82 -start_number 1 site/assets/sequence/frame-%03d.webp
```

Do not extract over old frames; use a new empty project-local output directory.
Verify the actual count, dimensions and payload after extraction. A 3fps source
cannot become detailed motion by asking FFmpeg for 24fps. The build gate probes
the retained original, validates native rate/window/count, checks every file,
detects exact duplicate frames, decodes the sequence and checks the whole-site
budget. It does not detect all visual near-duplicates; continuous browser QA is
still required. Use a gallery recipe for intentionally discrete still collections.

## MOTION-QA.json for frame scenes

Record `schemaVersion: 1` and `scenes`, each containing the effect `id`,
`observed: true`, browser, viewport, measured `activeScrollPx` (excluding holds),
private evidencePath, and checks with actual Boolean results for:

- continuousForward, continuousReverse, rapidAlternating, holdsAndRelease
- resize, failedFrame, reducedMotion, noJs, saveData, mobile

Include screenshot/recording paths, observed defects and fixes in the evidence.
Do not fill unexecuted checks as true. Endpoints alone do not meet these checks.
If a required browser check is unavailable, report it incomplete and do not claim
full motion QA. Inspect phase words/descriptions at intermediate states too.
