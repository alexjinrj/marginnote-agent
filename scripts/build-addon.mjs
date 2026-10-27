import { execFile } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveServicePaths } from "./service-config.mjs";
import { packageAddonArchive } from "./addon-package.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = resolveServicePaths({ projectDir: root });
const archive = paths.addonArchive;

await rm(paths.addonBuildDir, { recursive: true, force: true });
await mkdir(path.dirname(archive), { recursive: true });

// Compile native helpers
const xcrun = "/usr/bin/xcrun";
if (process.platform !== "darwin") {
  throw new Error("The MarginNote add-on can only be built on macOS with Xcode Command Line Tools.");
}
const sdk = (await execFileAsync(xcrun, ["--show-sdk-path"], { cwd: root })).stdout.trim();
const clang = (await execFileAsync(xcrun, ["--find", "clang"], { cwd: root })).stdout.trim();
const localBin = paths.helperDir;
await mkdir(localBin, { recursive: true });

// image-ocr (for note media OCR)
const scriptOcr = path.join(root, "scripts", "image-ocr.m");
const binOcr = path.join(localBin, "image-ocr");
const srcStat = await stat(scriptOcr);
let upToDate = false;
try {
  const binStat = await stat(binOcr);
  upToDate = binStat.isFile() && binStat.mtimeMs >= srcStat.mtimeMs;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!upToDate) {
  const tmpOcr = `${binOcr}.${process.pid}.${Date.now()}`;
  try {
    await execFileAsync(clang, ["-isysroot", sdk, "-fobjc-arc", "-framework", "AppKit", "-framework", "Foundation", "-framework", "Vision", scriptOcr, "-o", tmpOcr], { cwd: root, timeout: 30000 });
    await rename(tmpOcr, binOcr);
  } finally {
    await rm(tmpOcr, { force: true });
  }
}

console.log(await packageAddonArchive({
  projectDir: root,
  outputPath: archive,
  stagingDir: path.join(paths.addonBuildDir, "addon"),
}));
