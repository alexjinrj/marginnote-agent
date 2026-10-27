import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { packageAddonArchive } from "../addon-package.mjs";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectDir = fileURLToPath(new URL('../..', import.meta.url));

test("bundled release add-on matches the current source", async () => {
  const archive = path.join(projectDir, 'share', 'marginnote-agent.mnaddon');
  for (const entry of ['main.js', 'tools.js', 'bridge.js', 'network.js', 'config.js', 'mnaddon.json']) {
    const { stdout } = await execFileAsync('/usr/bin/unzip', ['-p', archive, entry], { encoding: 'buffer' });
    const source = path.join(projectDir, 'addon', entry === 'main.js' ? 'bridge-main.js' : entry);
    assert.deepEqual(stdout, await readFile(source), `${entry} is stale; run npm run package:addon`);
  }
});

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
