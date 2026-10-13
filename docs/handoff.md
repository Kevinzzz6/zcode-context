# ZCode Context 交接文档

更新时间：2026-10-13，Asia/Shanghai。当前版本：0.3.0。

## 0.3.0 界面改版

侧栏按 dsh-context 的卡片结构重做：请求概览、带 Y 轴和回合带的趋势、行内展开的上下文浏览器（含“仅变化”模式）、压缩事件卡片、底部说明收纳。
修掉的逻辑问题：辅助请求混入趋势导致 Delta 柱与相邻柱无关；R 编号随窗口滑动变化；全局 40 条分页导致小类别展开为空；token 与字符混用；
每 3 秒整页重绘两次（会关闭下拉框、清掉选中文字）；打开任意条目会永久取消跟随；规范 `toolCalls` 不能配对参数。
服务端只做了增量字段（步序号/回合号、按类分组、按类增删、条目标题/芯片、规范 toolCalls、`isError:false` 视为成功），既有口径和测试不变。
UI 开发用 `npm run fixture:ui`（端口 4175）；`npm run fixture:browser` + `npm run test:browser` 为 18 组交互回归。
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
SQLite 与 traj 不强行关联 request ID。估算与实际 usage 分开，缺字段保持未知。
缺消息基线、reset、损坏行/跨缺口不能产生删除或负 Delta；未记录 schema 不按删除处理。
下降不是压缩原因证据；淘汰内容不可恢复；不猜 skill/插件来源。
冷文件 24 MiB、每轮/单行 8 MiB、8 会话、总记录缓存 32 Mi 字符、worker 堆 256 MiB；响应只返回有界摘要与正文块。

## 文件边界

| 文件 | 职责 |
|---|---|
| `src/server.mjs` / `worker.mjs` | app-only MCP、每次身份校验、串行读取、超时 |
| `src/data/service.mjs` | 会话缓存、历史分页、查询/排序、基线、分块、事件导航 |
| `src/domain/trajectory.mjs` | 快照重建、角色组成、可读内容、已记录身份配对、Diff |
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

构建结果复制回正式目录，安装源为 `dist/local-marketplace`。
安装包为 `zcode-context-0.2.0-marketplace.zip`，校验值同名 `.sha256`。
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
