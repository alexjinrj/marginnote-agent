import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { tools } from './tools.mjs';
import { errorData } from './errors.mjs';
import { MarginNoteClient } from './marginnote-client.mjs';
import { readPdfPage } from './pdf-ocr.mjs';
import { readCard } from './card-reader.mjs';
import { serverInstructions } from './instructions.mjs';

export function createMcpServer(client = new MarginNoteClient()) {
  const server = new McpServer({ name: 'marginnote', version: '0.9.3' }, { instructions: serverInstructions });
  for (const [key, definition] of Object.entries(tools)) {
    server.registerTool(`marginnote.${key}`, {
      description: definition.description, inputSchema: definition.schema, outputSchema: definition.outputSchema,
      annotations: { readOnlyHint: !definition.writes, destructiveHint: false, openWorldHint: false, idempotentHint: !definition.writes },
    }, async (args) => {
      try {
        let output, images = [];
        if (key === 'read_card') ({ output, images } = await readCard(client, args));
        else if (key === 'read_pdf_page') ({ output, images } = await readPdfPage(client, args));
        else {
          output = await client.call(definition.rpc, args);
          if (key === 'search_cards') { const { notes, ...metadata } = output; output = { ...metadata, cards: notes }; }
          if (key === 'append_card_comment') { const { note, ...metadata } = output; output = { ...metadata, card: note }; }
        }
        output = definition.outputSchema.parse(output);
        return { content: [...images, { type: 'text', text: JSON.stringify(output) }], structuredContent: output };
      } catch (error) {
        const result = { error: errorData(error) };
        // Error results must not carry structuredContent. MCP clients validate it
        // against the tool's success outputSchema and would replace the real
        // business error with a schema-validation protocol failure.
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
    });
  }
  return server;
}
