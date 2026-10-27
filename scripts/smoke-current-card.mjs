import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'marginnote-card-smoke', version: '0.9.2' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../mcp/src/index.mjs', import.meta.url))], env: { ...process.env }, stderr: 'inherit' }));
  const response = await client.callTool({ name: 'marginnote.read_card', arguments: {} });
  if (response.isError) throw new Error(JSON.parse(response.content?.[0]?.text || '{}').error?.code || 'MCP card read failed');
  const card = response.structuredContent;
  const images = response.content.filter(block => block.type === 'image');
  const media = card.media.filter(item => item.status === 'image');
  if (images.length !== media.length) throw new Error('Image block and metadata count mismatch');
  for (let i = 0; i < media.length; i++) {
    const bytes = await readFile(media[i].image_file_path);
    if (!bytes.equals(Buffer.from(images[i].data, 'base64'))) throw new Error('Local image differs from MCP image');
  }
  if (card.handwriting_detected && !images.length) throw new Error('Handwriting exists but no readable image was returned: ' + card.media.map(m => m.reason).join(', '));
  console.log(JSON.stringify({ note_id: card.card.note_id, handwriting_detected: card.handwriting_detected,
    image_count: images.length, local_images_match_mcp: true, media_status: card.media_status,
    next_media_offset: card.next_media_offset, interpretation: 'Images verified; transcription must be checked visually by the client model.' }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await client.close(); }
