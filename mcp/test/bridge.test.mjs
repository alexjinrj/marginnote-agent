import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createBridgeHost } from '../../host/src/bridge-server.mjs';
import { MarginNoteClient } from '../src/marginnote-client.mjs';
import { MarginNoteBridge } from '../../host/src/marginnote/bridge.mjs';
import { normalize } from '../src/tools.mjs';

async function fixture(t, options = {}) {
  const host = createBridgeHost({ port: 0, checkRunning: () => true, ...options });
  const address = await host.listen();
  t.after(() => host.close());
  const url = `http://127.0.0.1:${address.port}`;
  const post = (path, body) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { host, url, post, port: address.port };
}
async function sdkClient(t, port) {
  const client = new Client({ name: 'bridge-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['mcp/src/index.mjs'], env: { ...process.env, MN_BRIDGE_PORT: String(port) }, stderr: 'pipe' });
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

test('SDK stdio discovery -> HTTP addon queue -> normalized context/search/get_note/get_current_pdf; two clients share Host', async t => {
  const { host, url, post, port } = await fixture(t);
  await post('/api/marginnote/connect', { clientId: 'test' });
  const a = await sdkClient(t, port);
  const b = await sdkClient(t, port);
  assert.deepEqual((await a.listTools()).tools.map(x => x.name), ['marginnote.get_context', 'marginnote.search_notes', 'marginnote.get_note', 'marginnote.get_current_pdf']);
  const contextCall = a.callTool({ name: 'marginnote.get_context', arguments: {} });
  const searchCall = b.callTool({ name: 'marginnote.search_notes', arguments: { query: 'CAP' } });
  for (let i = 0; i < 2; i++) {
    const request = await next(url);
    const result = request.tool === 'get_context' ? { available: true, windowId: 'w1', notebook: { topicId: 'n1', title: 'Test' }, focusNote: { noteId: 'x1' } } : [{ noteId: 'x1', notebookId: 'n1', title: 'CAP' }];
    if (request.tool === 'search_notes') assert.equal(request.arguments.scope, 'all');
    await post('/api/marginnote/result', { requestId: request.requestId, success: true, result });
  }
  assert.equal((await contextCall).structuredContent.window_id, 'w1');
  const noteId = (await searchCall).structuredContent.notes[0].note_id;
  const noteCall = a.callTool({ name: 'marginnote.get_note', arguments: { note_id: noteId } });
  const request = await next(url);
  assert.equal(request.arguments.noteId, 'x1');
  await post('/api/marginnote/result', { requestId: request.requestId, success: true, result: { noteId: noteId, comments: [{ text: 'content' }] } });
  assert.equal((await noteCall).structuredContent.note.comments[0].text, 'content');
  const pdfCall = a.callTool({ name: 'marginnote.get_current_pdf', arguments: {} });
  const pdfRequest = await next(url);
  assert.equal(pdfRequest.tool, 'get_current_pdf');
  assert.deepEqual(pdfRequest.arguments, {});
  await post('/api/marginnote/result', { requestId: pdfRequest.requestId, success: true, result: { docMd5: 'doc-1', title: 'PDF', filePath: '/tmp/test file.pdf', pageIndex: 1, pageCount: 3 } });
  const pdf = (await pdfCall).structuredContent;
  assert.equal(pdf.file_path, '/tmp/test file.pdf');
  assert.equal(pdf.file_name, 'test file.pdf');
  assert.equal(pdf.page_index, 1);
  assert.equal(pdf.page_number, 2);
  assert.equal(pdf.pages, undefined);
  await a.close();
  assert.equal((await fetch(url + '/health')).status, 200);
  assert.equal(host.bridge.pending.size, 0);
});

test('MCP validation and business errors preserve server health', async t => {
  const { port } = await fixture(t);
  const client = await sdkClient(t, port);
  const invalid = await client.callTool({ name: 'marginnote.search_notes', arguments: { query: '', limit: 101 } });
  assert.equal(invalid.isError, true);
  const offline = await client.callTool({ name: 'marginnote.get_context', arguments: {} });
  assert.equal(offline.structuredContent.error.code, 'MARGINNOTE_ADDON_UNAVAILABLE');
  assert.equal((await client.listTools()).tools.length, 4);
});

test('RPC blocks mutation, extra fields, invalid limits and browser origins', async t => {
  const { post, url } = await fixture(t);
  for (const body of [{ tool: 'append_comment', arguments: { note_id: 'x', text: 'bad' } }, { tool: 'search_notes', arguments: { query: 'CAP', limit: -1 } }, { tool: 'get_context', arguments: { unexpected: true } }]) {
    const response = await post('/api/bridge/call', body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_ARGUMENT');
  }
  assert.equal((await fetch(url + '/health', { headers: { Origin: 'https://example.com' } })).status, 403);
  const invalidHostStatus = await new Promise((resolve, reject) => {
    http.get(url + '/health', { headers: { Host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(invalidHostStatus, 403);
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
  const waiting = client.callTool({ name: 'marginnote.get_context', arguments: {} });
  for (let i = 0; i < 100 && host.bridge.pending.size === 0; i++) await delay(5);
  assert.equal(host.bridge.pending.size, 1);
  await host.close();
  assert.equal((await waiting).structuredContent.error.code, 'HOST_UNAVAILABLE');
  const restarted = createBridgeHost({ port, checkRunning: () => false });
  await restarted.listen();
  t.after(() => restarted.close());
  const result = await client.callTool({ name: 'marginnote.get_context', arguments: {} });
  assert.equal(result.structuredContent.error.code, 'MARGINNOTE_NOT_RUNNING');
});
