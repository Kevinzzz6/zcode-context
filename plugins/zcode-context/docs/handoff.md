# ZCode Context 交接文档

更新时间：2026-10-21，Asia/Shanghai。当前版本：0.3.10，另有未发布的改动（见下）。

## 实测大小记账（2026-10-21，未发布）

- 起因：完整记录下概览的大数字是字符估算，本机 Claude 会话中位只有实际输入的 72%（例如估算约 6 万、实际约 10 万）；浏览器里工具结果显得偏小、带 thinking 的回复显得偏大，按大小排序会排错。
- 新模块 `src/domain/ledger.mjs`：入库时按文件顺序记账，口径和证据见 [decisions.md](decisions.md)「大小口径」和 [architecture.md](architecture.md)「Measured sizes」。`measureRecord` 每条记录给出各条目的 `tokens / kind / source / share`；`storeSizes` 从会话记录（`readRequestUsage` 加上 `readConversation` 新增的 `tools`）补序列开头的回复和单个工具结果。
- 服务在扫描请求记录之前先读会话记录、日志和请求用量；`composition`、`elementSummary`、`diffRecords` 接收实测大小，原有的 `estimatedTokens`、`tokensDelta` 和 `unusedEstimatedTokens` 含义不变，新增 `tokens`、`size`、`measuredTokens`、`measuredCount`、`sizes`（含 `residual`）、`sizeDelta`、`sizeExact`、`unusedTokens` 和 `unusedExact`。界面优先用新字段，没有时退回估算（演示数据就是这样）。
- 代码审查（4 个并行审查，记账、数据层、界面与文档、测试质量）后修复：会话库的工具结果按内容长度核对，配对只取同来源真正相邻、同模型、中间没有压缩或模型切换的两次请求，回复大小只在输出放得进增量时才记；回复只按输出原值记账、实测值不小于 1、余量单独记着；防护要求至少 3 次超出，只检验离开内容都是实测的步骤，用会话库的整场判断提前生效，触发时当前请求重新起账；类别变化只算进入和离开的内容，换模型不给实测变化，变化量不精确时带 ≈；取整不再丢掉 ≈，上报输入为 0 不当作大数字；数据库短暂不可读时保留上次的行，首次扫描最多等两轮；用量改为先读汇总、有变化再读行。
- 验证：`npm run verify` 通过（122 个单元测试；`test/ledger.test.mjs` 24 个，数据层另有 5 个）；16 个针对审查发现的变异全部被测试发现；浏览器冒烟 36 组通过；用本机真实会话只读回放：完整记录的 Claude 会话实测 52%–79%、GLM 会话 81%，类别加总在容差内等于实际输入，相邻步骤的变化 19/20、13/14 步是精确的；无变化的刷新多约 2 ms（汇总查询），冷读扫描多约 4%–9%。尚未在真实 Electron 客户端中验收。
- 已知限制：一步同时新增多项时各项是估算份额；系统提示词和工具定义永远是份额；默认记录下工具定义和起账时窗口里的消息只能估算；隐藏推理比同一步工具结果小、且会话不到 10 步时，防护发现不了；会话库补的工具结果在约 0.7% 的情况下会带上请求时临时注入、会话库里没有的提醒。

## 0.3.8 代码审查修复（2026-10-14）

- 起因：两份 0.3.7 代码审查（output/review/）。逐条核对后采用的项见 CHANGELOG 0.3.8；不采用的（如“加载更早第 4 次必定无效”实际到不了、暗色 `mark.current` 对比度不低）未改。
- 最重要的一项：默认记录下 ZCode 在 tail 之后按自己未裁剪的上一条写 delta，插件以前只保留 delta 本身；现在接在 tail 已记录的消息后面，仍标为不完整（`expandCollection`）。
- 会话记录读取记住所有 message/part id：删除直接去掉，游标倒退或出现没见过的行时整体重读；超过 4000 字的注入正文按长度和 SHA-256 核对；压缩详情只读标题字段和 400 字样本。
- 服务端新增 `baselineMode:"turn"`（上一轮由服务端在整个缓存里找），详情的 `summary` 带趋势 Delta。
- 已通过 `npm run verify`（93 个单元测试）和 SDK 浏览器冒烟 36 组；在 14 个本机真实会话上只读对照注入定位无回归（这些会话里没有 tail 记录）。尚未在真实 Electron 客户端中验收。

