import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readCard } from '../src/card-reader.mjs';
import { readPdfPage } from '../src/pdf-ocr.mjs';
import { renderedNoteImage } from '../src/note-media.mjs';
import { normalize } from '../src/rpc-tools.mjs';
import { tools } from '../src/tools.mjs';
import { BridgeError } from '../src/errors.mjs';

const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const missing = () => { throw new BridgeError('MEDIA_UNAVAILABLE', 'No matching source'); };
const fakeRender = async value => value;
const fakeSave = async value => value.image_base64 ? '/private/tmp/test-image.png' : null;
function media(noteId, source, index, count, image = true) {
  return { note_id: noteId, source, media_note_id: source === 'sketch' ? 'linked-sketch' : noteId,
    media_count: count, media_index: index, media_hash: null, stroke_count: null,
    media_format: image ? 'png' : 'wrd_binary', byte_count: 70, available: count > 0,
    image_base64: image ? imageData : null, image_mime_type: image ? 'image/png' : null,
    reason: count ? null : 'NO_MEDIA' };
}
function fixture({ comments = [], strokes = null, mediaCall = missing, selected = 'card-A' } = {}) {
  const calls = [];
  const client = { async call(tool, args) {
    calls.push({ tool, args });
    if (tool === 'get_context') return { focus_note: selected ? { note_id: selected } : null };
    if (tool === 'get_note') return normalize(tool, { noteId: args.note_id, notebookId: 'book-A', notesText: 'typed text', comments, strokeCount: strokes }, args);
    if (tool === 'get_note_media') return mediaCall(args);
    throw new Error('Unexpected RPC ' + tool);
  } };
  return { client, calls };
}
const read = (f, args = {}) => readCard(f.client, tools.read_card.schema.parse(args), { render: fakeRender, save: fakeSave });

test('one card task combines typed text, visual comment, sketch and pinned selection', async () => {
  const f = fixture({ comments: [{ type: 'PaintNote', noteId: 'comment-B' }], mediaCall: args => {
    assert.notEqual(args.source, 'focus_image');
    return { ...media(args.note_id, args.source, args.media_index, 1), stroke_count: args.note_id === 'comment-B' ? 12 : null,
      ocr_text: args.note_id === 'comment-B' ? 'comment OCR' : null,
      ocr_engine: args.note_id === 'comment-B' ? 'apple_vision' : null };
  } });
  const { output, images } = await read(f);
  assert.equal(output.card.content, 'typed text');
  assert.equal(output.card.comments[0].note_id, 'comment-B');
  assert.deepEqual(output.media.map(m => [m.requested_note_id, m.source]), [['card-A', 'note'], ['comment-B', 'note'], ['card-A', 'sketch']]);
  assert.equal(images.length, 3);
  assert.equal(output.handwriting_detected, true);
  assert.equal(output.media_status, 'ready');
  assert.equal(f.calls.filter(c => c.tool === 'get_context').length, 1);
  assert.ok(f.calls.filter(c => c.tool === 'get_note_media').every(c => ['card-A', 'comment-B'].includes(c.args.note_id)));
  assert.deepEqual(output.media.map(m => [m.ocr_text, m.ocr_engine]), [[null, null], ['comment OCR', 'apple_vision'], [null, null]]);
  tools.read_card.outputSchema.parse(output);
});

test('media pagination preserves failed items and reaches later images without selection drift', async () => {
  const f = fixture({ strokes: 9, mediaCall: args => media(args.note_id, args.source, args.media_index, 3, args.media_index > 0) });
  const first = await read(f, { media_source: 'note', media_limit: 1 });
  assert.equal(first.output.media_status, 'unavailable');
  assert.equal(first.output.media[0].status, 'unrenderable');
  assert.equal(first.output.next_media_offset, 1);
  assert.equal(first.output.media_total_count, 3);
  const page = await read(f, { note_id: 'card-A', media_source: 'note', media_offset: 1, media_limit: 2 });
  assert.equal(page.images.length, 2);
  assert.deepEqual(page.output.media.map(m => m.media_index), [1, 2]);
  assert.equal(page.output.next_media_offset, null);
  assert.equal(f.calls.filter(c => c.tool === 'get_context').length, 1);
  assert.equal(tools.read_card.schema.safeParse({ media_offset: 1 }).success, false);
});

test('missing handwriting render stays explicit, and document focus is an automatic fallback', async () => {
  for (const renderAvailable of [false, true]) {
    const f = fixture({ strokes: 10, comments: [{ type: 'PaintNote' }], mediaCall: args => {
      if (args.source === 'sketch') return missing();
      if (args.source === 'focus_image') return renderAvailable ? media(args.note_id, args.source, 0, 1) : missing();
      return { ...media(args.note_id, args.source, 0, 1, false), stroke_count: 10 };
    } });
    const result = await read(f);
    assert.equal(result.output.handwriting_detected, true);
    assert.equal(result.images.length, renderAvailable ? 1 : 0);
    assert.equal(result.output.media[0].status, 'unrenderable');
    if (renderAvailable) assert.equal(result.output.media[1].source, 'focus_image');
    else assert.match(result.output.warnings.join(' '), /Empty text is not a blank card/);
  }
});

