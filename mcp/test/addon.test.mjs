import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

test('bridge-only addon refuses ambiguous scenes and mutations, tracks scene disconnect', async () => {
  let methods;
  let executeCount = 0;
  let queued;
  const results = [];
  const context = vm.createContext({
    JSB: { require() {}, defineClass(name, instance) { methods = instance; return instance; } },
    NSTimer: { scheduledTimerWithTimeInterval() {} },
    MN_AGENT_ADDON_VERSION: '0.5.0', MN_AGENT_CLIENT_ID: 'test',
    MNAgentHTTP: { get(path, callback) { callback(null, { request: queued }); }, post(path, data, callback) { if (path.endsWith('/result')) results.push(data); callback(); } },
    MNAgentTools: { execute() { executeCount++; return { available: true }; } },
  });
  for (const file of ['bridge.js', 'bridge-main.js']) vm.runInContext(await readFile(new URL(`../../addon/${file}`, import.meta.url), 'utf8'), context);
  context.JSB.newAddon();
  const first = {}, second = {};
  context.self = first;
  methods.sceneWillConnect();
  context.self = second;
  methods.sceneWillConnect();
  queued = { requestId: '1', tool: 'get_context', arguments: {} };
  context.MNAgentBridge.poll();
  assert.equal(results.at(-1).errorCode, 'AMBIGUOUS_CONTEXT');
  assert.equal(executeCount, 0);
  methods.sceneDidDisconnect();
  context.MNAgentBridge.poll();
  assert.equal(results.at(-1).result.windowId, first.mnBridgeWindowId);
  queued = { requestId: '2', tool: 'append_comment', arguments: {} };
  context.MNAgentBridge.poll();
  assert.equal(results.at(-1).errorCode, 'INVALID_ARGUMENT');
  assert.equal(executeCount, 1);
});