## 0.3.7 浏览器交互规则（2026-10-14）

- 起因：点「MCP 工具注册」把 `mcp__` 写进了全局搜索框，筛选会跟着切步骤、重开面板一直留着；类别上的 `+3` 取自未筛选的对比，点开却只有筛选后的一条。按第一性原理整理成五条规则，写在 [decisions.md](decisions.md)「上下文浏览器的交互规则」。
- 服务端 `get_context_request` 新增 `listing`（每类 total / matched / added / removed 及未筛选总数，新增/移除列表已按筛选过滤）、`toolPrefix`（只按工具名匹配 schema）、`noBaseline`（上一轮不存在时不退回上一步）；`focusKey` 指向的项即使不符合筛选也会列出并标 `pinned`。去掉了 `searchAddedGroups` / `searchRemovedGroups` / `arrivals.searchGroups`。
- 界面新增事件焦点 `view.focus`（`ui/state.mjs` 的 `lens()` 决定实际生效的基线、集合和条件），不保存；`eventKey` 也不再保存。
- 已通过 `npm run verify`（83 个单元测试）和 SDK 浏览器冒烟 34 组（新增 4 组）；尚未在真实 Electron 客户端中验收。

## 0.3.6 桌面验收（2026-10-14）

- 在隔离副本（3.15.1.8093、本地模拟服务、仓库根市场安装 0.3.6）按 docs/desktop-acceptance.md 跑完 12 项矩阵：10 项通过，报告在 output/verification/desktop-v036.json。
- 宿主无法驱动的场景（双窗口交叉、无请求会话的 surface、强制微压缩、选择器切模型无留痕）已从验收清单移出并在 desktop-acceptance.md 记录原因；实机编辑回退按钮不响应合成事件，回退分支行为由单元测试+真实库 revert 结构验证。
- 0.2.0 时代的"重启后 Context 菜单要等新请求"未复现：重启后不提交消息即可打开标签并获得新绑定。

## 0.3.5 关于页

- 工具栏新增 <kbd>ⓘ</kbd>，进入「关于」次级页面（与用量页同级的 `view.page="about"`）：插件一句话描述、版本、作者、MIT 许可、源码仓库（可复制 URL）、第三方许可指引（THIRD_PARTY_NOTICES.txt），以及“只读本机已落盘数据、不联网、不写入”的说明；demo 模式下附演示数据标记。
- 版本号来源：`ui/app.mjs` 顶部的 `INFO` 常量（`name`/`version` 字面量保持一处，`npm run check` 的正则仍命中一次），经 render ctx 传入 `aboutPage`。数据未加载或绑定失败时关于页也可达。
- 浏览器冒烟新增一组交互（`#show-about` → 版本号格式与仓库行 → `#about-back` 返回）。

## 0.3.4 修复与优化

- token 估算按文字类型加权：ASCII 约 4 字符 ≈ 1 token，中日韩约 1.5 字 ≈ 1 token。旧的一律 chars/4 让中文内容显得偏小，tail 记录下“更早消息（未记录）”（实际输入减去已记录估算）因此被高估。Delta 由服务端按同一口径给出 `tokensDelta`。
- worker 串行队列：超时或取消且尚未开始的读取直接跳过（`src/data/runner.mjs`）；繁忙上限按 worker 实际持有的读取计数（`src/data/reader.mjs`）。之前超时只删除了主线程的等待项，worker 仍会执行，堆积在新请求前面。
- 面板轮询空闲退避 3 → 6 → 10 秒，可见、获得焦点或指针进入时立即刷新。
- 服务端缓存经实测放弃：32 MiB 真实会话的无变化刷新约 7 ms，其中 SQLite 约 4 ms。
- `npm run check` 校验 server/app 宣告的版本号与 package-lock 一致。
- 刻意没做的功能及原因汇总在 [decisions.md](decisions.md)，新增取舍时同步更新。
- 本版尚未在真实 Electron 客户端中验收；下面 0.3.x 的验收状态不变。

