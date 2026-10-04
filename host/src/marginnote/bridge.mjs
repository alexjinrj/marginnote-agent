import { BridgeError } from "../../../mcp/src/errors.mjs";
import { randomUUID } from "node:crypto";

export class MarginNoteBridge {
  constructor({ timeoutMs = 60_000, offlineAfterMs = 3_000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.offlineAfterMs = offlineAfterMs;
    this.queue = [];
    this.pending = new Map();
    this.clients = new Map();
  }

  touchClient(clientId, metadata = {}) {
    this.clients.set(clientId, {
      clientId,
      metadata,
      lastSeenAt: Date.now(),
    });
  }

  status() {
    const now = Date.now();
    const clients = [...this.clients.values()].map((client) => ({
      ...client,
      online: now - client.lastSeenAt <= this.offlineAfterMs,
    }));
    return {
      online: clients.some((client) => client.online),
      clients,
      queuedCalls: this.queue.length,
      pendingCalls: this.pending.size,
    };
  }

  async call(tool, argumentsValue) {
    if (this.pending.size >= 64) throw new BridgeError("RPC_BUSY", "Too many pending calls", "not_started");
    if (!this.status().online && this.pending.size === 0) {
      throw new BridgeError("MARGINNOTE_ADDON_UNAVAILABLE", "MarginNote 插件未连接。请确认 MarginNote 已打开并启用插件。", "not_started");
    }

    const requestId = randomUUID();
    const request = {
      requestId,
      tool,
      arguments: argumentsValue ?? {},
      createdAt: new Date().toISOString(),
      dispatchedAt: null,
    };
    this.queue.push(request);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.queue = this.queue.filter((item) => item.requestId !== requestId);
        reject(new BridgeError("MARGINNOTE_RPC_TIMEOUT", `MarginNote tool timed out: ${tool}`, request.dispatchedAt === null ? "not_started" : "unknown"));
      }, this.timeoutMs);
      this.pending.set(requestId, { request, resolve, reject, timer });
    });
  }

  takeNext(clientId, metadata = {}) {
    this.touchClient(clientId, metadata);
    const now = Date.now();
    if (this.queue.some((item) => item.dispatchedAt !== null)) return null;
    const request = this.queue.find((item) => item.dispatchedAt === null);
    if (!request) return null;
    request.dispatchedAt = now;
    request.clientId = clientId;
    return {
      requestId: request.requestId,
      tool: request.tool,
      arguments: request.arguments,
    };
  }

  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new BridgeError("HOST_UNAVAILABLE", "Host stopped", pending.request.dispatchedAt === null ? "not_started" : "unknown"));
    }
    this.pending.clear();
    this.queue = [];
  }

  resolve(requestId, { success, result, error, errorCode }) {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    this.queue = this.queue.filter((item) => item.requestId !== requestId);
    if (success) pending.resolve(result);
    else {
      const code = ["NOTE_NOT_FOUND", "NOTEBOOK_NOT_FOUND", "STALE_SNAPSHOT", "NO_ACTIVE_CONTEXT", "AMBIGUOUS_CONTEXT", "INVALID_ARGUMENT", "PDF_PATH_UNAVAILABLE", "PDF_PAGE_UNAVAILABLE"].includes(errorCode) ? errorCode : (String(error).startsWith("Note not found:") ? "NOTE_NOT_FOUND" : "RPC_FAILURE");
      pending.reject(new BridgeError(code, code === "RPC_FAILURE" ? "Native MarginNote call failed" : code));
    }
    return true;
  }
}
