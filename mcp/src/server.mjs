import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { tools } from './tools.mjs';
import { errorData } from './errors.mjs';
import { MarginNoteClient } from './marginnote-client.mjs';
export function createMcpServer(client = new MarginNoteClient()) {
  const server = new McpServer({ name: 'marginnote', version: '0.5.0' });
  for (const [key, definition] of Object.entries(tools)) {
    server.registerTool(`marginnote.${key}`, { description: definition.description, inputSchema: definition.schema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } }, async (args) => {
      try {
        const result = await client.call(key, args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        const result = { error: errorData(error) };
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      }
    });
  }
  return server;
}
