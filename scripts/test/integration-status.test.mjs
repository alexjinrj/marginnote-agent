import assert from "node:assert/strict";
import { mkdtemp, mkdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  detectAddon,
  detectCodexMcp,
  inspectAddon,
} from "../integration-status.mjs";

test("add-on detection validates the MarginNote add-on id", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mn-addon-detect-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  const installed = path.join(root, "MarginNote", "Extensions", "marginnote-agent.mnaddon");
  await mkdir(installed, { recursive: true });
  await writeFile(
    path.join(installed, "mnaddon.json"),
    JSON.stringify({ addonid: "com.marginnote.agent.host", version: "0.9.2" }),
  );

  const addon = await inspectAddon(installed);
  assert.deepEqual(addon, {
    id: "com.marginnote.agent.host",
    installed: true,
    version: "0.9.2",
    directory: installed,
    enabled: null,
  });

  const status = await detectAddon(root, {
    HOME: root,
    MN_AGENT_ADDON_PATH: installed,
    MN_AGENT_STATE_DIR: path.join(root, "state"),
    MN_AGENT_BUNDLED_ADDON_ARCHIVE: path.join(root, "share", "marginnote-agent.mnaddon"),
  });
  assert.equal(status.installed, true);
  assert.equal(status.directory, installed);
  assert.equal(status.built_archive_available, false);
  assert.equal(status.bundled_archive_available, false);

  await mkdir(path.join(root, "share"), { recursive: true });
  await writeFile(path.join(root, "share", "marginnote-agent.mnaddon"), "zip");
  const packaged = await detectAddon(root, {
    HOME: root,
    MN_AGENT_ADDON_PATH: installed,
    MN_AGENT_STATE_DIR: path.join(root, "state"),
    MN_AGENT_BUNDLED_ADDON_ARCHIVE: path.join(root, "share", "marginnote-agent.mnaddon"),
  });
  assert.equal(packaged.bundled_archive_available, true);
});

test("add-on detection finds extensions in MarginNote's sandboxed container", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mn-addon-container-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  const installed = path.join(
    root,
    "Library",
    "Containers",
    "QReader.MarginStudy.easy",
    "Data",
    "Library",
    "Application Support",
    "MarginNote 4",
    "Extensions",
    "marginnote-agent.mnaddon",
  );
  await mkdir(installed, { recursive: true });
  await writeFile(
    path.join(installed, "mnaddon.json"),
    JSON.stringify({ addonid: "com.marginnote.agent.host", version: "0.9.2" }),
  );

  const status = await detectAddon(path.join(root, "libexec"), {
    HOME: root,
    MN_AGENT_STATE_DIR: path.join(root, "state"),
    MN_AGENT_BUNDLED_ADDON_ARCHIVE: path.join(root, "share", "marginnote-agent.mnaddon"),
  });
  assert.equal(status.installed, true);
  assert.equal(status.directory, installed);
  assert.equal(status.enabled, null);
});

test("add-on detection recognizes extracted addonid directories and rejects other manifests", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mn-addon-extracted-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  const extensions = path.join(root, "Library", "Containers", "QReader.MarginStudy.easy", "Data", "Library", "MarginNote Extensions");
  const installed = path.join(extensions, "com.marginnote.agent.host");
  const unrelated = path.join(extensions, "other.plugin");
  for (const [directory, addonid] of [[installed, "com.marginnote.agent.host"], [unrelated, "other.plugin"]]) {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "mnaddon.json"), JSON.stringify({ addonid, version: "0.9.2" }));
  }
  const env = { HOME: root, MN_AGENT_STATE_DIR: path.join(root, "state") };
  const detected = await detectAddon(root, env);
  assert.equal(detected.installed, true);
  assert.equal(detected.directory, installed);
  assert.equal(detected.version, "0.9.2");
  assert.equal(detected.enabled, null);
  assert.equal((await detectAddon(root, { ...env, MN_AGENT_ADDON_PATH: installed })).installed, true);
  assert.equal((await detectAddon(root, { ...env, MN_AGENT_ADDON_PATH: unrelated })).installed, false);
});

test("Codex MCP detection distinguishes installation, config, and path drift", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mn-mcp-detect-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  const projectDir = path.join(root, "libexec");
  const configPath = path.join(root, "config.toml");
  await mkdir(path.join(projectDir, "bin"), { recursive: true });
  await mkdir(path.join(projectDir, "mcp", "src"), { recursive: true });
  await mkdir(path.join(projectDir, "node_modules", "@modelcontextprotocol", "sdk"), { recursive: true });
  await writeFile(path.join(projectDir, "bin", "marginnote-agent-mcp"), "#!/bin/sh\n");
  await writeFile(path.join(projectDir, "mcp", "src", "index.mjs"), "");
  await writeFile(path.join(projectDir, "node_modules", "@modelcontextprotocol", "sdk", "package.json"), "{}");
  const wrapper = path.join(projectDir, "bin", "marginnote-agent-mcp");
  await writeFile(
    configPath,
    `[mcp_servers.marginnote]\ncommand = "node"\nargs = ["${wrapper}"]\nstartup_timeout_sec = 10\n`,
  );

  const env = {
    HOME: root,
    CODEX_HOME: root,
    MN_AGENT_CODEX_CONFIG: configPath,
    MN_AGENT_STATE_DIR: path.join(root, "state"),
  };
  const status = await detectCodexMcp(projectDir, { ...env, PATH: path.dirname(process.execPath) });
  assert.equal(status.installed, true);
  assert.equal(status.configured, true);
  assert.equal(status.points_to_this_project, true);
  assert.equal(status.requires_node_on_path, true);
  assert.equal(status.expected_entrypoint, wrapper);

  await rename(wrapper, `${wrapper}.old`);
  const missing = await detectCodexMcp(projectDir, { ...env, PATH: path.dirname(process.execPath) });
  assert.equal(missing.installed, false);
  assert.equal(missing.wrapper_installed, false);
});
