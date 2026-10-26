import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const cache = path.join(os.homedir(), 'Library/Containers/QReader.MarginStudy.easy/Data/Library/Caches/MediaCacheFiles');
const databaseRoot = path.join(os.homedir(), 'Library/Containers/QReader.MarginStudy.easy/Data/Library/Private Documents/MN4NotebookDatabase');
const maxBytes = 900000;
let outputDirectoryPromise;
let ocrBinary;
const imageFiles = [];

const ocrBinaryPath = () => {
  if (!ocrBinary) {
    ocrBinary = path.join(
      process.env.MN_AGENT_HELPER_DIR
        || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.local', 'bin'),
      'image-ocr',
    );
  }
  return ocrBinary;
};

// OCR a single image file using the native Apple Vision helper
async function imageOcr(filePath) {
  try {
    const bin = ocrBinaryPath();
    const info = await stat(bin);
    if (!info.isFile()) return null;
    const { stdout } = await run(bin, [filePath], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    const result = JSON.parse(stdout);
    if (result.error) return null;
    const text = (result.ocr_text || '').trim();
    return text ? { ocr_text: text, ocr_engine: result.vision_error ? (result.ocr_engine || 'tesseract') : 'apple_vision' } : null;
  } catch { return null; }
}

export async function localImagePath(result) {
  if (!result.image_base64 || !['image/png', 'image/jpeg'].includes(result.image_mime_type)) return null;
  const bytes = Buffer.from(result.image_base64, 'base64');
  if (!bytes.length || bytes.length > maxBytes) return null;
  outputDirectoryPromise ??= mkdtemp(path.join(os.tmpdir(), 'marginnote-mcp-image-')).then(directory => {
    process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
    return directory;
  });
  const outputDirectory = await outputDirectoryPromise;
  const file = path.join(outputDirectory, `${randomUUID()}.${result.image_mime_type === 'image/png' ? 'png' : 'jpg'}`);
  await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
  imageFiles.push(file);
  while (imageFiles.length > 20) await rm(imageFiles.shift(), { force: true });
  return file;
}

async function mediaHashForNote(result) {
  if (result.source === 'focus_image') return null;
  if (/^[a-f0-9]{32}$/.test(result.media_hash || '')) return result.media_hash;
  const noteId = result.media_note_id || result.note_id;
  if (!/^[A-Fa-f0-9-]{36}$/.test(noteId || '') || !Number.isInteger(result.media_index)) return null;
  let partitions;
  try { partitions = (await readdir(databaseRoot)).filter(p => /^\d+$/.test(p)).slice(0, 32); }
  catch { return null; }
  for (const partition of partitions) {
    try {
      const { stdout } = await run('/usr/bin/sqlite3', ['-readonly', path.join(databaseRoot, partition, 'MarginNotes.sqlite'), `SELECT ZMEDIA_LIST FROM ZBOOKNOTE WHERE ZNOTEID='${noteId}' LIMIT 1;`], { timeout: 3000, maxBuffer: 8192 });
      const hash = (stdout.match(/[a-fA-F0-9]{32}/g) || [])[result.media_index];
      if (hash) return hash.toLowerCase();
    } catch { /* Older addons may require trying another local database partition. */ }
  }
  return null;
}

export async function imageFileData(file, { forceJpeg = false, ocr = true } = {}) {
  const info = await stat(file);
  if (!info.isFile() || info.size > 20 * 1024 * 1024) return null;
  const bytes = await readFile(file);
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg) return null;
  let imageResult;
  if (!forceJpeg && bytes.length <= maxBytes) {
    imageResult = { image_base64: bytes.toString('base64'), image_mime_type: png ? 'image/png' : 'image/jpeg' };
  } else {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'mn-image-render-'));
    try {
      const target = path.join(temporary, 'image.jpg');
      for (const size of [null, 2048, 1600, 1024]) {
        await run('/usr/bin/sips', ['-s', 'format', 'jpeg', ...(size ? ['-Z', String(size)] : []), file, '--out', target], { timeout: 10000, maxBuffer: 1024 * 1024 });
        const resized = await readFile(target);
        if (resized.length <= maxBytes && resized[0] === 255 && resized[1] === 216) {
          imageResult = { image_base64: resized.toString('base64'), image_mime_type: 'image/jpeg' };
          break;
        }
      }
      if (!imageResult) return null;
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  // OCR on-demand for images with content (not tiny thumbnails)
  if (ocr && bytes.length > 1000) {
    try {
      const ocrResult = await imageOcr(file);
      if (ocrResult) return { ...imageResult, ...ocrResult };
    } catch { /* OCR is best-effort */ }
  }
  return imageResult;
}

export async function renderedNoteImage(result, { cacheDirectory = cache, lookupHash = mediaHashForNote } = {}) {
  if (result.image_base64) return result;
  const mediaHash = await lookupHash(result);
  if (!mediaHash) return { ...result, image_unavailable_reason: result.reason || 'MEDIA_HASH_UNAVAILABLE' };
  let entries;
  try { entries = (await readdir(cacheDirectory)).filter(name => name.startsWith(mediaHash + '_')); }
  catch (error) { return { ...result, media_hash: mediaHash, image_unavailable_reason:
    ['EACCES', 'EPERM', 'ERR_ACCESS_DENIED'].includes(error.code) ? 'RENDER_CACHE_ACCESS_DENIED' : 'RENDER_CACHE_UNAVAILABLE' }; }
  // Prefer higher resolution renders instead of hardcoding one cache suffix.
  entries.sort((a, b) => Number(b.split('_')[1]) - Number(a.split('_')[1]));
  for (const name of entries.slice(0, 16)) {
    try {
      const image = await imageFileData(path.join(cacheDirectory, name), { forceJpeg: true });
      if (image) return { ...result, ...image, media_hash: mediaHash, image_source: 'marginnote_render_cache' };
    } catch { /* Try another cached resolution. */ }
  }
  return { ...result, media_hash: mediaHash, image_unavailable_reason: 'RENDER_CACHE_MISSING_OR_UNREADABLE' };
}
