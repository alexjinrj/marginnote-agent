import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'marginnote-pdf-smoke', version: '0.9.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../mcp/src/index.mjs', import.meta.url))], env: { ...process.env }, stderr: 'inherit' }));
  const response = await client.callTool({ name: 'marginnote.read_pdf_page', arguments: { include_content: false } });
  if (response.isError) throw new Error(JSON.parse(response.content?.[0]?.text || '{}').error?.code || 'MCP tool failed');
  const pdf = response.structuredContent;
  const file = await open(pdf.file_path, 'r');
  try {
    const header = Buffer.alloc(5);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead !== 5 || header.toString() !== '%PDF-') throw new Error('The returned path is not a readable PDF file');
  } finally { await file.close(); }
  console.log(JSON.stringify({ file_name: pdf.file_name, page_index: pdf.page_index, page_number: pdf.page_number, local_pdf_readable: true }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await client.close(); }
