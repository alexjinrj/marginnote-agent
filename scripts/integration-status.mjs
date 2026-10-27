import { execFile } from "node:child_process";
import { access, readFile, readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolveServicePaths } from "./service-config.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADDON_ID = "com.marginnote.agent.host";
const MARGINNOTE_CONTAINER = "QReader.MarginStudy.easy";

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function findAddonDirectories(roots, maxDepth = 5) {
  const results = [];
  for (const rootPath of roots) {
    if (!(await exists(rootPath))) continue;
    if (rootPath.endsWith(".mnaddon")) {
      results.push(rootPath);
      continue;
    }
    const pending = [{ directory: rootPath, depth: 0 }];
    while (pending.length) {
      const { directory, depth } = pending.pop();
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      // MarginNote installs extracted add-ons under their addonid, without a
      // .mnaddon suffix. Discover the manifest; inspectAddon validates its ID.
      if (entries.some((entry) => entry.isFile() && entry.name === "mnaddon.json")) {
        results.push(directory);
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const child = path.join(directory, entry.name);
        if (entry.name.endsWith(".mnaddon")) results.push(child);
        else if (depth < maxDepth) pending.push({ directory: child, depth: depth + 1 });
      }
    }
  }
  return results;
}

async function inspectAddon(directory) {
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, "mnaddon.json"), "utf8"));
    if (manifest.addonid !== ADDON_ID) return null;
    return {
      id: manifest.addonid,
      installed: true,
      version: typeof manifest.version === "string" ? manifest.version : null,
      directory,
      enabled: null,
    };
  } catch {
    return null;
  }
}

async function detectAddon(projectDir, env = process.env) {
  const paths = resolveServicePaths({ projectDir, env });
  const configured = env.MN_AGENT_ADDON_PATH
    ? [path.resolve(env.MN_AGENT_ADDON_PATH), paths.addonArchive]
    : [];
  const home = env.HOME || os.homedir();
  const library = path.join(home, "Library");
  const roots = configured.length
    ? configured.map((rootPath) => ({ rootPath, maxDepth: 3 }))
    : [
        // MarginNote's sandbox stores extensions below this direct root. Scan
        // it separately so a realistic installation is reachable without
        // walking every other application's container.
        {
          rootPath: path.join(library, "Containers", MARGINNOTE_CONTAINER, "Data", "Library"),
          maxDepth: 8,
        },
        { rootPath: path.join(library, "Containers"), maxDepth: 5 },
        { rootPath: path.join(library, "Application Support"), maxDepth: 5 },
        { rootPath: path.join(home, "Documents"), maxDepth: 5 },
        { rootPath: path.join(home, "Applications"), maxDepth: 5 },
      ];
  const directories = [
    ...new Set(
      (
        await Promise.all(
          roots.map(({ rootPath, maxDepth }) => findAddonDirectories([rootPath], maxDepth)),
        )
      ).flat(),
    ),
  ];
  const built = await exists(paths.addonArchive);
  const bundled = await exists(paths.bundledAddonArchive);
  for (const directory of directories) {
    const addon = await inspectAddon(directory);
    if (addon) {
      return {
        ...addon,
        built_archive_available: built,
        bundled_archive_available: bundled,
      };
    }
  }
  return {
    installed: false,
    built_archive_available: built,
    bundled_archive_available: bundled,
    searched: roots.map(({ rootPath }) => rootPath),
  };
}

