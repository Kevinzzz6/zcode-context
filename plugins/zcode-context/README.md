<a name="readme-top"></a>

<div align="center">

<img src="docs/images/hero.png" width="100%" alt="ZCode Context：在会话侧栏里看清每一次请求的上下文">

<br>
<br>

**在 ZCode 会话侧栏里，看清每一次请求的上下文**<br>
<sub>每次请求带了什么 · 哪类内容占得最多 · 这一步新进来了什么 · 运行时注入了什么 · 压缩摘要掉了什么</sub>

<br>

<a href="https://github.com/Kevinzzz6/zcode-context/releases"><img alt="Release" src="https://img.shields.io/github/v/release/Kevinzzz6/zcode-context?style=flat-square&color=6366f1&label=release"></a>
<a href="https://github.com/Kevinzzz6/zcode-context/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Kevinzzz6/zcode-context/ci.yml?branch=main&style=flat-square&label=CI"></a>
<img alt="ZCode Desktop 3.15.1+" src="https://img.shields.io/badge/ZCode%20Desktop-3.15.1%2B-14b8a6?style=flat-square">
<img alt="Node.js 24+" src="https://img.shields.io/badge/Node.js-24%2B-22c55e?style=flat-square&logo=nodedotjs&logoColor=white">
<img alt="只读 · 离线" src="https://img.shields.io/badge/%E5%8F%AA%E8%AF%BB%20%C2%B7%20%E7%A6%BB%E7%BA%BF-f59e0b?style=flat-square">
<a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square"></a>

<br>

