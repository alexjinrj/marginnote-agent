import { BridgeError } from './errors.mjs';
import { SERVICE, PROTOCOL, bridgeConfig } from './config.mjs';
export class MarginNoteClient {
  constructor({ url = bridgeConfig().url, timeoutMs = 20000 } = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password) throw new Error('RPC must use http://127.0.0.1');
    this.url = parsed.origin;
    this.timeoutMs = timeoutMs;
  }
  async request(path, body) {
    try {
      const response = await fetch(this.url + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-MN-Bridge-Client': 'mcp' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' });
      let length = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 2097152) throw new BridgeError('RPC_FAILURE', 'RPC response exceeds size limit');
        chunks.push(chunk);
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { throw new BridgeError('HOST_INCOMPATIBLE', 'Port is not serving a compatible bridge'); }
      if (!response.ok) throw new BridgeError(payload.error?.code || 'RPC_FAILURE', payload.error?.message || 'RPC request failed', payload.error?.outcome);
      return payload;
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      if (error.name === 'TimeoutError') throw new BridgeError('MARGINNOTE_RPC_TIMEOUT', 'RPC request timed out', 'unknown');
      throw new BridgeError('HOST_UNAVAILABLE', 'Start the shared MarginNote bridge Host');
    }
  }
  async call(tool, args) {
    const health = await this.request('/health');
    if (health.service !== SERVICE || health.protocol !== PROTOCOL) throw new BridgeError('HOST_INCOMPATIBLE', 'Port belongs to an incompatible Host');
    return this.request('/api/bridge/call', { tool, arguments: args });
  }
}
