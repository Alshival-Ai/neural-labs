# Pointer Video Scrub

Use this when pointer position should seek a video that stays paused.

## Behavior

- Wait for metadata before reading duration or accepting scrub targets.
- Calculate horizontal progress from the interaction container: `(clientX - rect.left) / rect.width`, clamped to `0..1`.
- A pointer handler updates only the target time. A single animation-frame loop eases a displayed time toward the target and writes `video.currentTime` at most once per frame.
- Stop the loop when settled and restart it on the next target. Never call `play()`.
- Use a section-local pointer listener and clean up capture, listeners, and frames.
- Prefer scrub-friendly encodes with short GOPs and fast-start metadata. A poor source encode cannot be repaired by more frequent seeks.
- For coarse pointers or reduced motion, provide a range input, scroll alternative, or stable poster instead of depending on hover.

## Acceptance checks

- Left and right edges resolve to the beginning and end of the video within tolerance.
- The video remains paused throughout interaction.
- Pointer movement is smooth without duplicate animation loops or raw-event seeks.
