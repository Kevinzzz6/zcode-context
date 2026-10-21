# 与 dsh-context 的功能对照

> 本文是功能层面的对照，用来决定 zcode-context 要提供哪些能力。zcode-context 的代码针对 ZCode 的数据和宿主接口独立编写，没有复制 dsh-context 的代码。

> 历史快照（0.1.1）。其中多数差距已在 0.3.x 实现，结论汇总在 [产品决策与取舍](decisions.md)；本文不再更新。

检查日期：2026-10-12。我们的版本：0.1.1。
对照版本：dsh-context 0.69.1，提交 `fd8e3b80136c000af87ad0871c00a7880ec8d51e`。

本次读取了对照仓库当前源码、README 和文档截图，以及本项目当前源码与浏览器验证截图。
没有启动 dsh 客户端；其文档截图部分标注的是较早版本，现行能力以此次固定提交源码为准。
本次只做评估，不修改产品代码、安装包或原先约定的只读范围。

## 判断

我们完成了首版的数据读取和基础展示，但尚未完成 dsh 那种可联动的诊断体验。
最大的缺口是“选中一次请求 → 同步看组成、变化、相关事件与具体内容”这条路径。
许多缺口已有数据可用，不能统一归因于 ZCode 没有接口；另一些能力确实需要宿主实时投影或可靠来源信息。

## 最值得补齐的界面能力

| 项目 | dsh 的做法 | 我们当前的差距 | 下一步可行性 |
|---|---|---|---|
| 共享选中请求 | 趋势点击固定步骤，悬停临时预览，内容浏览器跟随 | SQLite 图柱只有 tooltip，没有点击行为；traj 请求要另外找 | 可新增基于 traj 的可选请求趋势，统一本次选中的快照 key |
| 历史组成 | 组成与浏览器反映所选步骤 | `loadDetail` 收到 `next.composition` 后没有使用；上面的组成一直是 latest | 已有接口数据，可直接接 UI；保留“最近记录”和“所选快照”的明确区分 |
| 请求趋势 | 分类堆叠、Step/Turn、Total/Delta、坐标和压缩标记 | 只有实际输入单色柱，没有角色演进、正负变化、回合分组或轴刻度 | traj 完整快照可提供估算堆叠和变化；按可靠 turnId 分组，不把缺口算为删除 |
| 步骤摘要 | User / In / Response 三行，能定位到内容 | 请求列表以原始 requestId、模型和时间为主 | 从该条 traj 中抽取可确认的输入和新增内容；Response 需要扩充当前只保留 hasResponse 的归约 |
| 分类内容浏览器 | 类别可折叠，逐项占用、数量，支持检索和排序 | 所有消息/schema 混在一个分页列表，只显示 role、key、字符数 | system/user/assistant/tool/schema 可直接分组；按名称/大小排序和搜索需在服务端覆盖已加载数据，不能只搜当前 40 项 |
| 大来源定位 | 从分类与大小快速找最占空间的工具结果/schema | 用户需逐个点开才能判断正文内容 | 可增加 Top N、摘要、字符/估算 token 和类别占比，点击跳至正文 |
| 可读正文 | 工具调用卡片、参数、OK/error、结果；Raw/Markdown、复制、正文搜索 | 只有整个消息 JSON 和 12k 字符片段 | 优先解析确认的 toolCallId/调用与结果；结构化卡片保留 Raw；缺失参数/状态时明确显示 |
| 分类 Diff | 每类增加/回收量，可选上一请求或上一回合基线 | 有新增/删除跳转，但只显示总条数和总字符差；基线固定 | 可做分类变化、匹配元素的正文 Diff 和明确的基线选择；不完整快照维持不可比较 |
| 事件联动 | 人类可读的类型、回合/步骤、变化量、筛选，趋势上标注 | 仅独立的 compact 日志列表，显示原始事件名，没有定位或筛选 | 先做压缩事件译名、状态和 turnId；没有请求级证据时，只标时间区间，不强绑具体柱 |
| 视觉语义 | 固定类别色，同一颜色贯穿趋势、组成和列表；宽窄布局适配 | 组成颜色按数组次序分配；类别缺失时同色可能对应不同 role；详情藏在长列表之后 | 固定角色调色板；窄栏折叠列表/请求选择器，宽面板可并列趋势与内容 |
| 查看状态 | 保留选择、展开、筛选与滚动位置，支持加载/失败/重试 | 没有视图偏好恢复，刷新重建列表；错误提示较泛化 | 可用宿主允许的视图状态恢复偏好，但会话授权始终重新取宿主元数据 |
| 历史导航 | 支持在保留范围内横向浏览步骤及分组 | SQLite 返回最多 80 条，UI 明细列表仅列最近 30 条；traj 摘要最多 60 条，没有更早请求分页 | 可先提供已加载窗口的选择/定位，再设计有界历史分页，不能移除读取上限后全量加载 |

