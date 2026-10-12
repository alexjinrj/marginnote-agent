import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const run = promisify(execFile);
const cache = path.join(os.homedir(), 'Library/Containers/QReader.MarginStudy.easy/Data/Library/Caches/MediaCacheFiles');
const databaseRoot = path.join(os.homedir(), 'Library/Containers/QReader.MarginStudy.easy/Data/Library/Private Documents/MN4NotebookDatabase');
const maxBytes = 900000;
let outputDirectoryPromise;
const imageFiles = [];

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

export async function imageFileData(file, { forceJpeg = false } = {}) {
  const info = await stat(file);
  if (!info.isFile() || info.size > 20 * 1024 * 1024) return null;
  const bytes = await readFile(file);
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg) return null;
  if (!forceJpeg && bytes.length <= maxBytes) return { image_base64: bytes.toString('base64'), image_mime_type: png ? 'image/png' : 'image/jpeg' };
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'mn-image-render-'));
  try {
    const target = path.join(temporary, 'image.jpg');
    for (const size of [null, 2048, 1600, 1024]) {
      await run('/usr/bin/sips', ['-s', 'format', 'jpeg', ...(size ? ['-Z', String(size)] : []), file, '--out', target], { timeout: 10000, maxBuffer: 1024 * 1024 });
      const image = await readFile(target);
      if (image.length <= maxBytes && image[0] === 255 && image[1] === 216) return { image_base64: image.toString('base64'), image_mime_type: 'image/jpeg' };
    }
    return null;
  } finally { await rm(temporary, { recursive: true, force: true }); }
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
