export class BridgeError extends Error {
  constructor(code, message, outcome) {
    super(message);
    this.code = code;
    this.outcome = outcome;
  }
}
export function errorData(error) {
  return { code: error.code || 'RPC_FAILURE', message: error.code ? error.message : 'MarginNote RPC failed', ...(error.outcome ? { outcome: error.outcome } : {}) };
}
