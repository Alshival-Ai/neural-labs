---
name: web-video-asset-preparation
description: Prepare local videos for cinematic website use with seek-friendly MP4 derivatives, WebP posters, representative-frame inspection, and media verification. Use whenever a generated site includes scroll-controlled or triggered video; do not use to source media or claim that representative footage depicts a real business.
---

# Web Video Asset Preparation

Prepare a selected local source video for reliable website playback or scroll
seeking. This skill does not source media, establish business identity, grant
media rights, deploy a site, or authorize external actions.

## Establish the media boundary

1. Read the project instructions and asset manifest. Confirm the source exists,
   its provenance and representation class are recorded, and its intended page
   role cannot imply that conceptual footage depicts the real business.
2. Set explicit source, output MP4, and poster paths inside the site's local
   asset tree. Inspect existing outputs before replacing them and preserve
   unrelated files.
3. Inspect representative source frames near the start, middle, and end. For a
   scroll-controlled role, require visible continuous progression that remains
   understandable forward and backward. Reject dense cuts, nearly static clips,
   or indistinguishable endpoints.

## Create browser-ready derivatives

Normalize video with `ffmpeg`: remove audio, preserve aspect ratio inside the
target dimensions, require even dimensions, encode H.264 `yuv420p`, and add
fast-start metadata. For scroll seeking, use a short GOP and no B-frames:

```bash
ffmpeg -hide_banner -loglevel error -y \
  -i "$source" -an \
  -vf "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p" \
  -c:v libx264 -profile:v high -level 4.0 -preset medium -crf 24 \
  -g 10 -keyint_min 10 -sc_threshold 0 -bf 0 \
  -movflags +faststart "$output_mp4"
```

Choose a representative timestamp strictly inside the normalized duration and
extract a local WebP poster:

```bash
ffmpeg -hide_banner -loglevel error -y \
  -ss "$poster_timestamp" -i "$output_mp4" -frames:v 1 \
  -vf "scale=1280:-2" -c:v libwebp -quality 82 "$poster_webp"
```

Create a smaller mobile derivative when the desktop asset would impose an
unreasonable transfer or decode cost. Never hotlink the runtime video.

## Verify before integration

Probe the prepared file and require H.264 video, `yuv420p`, nonzero even
dimensions, nonzero duration and frame rate, `has_b_frames: 0`, and no audio:

```bash
ffprobe -v error \
  -show_entries stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate,duration,has_b_frames \
  -of json "$output_mp4"
```

Confirm the poster is a readable, nonempty WebP. Record source-to-derivative
mapping, codec, dimensions, duration, frame rate, poster timestamp, byte sizes,
provenance, identity class, and intended role in the asset manifest. Prefer one
short purposeful clip; keep the total site payload proportionate to mobile use.

Hand the verified local MP4 and poster to `$cinematic-interactions`, which owns
controller behavior, reduced-motion fallback, cleanup, and browser QA.

## Neural Labs continuous-motion quality

For local-business builds read
[motion-quality.md](../local-business-website-builder/references/motion-quality.md)
and [quality-contract.md](../local-business-website-builder/references/quality-contract.md)
before selecting source windows or extracting frames. Preserve native temporal
detail; a 3-fps sequence is not a smooth substitute for a 24-fps source. Shorten
the source window to fit the existing publication budget. Verify every frame,
continuous scrolling and static failure geometry, not just start/middle/end.
