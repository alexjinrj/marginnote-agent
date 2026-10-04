import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlServer } from '../../scripts/host-control.mjs';

test('local Host dashboard reports state and controls only its managed child', async t => {
  const actions = [];
  const supervisor = {
    port: 42117, projectDir: '/tmp/example-project', paused: false, writesEnabled: false,
    status() { return { managed_host_running: false, margin_note_running: true, paused: this.paused, writes_enabled_setting: this.writesEnabled, port: this.port }; },
    stopHost() { actions.push('stop'); },
    restartHost() { actions.push('restart'); },
    reconcile() { actions.push('reconcile'); },
  };
  const saved = [];
  const control = createControlServer({ supervisor, saveSettings: async () => saved.push({ paused: supervisor.paused, writesEnabled: supervisor.writesEnabled }), port: 0, fetchHealth: async () => ({ ok: true, json: async () => ({ service: 'marginnote-mcp-bridge', version: '0.5.0', online: true }) }), buildAddon: async dir => { assert.equal(dir, supervisor.projectDir); return '/tmp/package.mnaddon'; } });
  const address = await control.listen();
  t.after(() => control.close());
  const url = `http://127.0.0.1:${address.port}`;
  const page = await (await fetch(url)).text();
  assert.match(page, /MarginNote Host 控制台/);
  const token = page.match(/const token="([^"]+)"/)[1];
  const state = await (await fetch(url + '/api/status')).json();
  assert.equal(state.host.version, '0.5.0');
  assert.equal(state.managed_host_running, false);
  const action = (name, headers = {}) => fetch(url + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ action: name }) });
  assert.equal((await action('writes_on')).status, 403);
  assert.equal((await action('writes_on', { 'X-Control-Token': token, Origin: 'https://example.com' })).status, 403);
  assert.equal((await action('writes_on', { 'X-Control-Token': token })).status, 200);
  assert.equal(supervisor.writesEnabled, true);
  assert.deepEqual(actions, ['restart']);
  assert.deepEqual(saved, [{ paused: false, writesEnabled: true }]);
  await action('pause', { 'X-Control-Token': token });
  assert.equal(supervisor.paused, true);
  assert.deepEqual(actions, ['restart', 'stop']);
  await action('resume', { 'X-Control-Token': token });
  assert.equal(supervisor.paused, false);
  assert.deepEqual(actions, ['restart', 'stop', 'reconcile']);
  const built = await (await action('build_addon', { 'X-Control-Token': token })).json();
  assert.match(built.message, /package\.mnaddon/);
});
