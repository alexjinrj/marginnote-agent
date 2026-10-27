import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { packageAddonArchive } from "../addon-package.mjs";

const execFileAsync = promisify(execFile);

test("add-on packaging creates the expected archive without native helpers", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mn-addon-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = path.join(root, "marginnote-agent.mnaddon");
  const stagingDir = path.join(root, "staging");

  assert.equal(await packageAddonArchive({ outputPath: archive, stagingDir }), archive);
  assert.ok((await stat(archive)).size > 0);
  const { stdout } = await execFileAsync("/usr/bin/unzip", ["-Z1", archive]);
  const entries = new Set(stdout.trim().split("\n"));
  for (const entry of ["mnaddon.json", "main.js", "config.js", "network.js", "tools.js", "bridge.js", "icon.png"]) {
    assert.ok(entries.has(entry), `archive should contain ${entry}`);
  }
  assert.equal(entries.has("AgentPanelController.js"), false);
  assert.equal(entries.has("bridge-main.js"), false);
});
