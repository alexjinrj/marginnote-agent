# MCP 工具与生命周期优化方案（已实施）

审查日期：2026-10-04；实施日期：2026-10-05。这里分析的是默认 bridge-only 运行路径；旧 AgentEngine 和聊天面板没有加入运行方案。

## 已确认的问题

当前选中的手写卡片在真实 stdio MCP 调用中返回空文字字段、`PaintNote` 评论、81 个笔画和 `wrd_binary` 媒体。渲染缓存可转换为 JPEG，图片及本地图片路径均可读取；图中包含命题逻辑推导。这个结果说明当前卡片的原生获取与缓存渲染可用，但不代表其他手写卡片或客户端都同样可靠。

链路仍有以下通用缺陷：

- `get_note` 只交付文字，容易让 Agent 将空文字误判为没有内容。当前 `PaintNote` 评论的原生 noteId 在 MCP 标准化时被丢弃。
- `get_current_card_image` 只检查本卡片前十项媒体并返回第一张图；未自动检查关联 sketch、手写评论或文档焦点渲染。混合卡片可能被读漏。
- 本机缓存查找依赖固定数据库分区和缓存后缀；插件知道精确媒体 hash，却未把 hash 返回给 MCP。缓存缺失或超限时解释不够明确。
- 获取成功、原始媒体存在、可渲染图片、模型实际转写是不同状态，目前输出容易混淆。笔画数不能代替文字识别。
- 公共 MCP 工具与内部 RPC 原语共用一个注册表，限制了面向用户任务的组合工具设计。
- bridge-only 插件没有工具栏开关，只在 scene 连接时轮询 Host。Host 从独立 Terminal 或可选 supervisor 启动；现有 supervisor 追踪的是 MarginNote 进程，而不是插件启用状态。

## 每个现有工具的判断

| 现有工具 | 核心任务、重叠与决策 | 新的调用及数据契约 |
| --- | --- | --- |
| `get_context` | 定位当前窗口、学习集、PDF、选中卡片。保留轻量上下文用途；不承担完整内容读取。 | `get_workspace` 无参数，保留当前上下文和稳定 IDs。读当前卡片不必先调用它。 |
| `search_notes` | 按文字查找卡片。保留；不会搜索未转写的手写像素。 | `search_cards` 保留 query/notebook_id/limit，返回 ID、摘要、截断提示与搜索范围。 |
| `get_note` | 按 ID 读取文字和关系。与图片工具共同构成一次完整卡片阅读，合并。 | `read_card` 接受可选 note_id；省略时解析当前选中卡片一次。返回文字、评论 IDs、关系和视觉附件。 |
| `get_note_media` | 按 source/index 读取媒体。属于卡片阅读的底层步骤，合并到 `read_card`；内部 RPC 保留。 | `read_card` 支持 media_source、media_offset、media_limit；自动模式检查卡片、手写评论、关联 sketch 和适用的焦点渲染。 |
| `get_current_card_image` | 自动定位当前卡片并取图。与 `read_card` 的默认选择重复，合并。 | `read_card({})` 一次提供文字与视觉输入；无图片的文字卡片仍正常返回。图片返回标准 MCP image 及可打开的 image_file_path。 |
| `get_current_pdf` | 提供当前 PDF 本地路径与物理页索引。与 PDF 页阅读前置步骤重叠，合并。 | `read_pdf_page({include_content:false})` 保留轻量定位，保留 MarginNote 页码和 PDF 页序区别。 |
| `ocr_current_pdf_page` | 自动定位当前 PDF 并读取一页。保留能力，合并为 PDF 页任务。 | `read_pdf_page` 默认 include_content=true，返回定位、嵌入文字、OCR 状态和可视页面；扫描/公式需要结合图片。 |
| `list_notebooks` | 列出学习集目录。与卡片树读取是目录与内容的关系，应分别保留。 | 保留名称和 offset/limit 分页；明确 notebook 是学习集，不是 PDF。 |
| `get_library_page` | 按快照分页读取一个学习集或子树的卡片关系和内容。保留。 | `read_card_tree` 保留 notebook_id/root_note_id/snapshot_id 和准确 total_count；附件不批量嵌入，需读具体卡片时用 read_card。 |
| `create_card` | 创建一个卡片。是层级批量创建的一节点特例，合并。 | `create_cards` 使用 nodes 数组，单卡片传一个节点，保持 title/body/外部父卡片能力。 |
| `create_framework` | 从 Agent 整理的节点表创建层级。与单卡片创建合并；知识总结仍由 Agent 进行。 | `create_cards` 支持每节点 key/parent_key/title/body，最多 30 节点，父节点必须已在前面声明，返回逐卡片验证结果。 |
| `append_comment` | 给既有卡片追加文字评论。与创建卡片区别明确，保留。 | `append_card_comment` 保留 note_id/text/format，写入超时结果未知时禁止盲目重试。 |
| `promote_excerpt_to_title` | 将已有摘录设为标题，保留摘录。不是任意改名，保留专用契约。 | 保留名称和 expected_excerpt_text 前置条件。 |
| `preview_reorganization` | 校验、预览现有卡片移动计划。保留，与写入分开是用户审阅和防陈旧修改的必要步骤。 | `preview_card_moves` 保留 notebook_id/moves，返回 snapshot_id、plan_id 和可审阅变化。 |
| `apply_reorganization` | 应用已经审阅的移动计划。保留，不与预览合并。 | `apply_card_moves` 必须匹配预览 IDs、目标学习集和完整 moves；保留防循环、顺序与写后验证。 |

