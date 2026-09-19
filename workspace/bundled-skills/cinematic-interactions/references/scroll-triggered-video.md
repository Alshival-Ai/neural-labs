# Gesture-Triggered Video

Use this when one downward gesture should start ordinary forward playback. Do not map scroll position to `currentTime`.

## Behavior

- Model the interaction as `idle`, `armed`, `playing`, `complete`, or `error`.
- Arm it only when the section is the active viewport section. Use an observer or equivalent section ownership test before responding to wheel, touch, or keyboard input.
- A qualifying downward gesture calls `play()` once from the current intended start frame. Handle the returned promise.
- While playing, ignore repeated triggers. Avoid global scroll locking. If the experience requires temporary input consumption, scope it to the active section and release it for `ended`, `error`, reduced motion, skip, and cleanup.
- On `ended`, pause and retain the final frame. Define whether reverse navigation resets to the first frame; do not infer video reversal.
- Under reduced motion, show the poster/final composition with a conventional play control or a skip path.

## Acceptance checks

- Initial state is visibly stable.
- One qualifying downward gesture plays the video once to completion.
- Repeated gestures do not restart or scrub it.
- Completion and error paths both release input and allow the page to continue.