## 真实会话测试（0.3.1–0.3.2）

用 `npm run preview:session -- <sessionId>` 只读预览了一个真实会话（约 60 万 token，默认记录模式），发现并修复：
- 默认 rollout 是 `tail` 记录，只保存最近 64 条消息（偶尔是接在 tail 上的 `delta`）。旧界面把已记录部分当作上下文大小（约 6 万 vs 实际 60 万）；现在以 provider 实际输入为主，其余显示为“更早消息（未记录）”。
- ZCode 把缓存断点 `cacheControl` 放在每次请求的最新消息上，相邻记录的同一条消息只差这个字段；匹配消息时改用忽略缓存字段的 `contentKey`。
- ZCode 会轮转长会话的 model-io 文件（首条记录带 `modelIOReset`），历史随之清零，步序号从头计数；趋势图下方现在会说明。
- 默认模式下无法逐条对比，“输入”行和“仅变化”改由入场标记推出的 `arrivals`（基线步之后进入的消息）提供；移除项仍无法得知，界面会说明。
- 工具调用次数来自 SQLite `tool_usage`（整个会话），不从 tail 消息里统计。

真实 ZCode（`C:\Users\USER\.zcode\cli`）中已安装的插件用 `output/install-existing/update.mjs` 升级：先备份配置，再 validate → 重新添加本地市场 → `plugins update`，最后核对 config.json 未变、安装产物与构建逐字节一致。
升级后需要重启 ZCode 才生效；0.3.x 在桌面侧栏中的验收（含工具授权表现）尚待用户完成。

## 0.3.0 界面改版

侧栏参考 dsh-context 的卡片式布局重新设计：请求概览、带 Y 轴和回合带的趋势、行内展开的上下文浏览器（含“仅变化”模式）、压缩事件卡片、底部说明收纳。
修掉的逻辑问题：辅助请求混入趋势导致 Delta 柱与相邻柱无关；R 编号随窗口滑动变化；全局 40 条分页导致小类别展开为空；token 与字符混用；
每 3 秒整页重绘两次（会关闭下拉框、清掉选中文字）；打开任意条目会永久取消跟随；规范 `toolCalls` 不能配对参数。
服务端只做了增量字段（步序号/回合号、按类分组、按类增删、条目标题/芯片、规范 toolCalls、`isError:false` 视为成功），既有口径和测试不变。
UI 开发用 `npm run fixture:ui`（端口 4175）；`npm run fixture:browser` + `npm run test:browser` 为 23 组交互回归。
0.3.0 之后参考 dsh-context 的交互设计，补了第一批交互：趋势悬停提示与类别联动高亮、步骤/轮次粒度、自适应纵轴、“本轮 / 输入 / 回复”摘要、上一步/上一轮对比基线、正文查找上一处/下一处与 ←/→ 切换步骤，均为前端改动。
0.3.0 尚未在真实 Electron 客户端中重新验收；下面的桌面结论仍针对 0.2.0。`_sandbox/context-desktop-acceptance/guest-v02-check.mjs` 使用的
`#back`、`.element-row` 详情页流程已改为行内展开，复验时需要按新选择器调整。

以下为 0.2.0 时的记录。

正式源码为 `D:\projects\zcode-context`（WSL `/mnt/d/projects/zcode-context`）。
`/tmp/zcode-context` 是已安装依赖的构建缓存，两者源码已同步；不可将缓存当成唯一源码。
本项目有自己的 `.git`，尚无提交或 remote。本轮没有发布、推送，也没有操作父仓库。

