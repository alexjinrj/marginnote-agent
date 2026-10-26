import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveServicePaths } from "./service-config.mjs";

export const LAUNCH_AGENT_LABEL = "com.shentry.marginnote-agent";

async function preferredNodePath() {
  const candidates = [
    process.env.MN_AGENT_NODE_PATH,
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    process.execPath,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known Node.js location.
    }
  }
  return process.execPath;
}

function launchAgentPath(pathEnvironment, nodePath) {
  const entries = [
    path.dirname(nodePath),
    ...(pathEnvironment || "")
      .split(path.delimiter)
      .filter((entry) => entry && !entry.includes("/.codex/tmp/")),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  return [...new Set(entries)].join(path.delimiter);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function createLaunchAgentPlist({
  nodePath,
  supervisorPath,
  projectDir,
  stdoutPath,
  stderrPath,
  pathEnvironment,
  enableWrites = false,
}) {
  const environment = pathEnvironment || enableWrites
    ? `
  <key>EnvironmentVariables</key>
  <dict>
${pathEnvironment ? `    <key>PATH</key>
    <string>${escapeXml(pathEnvironment)}</string>
` : ""}${enableWrites ? `    <key>MN_ENABLE_WRITES</key>
    <string>1</string>
` : ""}  </dict>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(supervisorPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(projectDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderrPath)}</string>${environment}
</dict>
</plist>
`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr || stdout}`));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function isLoaded(target) {
  try {
    await run("/bin/launchctl", ["print", target]);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const enableWrites = process.argv.includes("--enable-writes");
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectDir = path.resolve(scriptDir, "..");
  const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const logsDir = path.join(os.homedir(), "Library", "Logs", "MarginNote Agent");
  const plistPath = path.join(launchAgentsDir, `${LAUNCH_AGENT_LABEL}.plist`);
  const supervisorPath = path.join(scriptDir, "marginnote-host-supervisor.mjs");
  const domain = `gui/${process.getuid()}`;
  const target = `${domain}/${LAUNCH_AGENT_LABEL}`;
  const nodePath = await preferredNodePath();
  const settingsPath = resolveServicePaths({ projectDir }).settingsFile;
  let effectiveWrites = enableWrites;

  if (enableWrites) {
    let previous = {};
    try { previous = JSON.parse(await readFile(settingsPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ paused: previous.paused === true, writesEnabled: true }), { mode: 0o600 });
  } else {
    try { effectiveWrites = JSON.parse(await readFile(settingsPath, "utf8")).writesEnabled === true; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }

  await mkdir(launchAgentsDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await writeFile(
    plistPath,
    createLaunchAgentPlist({
      nodePath,
      supervisorPath,
      projectDir,
      stdoutPath: path.join(logsDir, "launchd.out.log"),
      stderrPath: path.join(logsDir, "launchd.err.log"),
      pathEnvironment: launchAgentPath(process.env.PATH, nodePath),
      enableWrites,
    }),
    { mode: 0o644 },
  );
  await chmod(plistPath, 0o644);

  if (await isLoaded(target)) {
    await run("/bin/launchctl", ["bootout", target]);
    await delay(500);
  }
  await run("/bin/launchctl", ["bootstrap", domain, plistPath]);

  console.log(`Installed ${LAUNCH_AGENT_LABEL}.`);
  console.log(`Host now follows MarginNote 4: ${plistPath}`);
  console.log(`Card writes: ${effectiveWrites ? "enabled" : "disabled"}.`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  if (process.env.MN_AGENT_ALLOW_LEGACY_LAUNCH_AGENT !== "1") {
    console.error(
      "The standalone LaunchAgent installer is deprecated because it can conflict with the Homebrew service on port 42117.",
    );
    console.error(
      'Install the Homebrew service instead: brew services start marginnote-agent. Set MN_AGENT_ALLOW_LEGACY_LAUNCH_AGENT=1 only for legacy recovery.',
    );
    process.exitCode = 1;
  } else {
    void main();
  }
}
