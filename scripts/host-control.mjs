import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const MAX_BODY = 4096;
const html = (token) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MarginNote Host 控制台</title>
<style>
body{font:15px -apple-system,BlinkMacSystemFont,sans-serif;max-width:620px;margin:42px auto;padding:0 18px;color:#17212b;background:#f5f7fa}h1{font-size:24px}section{background:white;border:1px solid #dce2e9;border-radius:12px;padding:18px;margin:16px 0}p{line-height:1.5}button{font:inherit;border:1px solid #9aa8b6;border-radius:8px;background:#fff;padding:9px 13px;margin:4px 5px 4px 0;cursor:pointer}button:hover{background:#edf3f8}.primary{background:#1456a0;color:white;border-color:#1456a0}.primary:hover{background:#0b478c}.warn{color:#963c15}code{background:#edf1f5;padding:2px 4px;border-radius:4px}small{color:#536270}#message{min-height:22px}</style>
</head><body><h1>MarginNote Host 控制台</h1>
<section><strong>当前状态</strong><p id="status">读取中…</p><small id="details"></small></section>
<section><strong>操作</strong><p>自动模式下，Host 随 MarginNote 启停。暂停后，即使 MarginNote 开着也不会启动 Host。</p>
<button class="primary" data-action="resume">恢复自动运行</button><button data-action="pause">暂停 Host</button><button data-action="restart">重启 Host</button></section>
<section><strong>卡片写入</strong><p id="writes"></p><button data-action="writes_on">允许写入</button><button data-action="writes_off">关闭写入</button></section>
<section><strong>开发时更新</strong><p>修改 Host 代码后点「重启 Host」。修改 MCP 工具定义后还要新建 Codex 会话。修改 MarginNote 插件后，点「构建插件包」，再到 MarginNote 安装新版插件。</p><button data-action="build_addon">构建插件包</button><small>本页面只管理这个后台项启动的 Host，不会关闭占用端口的其他进程。</small></section>
<p id="message" role="status"></p>
<script>
const token=${JSON.stringify(token)};
const $=id=>document.getElementById(id);
async function refresh(){try{const r=await fetch('/api/status',{cache:'no-store'});const s=await r.json();const h=s.host;
 $('status').textContent=(s.managed_host_running?'后台项管理的 Host 正运行':h?'端口上有其他 Host':'Host 未运行')+' · MarginNote '+(s.margin_note_running?'已打开':'未打开')+' · '+(s.paused?'已暂停':'自动运行');
 $('details').textContent=h?'Host '+h.version+' · 插件 '+(h.online?'已连接':'未连接')+' · 端口 '+s.port:'端口 '+s.port+' 未响应';
 $('writes').textContent='设置：'+(s.writes_enabled_setting?'允许写入':'关闭写入')+'；当前 Host：'+(h?(h.writes_enabled?'允许写入':'关闭写入或旧版本未报告'):'未运行')+(h&&!s.managed_host_running?'。当前端口由手动 Host 占用，设置将在它退出后生效。':'。');
}catch(e){$('status').textContent='无法连接控制台：'+e.message}}
document.querySelectorAll('button[data-action]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const r=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Control-Token':token},body:JSON.stringify({action:b.dataset.action})});const v=await r.json();$('message').textContent=v.message||v.error||'操作完成';await refresh()}catch(e){$('message').textContent=e.message}finally{b.disabled=false}});
refresh();setInterval(refresh,2000);
</script></body></html>`;

async function defaultBuildAddon(projectDir) {
  await execFileAsync(process.execPath, [path.join(projectDir, 'scripts/build-addon.mjs')], { cwd: projectDir, timeout: 30000 });
  await execFileAsync(process.execPath, [path.join(projectDir, 'scripts/verify-addon.mjs')], { cwd: projectDir, timeout: 30000 });
  return path.join(projectDir, 'dist/marginnote-agent.mnaddon');
}

export function createControlServer({ supervisor, saveSettings, port = 42118, host = '127.0.0.1', fetchHealth = globalThis.fetch, buildAddon = defaultBuildAddon } = {}) {
  const token = randomUUID();
  let busy = false;
  const server = http.createServer(async (req, res) => {
    const authority = `${host}:${server.address().port}`;
    const origin = `http://${authority}`;
    if (req.headers.host !== authority || (req.headers.origin && req.headers.origin !== origin)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const send = (code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" });
      res.end(html(token));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/status') {
      let health = null;
      try {
        const response = await fetchHealth(`http://127.0.0.1:${supervisor.port}/health`, { signal: AbortSignal.timeout(700) });
        if (response.ok) {
          const payload = await response.json();
          if (payload.service === 'marginnote-mcp-bridge') health = { version: payload.version, online: payload.online, writes_enabled: payload.writes_enabled === true };
        }
      } catch {}
      send(200, { ...supervisor.status(), host: health });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/action') {
      if (req.headers['x-control-token'] !== token) return send(403, { error: 'Invalid control token' });
      if (busy) return send(409, { error: 'Another action is in progress' });
      busy = true;
      try {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > MAX_BODY) return send(413, { error: 'Request too large' });
        }
        const action = JSON.parse(body).action;
        if (!['pause', 'resume', 'restart', 'writes_on', 'writes_off', 'build_addon'].includes(action)) return send(400, { error: 'Unknown action' });
        if (action === 'build_addon') {
          const archive = await buildAddon(supervisor.projectDir);
          return send(200, { message: `插件包已构建：${archive}。仍需在 MarginNote 中安装。` });
        }
        const oldSettings = { paused: supervisor.paused, writesEnabled: supervisor.writesEnabled };
        const managed = supervisor.status().managed_host_running;
        if (action === 'pause') supervisor.paused = true;
        if (action === 'resume') supervisor.paused = false;
        if (action === 'writes_on') supervisor.writesEnabled = true;
        if (action === 'writes_off') supervisor.writesEnabled = false;
        try {
          if (action !== 'restart') await saveSettings();
        } catch (error) {
          supervisor.paused = oldSettings.paused;
          supervisor.writesEnabled = oldSettings.writesEnabled;
          throw error;
        }
        if (action === 'pause') supervisor.stopHost();
        else if (action === 'restart' || action.startsWith('writes_')) supervisor.restartHost();
        else void supervisor.reconcile();
        send(200, { message: managed ? (action === 'restart' ? '正在重启受管理的 Host' : '设置已保存；受管理的 Host 将按新设置运行') :
          (action === 'restart' ? '当前端口上的手动 Host 不受本页面控制；请先在原 Terminal 停止它。' : '设置已保存。当前端口上的手动 Host 不受本页面控制；它退出后新设置才会生效。') });
      } catch (error) {
        send(400, { error: error.message });
      } finally {
        busy = false;
      }
      return;
    }
    send(404, { error: 'Not found' });
  });
  return {
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    async close() {
      server.closeIdleConnections();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    },
  };
}