以上 dsh 行为依据：
[趋势组件](https://github.com/bowenliang123/dsh-context/blob/fd8e3b80136c000af87ad0871c00a7880ec8d51e/src/client/components/trendChart.tsx)、
[内容浏览器](https://github.com/bowenliang123/dsh-context/blob/fd8e3b80136c000af87ad0871c00a7880ec8d51e/src/client/components/browser.tsx)、
[正文与工具卡片](https://github.com/bowenliang123/dsh-context/blob/fd8e3b80136c000af87ad0871c00a7880ec8d51e/src/client/components/browserToolCard.tsx)、
[事件组件](https://github.com/bowenliang123/dsh-context/blob/fd8e3b80136c000af87ad0871c00a7880ec8d51e/src/client/components/events.tsx)、
[视图联动](https://github.com/bowenliang123/dsh-context/blob/fd8e3b80136c000af87ad0871c00a7880ec8d51e/src/client/components/contextView.tsx)。

## 尚未提供的同类功能

| 功能 | 当前状态与边界 | 建议 |
|---|---|---|
| 回合/工具/错误/重试统计 | 我们只接 model_usage；ZCode 还持久化 turn_usage、tool_usage。已有 errors/retries 与 TTFT 等字段也未充分展示 | 可补单会话统计与工具耗时，先做规范字段，不重复累计模型/回合 token |
| 时间组成 | dsh 展示等待、生成、工具、开销及更细生成阶段；我们只列请求 duration | 可读明确的请求/工具时间；并行工具耗时不能直接相加充当墙钟时间，缺少流阶段信息不能拆出思考/正文耗时 |
| 文件活动 | dsh 汇总 Read/Written/Searched/Images、路径、行变化并跳转原始操作 | 只能基于明确工具名、参数、结果和 ID 提取有证据的活动；不能把任意 shell 命令完整解析成文件事实 |
| Fleet / 子代理网络 | 当前按 session_id 精确读取，不递归汇总子会话。ZCode session 表存在 parent_id | 可做显式父子关系和独立用量，先设计授权范围和缓存；实时运行状态、窗口占用、跳转能力仍需另外验证 |
| 跨会话 Insights | dsh 有时间范围、用量/费用、热力图、搜索和会话卡片；我们只有单会话每日列表 | 后续可做当前工作区范围的统计；这需要显式增加读取范围，不能借当前 session 绑定静默读取整个用户数据库 |
| DNA 模式 | dsh 把每个具体上下文元素画成条带，按组装顺序展示并联动 | 可做记录中消息/schema 的顺序和估算大小；SDK messages 与 provider body 是不同表示，不能冒充完整 provider 原始顺序 |
| 成本估算 | dsh 使用模型价格资料，并区分部分模型的时段 | 首版不优先；需要有版本的价格、模型别名、计费口径，未知时不报虚假费用 |
| 多入口和设置 | dsh 有中心页、侧栏、Fleet、/context 和偏好卡；我们只有会话侧栏及路径配置 | 视图偏好可先做；不能把 dsh 的一级导航/命令入口直接当成 ZCode 已有可调用接口 |

对照依据：
[功能说明](https://github.com/bowenliang123/dsh-context/blob/fd8e3b80136c000af87ad0871c00a7880ec8d51e/README.md)、
[时间统计](https://github.com/bowenliang123/dsh-context/blob/fd8e3b80136c000af87ad0871c00a7880ec8d51e/src/client/components/statsTiming.tsx)、
[DNA 组成](https://github.com/bowenliang123/dsh-context/blob/fd8e3b80136c000af87ad0871c00a7880ec8d51e/src/client/dna.ts)。

ZCode 可用数据的核对位置：参考源码 `apps/zcode-cli/packages/adapters/src/storage/session-store/repositories/usage.ts` 中的 turn_usage/tool_usage 写入，及 `repositories/sessions.ts` 的 session.parent_id。
存在这些字段证明可以探索部分功能，不证明当前插件已实现、数据全量或运行状态实时可靠。

## 受 ZCode 宿主限制、无法提供的能力

- **Live / Next Request 和准确窗口占用**：dsh 使用宿主 contextPressure/contextBreakdown 等投影。ZCode 当前插件读取的是已记录 traj，不能把最新记录改名成实时上下文。
- **精确生产者与 Skill Injections**：dsh 有结构化来源和工具注册信息，并对无法归因的第三方工具保留未知。我们不能仅按正文片段拆出精确 skill/插件来源；有明确元数据再显示来源，否则只用 role 分类。
- **完整注入、剪枝、模式事件**：dsh 持久化相应生命周期事件。我们能展示已确认日志和观察到的内容变化，不能从字符下降推断完整原因。
- **压缩前历史恢复与多媒体**：dsh 有 removed-message archive 和图像加载能力。ZCode 已轮转的数据不能恢复，脱敏图像不能恢复缩略图，只有真实保留的内容才能展示。
- **系统提示词 Prefix/Suffix 设置**：dsh 支持修改提示词；这会改变 Agent 行为，超出本项目只读观察范围，不纳入本项目范围。

来源：
[宿主投影与视图](https://github.com/bowenliang123/dsh-context/blob/fd8e3b80136c000af87ad0871c00a7880ec8d51e/src/client/components/contextView.tsx)、
[历史组装与缺口](https://github.com/bowenliang123/dsh-context/blob/fd8e3b80136c000af87ad0871c00a7880ec8d51e/src/client/assemble.ts)、
[工具来源边界](https://github.com/bowenliang123/dsh-context/blob/fd8e3b80136c000af87ad0871c00a7880ec8d51e/src/host/toolSources.ts)。

## 优先级建议

### 第一批：把已有数据连起来

1. 以 traj 快照 key 建立统一选择；历史组成、请求信息、Diff 和正文跟随选择。
2. 分类折叠、固定配色、按大小排序、摘要、搜索和 Top N。
3. 压缩事件的可读名称与前后内容导航，保留“日志确认/观察变化/数据缺失”的证据区别。
4. 增加 traj 的分类趋势与 Delta；SQLite 用量图继续独立展示。

这里不能直接把 SQLite 当前图柱连接到任意 traj：两个来源的请求 ID 尚未建立可靠映射。
同一 traj 记录自己的 responseUsage 可以用于“该 attempt 的实际用量”，规范化后展示，无需强行关联 SQLite。

### 第二批：扩充可验证的诊断

工具调用卡片、分类与正文 Diff、回合粒度、TTFT/工具统计，以及有证据的文件活动。
并行时序和生命周期缺口应继续明确标注，避免漂亮图表带来假精度。

### 后续范围

Fleet、跨会话 Insights、DNA 和费用估算分别评估数据覆盖与宿主能力。
它们有价值，但不应先于单会话“哪次变大、由哪些内容造成、点开看到正文”这一交互路径。

## 我们当前的直接证据

- `ui/app.mjs` 的图柱循环仅设置 style/title/aria-label，没有设置选中回调。
- `render()` 的组成使用 `state.composition`；`loadDetail()` 未消费返回的 `next.composition`。
- `src/data/service.mjs` 的详情已经返回 composition、diff 和可分页 elements。
- `src/domain/trajectory.mjs` 保留 responseUsage，但 trajectorySummary 未暴露该字段。
- `src/data/sqlite.mjs` 当前只查询 model_usage；turn_usage/tool_usage 没有接入。
- `ui/app.mjs` 的事件仅显示 raw event/reason/time，正文通过 textContent 显示整条 JSON。

这些证据说明，0.1.1 可以称为“数据闭环和基础 UI 已完成”，还不具备与 dsh 同等的诊断功能。