function tomlTableValue(text, table, key) {
  const lines = text.split(/\r?\n/);
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(`^\\s*\\[${escaped}\\]\\s*(?:#.*)?$`);
  let active = false;
  for (const line of lines) {
    if (/^\s*\[.*\]\s*(?:#.*)?$/.test(line)) {
      active = header.test(line);
      continue;
    }
    if (!active) continue;
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*(?:#.*)?$`));
    if (match) return match[1].trim();
  }
  return null;
}

function unquoteToml(value) {
  if (!value) return null;
  const stringMatch = value.match(/^"((?:[^"\\]|\\.)*)"$/) ?? value.match(/^'([^']*)'$/);
  return stringMatch ? stringMatch[1].replace(/\\"/g, '"') : null;
}

async function canonicalPath(candidate) {
  try {
    return await realpath(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

async function resolveConfiguredCommand(command, env) {
  if (!command) return null;
  if (command.includes("/")) return canonicalPath(command);
  const pathEntries = (env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, command);
    if (await exists(candidate)) return canonicalPath(candidate);
  }
  return command;
}

async function detectCodexMcp(projectDir, env = process.env) {
  const paths = resolveServicePaths({ projectDir, env });
  const [wrapperInstalled, entrypointInstalled, dependenciesInstalled] = await Promise.all([
    exists(paths.mcpWrapper),
    exists(paths.mcpEntrypoint),
    exists(path.join(projectDir, "node_modules", "@modelcontextprotocol", "sdk", "package.json")),
  ]);
  const installation = {
    wrapper_installed: wrapperInstalled,
    entrypoint_installed: entrypointInstalled,
    dependencies_installed: dependenciesInstalled,
    installed: wrapperInstalled && entrypointInstalled && dependenciesInstalled,
  };
  const home = env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const configPath = env.MN_AGENT_CODEX_CONFIG
    ? path.resolve(env.MN_AGENT_CODEX_CONFIG)
    : path.join(home, "config.toml");
  if (!(await exists(configPath))) {
    return {
      ...installation,
      configured: false,
      config_path: configPath,
      reason: "config_not_found",
    };
  }
  const text = await readFile(configPath, "utf8");
  const command = unquoteToml(tomlTableValue(text, "mcp_servers.marginnote", "command"));
  const args = tomlTableValue(text, "mcp_servers.marginnote", "args");
  const expected = paths.mcpWrapper
    ? path.resolve(paths.mcpWrapper)
    : paths.mcpEntrypoint;
  const [canonicalExpected, canonicalEntrypoint] = await Promise.all([
    canonicalPath(expected),
    canonicalPath(paths.mcpEntrypoint),
  ]);
  const configuredPaths = (args?.match(/"(?:[^"\\]|\\.)*"/g) ?? []).map(unquoteToml);
  const canonicalConfigured = await Promise.all(
    configuredPaths.filter(Boolean).map((candidate) => canonicalPath(candidate)),
  );
  const resolvedCommand = await resolveConfiguredCommand(command, env);
  const pointsToThisProject = canonicalConfigured.includes(canonicalExpected)
    || canonicalConfigured.includes(canonicalEntrypoint)
    || resolvedCommand === canonicalExpected
    || resolvedCommand === canonicalEntrypoint;
  const commandIsNode = Boolean(
    command && ["node", "nodejs"].includes(path.basename(command).toLowerCase()),
  );
  return {
    ...installation,
    configured: Boolean(command),
    config_path: configPath,
    command,
    args,
    points_to_this_project: pointsToThisProject,
    expected_entrypoint: expected,
    command_is_node: commandIsNode,
    requires_node_on_path: commandIsNode,
  };
}

export async function probeMcp(projectDir, env = process.env) {
  const paths = resolveServicePaths({ projectDir, env });
  const wrapperInstalled = await exists(paths.mcpWrapper);
  const entrypoint = wrapperInstalled ? paths.mcpWrapper : paths.mcpEntrypoint;
  if (!(await exists(entrypoint))) return { ok: false, reason: "entrypoint_missing" };
  try {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const client = new Client({ name: "marginnote-dashboard", version: "1" });
    const transport = new StdioClientTransport({
      command: wrapperInstalled ? entrypoint : process.execPath,
      args: wrapperInstalled ? [] : [entrypoint],
      env,
      stderr: "pipe",
    });
    let timer;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("MCP handshake timed out after 10 seconds")),
            10_000,
          );
        }),
      ]);
      const tools = (await client.listTools()).tools;
      return { ok: true, tool_count: tools.length };
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
      await client.close().catch(() => {});
    }
  } catch (error) {
    return { ok: false, reason: "handshake_failed", message: error.message };
  }
}

async function detectMarginNote() {
  if (process.platform !== "darwin") return { running: false, reason: "not_macos" };
  try {
    const { stdout } = await execFileAsync("/bin/ps", ["-axo", "command="], { encoding: "utf8" });
    const running = /\/MarginNote 4(?: [^/]*)?\.app\/Contents\/MacOS\/MarginNote 4(?:\s|$)/.test(stdout);
    return { running };
  } catch (error) {
    return { running: false, reason: error.message };
  }
}

export async function collectIntegrationStatus({ projectDir = root, env = process.env, probe = true } = {}) {
  const paths = resolveServicePaths({ projectDir, env });
  const [addon, codex, marginNote, mcp] = await Promise.all([
    detectAddon(projectDir, env),
    detectCodexMcp(projectDir, env),
    detectMarginNote(),
    probe ? probeMcp(projectDir, env) : Promise.resolve({ ok: null, skipped: true }),
  ]);
  return {
    addon: {
      ...addon,
      archive: paths.addonArchive,
      bundled_archive: paths.bundledAddonArchive,
    },
    mcp: {
      ...codex,
      ...mcp,
      configured: codex.configured,
      client: "codex",
    },
    margin_note: marginNote,
    checked_at: new Date().toISOString(),
  };
}

export {
  root as projectDir,
  findAddonDirectories,
  inspectAddon,
  detectAddon,
  detectCodexMcp,
};
