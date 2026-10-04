import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.mjs';
const server = createMcpServer();
await server.connect(new StdioServerTransport());
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void server.close().then(() => process.exit(0)));
process.stdin.on('end', () => void server.close().then(() => process.exit(0)));
