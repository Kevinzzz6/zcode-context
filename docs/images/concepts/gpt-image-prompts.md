# GPT Image 核心功能效果图

生成日期：2026-10-12。生成方式：内置 GPT Image / image_gen。
这些是窄侧栏设计概念图，数据为示例，不是已实现界面的截图。

- [请求趋势与组成](request-composition.png)
- [压缩前后变化](compaction-diff.png)
- [工具结果详情](tool-content-detail.png)

## 最终提示词

### request-composition

```text
Use case: ui-mockup.
Asset type: high-fidelity design concept for the ZCode Context plugin in a narrow desktop right sidebar.
Generate a polished, production-plausible raster UI design, front-on flat screen view, portrait 2:3 aspect ratio. ONE narrow sidebar per image, approximating 420 CSS px wide and 760 CSS px high, scaled for razor-sharp readable typography; fill the image with the UI and small dark outer margins. No phone frame, no perspective, no device mockup, no large surrounding desktop, no marketing headline. Chinese product copy and professional CJK sans-serif typography, clean monospace for numerical values and code. Elegant developer-tool design matching ZCode: graphite background #191A1D, soft surface #23252B, subtle #303640 separators, primary text #E3E6ED, secondary #9299A5. Restrained chrome, minimal card stacking, compact functional controls, generous enough row spacing to be readable. Fixed semantic colors: system purple, tool schemas amber, users green, assistant blue, tool results teal. No neon, gradients, glassmorphism, decorative illustrations or gratuitous donuts. All content is illustrative design data. Header contains exact Chinese title "上下文" and a small "示例会话" label. Maintain coherent sizes, spacing, typography and palette across this design series. Everything should fit in a narrow sidebar without tiny unreadable text or horizontal overflow. Render all specified Chinese labels accurately. This is an intended UI design, not a claim of a live screenshot.
Screen: REQUEST TREND AND COMPOSITION, the default diagnostic view.
At the top, a discreet "用量" action and "最新" action. Compact request picker with previous/next chevrons reads "R12 · 工具返回", status "已固定历史请求".
Primary numeric line: "≈30.2k" with label "输入组成", and compact "+8.4k 较前次". Secondary line: "实际输入 30.8k" and "缓存 72%" and "内容完整".
A short stacked bar chart labeled "请求输入组成 · 估算 token", with a small "总量 / 变化" selector; eight bars R7 through R14, R12 visibly selected. Bar heights grow to R12, then drop at R13 with a small scissors event marker. Use labeled y-axis 0,16k,32k; consistent colored category stacks, not arbitrary colorful bars.
Two compact linked brief rows underneath: "用户  检查缓存过期逻辑", "新增  Read · src/cache.ts · ≈8.6k".
A tab row "组成", "变化", "事件", with "组成" selected.
The composition browser beneath has title "所选请求的组成", a compact search field "搜索工具或文件", and a subtle size sort control "按大小".
Five accordion category rows sorted by size: "工具结果 12" with "≈19.0k 63%" expanded first; "工具定义 28" with "≈4.2k 14%"; "助手消息 17" with "≈3.8k 13%"; "系统指令 1" with "≈1.8k 6%"; "用户消息 4" with "≈1.4k 5%". Expanded tools have three refined rows "Read · src/cache.ts" "≈8.6k", "Bash · npm test" "≈5.1k", "Read · package.json" "≈2.3k", each with a subdued one-line description.
Footer in small readable text "最近记录的模型输入 · 分项为估算". Show clear information hierarchy; the largest source should be easy to find.
```

### compaction-diff