## 已完成的 v0.2 闭环

- 统一 traj key 选择、上一/下一、跟随最近记录与固定历史；刷新不抢历史选择。
- 固定角色颜色的分类堆叠、正负 Delta、10 个请求的趋势窗口及更早有界快照导航。
- 组成/变化/事件共享选择；自定义历史基线，分类增减、新增/删除分页。
- 分类折叠、摘要、估算量/占比、大小/原序排序、最大内容定位。
- 搜索所选快照的所有已加载条目，或显式搜索所有已加载快照；不局限于当前 40 项。
- 系统指令、消息、schema 与工具结果的可读详情；仅唯一已记录 toolCallId 配对参数。
- 可读/Raw/基础 Markdown、每块 12k 字符、当前块复制、全文搜索与前 100 个匹配导航。
- 只有唯一工具结果 ID 或 schema 名称的替换提供正文 Diff。普通消息通过新增/删除查看。
- 单列正文 Diff 显示共同前后缀之间的替换块，并非最小行编辑序列；同样按 12k 字符分页。
- 明确压缩日志的类型、状态、原因、turnId、节省/清理记录；前后 startedAt 邻近导航与 turn 范围有证据标签。
- 选择、筛选、展开、基线、偏好、正文格式/偏移、滚动状态按已验证的 session 分区保存。
- SQLite 30 天逻辑用量和 UTC 日汇总在次级入口；attempt 的 provider usage 单独展示。

## 可靠性边界

每次工具调用重新从 `_meta["com.zcode/request-context"].session_id` 绑定。
视图存储只是偏好，绝不提供会话授权；绑定失败清空页面旧数据。
SQLite 与 traj 不强行关联 request ID。实际 usage 是请求的大小，估算只在实测总量里分份额或在无从实测时代替；缺字段保持未知。
缺消息基线、reset、损坏行/跨缺口不能产生删除或负 Delta；未记录 schema 不按删除处理。
下降不是压缩原因证据；淘汰内容不可恢复；不猜 skill/插件来源。
冷文件 24 MiB、每轮/单行 8 MiB、8 会话、总记录缓存 32 Mi 字符、worker 堆 256 MiB；响应只返回有界摘要与正文块。

## 文件边界

| 文件 | 职责 |
|---|---|
| `src/server.mjs` / `worker.mjs` | app-only MCP、每次身份校验 |
| `src/data/reader.mjs` / `runner.mjs` | worker 读取客户端（超时、取消、繁忙上限）与串行执行（跳过已放弃的读取） |
| `src/data/service.mjs` | 会话缓存、历史分页、查询/排序、基线（含“上一轮”）、分块、事件导航与注入定位 |
| `src/data/jsonl.mjs` | 有界增量 JSONL 读取：追加、UTF-8 边界、残行、轮转识别（只有文件消失才重读窗口） |
| `src/data/sqlite.mjs` | model_usage 汇总、tool_usage 调用数、共享的数据库错误归类 |
| `src/data/conversation.mjs` | 会话记录（message/part）增量读取、删除核对、压缩被摘要内容 |
| `src/data/paths.mjs` | 数据目录与数据库路径（环境变量覆盖） |
| `src/domain/trajectory.mjs` | 快照重建（含 tail 后 delta 续接）、角色组成、可读内容、已记录身份配对、Diff |
| `src/domain/events.mjs` | 日志事件合并、会话记录事件（注入/压缩/模型切换）、两者去重 |
| `src/domain/usage.mjs` | 单条用量归一化（SQL 汇总与之有一致性测试） |
| `ui/state.mjs` | 按会话保存视图状态；不授权 |
| `ui/components.mjs` / `i18n.mjs` | 侧栏组件、纯文本安全渲染、固定配色与双语 |
| `ui/app.mjs` | SDK 生命周期、共享选择、异步结果隔离与视图协调 |
| `ui/demo.mjs` / `scripts/ui-fixture.mjs` | `npm run preview` 的演示数据；规范格式的多轮会话 UI 开发夹具 |
| `scripts/browser-fixture.mjs` / `browser-smoke.mjs` | SDK + 真实 stdio/SQLite 的合成双会话交互验证 |
| `scripts/package.py` | 本地 ZIP、逐文件核对、CRC 与 SHA-256 |

