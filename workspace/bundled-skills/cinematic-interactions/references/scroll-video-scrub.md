# Scroll Video Scrub

Use this when a section's own scroll range should seek a paused video continuously.

Do not use this recipe for an exported image sequence. Use [scroll-frame-sequence.md](scroll-frame-sequence.md) when scroll progress selects numbered still frames.

## Behavior

- Give the section an explicit scroll length and a sticky viewport-sized stage.
- Calculate local progress from the section's position, for example `clamp(-rect.top / (sectionHeight - viewportHeight), 0, 1)`. Do not divide global document scroll by global document height.
- Wait for video metadata, then map local progress to a target time.
- The scroll handler stores a target only. One animation-frame loop eases displayed time and writes `currentTime` no more than once per frame.
- Keep the video paused. Downward scrolling advances and upward scrolling rewinds.
- Use passive scroll listeners when native scrolling is retained. Recompute geometry after relevant resize or media changes.
- Under reduced motion, use the poster or a small set of discrete static frames without sticky scroll trapping.

## Acceptance checks

- Progress is zero at the section entrance and one at its exit regardless of content before or after it.
- Reverse scrolling rewinds smoothly.
- The document does not jump and the video never starts ordinary playback.
