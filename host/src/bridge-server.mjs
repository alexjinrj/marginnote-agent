import http from 'node:http';
import { MarginNoteBridge } from './marginnote/bridge.mjs';
import { BridgeError, errorData } from '../../mcp/src/errors.mjs';
import { tools, validate, nativeArguments, normalize } from '../../mcp/src/tools.mjs';
import { SERVICE, PROTOCOL } from '../../mcp/src/config.mjs';
import { isMarginNoteRunning } from '../../scripts/marginnote-host-supervisor.mjs';

const MAX_BYTES = 2097152;
function send(res, status, body) {
  if (res.destroyed) return;
  const data = JSON.stringify(body);
  if (Buffer.byteLength(data) > MAX_BYTES) throw new BridgeError('RPC_FAILURE', 'Response exceeds size limit');
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(data);
}
async function read(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new BridgeError('INVALID_ARGUMENT', 'Request exceeds size limit');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new BridgeError('INVALID_ARGUMENT', 'Invalid JSON'); }
}
export function createBridgeHost({ port = 42117, timeoutMs = 15000, checkRunning = isMarginNoteRunning, writesEnabled = process.env.MN_ENABLE_WRITES === '1' } = {}) {
  const bridge = new MarginNoteBridge({ timeoutMs, offlineAfterMs: 5000 });
  const server = http.createServer(async (req, res) => {
    try {
      const authority = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== authority || (req.headers.origin && req.headers.origin !== `http://${authority}`)) {
        send(res, 403, { error: { code: 'INVALID_ARGUMENT', message: 'Origin or Host is not allowed' } });
        return;
      }
      const url = new URL(req.url, `http://${authority}`);
      if (req.method === 'GET' && url.pathname === '/health') {
        send(res, 200, { service: SERVICE, protocol: PROTOCOL, version: '0.6.0', online: bridge.status().online, writes_enabled: writesEnabled });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/marginnote/next') {
        const clientId = url.searchParams.get('clientId');
        if (!clientId || clientId.length > 200) throw new BridgeError('INVALID_ARGUMENT', 'clientId is required');
        send(res, 200, { request: bridge.takeNext(clientId, { version: url.searchParams.get('version') }) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/marginnote/connect') {
        const body = await read(req);
        if (typeof body?.clientId !== 'string' || !body.clientId || body.clientId.length > 200) throw new BridgeError('INVALID_ARGUMENT', 'clientId is required');
        bridge.touchClient(body.clientId, {});
        send(res, 200, { connected: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/marginnote/result') {
        const body = await read(req);
        if (typeof body?.requestId !== 'string' || typeof body.success !== 'boolean') throw new BridgeError('INVALID_ARGUMENT', 'Invalid result');
        const pending = bridge.pending.get(body.requestId);
        if (!pending || pending.request.dispatchedAt === null) {
          send(res, 404, { error: { code: 'RPC_FAILURE', message: 'No dispatched request' } });
          return;
        }
        bridge.resolve(body.requestId, body);
        send(res, 200, { resolved: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/bridge/call') {
        const body = await read(req);
        const args = validate(body?.tool, body?.arguments ?? {});
        if (tools[body.tool].writes && !writesEnabled) throw new BridgeError('WRITE_DISABLED', 'Start Host with MN_ENABLE_WRITES=1 to enable card writes', 'not_started');
        if (!bridge.status().online && bridge.pending.size === 0) {
          let running;
          try { running = checkRunning(); } catch { running = undefined; }
          if (running === false) throw new BridgeError('MARGINNOTE_NOT_RUNNING', 'Open MarginNote 4', 'not_started');
        }
        const result = await bridge.call(body.tool, nativeArguments(body.tool, args));
        send(res, 200, normalize(body.tool, result, args));
        return;
      }
      send(res, 404, { error: { code: 'INVALID_ARGUMENT', message: 'Unknown route' } });
    } catch (error) {
      send(res, error.code === 'INVALID_ARGUMENT' ? 400 : 503, { error: errorData(error) });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return {
    bridge, server,
    async listen() {
      await new Promise((resolve, reject) => {
        const failed = (error) => { server.off('listening', ready); reject(error.code === 'EADDRINUSE' ? new BridgeError('PORT_IN_USE', `Port ${port} is already in use; no existing process was stopped`) : error); };
        const ready = () => { server.off('error', failed); resolve(); };
        server.once('error', failed);
        server.once('listening', ready);
        server.listen(port, '127.0.0.1');
      });
      return server.address();
    },
    async close() {
      bridge.close();
      server.closeIdleConnections();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    },
  };
}
