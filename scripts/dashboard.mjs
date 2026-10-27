import http from "node:http";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { collectIntegrationStatus } from "./integration-status.mjs";
import { resolveServicePaths, serviceEnvironment } from "./service-config.mjs";

const execFileAsync = promisify(execFile);
const MAX_BODY = 4096;
const MAX_RESPONSE_BYTES = 256 * 1024;

const dashboardHtml = (token, initialStatus) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MarginNote Agent · Service Console</title>
<style>
:root{color-scheme:light dark;--bg:#f3f6f9;--panel:#fff;--soft:#f8fafc;--line:#dbe3eb;--text:#17212b;--muted:#617080;--accent:#1456a0;--accent-2:#0f4585;--good:#18794e;--good-bg:#e8f6ee;--warn:#8a560b;--warn-bg:#fff4dc;--bad:#b42318;--bad-bg:#fdecea;--shadow:0 1px 2px #14213d0d,0 8px 24px #14213d0a}
@media(prefers-color-scheme:dark){:root{--bg:#10151b;--panel:#171e26;--soft:#1d2630;--line:#2c3743;--text:#e7edf4;--muted:#9aa8b7;--accent:#74a9e6;--accent-2:#9bc2ef;--good:#73d6a4;--good-bg:#143525;--warn:#f0c674;--warn-bg:#382b12;--bad:#ff9d94;--bad-bg:#3b1c1c;--shadow:0 1px 2px #0005,0 8px 24px #0004}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.shell{max-width:1040px;margin:0 auto;padding:32px 20px 48px}.hero{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:22px}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:5px}h1{font-size:27px;line-height:1.2;margin:0 0 6px;letter-spacing:-.02em}.hero p{margin:0;color:var(--muted);max-width:620px}.hero-right{text-align:right;white-space:nowrap}.hero-right .version{font-weight:650}.hero-right .checked{display:block;color:var(--muted);font-size:12px;margin-top:4px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:18px;min-width:0}.card.wide{grid-column:1/-1}
.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}.card-title{font-size:15px;font-weight:700;letter-spacing:-.01em}.card-subtitle{color:var(--muted);font-size:12.5px;margin:3px 0 0}
.pill{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:999px;font-size:11.5px;font-weight:650;white-space:nowrap}.pill:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}.pill.good{color:var(--good);background:var(--good-bg)}.pill.warn{color:var(--warn);background:var(--warn-bg)}.pill.bad{color:var(--bad);background:var(--bad-bg)}.pill.neutral{color:var(--muted);background:var(--soft)}
.kv{display:grid;grid-template-columns:128px minmax(0,1fr);gap:7px 12px;font-size:13px}.kv dt{color:var(--muted)}.kv dd{margin:0;min-width:0;overflow-wrap:anywhere}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.muted{color:var(--muted)}.good-text{color:var(--good)}.warn-text{color:var(--warn)}.bad-text{color:var(--bad)}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.btn{appearance:none;border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:8px;padding:8px 11px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;transition:background .14s,border-color .14s}.btn:hover{background:var(--soft)}.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}.btn.primary:hover{background:var(--accent-2)}.btn:disabled{opacity:.5;cursor:wait}.btn.small{padding:5px 8px;font-size:11.5px}
.steps{counter-reset:step;display:grid;gap:9px;margin:0;padding:0;list-style:none}.steps li{display:grid;grid-template-columns:24px minmax(0,1fr);gap:9px;align-items:start;font-size:13px}.steps li:before{counter-increment:step;content:counter(step);display:grid;place-items:center;width:21px;height:21px;border-radius:50%;background:var(--soft);border:1px solid var(--line);font-size:11px;font-weight:700;color:var(--muted)}.steps strong{display:block;font-size:13px}.steps span{color:var(--muted);font-size:12.5px}
pre.logs{margin:0;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:12px;max-height:240px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:11.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text)}
.notice{display:none;margin:0 0 14px;padding:10px 12px;border-radius:9px;border:1px solid var(--line);background:var(--panel);font-size:13px}.notice.show{display:block}.notice.error{border-color:var(--bad);background:var(--bad-bg);color:var(--bad)}
.footer{text-align:center;color:var(--muted);font-size:11.5px;margin-top:22px}code{background:var(--soft);padding:1px 5px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
@media(max-width:760px){.shell{padding:22px 14px 36px}.hero{display:block}.hero-right{text-align:left;margin-top:10px}.grid{grid-template-columns:1fr}.kv{grid-template-columns:105px minmax(0,1fr)}}
</style></head>
<body><main class="shell">
<header class="hero"><div><div class="eyebrow">MarginNote Agent</div><h1>Service Console</h1><p>Manage the local bridge, verify the MarginNote add-on, and check whether an MCP client is wired to this installation.</p></div><div class="hero-right"><span class="version" id="version">—</span><span class="checked" id="checked">Checking…</span></div></header>
<div id="notice" class="notice" role="status" aria-live="polite"></div>
<section class="grid">
  <article class="card"><div class="card-head"><div><div class="card-title">Bridge service</div><p class="card-subtitle">Shared localhost RPC host</p></div><span id="bridgePill" class="pill neutral">Checking</span></div>
    <dl class="kv"><dt>Process</dt><dd id="bridgeProcess">—</dd><dt>MarginNote</dt><dd id="bridgeMarginNote">—</dd><dt>Add-on link</dt><dd id="bridgeOnline">—</dd><dt>Writes</dt><dd id="bridgeWrites">—</dd><dt>Port</dt><dd id="bridgePort" class="mono">—</dd></dl>
    <div class="actions"><button class="btn primary" data-action="restart">Restart bridge</button><button class="btn" data-action="pause">Pause</button><button class="btn" data-action="resume">Resume</button></div>
  </article>
  <article class="card"><div class="card-head"><div><div class="card-title">MarginNote add-on</div><p class="card-subtitle">Manifest detection inside MarginNote 4</p></div><span id="addonPill" class="pill neutral">Checking</span></div>
    <dl class="kv"><dt>Installed</dt><dd id="addonInstalled">—</dd><dt>Version</dt><dd id="addonVersion">—</dd><dt>Location</dt><dd id="addonPath" class="mono">—</dd><dt>Local archive</dt><dd id="addonArchive">—</dd></dl>
    <div class="actions"><button class="btn" data-action="build_addon">Build add-on package</button><button class="btn" data-action="open_addon">Show package</button></div>
  </article>
  <article class="card"><div class="card-head"><div><div class="card-title">MCP stdio client</div><p class="card-subtitle">Codex-compatible MCP configuration</p></div><span id="mcpPill" class="pill neutral">Checking</span></div>
    <dl class="kv"><dt>Configured</dt><dd id="mcpConfigured">—</dd><dt>Handshake</dt><dd id="mcpHandshake">—</dd><dt>Project target</dt><dd id="mcpTarget">—</dd><dt>Config</dt><dd id="mcpConfig" class="mono">—</dd><dt>Entrypoint</dt><dd id="mcpEntry" class="mono">—</dd></dl>
    <div class="actions"><button class="btn" data-action="probe_mcp">Test MCP server</button></div>
  </article>
  <article class="card"><div class="card-head"><div><div class="card-title">Service control</div><p class="card-subtitle">Host behavior and write access</p></div><span id="controlPill" class="pill neutral">Checking</span></div>
    <dl class="kv"><dt>Supervisor</dt><dd id="controlSupervisor">—</dd><dt>State directory</dt><dd id="controlState" class="mono">—</dd><dt>Control port</dt><dd id="controlPort" class="mono">—</dd><dt>Launch mode</dt><dd id="controlMode">—</dd></dl>
    <div class="actions"><button class="btn" data-action="writes_on">Enable writes</button><button class="btn" data-action="writes_off">Disable writes</button></div>
  </article>
  <article class="card wide"><div class="card-head"><div><div class="card-title">Setup check</div><p class="card-subtitle">Complete these once; the service follows MarginNote automatically afterwards</p></div></div>
    <ol class="steps">
      <li><div><strong>Start the Homebrew service</strong><span id="setupService" class="muted">Checking…</span></div></li>
      <li><div><strong>Install and enable the add-on</strong><span id="setupAddon" class="muted">Checking…</span></div></li>
      <li><div><strong>Connect your MCP client</strong><span id="setupMcp" class="muted">Checking…</span></div></li>
      <li><div><strong>Open one MarginNote study window</strong><span id="setupMarginNote" class="muted">Checking…</span></div></li>
    </ol>
  </article>
  <article class="card wide"><div class="card-head"><div><div class="card-title">Recent service logs</div><p class="card-subtitle">Last lines from the supervisor and bridge</p></div><button class="btn small" data-action="refresh">Refresh</button></div><pre id="logs" class="logs">Loading…</pre></article>
</section>
<p class="footer">Local-only dashboard · requests are restricted to this origin · <span id="footerPort">—</span></p>
</main>
<script type="application/json" id="initial-status">${JSON.stringify(initialStatus).replaceAll("<", "\\u003c")}</script>
<script>
const token=${JSON.stringify(token)};
const $=id=>document.getElementById(id);
let latest=null;
const pill=(el,text,kind)=>{el.textContent=text;el.className='pill '+kind};
const setText=(id,value)=>{$(id).textContent=value??'—'};
function render(s){
  latest=s;const h=s.host;
  setText('version',s.version?('v'+s.version):'Version unknown');
  setText('checked','Checked '+new Date(s.checked_at).toLocaleTimeString());
  const bridgeText=h?(s.managed_host_running?'Running':'Port in use'):(s.paused?'Paused':'Stopped');
  pill($('bridgePill'),bridgeText,h?(s.managed_host_running?'good':'warn'):(s.paused?'warn':'bad'));
  setText('bridgeProcess',s.managed_host_running?'Managed by supervisor':h?'External process on port '+s.port:'No process');
  setText('bridgeMarginNote',s.margin_note_running?'Running':'Not detected');
  setText('bridgeOnline',h?(h.online?'Connected':'Waiting for add-on'):'No health response');
  setText('bridgeWrites',h?(h.writes_enabled?'Enabled':'Disabled'):'—');
  setText('bridgePort',s.port);
  const a=s.integration.addon;
  pill($('addonPill'),a.installed?'Detected':'Not detected',a.installed?'good':'bad');
  setText('addonInstalled',a.installed?'Manifest detected; enable it in MarginNote':'Not found');
  setText('addonVersion',a.version);
  setText('addonPath',a.directory||'Not found in the standard MarginNote data directories');
  setText('addonArchive',a.built_archive_available?a.archive:(a.bundled_archive_available?a.bundled_archive:'Not packaged · use “Build add-on package”'));
  const m=s.integration.mcp;
  pill($('mcpPill'),m.configured?(m.points_to_this_project?'Configured':'Different path'):'Not configured',m.configured?(m.points_to_this_project?'good':'warn'):'bad');
  setText('mcpConfigured',m.installed?(m.configured?'MCP wrapper and marginnote entry found':'MCP wrapper installed; not configured'):'MCP wrapper or dependencies missing');
  setText('mcpHandshake',m.ok===null?'Not tested':m.ok?'Passed · '+m.tool_count+' tools':'Failed'+(m.message?': '+m.message:''));
  setText('mcpTarget',m.points_to_this_project?'Points to this installation':'Points to a different installation');
  setText('mcpConfig',m.config_path);setText('mcpEntry',m.expected_entrypoint);
  if(m.requires_node_on_path)setText('mcpTarget',(m.points_to_this_project?'Points to this installation':'Points to a different installation')+' · requires node on Homebrew service PATH');
  const c=s.integration.margin_note;
  pill($('controlPill'),s.paused?'Paused':s.writes_enabled_setting?'Writes on':'Auto',s.paused?'warn':s.writes_enabled_setting?'warn':'good');
  setText('controlSupervisor',s.service_mode);setText('controlState',s.state_dir);
  setText('controlPort',s.control_port);setText('controlMode','Follows MarginNote automatically');
  setText('setupService',s.service_mode+' is active');
  setText('setupAddon',a.installed?'Add-on '+(a.version||'')+' installed at '+a.directory:'Install '+a.archive+' from MarginNote.');
  setText('setupMcp',m.configured?(m.points_to_this_project?'Codex config points to this MCP entrypoint.':'Codex points elsewhere. Expected '+m.expected_entrypoint+'.'):'Add the marginnote server to '+m.config_path+'.');
  setText('setupMarginNote',c.running?'MarginNote 4 is running.':'Open MarginNote 4 and one study window.');
  $('setupService').className='good-text';$('setupAddon').className=a.installed?'good-text':'warn-text';
  $('setupMcp').className=m.configured&&m.points_to_this_project?'good-text':'warn-text';
  $('setupMarginNote').className=c.running?'good-text':'warn-text';
  $('logs').textContent=s.logs||'No log output is available yet.';$('footerPort').textContent='Port '+location.port;
}
function notice(text,error=false){const n=$('notice');n.textContent=text;n.className='notice show'+(error?' error':'');clearTimeout(notice.timer);notice.timer=setTimeout(()=>n.className='notice',5000)}
async function refresh(){try{const r=await fetch('/api/status',{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);render(await r.json())}catch(e){notice('Could not reach dashboard: '+e.message,true)}}
async function act(action){document.querySelectorAll('button[data-action]').forEach(b=>b.disabled=true);try{const r=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Control-Token':token},body:JSON.stringify({action})});const v=await r.json();if(!r.ok)throw new Error(v.error||'Action failed');notice(v.message||'Done');await refresh()}catch(e){notice(e.message,true)}finally{document.querySelectorAll('button[data-action]').forEach(b=>b.disabled=false)}}
document.querySelectorAll('button[data-action]').forEach(b=>b.onclick=()=>{if(b.dataset.action==='refresh')refresh();else act(b.dataset.action)});
const initial=document.getElementById('initial-status');try{render(JSON.parse(initial.textContent))}catch{}
refresh();setInterval(refresh,3000);
</script></body></html>`;

async function readTail(filePath, byteLength = 24 * 1024) {
  let handle;
  try {
    handle = await open(filePath, "r");
    const { size } = await handle.stat();
    const length = Math.min(size, byteLength);
    if (!length) return "";
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, size - length);
    return buffer.toString("utf8", 0, bytesRead);
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  } finally {
    await handle?.close();
  }
}

async function recentLogs(logDir, lines = 24) {
  const entries = [];
  for (const name of [
    "marginnote-agent.log",
    "marginnote-agent.err.log",
    "host.stdout.log",
    "host.stderr.log",
  ]) {
    const content = await readTail(path.join(logDir, name));
    const tail = content.split(/\r?\n/).filter(Boolean).slice(-lines);
    if (tail.length) entries.push(`--- ${name} ---\n${tail.join("\n")}`);
  }
  return entries.join("\n\n");
}

async function bridgeHealth(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (payload.service !== "marginnote-mcp-bridge") return null;
    return {
      version: payload.version,
      online: payload.online === true,
      writes_enabled: payload.writes_enabled === true,
    };
  } catch {
    return null;
  }
}

async function defaultBuildAddon(projectDir, env) {
  await execFileAsync(process.execPath, [path.join(projectDir, "scripts/build-addon.mjs")], {
    cwd: projectDir,
    env: serviceEnvironment({ projectDir, env }),
    timeout: 30_000,
  });
  await execFileAsync(process.execPath, [path.join(projectDir, "scripts/verify-addon.mjs")], {
    cwd: projectDir,
    env: serviceEnvironment({ projectDir, env }),
    timeout: 30_000,
  });
  return resolveServicePaths({ projectDir, env }).addonArchive;
}

export function createControlServer({
  supervisor,
  saveSettings,
  port = 42118,
  host = "127.0.0.1",
  projectDir = supervisor.projectDir,
  stateDir = null,
  logDir = null,
  fetchHealth = bridgeHealth,
  collectStatus = collectIntegrationStatus,
  buildAddon = defaultBuildAddon,
  openPath = async (target) => {
    await execFileAsync("/usr/bin/open", ["-R", target], { timeout: 10_000 });
  },
  env = process.env,
} = {}) {
  const paths = resolveServicePaths({ projectDir, env });
  const resolvedStateDir = stateDir ?? paths.stateDir;
  const resolvedLogDir = logDir ?? paths.logDir;
  const token = randomUUID();
  let busy = false;
  let statusInFlight = null;
  let cachedIntegration = null;

  const status = async ({ probe = false } = {}) => {
    const now = Date.now();
    const integrationPromise = !probe
      && cachedIntegration
      && now - cachedIntegration.at < 15_000
      ? Promise.resolve(cachedIntegration.value)
      : collectStatus({ projectDir, env, probe }).then((value) => {
        if (!probe) cachedIntegration = { at: Date.now(), value };
        return value;
      });
    const [health, integration, logs] = await Promise.all([
      fetchHealth(supervisor.port),
      integrationPromise,
      recentLogs(resolvedLogDir),
    ]);
    return {
      ...supervisor.status(),
      host: health,
      integration,
      logs,
      state_dir: resolvedStateDir,
      version: health?.version ?? null,
      service_mode: env.MN_AGENT_SERVICE_MODE ?? "Foreground supervisor",
      checked_at: new Date().toISOString(),
      mcp_entrypoint: integration.mcp.expected_entrypoint,
    };
  };

  const statusPage = async () => status({ probe: false });

  const server = http.createServer(async (req, res) => {
    const authority = `${host}:${server.address().port}`;
    const origin = `http://${authority}`;
    if (req.headers.host !== authority || (req.headers.origin && req.headers.origin !== origin)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const send = (code, data) => {
      const body = JSON.stringify(data);
      if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Dashboard response is too large" }));
        return;
      }
      res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(body);
    };

    if (req.method === "GET" && req.url === "/") {
      const initial = await statusPage();
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
      });
      res.end(dashboardHtml(token, initial));
      return;
    }
    if (req.method === "GET" && req.url === "/api/status") {
      if (!statusInFlight) statusInFlight = status();
      try {
        send(200, await statusInFlight);
      } finally {
        statusInFlight = null;
      }
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      send(200, {
        service: "marginnote-agent-dashboard",
        protocol: 1,
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/action") {
      if (req.headers["x-control-token"] !== token) return send(403, { error: "Invalid control token" });
      if (busy) return send(409, { error: "Another action is in progress" });
      busy = true;
      try {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > MAX_BODY) return send(413, { error: "Request too large" });
        }
        const action = JSON.parse(body).action;
        const allowed = [
          "pause",
          "resume",
          "restart",
          "writes_on",
          "writes_off",
          "build_addon",
          "probe_mcp",
          "open_addon",
        ];
        if (!allowed.includes(action)) return send(400, { error: "Unknown action" });
        if (action === "probe_mcp") {
          const result = await status({ probe: true });
          cachedIntegration = { at: Date.now(), value: result.integration };
          return send(200, {
            message: result.integration.mcp.ok
              ? `MCP handshake passed with ${result.integration.mcp.tool_count} tools.`
              : `MCP handshake failed: ${result.integration.mcp.message || result.integration.mcp.reason}`,
            status: result,
          });
        }
        if (action === "build_addon") {
          const archive = await buildAddon(projectDir, env);
          cachedIntegration = null;
          return send(200, { message: `Add-on package built: ${archive}. Install it in MarginNote.` });
        }
        if (action === "open_addon") {
          const candidate = (await collectStatus({ projectDir, env, probe: false })).addon;
          const target = candidate.built_archive_available
            ? candidate.archive
            : candidate.bundled_archive_available
              ? candidate.bundled_archive
              : null;
          if (!target) {
            return send(400, {
              error: "No add-on package is available. Build it first, or reinstall the Homebrew package.",
            });
          }
          await openPath(target);
          return send(200, { message: `Revealed ${target} in Finder.` });
        }
        const oldSettings = { paused: supervisor.paused, writesEnabled: supervisor.writesEnabled };
        const managed = supervisor.status().managed_host_running;
        if (action === "pause") supervisor.paused = true;
        if (action === "resume") supervisor.paused = false;
        if (action === "writes_on") supervisor.writesEnabled = true;
        if (action === "writes_off") supervisor.writesEnabled = false;
        try {
          if (action !== "restart") await saveSettings();
        } catch (error) {
          supervisor.paused = oldSettings.paused;
          supervisor.writesEnabled = oldSettings.writesEnabled;
          throw error;
        }
        if (action === "pause") supervisor.stopHost();
        else if (action === "restart" || action.startsWith("writes_")) supervisor.restartHost();
        else void supervisor.reconcile();
        return send(200, {
          message: managed
            ? action === "restart"
              ? "Restarting the managed bridge."
              : "Settings saved; the managed bridge will use them."
            : action === "restart"
              ? "The bridge on this port is not managed by the dashboard."
              : "Settings saved. They apply after the externally started bridge exits.",
        });
      } catch (error) {
        send(400, { error: error.message });
      } finally {
        busy = false;
      }
      return;
    }
    send(404, { error: "Not found" });
  });

  return {
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    async close() {
      server.closeIdleConnections();
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    },
  };
}
