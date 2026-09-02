import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createStaticServer } from "./server.mjs";

async function withServer(run) {
  const root = await mkdtemp(path.join(tmpdir(), "neural-labs-web-"));
  await writeFile(path.join(root, "index.html"), "<!doctype html><title>Neural Labs</title>");
  await writeFile(
    path.join(root, "login-pending.html"),
    "<!doctype html><title>Authentication setup is in progress</title>",
  );
  await writeFile(path.join(root, "styles.css"), "body { color: black; }");
  await writeFile(path.join(root, "server.mjs"), "not public");
  await mkdir(path.join(root, "assets", "media"), { recursive: true });
  await mkdir(path.join(root, "assets", "brand"), { recursive: true });
  await writeFile(path.join(root, "assets", "media", "sample.mp4"), "0123456789");
  await writeFile(path.join(root, "assets", "brand", "neural-labs-favicon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');

  const server = createStaticServer({
    root,
    logger: { error() {} },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
    await rm(root, { recursive: true, force: true });
  }
}

test("serves the landing page and health endpoint", async () => {
  await withServer(async (origin) => {
    const landing = await fetch(`${origin}/`);
    assert.equal(landing.status, 200);
    assert.match(await landing.text(), /Neural Labs/);
    assert.equal(landing.headers.get("content-type"), "text/html; charset=utf-8");

    const stylesheet = await fetch(`${origin}/styles.css?v=test`);
    assert.equal(stylesheet.status, 200);
    assert.equal(stylesheet.headers.get("cache-control"), "no-cache");

    const health = await fetch(`${origin}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok\n");
    assert.equal(health.headers.get("cache-control"), "no-store");

    const favicon = await fetch(`${origin}/favicon.ico`);
    assert.equal(favicon.status, 200);
    assert.equal(favicon.headers.get("content-type"), "image/svg+xml");
    assert.match(await favicon.text(), /<svg/);
  });
});

test("supports byte ranges for landing-page video", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/assets/media/sample.mp4`, {
      headers: { Range: "bytes=2-5" },
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await response.text(), "2345");
  });
});

test("rejects missing files and unsupported methods", async () => {
  await withServer(async (origin) => {
    assert.equal((await fetch(`${origin}/missing`)).status, 404);
    assert.equal((await fetch(`${origin}/server.mjs`)).status, 404);
    assert.equal((await fetch(`${origin}/`, { method: "POST" })).status, 405);
  });
});

test("shows an intentional setup response until Nginx owns the login route", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/login`);
    assert.equal(response.status, 503);
    assert.match(await response.text(), /Authentication setup is in progress/);
  });
});
