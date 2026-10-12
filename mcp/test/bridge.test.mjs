import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createBridgeHost } from '../../host/src/bridge-server.mjs';
import { MarginNoteClient } from '../src/marginnote-client.mjs';
import { MarginNoteBridge } from '../../host/src/marginnote/bridge.mjs';
import { normalize } from '../src/rpc-tools.mjs';

async function fixture(t, options = {}) {
  const host = createBridgeHost({ port: 0, checkRunning: () => true, ...options });
  const address = await host.listen();
  t.after(() => host.close());
  const url = `http://127.0.0.1:${address.port}`;
  const post = (path, body) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { host, url, post, port: address.port };
}
async function sdkClient(t, port, nodeArgs = []) {
  const client = new Client({ name: 'bridge-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [...nodeArgs, 'mcp/src/index.mjs'], env: { ...process.env, MN_BRIDGE_PORT: String(port) }, stderr: 'pipe' });
  await client.connect(transport);
  t.after(() => client.close());
  return client;
}
async function next(url) {
  for (let i = 0; i < 100; i++) {
    const response = await fetch(url + '/api/marginnote/next?clientId=test');
    const { request } = await response.json();
    if (request) return request;
    await delay(10);
  }
  throw new Error('Request did not arrive');
}

test('SDK public tasks compose stable native RPC calls, text and images; clients share Host', async t => {
  const { host, url, post, port } = await fixture(t);
  await post('/api/marginnote/connect', { clientId: 'test' });
  const a = await sdkClient(t, port), b = await sdkClient(t, port);
  assert.match(a.getInstructions(), /marginnote\.read_card/);
  assert.match(a.getInstructions(), /empty text does not mean a blank card/);
  const discovered = (await a.listTools()).tools;
  assert.deepEqual(discovered.map(x => x.name), ['get_workspace','list_notebooks','search_cards','read_card','read_card_tree','read_pdf_page','create_cards','append_card_comment','promote_excerpt_to_title','preview_card_moves','apply_card_moves'].map(x => 'marginnote.' + x));
  assert.ok(discovered.every(x => x.outputSchema));
  const contextCall = a.callTool({ name: 'marginnote.get_workspace', arguments: {} });
  const searchCall = b.callTool({ name: 'marginnote.search_cards', arguments: { query: 'CAP' } });
  for (let i = 0; i < 2; i++) {
    const req = await next(url);
    const result = req.tool === 'get_context' ? { available: true, windowId: 'w1', notebook: { topicId: 'n1', title: 'Test' }, focusNote: { noteId: 'x1' } } : [{ noteId: 'x1', notebookId: 'n1', title: 'CAP' }];
    if (req.tool === 'search_notes') assert.equal(req.arguments.scope, 'all');
    await post('/api/marginnote/result', { requestId: req.requestId, success: true, result });
  }
  assert.equal((await contextCall).structuredContent.window_id, 'w1');
  const noteId = (await searchCall).structuredContent.cards[0].note_id;
  const plain = a.callTool({ name: 'marginnote.read_card', arguments: { note_id: noteId, include_media: false } });
  const req = await next(url);
  assert.equal(req.tool, 'get_note');
  await post('/api/marginnote/result', { requestId: req.requestId, success: true, result: { noteId, comments: [{ text: 'content', noteId: 'comment1' }] } });
  const text = (await plain).structuredContent;
  assert.equal(text.card.comments[0].text, 'content');
  assert.equal(text.card.comments[0].note_id, 'comment1');
  assert.equal(text.media_status, 'not_requested');
  const current = a.callTool({ name: 'marginnote.read_card', arguments: { media_source: 'note' } });
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  for (const tool of ['get_context', 'get_note', 'get_note_media']) {
    const request = await next(url);
    assert.equal(request.tool, tool);
    const result = tool === 'get_context' ? { available: true, focusNote: { noteId } } : tool === 'get_note' ? { noteId, notesText: 'mixed text', comments: [{ type: 'PaintNote' }] } : { noteId, source: 'note', mediaNoteId: noteId, mediaHash: 'a'.repeat(32), mediaCount: 1, mediaIndex: 0, strokeCount: 81, byteCount: png.length, available: true, base64: png.toString('base64') };
    await post('/api/marginnote/result', { requestId: request.requestId, success: true, result });
  }
  const image = await current;
  assert.equal(image.isError, undefined);
  assert.equal(image.content[0].type, 'image');
  assert.equal(image.structuredContent.card.content, 'mixed text');
  assert.equal(image.structuredContent.handwriting_detected, true);
  assert.equal(image.structuredContent.media[0].media_hash, 'a'.repeat(32));
  const imagePath = image.structuredContent.media[0].image_file_path;
  assert.deepEqual(await readFile(imagePath), png);
  assert.equal((await stat(imagePath)).mode & 0o777, 0o600);
  assert.equal(image.structuredContent.media[0].image_base64, undefined);
  const pdfCall = a.callTool({ name: 'marginnote.read_pdf_page', arguments: { include_content: false } });
  const pdfRequest = await next(url);
  assert.equal(pdfRequest.tool, 'get_current_pdf');
  await post('/api/marginnote/result', { requestId: pdfRequest.requestId, success: true, result: { docMd5: 'doc-1', title: 'PDF', filePath: '/tmp/test file.pdf', pageIndex: 1, marginNotePageNo: 6, mappedPageNo: 7, pageCount: 3 } });
  const pdf = (await pdfCall).structuredContent;
  assert.equal(pdf.file_path, '/tmp/test file.pdf');
  assert.equal(pdf.page_number, 2);
  assert.equal(pdf.margin_note_page_no, 6);
  assert.equal(pdf.mapped_page_no, 7);
  assert.equal(pdf.content_included, false);
  await a.close();
  assert.equal((await fetch(url + '/health')).status, 200);
  assert.equal(host.bridge.pending.size, 0);
});

test('MCP validation and business errors preserve server health', async t => {
  const { port } = await fixture(t);
  const client = await sdkClient(t, port);
  const invalid = await client.callTool({ name: 'marginnote.search_cards', arguments: { query: '', limit: 101 } });
  assert.equal(invalid.isError, true);
  const offline = await client.callTool({ name: 'marginnote.get_workspace', arguments: {} });
  assert.equal(offline.structuredContent.error.code, 'MARGINNOTE_ADDON_UNAVAILABLE');
  assert.equal((await client.listTools()).tools.length, 11);
});

test('Host renders opaque handwriting for a stdio client without private-cache access', async t => {
  const jpeg = Buffer.from([255, 216, 255, 224, 1, 2, 3]);
  let rendered = 0;
  const { url, post, port } = await fixture(t, { renderMedia: async media => {
    rendered++;
    assert.equal(media.media_format, 'wrd_binary');
    assert.equal(media.image_base64, null);
    assert.equal(media.media_hash, 'b'.repeat(32));
    return { ...media, image_base64: jpeg.toString('base64'), image_mime_type: 'image/jpeg', image_source: 'marginnote_render_cache' };
  } });
  await post('/api/marginnote/connect', { clientId: 'test' });
  assert.equal((await (await fetch(url + '/health')).json()).note_media_rendering, 'host');
  const permissionFlag = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';
  const client = await sdkClient(t, port, [permissionFlag,
    '--allow-fs-read=' + process.cwd(), '--allow-fs-read=' + await realpath(process.cwd()),
    '--allow-fs-read=' + os.tmpdir(), '--allow-fs-write=' + os.tmpdir(),
    '--allow-fs-read=' + await realpath(os.tmpdir()), '--allow-fs-write=' + await realpath(os.tmpdir())]);
  const pending = client.callTool({ name: 'marginnote.read_card', arguments: { note_id: 'handwritten', media_source: 'note' } });
  const note = await next(url);
  await post('/api/marginnote/result', { requestId: note.requestId, success: true, result: { noteId: 'handwritten', strokeCount: 81, comments: [{ type: 'PaintNote' }] } });
  const media = await next(url);
  assert.equal(media.tool, 'get_note_media');
  const strokes = Buffer.from('wrd opaque strokes');
  await post('/api/marginnote/result', { requestId: media.requestId, success: true, result: { noteId: 'handwritten', source: 'note', mediaNoteId: 'handwritten', mediaCount: 1, mediaIndex: 0, mediaHash: 'b'.repeat(32), strokeCount: 81, byteCount: strokes.length, available: true, base64: strokes.toString('base64') } });
  const result = await pending;
  assert.equal(rendered, 1);
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.media_status, 'ready');
  assert.equal(result.content[0].type, 'image');
  assert.deepEqual(Buffer.from(result.content[0].data, 'base64'), jpeg);
  assert.deepEqual(await readFile(result.structuredContent.media[0].image_file_path), jpeg);
});

test('SDK exposes paged library reads and explicit writes through the enabled Host', async t => {
  const { url, post, port } = await fixture(t, { writesEnabled: true });
  await post('/api/marginnote/connect', { clientId: 'test' });
  const client = await sdkClient(t, port);
  const definitions = (await client.listTools()).tools;
  assert.equal(definitions.find(x => x.name === 'marginnote.read_card_tree').annotations.readOnlyHint, true);
  assert.equal(definitions.find(x => x.name === 'marginnote.create_cards').annotations.readOnlyHint, false);
  assert.equal(definitions.find(x => x.name === 'marginnote.create_cards').annotations.idempotentHint, false);
  const read = client.callTool({ name: 'marginnote.read_card_tree', arguments: { notebook_id: 'nb', limit: 2 } });
  const request = await next(url);
  assert.equal(request.tool, 'get_library_page');
  assert.deepEqual(request.arguments, { topicId: 'nb', offset: 0, limit: 2 });
  await post('/api/marginnote/result', { requestId: request.requestId, success: true, result: { topicId: 'nb', snapshotId: 'one', totalCount: 1, nextOffset: null, cards: [{ noteId: 'n1', parentNoteId: '', order: 0, title: 'A', commentCount: 0 }] } });
  assert.equal((await read).structuredContent.cards[0].note_id, 'n1');
  const write = client.callTool({ name: 'marginnote.create_cards', arguments: { notebook_id: 'nb', nodes: [{ key: 'root', title: 'New' }] } });
  const request2 = await next(url);
  assert.equal(request2.tool, 'create_framework');
  await post('/api/marginnote/result', { requestId: request2.requestId, success: true, result: { topicId: 'nb', allVerified: true, cards: [{ key: 'root', noteId: 'n2', parentNoteId: '', title: 'New', verified: true }] } });
  assert.equal((await write).structuredContent.all_verified, true);
});

test('RPC blocks unsupported mutation, extra fields, invalid limits and browser origins', async t => {
  const { post, url } = await fixture(t);
  for (const body of [{ tool: 'delete_note', arguments: { note_id: 'x' } }, { tool: 'search_notes', arguments: { query: 'CAP', limit: -1 } }, { tool: 'get_context', arguments: { unexpected: true } }]) {
    const response = await post('/api/bridge/call', body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_ARGUMENT');
  }
  assert.equal((await fetch(url + '/health', { headers: { Origin: 'https://example.com' } })).status, 403);
  const invalidHostStatus = await new Promise((resolve, reject) => {
    http.get(url + '/health', { headers: { Host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(invalidHostStatus, 403);
  const write = await post('/api/bridge/call', { tool: 'create_card', arguments: { notebook_id: 'nb', title: 'Draft' } });
  assert.equal(write.status, 503);
  assert.equal((await write.json()).error.code, 'WRITE_DISABLED');
});

test('public notebook, comment, title and move tools preserve native contracts and output schemas', async t => {
  const { url, post, port } = await fixture(t, { writesEnabled: true });
  await post('/api/marginnote/connect', { clientId: 'test' });
  const client = await sdkClient(t, port);
  const moves = [{ note_id: 'card1', parent_note_id: 'parent1', before_note_id: 'sibling1' }];
  const nativeMove = { noteId: 'card1', fromParentNoteId: 'old1', toParentNoteId: 'parent1', beforeNoteId: 'sibling1', title: 'Card', verified: true };
  const cases = [
    ['list_notebooks', { limit: 1 }, 'list_notebooks', { totalCount: 2, nextOffset: 1, notebooks: [{ topicId: 'book1', title: 'Study', rootNoteCount: 3 }] }],
    ['append_card_comment', { note_id: 'card1', text: 'new text', format: 'text' }, 'append_comment', { noteId: 'card1', notesText: 'new text', comments: [{ type: 'text', text: 'new text' }] }],
    ['promote_excerpt_to_title', { note_id: 'card1', expected_excerpt_text: 'excerpt' }, 'promote_excerpt_to_title', { noteId: 'card1', title: 'excerpt', excerptText: 'excerpt' }],
    ['preview_card_moves', { notebook_id: 'book1', moves }, 'preview_reorganization', { topicId: 'book1', snapshotId: 'snapshot', planId: 'plan', moves: [nativeMove] }],
    ['apply_card_moves', { notebook_id: 'book1', expected_snapshot_id: 'snapshot', expected_plan_id: 'plan', moves }, 'apply_reorganization', { topicId: 'book1', allVerified: true, moves: [nativeMove] }],
  ];
  for (const [name, args, native, result] of cases) {
    const pending = client.callTool({ name: 'marginnote.' + name, arguments: args });
    const req = await next(url);
    assert.equal(req.tool, native);
    if (native.includes('reorganization')) assert.deepEqual(req.arguments.moves[0], { noteId: 'card1', parentNoteId: 'parent1', beforeNoteId: 'sibling1' });
    await post('/api/marginnote/result', { requestId: req.requestId, success: true, result });
    const response = await pending;
    assert.equal(response.isError, undefined);
    if (name === 'append_card_comment') assert.equal(response.structuredContent.card.content, 'new text');
    if (name === 'apply_card_moves') assert.equal(response.structuredContent.moves[0].verified, true);
  }
});

test('combined create_cards cannot bypass the default Host write lock', async t => {
  const { port } = await fixture(t);
  const client = await sdkClient(t, port);
  const result = await client.callTool({ name: 'marginnote.create_cards', arguments: { notebook_id: 'book1', nodes: [{ key: 'one', title: 'One card' }] } });
  assert.equal(result.structuredContent.error.code, 'WRITE_DISABLED');
  const invalid = await client.callTool({ name: 'marginnote.read_card', arguments: { media_offset: 1 } });
  assert.equal(invalid.isError, true);
});

test('offline, recovery, native error and timeout mapping', async t => {
  const { host, url, post } = await fixture(t, { timeoutMs: 40, checkRunning: () => false });
  const client = new MarginNoteClient({ url });
  await assert.rejects(client.call('get_context', {}), { code: 'MARGINNOTE_NOT_RUNNING' });
  await post('/api/marginnote/connect', { clientId: 'test' });
  const failed = client.call('get_note', { note_id: 'missing' });
  const rejection = assert.rejects(failed, { code: 'NOTE_NOT_FOUND' });
  const request = await next(url);
  await post('/api/marginnote/result', { requestId: request.requestId, success: false, error: 'Note not found: missing' });
  await rejection;
  await assert.rejects(client.call('get_context', {}), { code: 'MARGINNOTE_RPC_TIMEOUT', outcome: 'not_started' });
  assert.equal(host.bridge.pending.size, 0);
});

test('queue never redelivers dispatched writes and discards late results', async () => {
  const bridge = new MarginNoteBridge({ timeoutMs: 30 });
  bridge.touchClient('test');
  const pending = bridge.call('append_comment', { noteId: 'x', text: 'once' });
  const rejection = assert.rejects(pending, { code: 'MARGINNOTE_RPC_TIMEOUT', outcome: 'unknown' });
  const request = bridge.takeNext('test');
  bridge.queue[0].dispatchedAt = Date.now() - 11000;
  assert.equal(bridge.takeNext('test'), null);
  await rejection;
  assert.equal(bridge.resolve(request.requestId, { success: true, result: {} }), false);
  bridge.close();
});

test('port collision and incompatible Host are explicit; no listener takeover', async t => {
  const { port, url } = await fixture(t);
  const other = createBridgeHost({ port });
  await assert.rejects(other.listen(), { code: 'PORT_IN_USE' });
  const legacy = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); });
  await new Promise(resolve => legacy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => legacy.close(resolve)));
  await assert.rejects(new MarginNoteClient({ url: `http://127.0.0.1:${legacy.address().port}` }).call('get_context', {}), { code: 'HOST_INCOMPATIBLE' });
  assert.equal((await fetch(url + '/health')).status, 200);
});

test('bounded note contents and search retain IDs and identify truncation', () => {
  const result = normalize('get_note', { noteId: 'x', notesText: 'a'.repeat(21000), comments: [], children: [] }, { note_id: 'x' });
  assert.equal(result.note.content.length, 20000);
  assert.equal(result.truncated, true);
  const search = normalize('search_notes', [{ noteId: 'x' }, { id: 'page-only' }], { limit: 2 });
  assert.equal(search.notes.length, 1);
  assert.equal(search.omitted_without_note_id, 1);
  assert.equal(search.possibly_truncated, true);
});

test('PDF locator accepts file URLs and rejects nonlocal paths', () => {
  const result = normalize('get_current_pdf', { filePath: 'file:///tmp/lecture%20notes.pdf', pageIndex: 0, pageCount: 8 }, {});
  assert.equal(result.file_path, '/tmp/lecture notes.pdf');
  assert.equal(result.page_number, 1);
  assert.throws(() => normalize('get_current_pdf', { filePath: 'lecture.pdf', pageIndex: 0 }, {}), { code: 'PDF_PATH_UNAVAILABLE' });
});

test('MCP survives Host restart and Host shutdown releases pending calls', async t => {
  const { host, port, post } = await fixture(t);
  const client = await sdkClient(t, port);
  await post('/api/marginnote/connect', { clientId: 'test' });
  const waiting = client.callTool({ name: 'marginnote.get_workspace', arguments: {} });
  for (let i = 0; i < 100 && host.bridge.pending.size === 0; i++) await delay(5);
  assert.equal(host.bridge.pending.size, 1);
  await host.close();
  assert.equal((await waiting).structuredContent.error.code, 'HOST_UNAVAILABLE');
  const restarted = createBridgeHost({ port, checkRunning: () => false });
  await restarted.listen();
  t.after(() => restarted.close());
  const result = await client.callTool({ name: 'marginnote.get_workspace', arguments: {} });
  assert.equal(result.structuredContent.error.code, 'MARGINNOTE_NOT_RUNNING');
});
