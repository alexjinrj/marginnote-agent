import os from "node:os";
import path from "node:path";

function envPath(env, name) {
  const value = env[name];
  return typeof value === "string" && value.trim() ? path.resolve(value.trim()) : null;
}

function homeDirectory(env) {
  return env.HOME || os.homedir();
}

function defaultDataRoot(env, platform) {
  if (platform === "darwin") {
    return path.join(homeDirectory(env), "Library", "Application Support");
  }
  return env.XDG_STATE_HOME || path.join(homeDirectory(env), ".local", "state");
}

function homebrewPrefix(projectDir) {
  const parts = path.resolve(projectDir).split(path.sep);
  const cellar = parts.lastIndexOf("Cellar");
  if (cellar <= 0) return null;
  return parts.slice(0, cellar).join(path.sep) || path.sep;
}

function defaultLogRoot(projectDir, env, platform) {
  const prefix = homebrewPrefix(projectDir);
  if (prefix) return path.join(prefix, "var", "log");
  if (platform === "darwin") {
    return path.join(homeDirectory(env), "Library", "Logs");
  }
  return env.XDG_STATE_HOME || path.join(homeDirectory(env), ".local", "state");
}

export function resolveServicePaths({
  env = process.env,
  projectDir,
  platform = process.platform,
} = {}) {
  if (!projectDir) throw new Error("projectDir is required");

  const stateDir = envPath(env, "MN_AGENT_STATE_DIR")
    ?? path.join(defaultDataRoot(env, platform), "MarginNote Agent");
  const logDir = envPath(env, "MN_AGENT_LOG_DIR")
    ?? (homebrewPrefix(projectDir)
      ? defaultLogRoot(projectDir, env, platform)
      : path.join(defaultLogRoot(projectDir, env, platform), "MarginNote Agent"));
  const helperDir = envPath(env, "MN_AGENT_HELPER_DIR")
    ?? path.join(stateDir, "bin");
  const addonArchive = envPath(env, "MN_AGENT_ADDON_ARCHIVE")
    ?? path.join(stateDir, "marginnote-agent.mnaddon");
  const bundledAddonArchive = envPath(env, "MN_AGENT_BUNDLED_ADDON_ARCHIVE")
    ?? path.join(projectDir, "share", "marginnote-agent.mnaddon");
  const prefix = homebrewPrefix(projectDir);
  // Point clients at Homebrew's stable bin link, not the versioned Cellar
  // directory, so `brew upgrade` does not invalidate their MCP configuration.
  const mcpWrapper = envPath(env, "MN_AGENT_MCP_WRAPPER")
    ?? (prefix
      ? path.join(prefix, "bin", "marginnote-agent-mcp")
      : path.join(projectDir, "bin", "marginnote-agent-mcp"));

  return {
    projectDir,
    stateDir,
    settingsFile: envPath(env, "MN_AGENT_SETTINGS_FILE")
      ?? path.join(stateDir, "host-control.json"),
    pidFile: envPath(env, "MN_AGENT_PID_FILE")
      ?? path.join(stateDir, "host.pid"),
    logDir,
    helperDir,
    addonBuildDir: envPath(env, "MN_AGENT_BUILD_DIR")
      ?? path.join(stateDir, "build", "addon"),
    addonArchive,
    bundledAddonArchive,
    mcpEntrypoint: path.join(projectDir, "mcp", "src", "index.mjs"),
    mcpWrapper,
  };
}

export function serviceEnvironment({
  env = process.env,
  projectDir,
  writesEnabled = false,
  paused = false,
  platform = process.platform,
} = {}) {
  const paths = resolveServicePaths({ env, projectDir, platform });
  return {
    ...env,
    MN_AGENT_STATE_DIR: paths.stateDir,
    MN_AGENT_SETTINGS_FILE: paths.settingsFile,
    MN_AGENT_PID_FILE: paths.pidFile,
    MN_AGENT_LOG_DIR: paths.logDir,
    MN_AGENT_HELPER_DIR: paths.helperDir,
    MN_AGENT_BUILD_DIR: paths.addonBuildDir,
    MN_AGENT_ADDON_ARCHIVE: paths.addonArchive,
    MN_AGENT_BUNDLED_ADDON_ARCHIVE: paths.bundledAddonArchive,
    MN_AGENT_MCP_WRAPPER: paths.mcpWrapper,
    MN_ENABLE_WRITES: writesEnabled ? "1" : "0",
    MN_AGENT_SERVICE_PAUSED: paused ? "1" : "0",
  };
}

export function helperEnvironment(env = process.env) {
  const helperDir = envPath(env, "MN_AGENT_HELPER_DIR");
  if (!helperDir) return env;
  return {
    ...env,
    MN_AGENT_HELPER_DIR: helperDir,
    PATH: [helperDir, env.PATH].filter(Boolean).join(path.delimiter),
  };
}
