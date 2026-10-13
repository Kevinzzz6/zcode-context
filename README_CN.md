# ZCode Context

[English](README.md)

独立、只读的 ZCode Context UI 插件，首版面向 Desktop 本地工作区。

## 当前功能（0.2.0）

- 以 traj 快照统一选择，默认诊断优先；历史选择暂停跟随，刷新和详情返回保留状态。
- 分类堆叠/Delta、历史组成、类别折叠与摘要、大小排序及最大内容定位。
- 搜索所选快照的全部条目或所有有界已加载快照；范围与缺口可见。
- 工具结果、消息、系统指令和 schema 的可读详情，保留 Raw/基础 Markdown；正文 12k 分块、复制当前块和全文搜索。
- 分类变化及新增/删除导航；有唯一已记录身份的替换提供单列正文 Diff。
- 可读压缩日志与有证据标签的前后快照/turn 范围导航；下降不自动解释为压缩。
- 每次按宿主请求元数据绑定会话。近 30 天 SQLite 逻辑用量/UTC 日汇总在次级入口，实际 attempt usage 与估算分开。

## 构建与安装

需要 Node.js 24+。依赖版本对齐上游 UI 插件示例。
宿主还需要支持官方 UI plugin 接口，适配源码基线为 ZCode 3.15.1。
当前客户端为 3.15.1.8093；已完成基础 Electron 接入，完整多窗口、重启与压缩矩阵仍未全部验收。

```sh
npm ci
npm run check
npm test
npm run build
npm run smoke
```

构建完成后，在 ZCode 的插件市场添加 **dist/local-marketplace** 的绝对路径，安装并启用
**zcode-context**，再从会话侧栏打开「上下文」。

安装产物自带服务依赖、worker 和离线 HTML，运行时无需源码目录和 node_modules；
系统 PATH 中仍需有 Node.js 24+。修改后重新构建、刷新同一市场源并重装插件。
0.2.0 是开发版本，正式发布修改后的安装内容前需要升级版本。

ZCode 的 MCP 权限仍生效：若详情读取等待或超时，应在宿主授权插件的
`get_context_summary` 和 `get_context_request` 两个只读工具。插件不会自动修改权限。
隔离验收曾遇到主页面不显示这项审批的宿主问题，条件与准确工具名见 [交接文档](docs/handoff.md)。

## 数据目录

默认读取 ~/.zcode/cli 下的 db/db.sqlite、rollout/、debug/ 和 log/。
在插件配置中用 **dataRoot** 指向自定义 CLI 目录；数据库单独放置时再设置 **dbPath**。
配置需为绝对路径，支持 ~/。

不要往清单 env 写 ZCODE_SESSION_ID。服务从每次 tools/call 的
_meta["com.zcode/request-context"].session_id 获取会话 ID；SDK 的 extra.sessionId 是传输 ID。
缺少有效绑定时明确报错，不自动选其他会话。

## 统计与内容边界

- 用量摘要来自近 30 天 model_usage 事实，包含此会话的主请求、压缩和辅助调用。
  不与 turn_usage 或消息 token 再次叠加，不把缓存与推理 token 重复加入总量。
  部分请求缺少输入或输出时，合计仅累加已报告值，并提示缺失请求数。
- 首页图表来自 traj 的分类字符估算，每窗口最多 10 个可选 attempt，可浏览有界缓存中的更早记录；不是实时窗口占用率。实际 provider usage 单独列出，SQLite 逻辑用量独立。
- 组成按序列化内容的 4 字符/token 粗估；schema 未记录时不会当作零。
  不猜每段文本归属哪个 skill 或插件，图片与视频数据可能已脱敏。
- 差异只比较同一文件、连续记录区间、同来源的完整前后快照。缺少增量基线、tail 裁剪和 schema 缺失均会明确显示。
- 事件读取最近 3 个本地日历日的日志。没有读到事件不能证明没有发生压缩。
- SQLite 的逻辑请求与 traj 的网络 attempt 分开展示，不根据时间或 request ID 强行一对一关联。
- 模型输入通常在 attempt 结束后写入，不能当作尚未发出的下一次请求的实时状态。
- 面板属于创建它的会话，不会因同一工作区另一个会话提交消息而切换。

官方「设置 → 通用 → 完整保留模型 I/O」可以增加内容覆盖，但会增加磁盘占用，
也无法恢复已经淘汰的记录；插件不会自动改这个设置。
即使全量模式，读取仍有窗口和容量上限，界面会保留覆盖范围提示。

正文 Diff 只对唯一 schema 名称或工具结果 ID 配对；普通消息不猜替换对应关系。
Diff 使用共同前后缀的替换块，可能比最小行 Diff 展示更多变化；基础 Markdown 仅渲染标题、段落和代码，捕获的 HTML 不执行。
偏好存储按已验证的会话分区；如果宿主禁用 localStorage，页面重建恢复会受限，身份仍须重新绑定。

## 验证

npm test 覆盖会话隔离、真实 WAL 读取、未知/零 usage、缓存口径、增量缺口、
重复消息差异和 JSONL 追加/重置。npm run smoke 验证构建产物与真实 MCP stdio 通信。
npm run preview 提供明确标注的演示页面，不代表桌面联调通过。

浏览器脚本可配合现有 Playwright/Chrome：先 npm run fixture:browser，再 npm run test:browser -- /Playwright模块绝对路径/index.mjs。
它验证官方 App/AppBridge 握手及真实 stdio/SQLite 的双会话页面交互，但不替代 Electron 沙箱验收。

桌面验收见 [desktop-acceptance.md](docs/desktop-acceptance.md)，只能使用隔离 ZCode 副本。
当前进度、目录和接续步骤见 [交接文档](docs/handoff.md)。
本插件不修改官方代码、设置或数据库，不运行迁移、不改 journal mode，不联网、不调用模型。
适配基线为 ZCode 3.15.1；上游内部存储格式变化时可能需要更新读取适配器。
