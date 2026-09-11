# Prospect research output contract

Use `$business-research-and-media` after candidate discovery and before design,
stock searches, storyboard, or implementation. Its reusable research and image
inspection workflow lives in
[business-research-and-media/SKILL.md](../../business-research-and-media/SKILL.md).
Complete that workflow, then write the prospect-specific records below. Existing
automation prompts that point here must follow the skill as well as this contract.

Use the selected Place ID and existing project under
`/home/node/workspace/projects/<business-slug>/`. Download usable authentic assets
to `site/assets/business/`; keep research and evidence outside `site/`.

## Evidence required by the build helper


In `research.json`, add `researchPass` with:

- `version: 1`, the selected `placeId`, and a nonempty `businessSummary` grounded
  in offerings, location, visitor actions and differentiators (or their gaps).
- `sources`: records with `sourceType` (`official-website`, `official-social`,
  `google-places`, or `public-listing`), `url`, `checkedAt`, `outcome`, and
  `evidencePath` pointing to a nonempty project-relative evidence note. Record
  searches that establish an absent site/profile; do not invent a URL for it.
  Include website, social and Places checks; when an official source is blocked,
  document a public-listing alternative too.
- `googlePhotos`: `status` (`inspected`, `no-photos`, or `unavailable`),
  `photoToolCalls`, `inspectedPhotoCount`, `reason`, and `evidencePath`.
  `inspected` requires at least one photo-tool call and viewed image. Other
  outcomes need an explicit supported reason; they do not waive other research.
- `authenticMediaDecision`: explain selected business images and roles, or the
  specific reasons and alternatives behind a stock-only result.

Evidence notes belong outside `site/`. Record source URLs, tool/action names,
retrieval times and factual findings, not secrets or temporary signed photo URLs.
The helper validates these records and local evidence paths; it cannot certify
that a self-authored note is true. Tool history must support the final report.

In `MEDIA.json`, every business-authentic asset additionally needs `sourceUrl`,
`localPath`, `identityEvidence`, `rightsStatus` (`production-cleared` or
`public-preview-only`), `usageBasis`, `credit`, and `productionFollowUp` for a
preview-only asset. Record rejected candidates and Google inspection findings
in the authentic-media search, including when the original could not be acquired.

Run `pipeline.py begin-build --run-dir <project>` after these records exist.
Both begin-build and complete-build check research. When resuming an older,
unpublished project, fill in real missing research before continuing; never
backfill a successful inspection that did not happen. Published historical
reports remain historical and are not rewritten to claim new checks passed.
