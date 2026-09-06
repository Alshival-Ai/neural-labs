import assert from "node:assert/strict";
import test from "node:test";
import { openclawRelease, verifyOpenClawRuntime, isOfficialSmsInstallation } from "./openclaw-runtime.mjs";

test("runtime check rejects version or source drift before provisioning", async () => {
  const execute = async () => ({ stdout: `OpenClaw ${openclawRelease.version} (${openclawRelease.sourceRevision.slice(0, 7)})\n` });
  assert.equal((await verifyOpenClawRuntime({}, execute)).version, openclawRelease.version);
  await assert.rejects(verifyOpenClawRuntime({ NEURAL_LABS_OPENCLAW_VERSION: "2000.1.1" }, () => assert.fail("must not execute")));
  await assert.rejects(verifyOpenClawRuntime({}, async () => ({ stdout: "OpenClaw 2000.1.1" })));
  await assert.rejects(verifyOpenClawRuntime({}, async () => ({ stdout: `OpenClaw ${openclawRelease.version} (ffffffff)` })));
});

test("SMS must have the matching official npm install record", () => {
  const version = openclawRelease.version;
  const info = { plugin: { origin: "global", version }, install: {
    source: "npm", spec: `@openclaw/sms@${version}`, resolvedName: "@openclaw/sms",
    resolvedVersion: version, resolvedSpec: `@openclaw/sms@${version}`,
  } };
  assert.equal(isOfficialSmsInstallation(info), true);
  assert.equal(isOfficialSmsInstallation(undefined), false);
  assert.equal(isOfficialSmsInstallation({ ...info, install: undefined }), false);
  for (const override of [{ source: "path" }, { spec: "@openclaw/sms@latest" },
    { resolvedName: "unofficial-sms" }, { resolvedVersion: "2000.1.1" }]) {
    assert.equal(isOfficialSmsInstallation({ ...info, install: { ...info.install, ...override } }), false);
  }
});
