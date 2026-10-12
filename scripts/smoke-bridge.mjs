import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const query = process.argv.slice(2).filter(arg => arg !== '--').join(' ').trim();
if (!query) throw new Error('Supply a search term known to exist in MarginNote notes');
const client = new Client({ name: 'marginnote-smoke', version: '0.9.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../mcp/src/index.mjs', import.meta.url))], env: { ...process.env }, stderr: 'inherit' }));
  const listed = await client.listTools();
  const call = async (name, args) => {
    const response = await client.callTool({ name: `marginnote.${name}`, arguments: args });
    if (response.isError) throw new Error(response.structuredContent?.error?.code || 'MCP tool failed');
    return response.structuredContent;
  };
  const context = await call('get_workspace', {});
  if (!context.available) throw new Error('Open a MarginNote study window');
  const search = await call('search_cards', { query, limit: 5 });
  if (!search.cards.length) throw new Error('No matching cards; choose a known search term');
  const id = search.cards[0].note_id;
  const result = await call('read_card', { note_id: id, include_media: false });
  if (result.card.note_id !== id) throw new Error('Returned ID mismatch');
  console.log(JSON.stringify({ tools: listed.tools.length, context: 'passed', search_count: search.cards.length, read_card_id_match: true, real_addon: 'passed' }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await client.close(); }
