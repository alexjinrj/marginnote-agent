import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archive = path.join(root, "dist", "marginnote-agent.mnaddon");
const { stdout } = await execFileAsync("/usr/bin/unzip", ["-Z1", archive]);
const entries = new Set(stdout.trim().split("\n"));
const required = [
  "mnaddon.json",
  "main.js",
  "config.js",
  "network.js",
  "tools.js",
  "bridge.js",
  "icon.png",
];

for (const entry of required) {
  if (!entries.has(entry)) throw new Error(`Addon archive is missing ${entry}`);
}
if ([...entries].some((entry) => entry.startsWith("addon/"))) {
  throw new Error("Addon files must be stored at the archive root");
}
console.log(`Verified ${archive} (${entries.size} entries)`);

if (entries.has("AgentPanelController.js")) throw new Error("Bridge archive includes chat UI");
const { stdout: main } = await execFileAsync("/usr/bin/unzip", ["-p", archive, "main.js"]);
if (main.includes("AgentPanelController") || !main.includes("sceneCount")) throw new Error("Wrong addon entry point");
