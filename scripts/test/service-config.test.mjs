import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveServicePaths, serviceEnvironment } from "../service-config.mjs";

test("service paths stay outside a Homebrew Cellar and support overrides", () => {
  const projectDir = "/opt/homebrew/Cellar/marginnote-agent/0.9.2/libexec";
  const paths = resolveServicePaths({
    projectDir,
    env: { HOME: "/Users/alice", PATH: "/usr/bin" },
    platform: "darwin",
  });

  assert.equal(paths.stateDir, "/Users/alice/Library/Application Support/MarginNote Agent");
  assert.equal(paths.logDir, "/opt/homebrew/var/log");
  assert.equal(paths.addonArchive, path.join(paths.stateDir, "marginnote-agent.mnaddon"));
  assert.equal(paths.bundledAddonArchive, path.join(projectDir, "share", "marginnote-agent.mnaddon"));
  assert.equal(paths.settingsFile, path.join(paths.stateDir, "host-control.json"));
  assert.equal(paths.helperDir, path.join(paths.stateDir, "bin"));
  assert.equal(paths.mcpEntrypoint, path.join(projectDir, "mcp", "src", "index.mjs"));
  assert.equal(
    paths.mcpWrapper,
    "/opt/homebrew/bin/marginnote-agent-mcp",
    "MCP clients must use the stable Homebrew link, not a versioned Cellar path",
  );

  const overrideEnv = {
    MN_AGENT_STATE_DIR: "/tmp/mn-state",
    MN_AGENT_LOG_DIR: "/tmp/mn-logs",
    MN_AGENT_ADDON_ARCHIVE: "/tmp/mn-addon.mnaddon",
    MN_AGENT_BUNDLED_ADDON_ARCHIVE: "/tmp/mn-bundled.mnaddon",
    MN_AGENT_MCP_WRAPPER: "/tmp/mn-mcp",
  };
  const overridden = resolveServicePaths({ projectDir, env: overrideEnv, platform: "darwin" });
  assert.equal(overridden.stateDir, "/tmp/mn-state");
  assert.equal(overridden.logDir, "/tmp/mn-logs");
  assert.equal(overridden.addonArchive, "/tmp/mn-addon.mnaddon");
  assert.equal(overridden.bundledAddonArchive, "/tmp/mn-bundled.mnaddon");
  assert.equal(overridden.mcpWrapper, "/tmp/mn-mcp");
});

test("source checkouts keep the adjacent MCP wrapper path", () => {
  const paths = resolveServicePaths({
    projectDir: "/tmp/src/marginnote-agent",
    env: { HOME: "/tmp/home" },
    platform: "darwin",
  });
  assert.equal(paths.mcpWrapper, "/tmp/src/marginnote-agent/bin/marginnote-agent-mcp");
});

test("service environment propagates runtime paths and write policy", () => {
  const env = serviceEnvironment({
    env: { HOME: "/Users/alice", PATH: "/usr/bin" },
    projectDir: "/tmp/marginnote-agent",
    writesEnabled: true,
    paused: true,
    platform: "darwin",
  });

  assert.equal(env.MN_ENABLE_WRITES, "1");
  assert.equal(env.MN_AGENT_SERVICE_PAUSED, "1");
  assert.equal(env.MN_AGENT_STATE_DIR, "/Users/alice/Library/Application Support/MarginNote Agent");
  assert.equal(env.MN_AGENT_MCP_WRAPPER, "/tmp/marginnote-agent/bin/marginnote-agent-mcp");
});
