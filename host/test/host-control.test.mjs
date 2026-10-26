import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlServer } from '../../scripts/host-control.mjs';

const integration = {
  addon: {
    installed: true,
    version: '0.9.2',
    directory: '/tmp/example-addon.mnaddon',
    archive: '/tmp/package.mnaddon',
    built_archive_available: false,
    bundled_archive_available: true,
    bundled_archive: '/tmp/bundled.mnaddon',
  },
  mcp: {
    configured: true,
    installed: true,
    points_to_this_project: true,
    config_path: '/tmp/config.toml',
    expected_entrypoint: '/tmp/example-project/bin/marginnote-agent-mcp',
    ok: null,
  },
  margin_note: { running: true },
};

test('local dashboard reports integration state and controls only its managed child', async t => {
  const actions = [];
  const supervisor = {
    port: 42117, controlPort: 42118, projectDir: '/tmp/example-project', paused: false, writesEnabled: false,
    status() { return { managed_host_running: false, margin_note_running: true, paused: this.paused, writes_enabled_setting: this.writesEnabled, port: this.port }; },
    stopHost() { actions.push('stop'); },
    restartHost() { actions.push('restart'); },
    reconcile() { actions.push('reconcile'); },
  };
  const saved = [];
  const opened = [];
  const collected = [];
  const control = createControlServer({
    supervisor,
    saveSettings: async () => saved.push({ paused: supervisor.paused, writesEnabled: supervisor.writesEnabled }),
    port: 0,
    logDir: '/tmp/does-not-exist',
    fetchHealth: async () => ({ version: '0.9.2', online: true, writes_enabled: false }),
    collectStatus: async options => { collected.push(options); return integration; },
    buildAddon: async (dir, env) => { assert.equal(dir, supervisor.projectDir); assert.ok(env); return '/tmp/package.mnaddon'; },
    openPath: async target => opened.push(target),
  });
  const address = await control.listen();
  t.after(() => control.close());
  const url = `http://127.0.0.1:${address.port}`;
  const page = await (await fetch(url)).text();
  assert.match(page, /MarginNote Agent/);
  assert.match(page, /Service Console/);
  assert.match(page, /Test MCP server/);
  const health = await (await fetch(url + '/health')).json();
  assert.deepEqual(health, { service: 'marginnote-agent-dashboard', protocol: 1 });
  const token = page.match(/const token="([^"]+)"/)[1];
  const state = await (await fetch(url + '/api/status')).json();
  assert.equal(state.host.version, '0.9.2');
  assert.equal(state.managed_host_running, false);
  assert.equal(state.integration.addon.installed, true);
  assert.equal(state.integration.mcp.installed, true);
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
  const probe = await (await action('probe_mcp', { 'X-Control-Token': token })).json();
  assert.match(probe.message, /MCP handshake failed/);
  assert.equal(probe.status.integration.mcp.ok, null);
  integration.mcp.ok = true;
  integration.mcp.tool_count = 11;
  const passed = await (await action('probe_mcp', { 'X-Control-Token': token })).json();
  assert.match(passed.message, /11 tools/);
  await action('open_addon', { 'X-Control-Token': token });
  assert.deepEqual(opened, ['/tmp/bundled.mnaddon']);
  assert.equal(collected[0].probe, false);
});
