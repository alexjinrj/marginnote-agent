# MarginNote MCP Bridge

Codex / Claude / Claudian → stdio MCP → Homebrew 管理的共享 RPC Host → MarginNote 4 Add-on。

0.9.2 将桥接服务、管理面板和插件打包纳入 Homebrew 安装。共享 RPC Host 与本地管理页由一个后台 supervisor 管理，随 MarginNote 启停；stdio MCP 仍由 Codex、Claude、Claudian 等客户端按需启动。卡片阅读提供文字、评论、关系与可用图片；知识归纳、手写视觉理解和问答由客户端 Agent 完成。Host 和 Add-on 不调用模型。逐工具审查及旧能力映射见 [TOOL_REVIEW.md](docs/TOOL_REVIEW.md)。

## 安装与启动

需要 macOS、Homebrew、MarginNote 4。Formula 会安装 Node.js 和锁定的依赖。Xcode Command Line Tools 只在重新构建插件或使用本地 PDF OCR 时需要。

仓库内保留了 Formula 模板。Formula 会拉取 `url`/`revision` 指定的远端提交，并不会自动使用当前未提交的工作树。发布到 tap 前，先按 [Homebrew 指南](docs/HOMEBREW.md) 把 `url`/`revision` 指向包含实现的发布提交，然后通过 tap 安装：

```sh
brew install <owner>/<tap>/marginnote-agent
brew services start marginnote-agent
marginnote-agent status
```

服务默认监听桥接端口 `127.0.0.1:42117`，管理页位于 `http://127.0.0.1:42118`。supervisor 会跟随 MarginNote 进程启动和停止自己的 Host 子进程；端口已被其他进程占用时只报告冲突，不接管或终止该进程。

```sh
marginnote-agent dashboard
marginnote-agent logs --follow
brew services restart marginnote-agent
brew services stop marginnote-agent
```

`marginnote-agent start|stop|restart` 会把操作委托给 `brew services`。开发时如需前台运行 supervisor，使用 `marginnote-agent serve`，按 Ctrl-C 停止。

## 安装插件与连接 MCP

Formula 自带打包好的插件：

```sh
marginnote-agent status
open "$(brew --prefix)/opt/marginnote-agent/share"
```

在 MarginNote 4 中安装 `marginnote-agent.mnaddon`，启用插件，然后打开一个学习集窗口。安装和启用仍是 MarginNote 内的手动步骤，Formula 不会修改应用容器。管理页只根据标准数据位置中的插件 manifest 判断“已安装/已检测”，插件是否启用及是否已连接由桥接健康状态单独显示。多个学习窗口会返回 `AMBIGUOUS_CONTEXT`；如果 MarginNote 的「暂停插件」已选中，应先恢复插件。

安装 Xcode Command Line Tools 后，也可在管理页重新构建插件包，或运行：

```sh
marginnote-agent build-addon
```

重新构建的插件保存在用户状态目录，不写入 Homebrew Cellar。

MCP stdio 由客户端启动，不是第二个后台服务。打印 Codex 配置片段：

```sh
marginnote-agent mcp-config
```

Homebrew 安装会输出指向稳定链接的配置：

```toml
[mcp_servers.marginnote]
command = "$(brew --prefix)/bin/marginnote-agent-mcp"
args = []
startup_timeout_sec = 10
tool_timeout_sec = 120
```

实际使用时把命令替换为 `marginnote-agent mcp-config` 打印的绝对路径。不要指向版本化的 `Cellar/...` 路径，因为 `brew upgrade` 后它可能失效。已有配置若直接指向旧的 Node 脚本，也应更新到稳定 wrapper 后重连客户端。组合卡片读取和本地 PDF OCR 可能超过 30 秒，因此建议工具超时设为 120 秒。

Claudian 使用所选 CLI 的 MCP 配置。修改工具或升级后重连 MCP；如果新会话仍沿用旧 MCP 进程，就重启客户端。

## 健康检查、写入与升级

```sh
curl http://127.0.0.1:42117/health
curl http://127.0.0.1:42118/health
```

桥接健康检查应返回 `service: marginnote-mcp-bridge`、`protocol: 1`；`online: true` 表示插件正在轮询。管理页健康检查返回 `service: marginnote-agent-dashboard`、`protocol: 1`。两者是独立的进程状态：管理页和 supervisor 可以运行，而桥接正在等待 MarginNote 启动。

写入默认关闭。在管理页选择 **Enable writes**，或修改设置后重启服务。设置和日志都在 Cellar 之外：

