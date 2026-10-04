# MarginNote MCP Bridge

本地只读 MCP 桥接：Claudian / Codex → stdio MCP → 共享 RPC Host → MarginNote 4 插件。

当前开放四个只读工具：

- `marginnote.get_context`
- `marginnote.search_notes`
- `marginnote.get_note`
- `marginnote.get_current_pdf`

Host 和插件都拒绝其他工具，包括写操作。无模型配置、API Key、聊天界面或会话持久化。MarginNote 返回的内容可能由 Codex 发送给其模型服务。

本机依赖及插件包已构建完成，可直接运行 `./scripts/start-bridge.zsh` 启动 Host，然后安装插件。可复制的本机配置见 [codex-mcp.toml](docs/codex-mcp.toml)。

## 安装和启动

需要 macOS、MarginNote 4、Node.js >=20 和 pnpm（锁文件为 pnpm-lock.yaml）。

```sh
pnpm install --frozen-lockfile
pnpm run verify
pnpm start
```

Host 默认监听 `127.0.0.1:42117`，独立于 MCP 客户端保持运行。不要同时运行旧 Agent Host。端口被占用时报告 `PORT_IN_USE`，不会停止已有进程。

在 MarginNote 中安装、启用 `dist/marginnote-agent.mnaddon`，打开一个学习集窗口。插件包不含旧聊天面板。首版只支持一个连接的学习窗口；多个窗口返回 `AMBIGUOUS_CONTEXT`。不需要关闭其他应用。

```sh
curl http://127.0.0.1:42117/health
```

返回 `service: marginnote-mcp-bridge`、`protocol: 1`；`online: true` 表示插件正在轮询，不代表 PDF 文件路径已经验收。

可选：`pnpm run install:launch-agent` 安装用户 launchd 项，随 MarginNote 自动启停共享 Host。默认不自动安装。已有旧启动项须先核对其项目路径；不能通过杀掉未知端口进程解决冲突。回退时退出新 Host，恢复先前 Git 版本及其对应插件包。

## Codex / Claudian 配置

在实际使用的 Codex 配置中添加以下内容，替换两个绝对路径：

```toml
[mcp_servers.marginnote]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/marginnote-agent/mcp/src/index.mjs"]
startup_timeout_sec = 10
tool_timeout_sec = 30
```

也可使用 `codex mcp add marginnote -- /absolute/path/to/node /absolute/path/to/marginnote-agent/mcp/src/index.mjs`。用 `codex mcp get marginnote` 检查，然后新建 Claudian Codex 会话。Claudian 使用所选 CLI 的 MCP 配置；不要把此配置填到旧 Agent Host 的 config.json。

本机 Node 路径（本次已验证）：`/Users/alexjinrj/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`。它是工具捆绑的运行时，长期使用建议安装稳定位置的 Node，并相应更新配置。

官方说明：[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)、[Claudian](https://github.com/YishenTu/claudian/blob/main/README.md)。

首版保持默认端口；如设置 `MN_BRIDGE_PORT`，Host 和 MCP 均须设置同一值，并修改 addon/config.js 的地址后重新打包安装。

## 工具行为

- `search_notes`：query 必填；不指定 notebook_id 时搜索所有笔记本；limit 默认 30，最大 100。达到 limit 时 possibly_truncated 为 true，不声称返回全部结果。
- `get_note`：必须提供从上下文或搜索取得的 note_id。保留 ID 原值；正文每字段最多 20,000 字符，评论和子节点最多各 100 项，截断有标记。过大的总响应报错，不静默裁剪成无效 JSON。
- `get_context`：返回 available、window_id、notebook、document、focus_note 和 selection_text。无活动学习上下文时 available=false。
- `get_current_pdf`：无参数，只返回当前打开 PDF 的本地绝对路径、文件名、文档 ID、零基 `page_index` 和一基 `page_number`，不返回文档内容。Codex 应使用 `file_path` 在本机打开 PDF，再阅读 `page_number`；切换文档或页码后重新调用。若 Codex 无法访问该路径，会报告文件访问错误；本工具不会隐式复制或上传 PDF。
- PDF 问答由 Codex 使用本地 PDF 阅读能力完成，桥接层不调用模型。
- 原生页码字段名为 native_start_page/native_end_page，索引基准待实机验证。
- 所有层均无自动重试；Host 原生调用超时为 15 秒，MCP HTTP 超时为 20 秒。超时结果区分 not_started 与 unknown。
- Host 不可用、插件未连接、目标不存在、窗口歧义等是可恢复的工具错误，不终止 MCP。
- EOF/退出只关闭当前 MCP 进程；共享 Host 需单独停止。

## 验证

```sh
pnpm run verify
# 安装插件并启动 Host 后，以笔记中确实存在的词测试真实链路：
pnpm run smoke -- "Perceptron"
# 打开一份 PDF 后验证本地路径及页码：
pnpm run smoke:pdf
```

smoke 使用官方 SDK 经 stdio 调用前三个笔记工具，并用搜索返回的 ID 读取笔记。安装新版插件后可运行 `pnpm run smoke:pdf`，验证当前 PDF 路径可从同一 Node 运行环境打开；它不输出 PDF 内容。随后让 Codex 调用 `marginnote.get_current_pdf` 并阅读返回的页码。它不能代替 Claudian 界面的端到端验收。

[架构审计](docs/ARCHITECTURE.md) · [项目规范](PROJECT_SPECIFICATION.md) · [验收记录](docs/VERIFICATION.md) · [待处理问题](docs/ISSUES.md)

## 目录

```text
addon/                    原生工具、轮询和 bridge-only 入口
host/src/bridge-*.mjs      共享 HTTP Host
host/src/marginnote/       可复用队列和旧工具定义
mcp/src/                  MCP 服务、校验、映射和客户端
mcp/test/                 新链路与插件边界测试
scripts/                  打包、校验、监督进程、真实链路 smoke
```

旧 Agent、聊天面板和持久化模块保留供审计/回退参考，不在默认运行路径。除 `get_current_pdf` 外的 Stage 2 功能和写入工具尚未启用。
