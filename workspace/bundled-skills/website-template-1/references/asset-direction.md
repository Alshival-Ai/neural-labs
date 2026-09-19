> Current workflow: use local-business-website-builder as the presentation owner.
> Read its business-photo-direction, asset-policy and quality-contract references.
> The active policy supersedes older stock defaults in this process supplement.

# Asset direction for Neural Labs

Before acquisition, give each required asset a role: identity/hero, service
example, authentic portfolio, location/team, atmosphere, interaction layer,
poster or social preview. Specify subject, framing, aspect ratio, focal point,
mobile crop, visual tone and whether authenticity is essential.

1. Complete the existing research skill and inspect real business media. Preserve
   source-use and attribution restrictions; a listing image is not automatically
   a redistributable file. Record unavailable or rejected candidates.
2. For representative roles use the configured generation tool; stock requires
   an explicit choice or documented fallback under the active asset policy. Search or prompt for the subject and composition
   in the asset plan, not just a category such as 'salon'. Inspect the actual
   output before assigning it a role. A nail example must show the nails clearly;
   a haircut guide must make the named cut visibly distinguishable.
3. Keep a consistent photographic direction across a set: compatible light,
   backdrop, crop and scale, while the service/detail changes. A pleasing but
   unrelated image is a failed asset decision, not a reason to rename the service.
4. Optimize derivatives after selecting the source. Use WebP/AVIF or appropriate
   JPEG/PNG, srcset/sizes, width/height and intentional object-position. Measure
   bytes and inspect mobile crops. Load the hero promptly and lazy-load later
   imagery. Self-host licensed fonts and record their licenses.

## Generated images

OpenClaw provides `image_generate` when an image provider is configured. Use its
`action: list` discovery before selecting a provider/model; inspect its current
schema. The installed runtime documents this in `/app/docs/tools/image-generation.md`.
The documented CLI alternative is `openclaw infer image`; read its current help.
Check availability without submitting a paid generation. Do not borrow credentials,
change provider settings or substitute the Models API's video model for a still
image generator. If unavailable, use fitting licensed media or report the missing
asset capability. Do not claim that an untested provider works.

A request to generate the website can include ordinary concept assets needed for
that build. Respect explicit budgets and restrictions. Generate only the planned
assets, using the configured provider and supported dimensions; inspect outputs
and retry only to correct a concrete defect. In asynchronous sessions retain the
task ID and wait for completion instead of submitting duplicates.

Prompt structure: communication role; exact subject/detail; viewpoint and crop;
lighting/background/color family; negative space; realism/style; exclusions such
as text, logos or implausible anatomy. For related images keep those constraints
consistent. Include the named service's visible defining features and inspect
that the generated result actually matches them.

Store prompts, provider/model, returned provenance, source path, dimensions,
derivative sizes and intended use in `MEDIA.json` or a linked project asset
manifest. Use the existing `conceptual-ui` identity class for representative
generated media. Describe its actual origin and terms; never call it Pexels or
invent a creator/license. Label generated examples visibly near their use and in
the concept disclosure. They are not the shop's work, staff, location or customers.
Keep replacement notes for authentic owner-approved imagery.

## Source handoff

Retain editable source and a reproducible build command under the project, with
lockfile and locally bundled media. Publish only `site/`. The old RichBoys
prepared release alone was insufficient as a reusable method: study its brief,
source, asset roles and QA together, not just a screenshot or deployed ZIP.