```text
Use case: ui-mockup.
Asset type: high-fidelity design concept for the ZCode Context plugin in a narrow desktop right sidebar.
Generate a polished, production-plausible raster UI design, front-on flat screen view, portrait 2:3 aspect ratio. ONE narrow sidebar per image, approximating 420 CSS px wide and 760 CSS px high, scaled for razor-sharp readable typography; fill the image with the UI and small dark outer margins. No phone frame, no perspective, no device mockup, no large surrounding desktop, no marketing headline. Chinese product copy and professional CJK sans-serif typography, clean monospace for numerical values and code. Elegant developer-tool design matching ZCode: graphite background #191A1D, soft surface #23252B, subtle #303640 separators, primary text #E3E6ED, secondary #9299A5. Restrained chrome, minimal card stacking, compact functional controls, generous enough row spacing to be readable. Fixed semantic colors: system purple, tool schemas amber, users green, assistant blue, tool results teal. No neon, gradients, glassmorphism, decorative illustrations or gratuitous donuts. All content is illustrative design data. Header contains exact Chinese title "上下文" and a small "示例会话" label. Maintain coherent sizes, spacing, typography and palette across this design series. Everything should fit in a narrow sidebar without tiny unreadable text or horizontal overflow. Render all specified Chinese labels accurately. This is an intended UI design, not a claim of a live screenshot.
Screen: COMPACTION BEFORE/AFTER ANALYSIS, same product showing a different state.
Compact picker "R13 · 压缩后", historical status "已固定历史请求".
Primary number "≈8.4k" with label "输入组成" and delta "−21.8k 较前次"; subtitle "R12 → R13".
A short DELTA chart labeled "上下文变化 · 估算 token" with a clear zero baseline; positive additions above zero, negative reclamation BELOW zero. R13 is the selected deep negative bar, with small scissors marker and tasteful emphasis, surrounding R10,R11,R12,R14 bars much smaller. Y ticks "+10k", "0", "−22k". No fake window occupancy.
Tabs "组成", "变化", "事件", with "变化" selected.
Readable evidence section: "自动压缩完成", a small badge "日志确认", line "21:08 · 触发：输入预算". A concise sentence "旧工具结果与历史消息被摘要替换".
Single-column before/after summary, NOT two narrow text columns: row "R12 压缩前" with "≈30.2k", next row "R13 压缩后" with "≈8.4k".
Below, category change rows with restrained signed colored indicators: "工具结果  −19.0k", "历史消息  −4.7k", "压缩摘要  +1.9k". These sum to −21.8k.
A clear detail action "查看被移除的内容". Lower portion shows one opened removed-item preview "Read · src/cache.ts" with a compact summary; plus an added "历史摘要" row with 2–3 lines of readable prose.
Footer "内容变化由快照确认 · 压缩原因由日志确认". Distinguish facts and evidence, not a generic warning panel.
```

最终一致性修订：

```text
Edit this UI mockup with only three data-consistency corrections. Keep its entire composition, dimensions, graphite palette, typography, cards, icons, Chinese labels, other numerical values, and all other content unchanged. In the delta chart, the R12 bar must show +8.4k ABOVE the zero baseline, replacing its current -1.1k negative bar; make the positive bar height appropriately just below the +10k axis label. In the expanded removed item 'Read · src/cache.ts', replace '-8.1k' with '-8.6k'. In the small line-count caption directly below that code excerpt, replace '共 320 行代码' with '共 186 行代码', retaining the remaining caption. This makes the R12 tool data consistent with the other two UI design images. No new controls, decorative elements, or layout changes.
```

### tool-content-detail

```text
Use case: ui-mockup.
Asset type: high-fidelity design concept for the ZCode Context plugin in a narrow desktop right sidebar.
Generate a polished, production-plausible raster UI design, front-on flat screen view, portrait 2:3 aspect ratio. ONE narrow sidebar per image, approximating 420 CSS px wide and 760 CSS px high, scaled for razor-sharp readable typography; fill the image with the UI and small dark outer margins. No phone frame, no perspective, no device mockup, no large surrounding desktop, no marketing headline. Chinese product copy and professional CJK sans-serif typography, clean monospace for numerical values and code. Elegant developer-tool design matching ZCode: graphite background #191A1D, soft surface #23252B, subtle #303640 separators, primary text #E3E6ED, secondary #9299A5. Restrained chrome, minimal card stacking, compact functional controls, generous enough row spacing to be readable. Fixed semantic colors: system purple, tool schemas amber, users green, assistant blue, tool results teal. No neon, gradients, glassmorphism, decorative illustrations or gratuitous donuts. All content is illustrative design data. Header contains exact Chinese title "上下文" and a small "示例会话" label. Maintain coherent sizes, spacing, typography and palette across this design series. Everything should fit in a narrow sidebar without tiny unreadable text or horizontal overflow. Render all specified Chinese labels accurately. This is an intended UI design, not a claim of a live screenshot.
Screen: TOOL RESULT CONTENT DRILLDOWN, full-width content reader inside the SAME narrow sidebar.
Back control "← 返回组成" in header, maintaining the "上下文" title and small "示例会话" label.
Small breadcrumb "R12 / 工具结果 / Read". Main title "src/cache.ts". Metadata: "调用成功" marked with restrained green dot, "≈8.6k token", "186 行 · 快照内容完整".
A collapsible "调用参数" section shows clean key/value rows: "file_path  src/cache.ts", "offset  1", "limit  200"; no giant raw JSON blob.
Toolbar heading "工具返回", toggles "正文" and "原始" with "正文" selected, discreet copy and find icons. An in-content search field "搜索正文".
Main reader is a beautifully readable syntax-highlighted TypeScript code excerpt, line numbers 1 through 12, realistic code:
export function readCache(key: string) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}
Make code wrap cleanly or use plausible short lines, no text overflow, no giant colored backgrounds. Violet keywords, amber strings, teal function details used sparingly on the dark editor surface.
Below code, a subtle line "显示 1–12 行 / 共 186 行", a text action "继续读取", then compact navigation "上一条结果" and "下一条结果".
Bottom contextual link "查看此内容在前后请求中的变化".
Footer "返回后保留请求、分类和查看位置". The content should be the dominant focus, with intentional spacing and no trend chart in this detail screen.
```

