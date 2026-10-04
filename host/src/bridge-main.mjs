import { createBridgeHost } from './bridge-server.mjs';
import { bridgeConfig } from '../../mcp/src/config.mjs';
import { errorData } from '../../mcp/src/errors.mjs';
try {
  const host = createBridgeHost(bridgeConfig());
  const address = await host.listen();
  console.error(`MarginNote bridge listening on 127.0.0.1:${address.port}`);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await host.close(); process.exit(0); };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
} catch (error) {
  console.error(JSON.stringify(errorData(error)));
  process.exitCode = 1;
}
