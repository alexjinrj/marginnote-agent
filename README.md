# MarginNote MCP Bridge

Codex / Claude / Claudian → stdio MCP → 手动启动的共享 RPC Host → MarginNote 4 Add-on。

0.9.0 将公开 MCP 工具整理为 11 个完整任务。卡片阅读同时提供文字、评论、关系与可用图片；知识归纳、手写视觉理解和问答由客户端 Agent 完成。Host 和 Add-on 不调用模型。逐工具审查及旧能力映射见 [TOOL_REVIEW.md](docs/TOOL_REVIEW.md)。

## 启动与更新

需要 macOS、MarginNote 4、Node.js >=20；依赖使用 pnpm-lock.yaml。

```sh
pnpm install --frozen-lockfile
pnpm run verify
./scripts/start-bridge.zsh
```

Host 前台运行，按 Ctrl-C 停止。默认监听 `127.0.0.1:42117`，默认关闭写入。需要写入时，在停止已有 Host 后运行：

```sh
MN_ENABLE_WRITES=1 ./scripts/start-bridge.zsh
```

安装并启用 [dist/marginnote-agent.mnaddon](dist/marginnote-agent.mnaddon)，打开一个学习集窗口。多个学习窗口返回 `AMBIGUOUS_CONTEXT`。如果 MarginNote 的「暂停插件」已选中，应先恢复插件。

```sh
curl http://127.0.0.1:42117/health
```

健康检查应返回 `service: marginnote-mcp-bridge`、`protocol: 1`；`online: true` 表示插件正在轮询。端口冲突会明确报错，Host 不接管已有监听进程。

更新到 0.9.0：停止并重新启动手动 Host，安装新版插件，再重新连接 MCP 客户端。MCP 启动命令和端口保持相同；旧公开工具名称已由下面的工具表替代，旧会话需要重连。新版插件和 Host 保留手写评论 IDs、媒体哈希和笔画/媒体数量；旧安装仍可进行基本卡片阅读，但增强的关联媒体信息需要更新。

0.9.1 修复 Claudian/Codex 沙箱无法读取 MarginNote 私有图片缓存的问题：由手动启动的 Host 读取和渲染缓存，再通过 localhost 将图片字节传给 MCP。已经安装 0.9.0 Add-on 的用户只需重启 Host、重新连接客户端，无需重新安装 Add-on。`/health` 应显示 `version:"0.9.1"` 和 `note_media_rendering:"host"`。

本次采用手动 Host 管理。现有 supervisor/网页控制台源码仍可用于开发；没有新增 helper app 或后台注册。

## MCP 配置

已有配置无需重新添加 server。新配置可参考 [codex-mcp.toml](docs/codex-mcp.toml)：

```toml
[mcp_servers.marginnote]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/marginnote-agent/mcp/src/index.mjs"]
startup_timeout_sec = 10
tool_timeout_sec = 120
```

stdio MCP 由客户端启动；共享 HTTP Host 仍由用户启动。组合卡片读取和本地 PDF OCR 可能超过 30 秒，因此建议工具超时设为 120 秒。

本机 Node 路径：`/Users/alexjinrj/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`。它是工具捆绑运行时；也可安装稳定位置的 Node 并更新配置。

CLI 添加示例：

```sh
codex mcp add marginnote -- /absolute/path/to/node /absolute/path/to/marginnote-agent/mcp/src/index.mjs
```

Claudian 使用所选 CLI 的 MCP 配置。修改工具后重连 MCP；如果新会话仍沿用旧 MCP 进程，就重启客户端。

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

本地 PDFKit 提取文字并渲染页面，OCR 优先 Apple Vision、失败时尝试本机 Tesseract。OCR 不可用时仍可返回页面图片。辅助程序首次使用在 `.local/bin` 构建，需要 macOS Command Line Tools；Tesseract 为可选回退，语言取决于安装的语言包。PDF 不由桥接层上传。

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
