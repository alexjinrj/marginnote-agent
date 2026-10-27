import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { BridgeError } from './errors.mjs';
import { imageFileData, localImagePath } from './note-media.mjs';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../../scripts/pdf-page-ocr.m', import.meta.url));
const binary = fileURLToPath(new URL('../../.local/bin/pdf-page-ocr', import.meta.url));
const maxText = 20000;

async function ensureBinary() {
  const source = await stat(script);
  try { if ((await stat(binary)).mtimeMs >= source.mtimeMs) return; } catch {}
  await mkdir(path.dirname(binary), { recursive: true });
  const temporary = `${binary}.${process.pid}.${randomUUID()}`;
  try {
    const sdk = (await run('xcrun', ['--show-sdk-path'])).stdout.trim();
    const compiler = (await run('xcrun', ['--find', 'clang'])).stdout.trim();
    await run(compiler, ['-isysroot', sdk, '-fobjc-arc', '-framework', 'AppKit', '-framework', 'Foundation', '-framework', 'PDFKit', '-framework', 'Vision', script, '-o', temporary], { timeout: 30000, maxBuffer: 1024 * 1024 });
    await rename(temporary, binary);
  } catch {
    throw new BridgeError('PDF_OCR_UNAVAILABLE', 'macOS Command Line Tools are required to build the local OCR helper');
  } finally { await rm(temporary, { force: true }); }
}

export async function ocrCurrentPdfPage(client, pdf = null) {
  pdf ??= await client.call('get_current_pdf', {});
  if (!pdf || typeof pdf.file_path !== 'string' || !Number.isInteger(pdf.page_index)) {
    throw new BridgeError('RPC_FAILURE', 'Invalid current PDF locator');
  }
  let info;
  try { info = await stat(pdf.file_path); }
  catch { throw new BridgeError('PDF_PATH_UNAVAILABLE', 'Current PDF cannot be read from this Mac'); }
  if (!info.isFile()) throw new BridgeError('PDF_PATH_UNAVAILABLE', 'Current PDF path is not a file');
  await ensureBinary();
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'mn-pdf-ocr-'));
  const imagePath = path.join(temporaryDirectory, 'page.png');
  try {
    let result;
    try {
      const { stdout } = await run(binary, [pdf.file_path, String(pdf.page_index), imagePath], { timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
      result = JSON.parse(stdout);
    } catch (error) {
      let detail;
      try { detail = JSON.parse(error.stdout).error; } catch {}
      throw new BridgeError('PDF_OCR_FAILED', detail || 'Local PDF rendering failed');
    }
    if (result.error) throw new BridgeError('PDF_OCR_FAILED', result.error);
    if (result.page_index !== pdf.page_index) throw new BridgeError('PDF_OCR_FAILED', 'OCR page did not match MarginNote selection');
    let engine = 'apple_vision';
    if (result.vision_error) {
      try {
        const fallback = await run('tesseract', [imagePath, 'stdout'], { timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
        result.ocr_text = fallback.stdout.trim();
        result.recognized_line_count = result.ocr_text ? result.ocr_text.split('\n').filter(Boolean).length : 0;
        engine = 'tesseract';
      } catch { engine = 'unavailable'; }
    }
    // The PDF helper already performed OCR; only decode/render the page image here.
    const image = await imageFileData(imagePath, { ocr: false });
    return {
      ...pdf,
      ...image,
      page_count: result.page_count,
      pdf_page_label: result.pdf_page_label || null,
      embedded_text: result.embedded_text.slice(0, maxText),
      ocr_text: result.ocr_text.slice(0, maxText),
      ocr_engine: engine,
      ocr_warning: engine === 'tesseract' ? 'Apple Vision failed; Tesseract language support depends on installed language packs' : (engine === 'unavailable' ? 'OCR unavailable; use embedded text and the returned page image' : null),
      recognized_line_count: result.recognized_line_count,
      embedded_text_truncated: result.embedded_text.length > maxText,
      ocr_text_truncated: result.ocr_text.length > maxText,
    };
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
}

export async function readPdfPage(client, args, { extract = ocrCurrentPdfPage, save = localImagePath } = {}) {
  const pdf = await client.call('get_current_pdf', {});
  const result = args.include_content ? await extract(client, pdf) : pdf;
  const { image_base64, image_mime_type, ...metadata } = result;
  const image_file_path = image_base64 ? await save({ image_base64, image_mime_type }) : null;
  return {
    output: { ...metadata, content_included: args.include_content, pdf_page_label: result.pdf_page_label ?? null,
      embedded_text: result.embedded_text ?? '', ocr_text: result.ocr_text ?? '', ocr_engine: result.ocr_engine ?? 'not_requested',
      ocr_warning: result.ocr_warning ?? null, recognized_line_count: result.recognized_line_count ?? 0,
      embedded_text_truncated: result.embedded_text_truncated ?? false, ocr_text_truncated: result.ocr_text_truncated ?? false,
      image_file_path, image_mime_type: image_mime_type ?? null, image_available: Boolean(image_base64 && image_file_path),
      page_image_source: image_base64 ? 'original_pdf' : null,
      margin_note_annotations_included: false,
      annotation_warning: args.include_content ? 'The page image and OCR come from the original PDF; MarginNote handwriting/annotations stored outside the PDF are not included.' : null },
    images: image_base64 && image_file_path ? [{ type: 'image', data: image_base64, mimeType: image_mime_type }] : [],
  };
}
