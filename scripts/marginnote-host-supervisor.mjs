import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createControlServer } from "./host-control.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultProjectDir = path.resolve(path.dirname(scriptPath), "..");

export const MARGINNOTE_EXECUTABLE_PATTERN =
  /\/MarginNote 4(?: [^/]*)?\.app\/Contents\/MacOS\/MarginNote 4(?:\s|$)/;

export function isMarginNoteProcess(command) {
  return MARGINNOTE_EXECUTABLE_PATTERN.test(String(command));
}

export function isMarginNoteRunning() {
  const result = spawnSync("/bin/ps", ["-axo", "command="], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Unable to inspect running processes (ps exited ${result.status})`);
  }
  return result.stdout.split("\n").some(isMarginNoteProcess);
}

export function isLocalPortInUse(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (inUse) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(inUse);
    };

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(300, () => finish(false));
  });
}

function spawnHost(projectDir, writesEnabled) {
  return spawn(process.execPath, [path.join(projectDir, "host/src/bridge-main.mjs")], {
    cwd: projectDir,
    env: { ...process.env, MN_ENABLE_WRITES: writesEnabled ? "1" : "0" },
    stdio: "inherit",
  });
}

function isChildRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

export class MarginNoteHostSupervisor {
  constructor({
    projectDir = defaultProjectDir,
    port = Number(process.env.MN_BRIDGE_PORT || 42117),
    pollIntervalMs = 1000,
    restartDelayMs = 2000,
    stopGraceMs = 2000,
    now = Date.now,
    isMarginNoteRunning: checkMarginNoteRunning = isMarginNoteRunning,
    isPortInUse: checkPortInUse = isLocalPortInUse,
    spawnHost: launchHost = spawnHost,
    logger = console,
    writesEnabled = false,
    paused = false,
  } = {}) {
    this.projectDir = projectDir;
    this.port = port;
    this.pollIntervalMs = pollIntervalMs;
    this.restartDelayMs = restartDelayMs;
    this.stopGraceMs = stopGraceMs;
    this.now = now;
    this.checkMarginNoteRunning = checkMarginNoteRunning;
    this.checkPortInUse = checkPortInUse;
    this.launchHost = launchHost;
    this.logger = logger;
    this.hostProcess = null;
    this.timer = null;
    this.reconciling = false;
    this.nextStartAt = 0;
    this.portConflictReported = false;
    this.stoppingHost = null;
    this.marginNoteMissingSince = null;
    this.writesEnabled = writesEnabled;
    this.paused = paused;
    this.marginNoteRunning = false;
  }

  start() {
    if (this.timer) return;
    void this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), this.pollIntervalMs);
  }

  async reconcile() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const marginNoteRunning = await this.checkMarginNoteRunning();
      this.marginNoteRunning = marginNoteRunning;
      if (this.paused) {
        this.stopHost();
        return;
      }
      if (!marginNoteRunning) {
        if (this.marginNoteMissingSince === null) this.marginNoteMissingSince = this.now();
        if (this.now() - this.marginNoteMissingSince < this.stopGraceMs) return;
        this.stopHost();
        return;
      }

      this.marginNoteMissingSince = null;
      if (isChildRunning(this.hostProcess)) return;
      if (this.now() < this.nextStartAt) return;

      if (await this.checkPortInUse(this.port)) {
        if (!this.portConflictReported) {
          this.logger.warn(
            `Port ${this.port} is already in use; leaving the existing process untouched.`,
          );
          this.portConflictReported = true;
        }
        return;
      }

      this.portConflictReported = false;
      this.startHost();
    } catch (error) {
      this.logger.error("MarginNote Agent supervisor check failed:", error);
    } finally {
      this.reconciling = false;
    }
  }

  startHost() {
    const child = this.launchHost(this.projectDir, this.writesEnabled);
    this.hostProcess = child;
    this.stoppingHost = null;
    this.nextStartAt = this.now() + this.restartDelayMs;
    this.logger.log(`MarginNote detected; starting Agent Host (pid ${child.pid ?? "pending"}).`);

    child.once("exit", (code, signal) => {
      if (this.hostProcess === child) this.hostProcess = null;
      if (this.stoppingHost === child) this.stoppingHost = null;
      this.logger.log(`MarginNote Agent Host exited (code ${code}, signal ${signal ?? "none"}).`);
    });
    child.once("error", (error) => {
      if (this.hostProcess === child) this.hostProcess = null;
      if (this.stoppingHost === child) this.stoppingHost = null;
      this.logger.error("MarginNote Agent Host failed to start:", error);
    });
  }

  stopHost() {
    const child = this.hostProcess;
    if (!isChildRunning(child)) {
      this.hostProcess = null;
      this.stoppingHost = null;
      return;
    }
    if (this.stoppingHost === child) return;
    this.stoppingHost = child;
    this.logger.log("MarginNote closed; stopping Agent Host.");
    try {
      child.kill("SIGTERM");
    } catch (error) {
      this.stoppingHost = null;
      this.logger.error("Unable to stop MarginNote Agent Host:", error);
    }
  }

  restartHost() {
    this.nextStartAt = 0;
    this.stopHost();
    if (!isChildRunning(this.hostProcess)) void this.reconcile();
  }

  status() {
    return {
      managed_host_running: isChildRunning(this.hostProcess),
      margin_note_running: this.marginNoteRunning,
      paused: this.paused,
      writes_enabled_setting: this.writesEnabled,
      port: this.port,
    };
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopHost();
  }
}

async function main() {
  const projectDir = defaultProjectDir;
  const settingsPath = path.join(projectDir, ".local", "host-control.json");
  let settings = { paused: false, writesEnabled: process.env.MN_ENABLE_WRITES === "1" };
  try {
    const stored = JSON.parse(await readFile(settingsPath, "utf8"));
    settings = { paused: stored.paused === true, writesEnabled: stored.writesEnabled === true };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Ignoring invalid Host control settings:", error.message);
  }
  const supervisor = new MarginNoteHostSupervisor({ ...settings });
  const saveSettings = async () => {
    await mkdir(path.dirname(settingsPath), { recursive: true });
    const temp = settingsPath + ".tmp";
    await writeFile(temp, JSON.stringify({ paused: supervisor.paused, writesEnabled: supervisor.writesEnabled }), { mode: 0o600 });
    await rename(temp, settingsPath);
  };
  const control = createControlServer({ supervisor, saveSettings });
  let controlReady = false;
  try {
    await control.listen();
    controlReady = true;
  } catch (error) {
    console.error("Host control page unavailable:", error.message);
  }
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`Stopping MarginNote Agent supervisor (${signal})...`);
    await supervisor.stop();
    if (controlReady) await control.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  supervisor.start();
  if (controlReady) console.error("Host controls: http://127.0.0.1:42118");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  void main();
}
