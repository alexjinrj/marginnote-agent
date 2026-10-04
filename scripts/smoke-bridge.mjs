import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const query = process.argv.slice(2).filter(arg => arg !== '--').join(' ').trim();
if (!query) throw new Error('Supply a search term known to exist in MarginNote notes');
const client = new Client({ name: 'marginnote-smoke', version: '0.5.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../mcp/src/index.mjs', import.meta.url))], env: { ...process.env }, stderr: 'inherit' }));
  const listed = await client.listTools();
  const call = async (name, args) => {
    const response = await client.callTool({ name: `marginnote.${name}`, arguments: args });
    if (response.isError) throw new Error(response.structuredContent?.error?.code || 'MCP tool failed');
    return response.structuredContent;
  };
  const context = await call('get_context', {});
  if (!context.available) throw new Error('Open a MarginNote study window');
  const search = await call('search_notes', { query, limit: 5 });
  if (!search.notes.length) throw new Error('No matching notes; choose a known search term');
  const id = search.notes[0].note_id;
  const result = await call('get_note', { note_id: id });
  if (result.note.note_id !== id) throw new Error('Returned ID mismatch');
  console.log(JSON.stringify({ tools: listed.tools.length, context: 'passed', search_count: search.notes.length, get_note_id_match: true, real_addon: 'passed' }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await client.close(); }