test('text-only cards succeed without media; no focus and RPC failures remain errors', async () => {
  const f = fixture({ mediaCall: args => args.source === 'note' ? media(args.note_id, 'note', null, 0, false) : missing() });
  const result = await read(f);
  assert.equal(result.output.media_status, 'none');
  assert.equal(result.output.card.content, 'typed text');
  const before = f.calls.length;
  await read(f, { note_id: 'card-A', include_media: false });
  assert.equal(f.calls.length, before + 1);
  await assert.rejects(read(fixture({ selected: null })), { code: 'NO_ACTIVE_CONTEXT' });
  const broken = fixture({ mediaCall() { throw new BridgeError('HOST_UNAVAILABLE', 'Stopped'); } });
  await assert.rejects(read(broken), { code: 'HOST_UNAVAILABLE' });
});

test('visual-comment inventory is bounded and reports unread references', async () => {
  const f = fixture({ comments: Array.from({ length: 7 }, (_, i) => ({ type: 'PaintNote', noteId: `comment-${i}` })), mediaCall: args => args.source === 'note' ? media(args.note_id, 'note', 0, 1) : missing() });
  const result = await read(f);
  assert.equal(result.output.media_inventory_truncated, true);
  assert.equal(result.output.media_total_count, 5);
  assert.equal(result.output.next_media_offset, 3);
  assert.equal(f.calls.filter(c => c.tool === 'get_note_media' && c.args.note_id.startsWith('comment-')).length, 4);
});

test('cached handwriting resolves exact native hash and variable render suffix', { skip: process.platform !== 'darwin' }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mn-render-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const hash = 'a'.repeat(32);
  await writeFile(path.join(directory, hash + '_4096_0_7'), Buffer.from(imageData, 'base64'));
  const result = await renderedNoteImage({ media_hash: hash, note_id: 'not-a-UUID', source: 'note', media_index: 0 }, { cacheDirectory: directory });
  assert.equal(result.image_mime_type, 'image/jpeg');
  assert.equal(result.image_source, 'marginnote_render_cache');
  assert.equal(Buffer.from(result.image_base64, 'base64')[0], 255);
  const absent = await renderedNoteImage({ media_hash: 'b'.repeat(32), source: 'note' }, { cacheDirectory: directory });
  assert.equal(absent.image_unavailable_reason, 'RENDER_CACHE_MISSING_OR_UNREADABLE');
});

test('direct native image bytes receive best-effort OCR before reaching the card output', async () => {
  const calls = [];
  const bytes = Buffer.alloc(1001, 1);
  const result = await renderedNoteImage({
    note_id: 'card-A', source: 'note', media_index: 0,
    image_base64: bytes.toString('base64'), image_mime_type: 'image/png',
  }, {
    lookupHash: async () => { throw new Error('Direct images must not use the render cache'); },
    ocrImage: async file => {
      calls.push(file);
      assert.deepEqual(await readFile(file), bytes);
      return { ocr_text: 'native image text', ocr_engine: 'apple_vision' };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(result.ocr_text, 'native image text');
  assert.equal(result.ocr_engine, 'apple_vision');
  await assert.rejects(readFile(calls[0]), { code: 'ENOENT' });
  const noText = await renderedNoteImage({
    note_id: 'card-A', source: 'note', media_index: 0,
    image_base64: bytes.toString('base64'), image_mime_type: 'image/png',
  }, {
    lookupHash: async () => { throw new Error('Direct images must not use the render cache'); },
    ocrImage: async () => null,
  });
  assert.equal(noText.ocr_text, undefined);
  assert.equal(noText.ocr_attempted, true);
  const alreadyProcessed = await renderedNoteImage({ ...result }, {
    lookupHash: async () => { throw new Error('Processed images must not use the render cache'); },
    ocrImage: async () => { throw new Error('OCR must not run twice'); },
  });
  assert.equal(alreadyProcessed.ocr_text, 'native image text');
  const alreadyAttempted = await renderedNoteImage(noText, {
    lookupHash: async () => { throw new Error('Attempted images must not use the render cache'); },
    ocrImage: async () => { throw new Error('OCR must not run twice after a failed attempt'); },
  });
  assert.equal(alreadyAttempted.ocr_attempted, true);
});

test('PDF task resolves page once and retains visual input when OCR has no text', async () => {
  let locationCalls = 0, extractCalls = 0;
  const pdf = normalize('get_current_pdf', { filePath: '/private/tmp/example.pdf', pageIndex: 4, pageCount: 6 }, {});
  const client = { async call(tool) { assert.equal(tool, 'get_current_pdf'); locationCalls++; return pdf; } };
  const result = await readPdfPage(client, { include_content: true }, { save: fakeSave, extract: async (_client, pinnedPdf) => {
    extractCalls++; assert.equal(pinnedPdf.page_index, 4);
    return { ...pinnedPdf, image_base64: imageData, image_mime_type: 'image/png', ocr_engine: 'unavailable' };
  } });
  assert.equal(locationCalls, 1);
  assert.equal(result.images.length, 1);
  assert.equal(result.output.image_available, true);
  assert.equal(result.output.ocr_engine, 'unavailable');
  assert.equal(result.output.page_image_source, 'original_pdf');
  assert.equal(result.output.margin_note_annotations_included, false);
  assert.match(result.output.annotation_warning, /original PDF/);
  tools.read_pdf_page.outputSchema.parse(result.output);
  const locatorOnly = await readPdfPage(client, { include_content: false }, { extract() { throw new Error('Must not render locator-only requests'); } });
  assert.equal(locatorOnly.output.page_image_source, null);
  assert.equal(locatorOnly.output.margin_note_annotations_included, false);
  assert.equal(locatorOnly.output.annotation_warning, null);
  tools.read_pdf_page.outputSchema.parse(locatorOnly.output);
  assert.equal(extractCalls, 1);
});