[功能](#它能回答什么) &nbsp;·&nbsp; [上下文事件](#上下文事件) &nbsp;·&nbsp; [安装](#安装) &nbsp;·&nbsp; [数字怎么读](#数字怎么读) &nbsp;·&nbsp; [工作原理与隐私](#工作原理与隐私) &nbsp;·&nbsp; [开发](#开发) &nbsp;·&nbsp; [**English**](README.en.md)

</div>

<br>

> [!TIP]
> **0.3.6 新功能：上下文事件。** 注入、压缩和模型切换现在直接读自 ZCode 的会话记录，覆盖整个会话，不再只看最近 3 天的日志。点一下事件，就能在浏览器里打开它带进上下文的那一项；压缩还能展开「被摘要的内容」，默认记录设置下也能看。[看看怎么用 ↓](#上下文事件)

独立、只读、离线的 ZCode UI 插件，面向 Desktop 本地工作区。它不联网、不调用模型，也不修改 ZCode 的任何设置，只把 ZCode 已经记录在本机的数据整理成一个随会话更新的侧栏面板。

## 它能回答什么

<table>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/frame-overview.dark.png">
        <img src="docs/images/frame-overview.png" alt="请求概览与上下文趋势">
      </picture>
      <h4>上下文为什么这么大？</h4>
      每次请求的大小、按类别（系统指令、工具定义、用户消息、助手消息、工具结果）的组成，以及随步骤的变化趋势。悬停任一类别，它会在各处同步高亮。
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/frame-changes.dark.png">
        <img src="docs/images/frame-changes.png" alt="压缩后的仅变化视图">
      </picture>
      <h4>压缩前后少了什么？</h4>
      点击压缩事件，浏览器选中压缩后的一步并与压缩前一步对比；「仅变化」只列出新增和移除，被移除的条目带删除线（需要完整记录，见<a href="#默认记录与完整保留">下文</a>）。
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/frame-events.dark.png">
        <img src="docs/images/frame-events.png" alt="上下文事件卡片：注入、压缩、模型切换和 MCP 工具注册">
      </picture>
      <h4>运行时往上下文里塞了什么？<sup>新</sup></h4>
      TodoWrite 提醒、Agent 列表、后台任务通知、Skill 加载这些不是你写的内容，每条一行，带估算大小和进入的步骤；压缩、模型切换和 MCP 工具注册也在同一条时间线上。
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/frame-tool-card.dark.png">
        <img src="docs/images/frame-tool-card.png" alt="展开的工具结果卡片">
      </picture>
      <h4>这一步新进来了什么？</h4>
      上一步回复之后进入上下文的内容，通常是工具结果，参数和正文可以直接展开。每条消息还标出它从第几轮第几步进入上下文，例如 <code>T4 S18</code>。
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/frame-summarized.dark.png">
        <img src="docs/images/frame-summarized.png" alt="一次自动压缩被摘要掉的提问、回复和工具调用">
      </picture>
      <h4>压缩摘要掉了什么？<sup>新</sup></h4>
      压缩前后的 token、用时和被摘要的消息数；展开「被摘要的内容」，逐条列出被换成摘要、之后不再发给模型的提问、回复、思考和工具调用。
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/frame-schemas.dark.png">
        <img src="docs/images/frame-schemas.png" alt="工具定义的调用次数">
      </picture>
      <h4>哪些工具定义白占 token？</h4>
      每个工具定义本会话被调用了几次，以及从未调用的工具定义每次请求占多少。可按大小、调用次数或名称排序。
    </td>
  </tr>
</table>

## 上下文事件

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/events-flow.dark.png">
    <img src="docs/images/events-flow.png" width="100%" alt="点击上下文事件：压缩展开被摘要的内容，注入在浏览器里打开携带它的那条消息">
  </picture>
</p>

上下文里有不少内容不是你或模型写的，而是 ZCode 运行时在请求之间加进去或换掉的。「上下文事件」卡片把它们按时间列出来，每一条都能点开，直接看到它对上下文做了什么。

| 事件 | 卡片上显示 | 点击后 |
|---|---|---|
| ↳ **注入** | TodoWrite 提醒、Agent 列表、恢复的上下文、后台任务通知、子代理消息、Skill 加载，每条一行，带估算大小 | 在浏览器里打开携带它的那条消息，并标出它进入上下文的回合与步骤；那次请求已不可读时，显示会话记录里的原文 |
| ✂ **压缩** | 状态（完成、失败、进行中、重试、中断或跳过）、用时、压缩前后的 token、被摘要的消息数 | 选中压缩后的一步，与压缩前一步对比；「被摘要的内容」逐条列出被摘要的提问、回复、思考和工具调用 |
| ⇄ **模型切换** | 从哪个模型换到哪个 | 选中切换后的第一步，在请求概览里看到新模型 |
| ↶ **回退 / 编辑提问** | 保留的消息数 | 选中之后的第一步，并与回退前一步对比 |
| ⚙ **MCP 工具注册** | 注册的工具数 | 选中注册后的第一步，只看工具定义里的 `mcp__` 工具；这是可退出的临时焦点，你自己的筛选暂停、退出后恢复 |

- **数据从哪来**：注入、压缩和模型切换读自 ZCode 数据库里的会话记录（`message` 与 `part` 表），覆盖整个会话，标题旁显示「整个会话」。读取是增量的，只取需要的 JSON 字段，大段工具输出不会进入插件。回退、编辑提问和 MCP 工具注册只记在日志里，因此只看最近 3 天；会话记录里没有的压缩（例如失败的尝试）也从日志补上。读不到会话记录时，整张卡片退回日志，标题改为「最近 3 天」。
- **怎么定位**：一条注入会随下一次请求发给模型，插件在那次请求里按工具调用 ID 或原文找到它，越过分页也能直接展开。早于已加载步骤的事件，点击后会先加载更早的步骤；仍然找不到时会明确说明，不会停在一个相近的步骤上。
- **跟随当前分支**：回退不会删除 ZCode 会话记录里的消息，「被摘要的内容」只列当前对话分支上的消息；压缩本身位于已回退的分支上时，会说明无法确定它摘要了什么。
- **怎么合并**：ZCode 把一次压缩的开始和完成记成两条日志，这里合并为一行并带上最终状态；编辑提问和它触发的回退同样合并。
- **怎么筛选**：出现多种事件时，标题下方有按类型筛选的按钮；列表默认显示最新 12 条，「显示全部」展开其余。趋势图里的 ✂ 和 ↶ 标记点击效果与事件相同。

> [!NOTE]
> 默认记录设置下，模型 I/O 记录只保留每个请求末尾的一段消息和之后的增量，压缩前一步的完整内容通常已经不在了。这时「被摘要的内容」是唯一能看到一次压缩移除了什么的地方，它来自会话记录，与模型 I/O 记录的保留设置无关。

## 界面一览

从上到下：

<table>
  <tr><th align="left">区域</th><th align="left">内容</th></tr>
  <tr><td nowrap><b>步骤选择</b></td><td><kbd>‹</kbd> <kbd>›</kbd> 或 <kbd>←</kbd> <kbd>→</kbd> 在主请求之间切换；下拉框另列出标题生成、压缩等辅助请求。默认跟随最新，展开内容阅读时暂停跟随，选中历史请求时提示有几个新请求</td></tr>
  <tr><td nowrap><b>请求概览</b></td><td>实际输入、较上一步的变化、实测比例、输出/缓存与模型；按类别的堆叠条与图例；「本轮 / 输入 / 回复」三行摘要</td></tr>
  <tr><td nowrap><b>上下文趋势</b></td><td>每个主请求一根柱，带纵轴、回合带和 ✂ 压缩标记；可切换总量/变化、步骤/轮次；「自适应」按可见范围缩放；悬停查看各类别数值，悬停类别会在各处同步高亮</td></tr>
  <tr><td nowrap><b>上下文浏览器</b></td><td>按类别折叠和分页；对比基线可选上一步、上一轮或更早任一步；「仅变化」只看新增和移除；条目按工具名和关键参数命名，如 <code>Read · src/cache.ts</code></td></tr>
  <tr><td nowrap><b>条目详情</b></td><td>行内展开：工具卡片（参数表、成功/错误）、工具定义的参数表、正文（可读 / Markdown / 原始、复制、查找、分段）</td></tr>
  <tr><td nowrap><b>上下文事件</b></td><td>注入、压缩、模型切换、回退和 MCP 工具注册的时间线，点击打开对应的那一项，详见<a href="#上下文事件">上文</a></td></tr>
  <tr><td nowrap><b>用量</b></td><td>次级页面：近 30 天的逻辑用量、每日汇总和最近请求</td></tr>
  <tr><td nowrap><b>关于</b></td><td>次级页面（工具栏 <kbd>ⓘ</kbd>）：版本、作者、许可、源码仓库，以及只读本机数据、不联网的说明</td></tr>
</table>

## 默认记录与完整保留

默认设置下，ZCode 对模型 I/O 记录有**两层丢弃**：

- **消息级**：每次请求只记录**末尾的一段消息和之后的增量**，更早的消息不会被记录，而长会话的一次请求常有几百条。
- **会话级**：新会话开始记录时，已有的记录文件会被删到只剩最近写入的 2 个——算上当前会话，通常只有最近 3 个会话留有记录，更早会话的数据整个消失。这也是「几个小时前的会话什么都查不到」的原因：不是插件读不到，是记录已经不在了。

插件会如实区分这些情况，不拿缺失的数据去猜：

| | 默认设置 | 打开「完整保留模型 I/O」 |
|---|---|---|
| 更早会话的记录 | ❌ 只保留最近 3 个会话的记录文件，更早的已被删除且无法恢复 | ✅ 持续保留，不再按会话数清理 |
| 请求大小 | ⚠️ 以 provider 上报的实际输入为准，标出已记录部分，其余显示为斜纹的「更早消息（未记录）」 | ✅ 实际输入，分类按实测增量记账 |
| 按类别组成 | ⚠️ 只覆盖已记录的消息和工具定义 | ✅ 完整 |
| 「输入」行、新增内容 | ✅ 可用（由入场标记推出） | ✅ 可用 |
| 移除了什么、按类别的变化量 | ❌ 无法得知，界面会说明 | ✅ 可用 |
| 替换内容的正文 Diff | ❌ 不可用 | ✅ 可用（仅限有唯一身份的工具结果和工具定义） |
| 工具调用次数、入场标记 | ✅ 可用 | ✅ 可用 |
| 上下文事件、被摘要的内容 | ✅ 可用（来自会话记录，覆盖整个会话） | ✅ 可用 |

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/frame-partial.dark.png">
    <img src="docs/images/frame-partial.png" width="400" alt="默认设置下的请求概览：未记录部分以斜纹显示">
  </picture>
  <br>
  <sub>默认设置下，未记录的更早消息在堆叠条和趋势里以斜纹显示</sub>
</p>

> [!IMPORTANT]
> **建议装好插件就打开「完整保留模型 I/O」，不要等到想回看时再开——默认丢掉的记录无法事后恢复。** 打开方法：ZCode <kbd>设置</kbd> → <kbd>通用</kbd>，找到「完整保留模型 I/O」并开启。开关只对之后发生的请求生效；代价是磁盘占用增长更快：不再按会话数清理，也没有单文件 64 MB 的重置上限。插件只读本机数据，不会自动修改这个设置。

## 安装

**前置条件**

- **ZCode Desktop**：适配基线 3.15.1，需支持官方 UI 插件接口。
- **Node.js 24+**：在系统 PATH 中，终端里 `node -v` 能打印版本即可。它只用于启动插件自带的服务，不需要 npm 或其他构建工具。

### 从插件市场安装（推荐）

1. 打开 <kbd>设置</kbd> → <kbd>插件管理</kbd>，切换到 <kbd>发现</kbd>（Discover）页签。
2. 点击页签右上角的 <kbd>+</kbd> 添加市场。
3. 输入本项目的 GitHub 仓库并确认，市场列表会新增 `zcode-context-marketplace`：

   ```text
   Kevinzzz6/zcode-context
   ```

   填完整地址 `https://github.com/Kevinzzz6/zcode-context` 也可以。
4. 在插件列表找到 **zcode-context** 卡片，点击 <kbd>获取</kbd>（Get）；按钮变为「已安装」即完成，插件默认启用。
5. 重启 ZCode。
6. 打开任意一个会话，在右侧面板点击 <kbd>+</kbd> 新增标签，选择 <kbd>上下文</kbd>。

整个过程不需要克隆仓库，也不需要执行任何 npm 命令。插件安装进 ZCode 的本地缓存，自带服务依赖、worker 和离线页面，运行时不依赖源码目录；卸载与开关在「已安装」页签的插件详情里操作。

> [!NOTE]
> 添加市场时 ZCode 需要从 GitHub 克隆仓库。如果网络要走代理，请设置环境变量 `ZCODE_HTTP_PROXY`（例如 `http://127.0.0.1:7890`）并重启 ZCode。ZCode 只读取这个变量，不读取 `http_proxy`。

<details>
<summary><b>更新</b></summary>

<br>

在 <kbd>设置</kbd> → <kbd>插件管理</kbd> → <kbd>发现</kbd> 中刷新 `zcode-context-marketplace` 市场源；zcode-context 卡片出现「更新」时点击更新，完成后重启 ZCode。当前版本号在「已安装」页签的插件详情里查看。

</details>

<details>
<summary><b>离线安装</b>（无法访问 GitHub 时）</summary>

<br>

1. 在 [Releases](https://github.com/Kevinzzz6/zcode-context/releases) 下载对应版本的 `zcode-context-<版本>-marketplace.zip`；同名的 `.sha256` 文件可用来校验。
2. 解压到任意位置，得到 `zcode-context-marketplace` 目录。
3. 在 <kbd>插件管理</kbd> → <kbd>发现</kbd> → <kbd>+</kbd> 添加市场时选择本地目录，指向解压出的 `zcode-context-marketplace` 目录（其中含有 `marketplace.json`）。
4. 获取、启用、重启，与上面第 4–6 步相同。

</details>

<details>
<summary><b>从源码安装</b>（开发者）</summary>

<br>

```sh
git clone https://github.com/Kevinzzz6/zcode-context.git
cd zcode-context
npm ci
npm run build
```

构建会在仓库根生成 `marketplace.json` 和 `plugins/zcode-context/`，整个仓库根目录此时就是一个市场目录。在 <kbd>插件管理</kbd> → <kbd>发现</kbd> → <kbd>+</kbd> 添加市场时选择本地目录、填仓库根目录的绝对路径即可；改动代码后重新构建，再到市场里刷新并更新插件。完整验证流程见下文[开发](#开发)。

</details>

### 首次打开：授权两个只读工具

插件开关只决定 ZCode 加载插件；面板取数据时要调用插件自带的两个工具，ZCode 对它们照常执行工具权限规则：

- `mcp__plugin_zcode-context_context__get_context_summary`：概览、趋势和上下文事件，有变化时每 3 秒轮询，长时间无变化时逐步放慢到 10 秒
- `mcp__plugin_zcode-context_context__get_context_request`：某一步的内容、对比和正文

> [!IMPORTANT]
> 这两个工具只读，只有面板能调用，模型看不到。如果面板一直显示「读取中」或「读取时间较长」，请在 ZCode 中允许这两个工具（授权按项目保存）。插件不会自行修改权限。

## 数字怎么读

- **实际输入**：大数字是 provider 上报的这次请求的输入 token，包含缓存读取。
- **实测与估算**：条目和类别的大小按实测增量记账。每条回复按生成它的那次响应的输出 token 计，前提是这个输出容得下这一步其余的新增内容；一步除回复外只新增一项时，这一项按这一步实际输入的增量计；同样的内容在同一模型、同一来源下沿用测过的大小；一段记录第一条请求里的回复和单个工具结果（一条回复只调用一个工具、内容没变时）由 ZCode 会话记录补上。不带「≈」的大小和变化是实测值。带「≈」的是估算，或是在一个实测总量里按估算分出的份额，比如一步同时新增多项时的各项、一段记录第一条请求里的系统指令和工具定义；悬停可以看到分的是哪个总量。「实测 79%」是这次请求里能实测的比例（向下取整）；默认记录下是已记录部分里的比例。
- **估算**：按序列化内容计算，英文和代码约 4 字符 ≈ 1 token，中日韩文字约 1.5 字 ≈ 1 token，不等于模型的分词结果。它在实测总量里分份额，或在无从实测时代替：没有上报用量的请求，以及默认记录下起账时窗口里的消息和工具定义。
- **步序号和回合号**：从当前可读的第一条记录开始计数，不是整个会话的绝对序号。ZCode 会定期重置长会话的记录文件，之后历史会从头开始，趋势图下方会说明。
- **入场标记** `T2 S7`：按消息的绝对位置追溯得到。追到已加载的最早记录、记录缺口、重置或压缩时仍然存在的消息，显示「更早」，不猜步骤。
- **工具调用次数**：来自整个会话的调用记录，包括所选步骤之后的调用和已被压缩掉的调用。读不到调用记录时显示未知，不显示 ×0。
- **注入大小** `≈+47`：这条注入正文的估算 token；大段的 Skill 输出按开头一段的文字构成折算全文，不把全文读进插件。
- **压缩**：压缩前后的 token 由 ZCode 在压缩时记录，`≈−12.1k` 是两者之差（ZCode 不保证它们是实测值）；被摘要的消息数和内容来自会话记录。内容变少不代表发生了压缩，只有会话记录或日志里有记载的才算。
- **用量页**：来自 ZCode 数据库的逻辑请求统计，包含标题、压缩等辅助调用，和趋势中的记录分开计算，不做强行对应。

## 工作原理与隐私

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/architecture.dark.png">
    <img src="docs/images/architecture.png" width="100%" alt="数据流：上下文面板通过两个只读工具调用插件服务，数据 worker 只读本机 ~/.zcode/cli 下的会话记录、用量统计、模型 I/O 记录和日志">
  </picture>
</p>

- **只读**：不修改 ZCode 的代码、设置、数据库或权限，不运行迁移，数据库连接为只读。
- **离线**：不联网，不调用模型；所有数据留在本机。
- **会话隔离**：每次读取都按宿主传入的会话身份绑定，拿不到有效身份时明确报错，不会去读别的会话。面板属于打开它的会话，不会因为同一工作区里其他会话发消息而切换。
- **安全渲染**：捕获的 HTML 不会执行，正文按纯文本或受限的 Markdown 显示。

## 配置

默认读取 `~/.zcode/cli` 下的数据。需要时在插件配置里修改：

| 选项 | 默认值 | 用途 |
|---|---|---|
| `dataRoot` | `~/.zcode/cli` | 指向其他 CLI 数据目录（含 `db/db.sqlite`、`rollout/`、`debug/`、`log/`） |
| `dbPath` | `<dataRoot>/db/db.sqlite` | 数据库单独放置时设置 |

两者都需为绝对路径，支持 `~/`。

## 开发

```sh
npm ci
npm run check        # 语法与清单检查
npm test             # 单元测试
npm run build        # 构建 dist/、plugins/zcode-context/ 与根目录市场
npm run smoke        # 构建产物 + 真实 MCP stdio 通信
npm run verify       # 以上全部，结果写入 output/verification
```

| 命令 | 用途 |
|---|---|
| `npm run fixture:ui` | 合成的多轮会话（工具调用、标题请求、自动压缩），打开 <http://127.0.0.1:4175>；`FIXTURE_TAIL=12` 模拟默认的只记录最近消息；`/append?session=sess_A` 模拟新请求到达 |
| `npm run preview:session -- <sessionId>` | 用构建产物只读地预览一个真实会话，打开 <http://127.0.0.1:4177>，无需安装插件 |
| `npm run preview` | 演示数据页面，打开 <http://127.0.0.1:4173/?demo=1> |
| `npm run fixture:browser` + `npm run test:browser -- <playwright/index.mjs 的绝对路径>` | 浏览器交互回归（36 组），使用已有的 Playwright 和本机 Chrome，不下载浏览器 |

浏览器测试验证官方 App/AppBridge 握手、真实 stdio/SQLite 和双会话隔离，但不代替在 ZCode 桌面侧栏中的验收。

README 里的图全部由 [`docs/images/src/render.sh`](docs/images/src/render.sh) 生成：它构建一份独立的面板副本，用带会话记录的合成会话截取中英文、浅色与深色两套截图，再合成头图、截图外框、上下文事件示意图和数据流图。运行方式：`PLAYWRIGHT=<playwright/index.mjs 的绝对路径> bash docs/images/src/render.sh`，需要 Chrome、curl 和 ImageMagick；装有 oxipng 时，PNG 还会再无损压小约一成。

## 当前状态

- ✅ 0.3.x 已用真实会话（约 60 万 token、默认记录模式）在只读预览中验证，单元测试与浏览器交互测试全部通过。
- ✅ 0.3.6 已在 ZCode 桌面侧栏（3.15.1.8093、隔离配置、本地模拟服务）按 [验收清单](docs/desktop-acceptance.md) 完成验收，清单内全部通过；宿主无法驱动的场景已移出清单并在文档中说明（见[验证记录](docs/verification.md)）。
- ⚠️ 上游内部存储格式（模型 I/O 记录、会话记录的表结构）变化时，读取适配可能需要更新。

## 文档

| 文档 | 内容 |
|---|---|
| [更新日志](CHANGELOG.md) | 每个版本的变化 |
| [产品决策与取舍](docs/decisions.md) | 刻意没做的功能和原因 |
| [架构](docs/architecture.md) | 身份绑定、数据来源、隔离与限制 |
| [交接与接续步骤](docs/handoff.md) | 当前版本的修复记录与后续步骤 |
| [桌面验收](docs/desktop-acceptance.md) | 桌面侧栏的验收清单，只在隔离的 ZCode 副本中进行 |
| [验证记录](docs/verification.md) | 已执行的检查与结果 |
| [与 dsh-context 的对比](docs/dsh-comparison.md) | 界面与功能差距评估（0.1.1 历史快照） |
| [侧栏设计提案](docs/sidebar-design.md) | 0.2 的侧栏设计（历史快照） |

<br>

<div align="center">

<sub>MIT 许可 · 界面与交互设计参考了 <a href="https://github.com/bowenliang123/dsh-context">dsh-context</a>，并针对 ZCode 重新实现</sub><br>
<sub><a href="#readme-top">回到顶部 ↑</a></sub>

</div>
