export function bridgeConfig(env = process.env) {
  const port = Number(env.MN_BRIDGE_PORT || 42117);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MN_BRIDGE_PORT must be a valid TCP port');
  return { port, url: `http://127.0.0.1:${port}` };
}
export const SERVICE = 'marginnote-mcp-bridge';
export const PROTOCOL = 1;