```text
设置：~/Library/Application Support/MarginNote Agent/host-control.json
重建插件：~/Library/Application Support/MarginNote Agent/marginnote-agent.mnaddon
辅助程序：~/Library/Application Support/MarginNote Agent/bin/
服务日志：$(brew --prefix)/var/log/marginnote-agent*.log
```

```sh
brew update
brew upgrade marginnote-agent
brew services restart marginnote-agent
```

稳定 `bin` 链接、端口和管理页 URL 在升级后保持不变。插件版本独立管理；manifest 版本变化时需要重新安装插件。完整的 tap、升级和故障排查说明见 [docs/HOMEBREW.md](docs/HOMEBREW.md)。

## 卸载与数据清理

先停止服务并取消登录自启动，再卸载程序；不要依赖 `brew uninstall` 自动停止正在运行的服务：

```sh
brew services stop marginnote-agent
brew uninstall marginnote-agent
```

手动启动的 Host/supervisor 请在对应 Terminal 按 Ctrl-C 停止。MarginNote Add-on 需在 MarginNote 内卸载；MCP 客户端需删除或禁用对应配置，并关闭旧连接。

卸载会保留 `~/Library/Application Support/MarginNote Agent/` 中的设置、OCR 辅助程序、重建插件包和构建目录，以及日志，方便重装使用。这些文件本身不会持续运行，也不是 MarginNote 的笔记库。正常使用时无需清理；确定不再使用时可删除，恢复默认设置或排查 OCR 时也可按项清理。删除影响、具体路径及可选的 tap 移除命令见 [卸载与数据清理指南](docs/HOMEBREW.md#uninstall-and-data-cleanup)。

## 公开工具

所有名称均带 `marginnote.` 前缀；输入、输出使用 snake_case，每个工具声明 inputSchema、outputSchema 和读写 annotations。

| 分类 | 工具 | 使用时机 |
| --- | --- | --- |
| 工作区 | `get_workspace` | 当前窗口、学习集、PDF、选中卡片 ID 和文本选区；不代替完整卡片阅读 |
| 浏览 | `list_notebooks` | 分页列出学习集目录；notebook 是脑图学习集，不是 PDF |
| 浏览 | `search_cards` | 按索引文字查找卡片，可指定 notebook_id；未转写的手写像素不在文字检索范围内 |
| 阅读 | `read_card` | 一次读取当前或指定卡片的文字、评论、关系、手写和图片 |
| 阅读 | `read_card_tree` | 按快照分页读取整个学习集或 root_note_id 子树，返回准确 total_count |
| 阅读 | `read_pdf_page` | 当前 PDF 一页的定位、文字、OCR 状态及渲染图片；可只返回定位 |
| 写入 | `create_cards` | 创建一张卡片或最多 30 张卡片的有序层级 |
| 写入 | `append_card_comment` | 给既有卡片追加 text/markdown 评论 |
| 写入 | `promote_excerpt_to_title` | 将当前摘录设为标题并保留摘录，校验 expected_excerpt_text |
| 重组 | `preview_card_moves` | 校验和预览最多 20 张卡片的移动/排序，不写入 |
| 重组 | `apply_card_moves` | 应用已经审阅的相同计划，校验预览 IDs 并读回核对 |

### 卡片阅读

询问「当前选中的卡片写了什么」时，Agent 可以直接调用：

```json
{}
```

作为 `read_card` 参数。无需先取得上下文或 note_id。明确目标时用 `{"note_id":"…"}`；只需文字/结构时加 `"include_media":false`。

默认 `media_source:"auto"` 检查本卡媒体、最多四个关联视觉评论、linked sketch，并在必要时尝试文档焦点渲染。显式指定 `note`、`sketch` 或 `focus_image` 可读取原有特定来源。每次最多返回四项媒体（默认三项）；超过范围有 `next_media_offset` 或 `media_inventory_truncated`，不会声称全部读完。

返回包含 `card`、`media`、`handwriting_evidence`、`media_status`。可渲染媒体以 MCP image 返回，同时提供 `media[].image_file_path`。如果客户端只给模型显示元数据，Agent 应用本地图片读取工具打开路径；笔画数不能当作内容转写。公式和模糊字符需核对原图。

在 Codex code execution 中，应将 MCP image 内容块交给 `image(block)`；仅使用 `text(result)` 不会把图片作为视觉输入。也可调用 `view_image` 打开返回的图片路径。Claude Code 使用本地 `Read` 工具打开图片。

续读媒体时显式传回同一 `card.note_id`、`next_media_offset` 和相同 media_source，避免选中卡片变化导致串页。关联评论超过四项时，剩余评论 IDs 仍保留在 card.comments，可直接按 ID 读取；文字/评论字段超限也有 truncated 标记。

原始手写二进制存在与可渲染图片是不同状态。缓存缺失返回 `status:"unrenderable"` 和原因，仍保留文字及手写证据。原生媒体哈希优先；兼容旧安装时才查询本机只读 SQLite。缓存图片会按实际可用后缀查找，并在必要时压缩至每图 900 KB。

缓存访问由 Host 执行；MCP 对旧 Host 保留本地读取兼容路径。`RENDER_CACHE_ACCESS_DENIED` 表示访问权限不足，`RENDER_CACHE_UNAVAILABLE` 表示目录不可用，均不代表卡片没有手写。优先检查 Host 是否已更新并从正常 Terminal 启动，而不是反复刷新卡片。

图片位于 MCP 进程专用的系统临时目录，仅保留最近 20 张，进程正常退出时删除；异常终止可能留下目录。返回路径应尽快读取。卡片识别不使用工具内的 LLM 或 Tesseract 转写。

### PDF 与卡片树

`read_pdf_page` 默认返回一页的文字及图片。`{"include_content":false}` 只返回本地路径和页码。零基 page_index、一基 PDF 物理 page_number、MarginNote 页码和印刷标签可能不同，切换页面后重新调用。

本地 PDFKit 提取文字并渲染页面，OCR 优先 Apple Vision、失败时尝试本机 Tesseract。OCR 不可用时仍可返回页面图片。辅助程序统一使用用户状态目录的 `bin/`，源码手动启动与 Homebrew 服务使用相同路径；`MN_AGENT_HELPER_DIR` 可覆盖，或通过 `MN_AGENT_STATE_DIR` 指定整个状态目录。PDF 辅助程序首次使用时构建；卡片 OCR 辅助程序通过 `marginnote-agent build-addon` 或 `pnpm run build:addon` 构建，需要 macOS Command Line Tools。Tesseract 为 PDF OCR 的可选回退，语言取决于安装的语言包。PDF 不由桥接层上传。

`read_card_tree` 下一页须传相同 notebook_id/root_note_id 和返回的 snapshot_id。直到 next_offset 为 null 才完成；发生 STALE_SNAPSHOT 时从第一页重读。卡片树不批量嵌入图片，但包含 media_count/has_visual_content 提示（旧安装不支持时为 null）。有视觉内容、状态未知或文字截断时，对相应 ID 调用 read_card。

### 写入

`create_cards` 的 nodes 数组每项包含唯一 key、title、可选 Markdown body、可选 parent_key。parent_key 指向前面已声明的节点；顶层可指定外部 parent_note_id。单卡片使用一个节点。

移动先调用 preview_card_moves 并审阅结果，再将相同 moves、snapshot_id 和 plan_id 交给 apply_card_moves。拒绝跨学习集移动、循环、计划变更和陈旧快照。parent_note_id:null 表示根层，before_note_id 表示同级插入位置。

写入由原生 Undo 分组并尽量读回验证，批量操作不保证事务回滚。未知结果的超时不能盲目重试。桥接层不删除卡片；原生 Summary 节点创建仍未实现。

## 验证

```sh
pnpm run verify
pnpm run smoke -- "Perceptron"
pnpm run smoke:card
pnpm run smoke:pdf
```

smoke:card 验证当前卡片的 MCP 图片与本地图片字节一致；转写质量还需由客户端模型目视确认。smoke:pdf 检查定位文件确实是可读 PDF。自动测试覆盖组合阅读、多来源、分页、缺缓存、读写映射、写入锁、快照、防循环、Host 恢复和未知写入结果。实机证据与未验收项见 [VERIFICATION.md](docs/VERIFICATION.md)。

## 代码连接

- `mcp/src/tools.mjs`：公开任务及输入输出 schema。
- `mcp/src/server.mjs`：SDK 注册、公开任务到内部 RPC 的映射。
- `mcp/src/card-reader.mjs` / `note-media.mjs` / `pdf-ocr.mjs`：组合阅读、图片和本地 PDF 处理。
- `mcp/src/rpc-tools.mjs`：稳定内部 RPC 原语、校验、native 参数映射及标准化。
- `host/src/bridge-server.mjs`：共享 HTTP 队列入口、写入锁与边界验证。
- `addon/bridge-main.js` / `bridge.js` / `tools.js`：场景跟踪、轮询及 MarginNote 原生 API。

MCP instructions 和 description 指明任务选择与图像读取路径，最终调用由客户端 Agent 决定。Host 原生调用超时 15 秒、MCP HTTP 单次超时 20 秒；没有自动重放写入。MCP stdout 仅用于协议消息。