## 建议的公开分类：11 个工具

1. 当前工作区：`get_workspace`。
2. 浏览与阅读：`list_notebooks`、`search_cards`、`read_card`、`read_card_tree`、`read_pdf_page`。
3. 创建与补充：`create_cards`、`append_card_comment`、`promote_excerpt_to_title`。
4. 结构重组：`preview_card_moves`、`apply_card_moves`。

选择原则：读一张卡片用 read_card；读整棵树用 read_card_tree；读 PDF 当前页用 read_pdf_page。上下文定位不再是阅读的强制前置。结构写入保留必要的预览与应用两步。

## 输入输出和兼容策略

- 公共 MCP 注册表和内部 RPC 原语分开。底层现有 RPC 名称继续使用，避免纯工具重构要求同时替换所有原生实现。
- 公共名称统一用 card 表示卡片，notebook 表示学习集。一次重连后使用新工具表，不同时广告一套含糊的旧别名。
- `read_card` 默认附带可用视觉输入，返回 source/media_note_id/media_index、handwriting evidence、是否缺失/截断、下一媒体偏移。文字和视觉结果均与本次解析得到的同一个 note_id 绑定。
- `read_card` 的媒体分页后续调用显式传返回的 note_id，避免用户换选中卡片后串页。限制图片数量与字节数，明确剩余媒体。
- 图片是提供给客户端模型的视觉输入；桥接层不调用 LLM，不保证手写数学公式字符完全准确。无法渲染时返回明确原因，保留文字结果。
- 每个公开工具提供相应 schema、outputSchema、明确使用时机与结构化错误。MCP instructions 只补充共同调用规则。
- 只读与写入标记、默认写入锁、批量限额、快照和计划校验全部保留。

## 生命周期决定

用户已选择继续手动启动 Host。本次仅实现工具重构、卡片视觉读取和相关契约优化。Host 独立运行，MCP 客户端退出仅关闭自己的 stdio 进程。先前提议的 helper app 未实现、未安装；没有新增后台注册。

## 验证范围

真实手写读取需检查同一选中 ID、原始媒体格式、实际图像像素、内容可理解；多媒体/评论/sketch/缺缓存/超限/选择变动由集成用例覆盖。Host 原有停机、重启、重连、不重放写入的回归测试保留。工具映射覆盖原 15 项能力；真实写入测试使用独立测试学习集并核对读回与 Undo，不修改用户的当前知识卡片。