## 构建与安装

Node 24+。已有 WSL Node：`/home/USER/.nvm/versions/node/v24.13.1/bin/node`。

```sh
rsync -a --exclude=.git --exclude=node_modules --exclude=dist --exclude=output --exclude='*.zip*' /mnt/d/projects/zcode-context/ /tmp/zcode-context/
cd /tmp/zcode-context
/home/USER/.nvm/versions/node/v24.13.1/bin/node scripts/verify.mjs
```

构建结果在仓库根：安装源为根目录 `marketplace.json` + `plugins/zcode-context/`（仓库本身即市场，可加 GitHub 仓库或本地根目录）。
安装包为 `zcode-context-<版本>-marketplace.zip`，校验值同名 `.sha256`。
旧 0.1.x 包保留作历史。不能将旧包作为本次安装包。

ZCode 宿主权限链仍然生效，readonly 注释并不自动允许普通 MCP 工具。
真实 3.15.1.8093 测试遇到 `get_context_request` 等待审批后超时，而主页面没有展示审批入口。
在此 Desktop 会话中，CLI 配置的 `permission.allowedTools` 未直接放行详情。
实际通过的条件：隔离测试数据库已有项目级汇总工具授权，测试驱动只给同一项目增加了详情工具的精确授权。
规则采用宿主的项目 `ruleset` 格式，非 wildcard：

```json
{"version":1,"allow":[{"toolName":"mcp__plugin_zcode-context_context__get_context_summary"},{"toolName":"mcp__plugin_zcode-context_context__get_context_request"}]}
```

这只用于隔离测试准备；插件不会写数据库或自行授权。正式用户应通过 ZCode 的项目工具权限授权入口设置。
CLI allow 配置不能作为本次已证实的安装解法。相关审批显示/旧会话重新打开行为仍需宿主联调。

页面会提示等待/失败时检查宿主权限。不能为绕过审批修改官方 ZCode 或扩大到 wildcard 授权。

## 桌面隔离与下一步

当前客户端 `D:\ZCode\ZCode.exe` 为 3.15.1.8093，0.1.1 的基本握手和真实读数曾通过。
本轮 SDK 合成交互、领域/数据、Windows/WSL、安装与实际桌面检查见 [verification.md](verification.md)。
完整多窗口、完整应用重启后的旧会话无新消息打开、真实自动/微/失败压缩矩阵尚未全部验收。重启后重新打开旧会话时，Context 菜单本次直到提交新的模拟请求才出现；此宿主行为尚未解决。
不可将局部 Electron 验证写成全套验收。

桌面测试驱动在 `D:\projects\_sandbox\context-desktop-acceptance`。
CLI 与 Electron 子进程同时隔离 USERPROFILE、APPDATA、LOCALAPPDATA；Electron 另有独立的 ZCODE_DESKTOP_* 目录。
`ZCODE_STORAGE_DIR` 单独使用不足以隔离 CLI 配置，必须核对 `os.homedir()` 及实际写入路径。
本轮只写隔离配置、合成模型服务、测试会话及隔离项目的精确工具授权；没有写用户正式配置或会话。
使用 Windows Node + Playwright/CDP，不下载依赖。高 DPI CDP 父页面截图可能错误合成 guest；布局结论用 DOM CSS 宽度。
后续按 [desktop-acceptance.md](desktop-acceptance.md) 扩大真实场景，保持只读插件范围。
