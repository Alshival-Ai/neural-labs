#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";

const inputs = process.argv.slice(2);

if (inputs.length === 0) {
  console.error("Usage: node inspect-media.mjs <media-path> [media-path ...]");
  process.exit(2);
}

const results = [];
let failed = false;

for (const input of inputs) {
  const path = resolve(input);

  try {
    const stats = statSync(path);
    if (!stats.isFile()) throw new Error("Not a file");

    const raw = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=format_name,duration,size:stream=index,codec_type,codec_name,width,height,pix_fmt,avg_frame_rate",
        "-of",
        "json",
        path,
      ],
      { encoding: "utf8" },
    );
    const probe = JSON.parse(raw);
    const visualStream = probe.streams?.find(
      (stream) => stream.codec_type === "video",
    );

    results.push({
      path,
      bytes: stats.size,
      durationSeconds: Number(probe.format?.duration) || null,
      width: visualStream?.width ?? null,
      height: visualStream?.height ?? null,
      codec: visualStream?.codec_name ?? null,
      pixelFormat: visualStream?.pix_fmt ?? null,
      averageFrameRate: visualStream?.avg_frame_rate ?? null,
      format: probe.format?.format_name ?? null,
      ok: true,
    });
  } catch (error) {
    failed = true;
    results.push({
      path,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(JSON.stringify(results, null, 2));
process.exitCode = failed ? 1 : 0;
