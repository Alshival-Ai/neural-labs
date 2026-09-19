# Smooth motion and comfortable scroll pacing

First distinguish the primitive. Tedy/GSAP image choreography animates positions
continuously; additional raster frames do not fix its timing. Plan entry, spread,
message reveal, hold and release with enough travel for each beat. Inspect images
at the crowded midpoint, not only the start/end. Use real content to choose gaps.

For continuous filmed motion, preserve temporal detail. The Dream Creations audit
found a 24-fps, 316-frame source reduced to 40 frames at 3 fps. Endpoint checks
passed while about 49 scroll pixels separated image changes on a desktop. Never
use that as a smooth-motion preset. Prefer a coherent 4-6 second section at its
native 24-30 fps (roughly 96-180 distinct frames), subject to the actual source.
Upsampling 3-fps stills merely duplicates frames; extract from the original source.
If a source cannot support smooth motion, select another scene or a different
interaction. Do not manufacture a low-frame-rate exception to fit file limits.

Keep the publisher's 200 files/50 MiB budget. Count all HTML, fonts, scripts and
other assets before choosing sequence length. Shorten the meaningful clip, resize
and compress intelligently, or use a tested seekable video. Do not raise hosting
limits. A headless browser codec failure alone does not establish that native
video seeking fails in the user's browser; test actual browser/codec support.

Record native source fps, source window, extracted count/fps, total bytes, dimensions,
file pattern and active scroll travel. Recommended default: 24-30 unique samples
per source second and roughly <=12 CSS scroll pixels per frame at the QA viewport.
The gate rejects <20 fps and >18 px/frame for continuous-motion sequences; visual
QA still decides whether a passing sequence is smooth. For authored discrete
slides use an ordinary gallery/Tedy recipe, not scroll-frame-sequence metadata.

Reserve a readable initial state and a final hold (often 10-15% each), with local
progress mapped only over the active range. Reach the last frame before release.
Use bounded directional prefetch/decode, a persistent canvas, and one scheduled
paint loop. Retain the last painted pixels while loading. Cache geometry and
refresh it on layout changes; avoid synchronous layout reads for every raw scroll.
Do not reload the whole page on resize or reduced-motion changes: clean up and
reinitialize the scoped controller while preserving normal document position.

Base CSS must be a complete normal-height static page. Add sticky height/pinning
only after successful enhancement. No JS, Save-Data, reduced motion, canvas/decode
failure and breakpoint changes must restore that base layout, readable labels
and an informative poster. Never leave a 300vh static spacer. Separate oversized
phase words from descriptions using actual line boxes; inspect descenders at
intermediate progress so words such as 'Shape' don't overlap their own copy.

QA: slow incremental forward/reverse scroll through the full scene, rapid input,
alternating input, continuous motion observation, first/final holds, exit/return,
deep-scroll refresh, resize/orientation, failed frame, reduced motion, no JS,
Save-Data and narrow/wide mobile. Record the browser, viewport, measured travel,
frame count, visible jumps or stalls and corrections. A few sampled endpoints
prove mapping only. Do not report unexecuted checks as passes.
