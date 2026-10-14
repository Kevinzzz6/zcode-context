import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {fileURLToPath,pathToFileURL} from "node:url";
const {chromium}=process.argv[2]?await import(pathToFileURL(process.argv[2]).href):await import("playwright");
const out=new URL("../output/playwright/",import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:"chrome",headless:true});
const errors=[],checks=[];
const base="http://127.0.0.1:4174";
try {
  const page=await browser.newPage({viewport:{width:1064,height:1100}});
  page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  await page.request.get(base+"/reset");await page.goto(base);
  const a=page.frameLocator("#sess_A"),b=page.frameLocator("#sess_B");
  const refresh=async frame=>{await frame.locator("#refresh").click();await frame.locator("#refresh.spinning").waitFor({state:"detached"});};
  await a.locator("#session").filter({hasText:"sess_A"}).waitFor({state:"attached"});
  await b.locator("#session").filter({hasText:"sess_B"}).waitFor({state:"attached"});
  await a.locator(".category").first().waitFor();checks.push("SDK handshake and session-scoped browser");

  await a.locator("#summary").evaluate(el=>{el.dataset.probe="idle";});await page.waitForTimeout(3600);
  assert.equal(await a.locator("#summary").getAttribute("data-probe"),"idle");checks.push("polling without new data does not rebuild the page");

  const schemas=a.locator('.category[data-role="schema"]'),schemaTitles=()=>schemas.locator(".el .el-title").allTextContents();
  await schemas.locator(".cat-toggle").first().click();
  assert.equal(await schemas.locator('.el:has-text("Read") .calls').textContent(),"×2");
  assert.equal(await schemas.locator('.el:has-text("Glob") .calls.zero').textContent(),"×0");
  await a.locator("#schema-unused").filter({hasText:"1 个工具定义本会话从未调用"}).waitFor();
  await a.locator("#schema-sort-name").click();await a.locator("#schema-sort-name[aria-pressed=true]").waitFor();
  await schemas.locator(".el").first().filter({hasText:"Glob"}).waitFor();assert.deepEqual(await schemaTitles(),["Glob","Read"]);
  await a.locator("#schema-sort-calls").click();await schemas.locator(".el").first().filter({hasText:"Read"}).waitFor();
  await a.locator("#schema-sort-size").click();await a.locator("#schema-sort-size[aria-pressed=true]").waitFor();
  await schemas.locator(".cat-toggle").first().click();checks.push("schema rows show session call counts (×N, muted ×0), unused total and Size/Calls/Name sort");

  await a.locator("#show-usage").click();assert.equal(await a.locator("#calls").textContent(),"2");assert.match(await a.locator("#daily").textContent(),/200 \/ 20/);
  await a.locator("#usage-back").click();checks.push("secondary SQLite usage with daily totals");

  await a.locator("#show-about").click();assert.match(await a.locator("#about-version").textContent(),/^\d+\.\d+\.\d+$/);
  await a.locator("#about-repo").filter({hasText:"github.com/Kevinzzz6/zcode-context"}).waitFor();
  await a.locator("#about-privacy").waitFor();
  await a.locator("#about-back").click();await a.locator("#summary").waitFor();checks.push("about page shows version, licence, source and privacy note, and returns");

  const keys=await a.locator("#snapshot option").evaluateAll(options=>options.map(x=>x.value));
  const oldest=keys.at(-1);
  await a.locator("#snapshot").selectOption(oldest);await a.locator("#follow-state").filter({hasText:"正在查看历史请求"}).waitFor();
  const oldTotal=await a.locator("#selected-total").textContent();
  await a.locator("#mode-changes").click();await a.locator("#diff-status").filter({hasText:"没有更早的同来源请求"}).waitFor();
  await a.locator("#mode-all").click();await a.locator("#element-search").fill("Recorded input");
  const first=a.locator('.el[data-element="message:1"]');
  await first.waitFor();await first.locator(".el-head").click();await a.locator("#content").filter({hasText:"fixture_1"}).waitFor();
  assert.ok(!(await a.locator("#content").textContent()).includes("sess_B"));
  await a.locator("#format-raw").click();await a.locator("#content").filter({hasText:'"role"'}).waitFor();
  await first.locator(".el-head").click();await a.locator("#content").waitFor({state:"detached"});
  assert.equal(await a.locator("#element-search").inputValue(),"Recorded input");
  checks.push("pinned history, missing baseline, inline content and collapse keep the filter");

  await page.request.get(base+"/append?session=sess_B");await refresh(b);
  await page.request.get(base+"/append?session=sess_A");await refresh(a);
  await a.locator("#latest").filter({hasText:"有 2 个新请求"}).waitFor();
  assert.equal(await a.locator("#snapshot").inputValue(),oldest);assert.equal(await a.locator("#selected-total").textContent(),oldTotal);
  checks.push("refresh keeps pinned history, counts newer requests, and isolates A/B");

  await a.locator("#latest").click();await a.locator(".live").waitFor();
  await a.locator("#element-search").fill("");await a.locator("#mode-changes").click();
  await a.locator("#mode-changes").filter({hasText:/\+\d+ −\d+/}).waitFor();
  const current=await a.locator("#snapshot").inputValue();
  await a.locator('.category[data-role="user"] .cat-toggle').first().click();
  const removed=a.locator('.el[data-kind="removed"]').filter({hasText:"Recorded input"});
  await removed.locator(".el-head").click();await a.locator("#content").filter({hasText:"fixture_2"}).waitFor();
  assert.equal(await a.locator("#snapshot").inputValue(),current);await removed.locator(".el-head").click();
  const added=a.locator('.el[data-kind="added"]').filter({hasText:"Recorded input"});
  await added.locator(".el-head").click();await a.locator("#content").filter({hasText:"fixture_5"}).waitFor();await added.locator(".el-head").click();
  await a.locator('.category[data-role="schema"] .cat-toggle').first().click();
  const schema=a.locator('.category[data-role="schema"] .el[data-kind="added"]');
  await schema.locator(".el-head").click();await a.locator(".param-list").waitFor();
  await a.locator("#toggle-diff").click();await a.locator("#content .added").waitFor();await a.locator("#content .removed").waitFor();
  await schema.locator(".el-head").click();checks.push("changes-only removed/added navigation, schema parameters and verified body Diff");

  await a.locator("#baseline").selectOption(oldest);await refresh(a);
  assert.equal(await a.locator("#baseline").inputValue(),oldest);
  await page.locator("#dark").click();await page.locator("#english").click();
  await a.locator("#show-usage").filter({hasText:"Usage"}).waitFor();assert.equal(await a.locator("html").getAttribute("data-theme"),"dark");
  assert.equal(await a.locator("#snapshot").inputValue(),current);assert.equal(await a.locator("#baseline").inputValue(),oldest);
  checks.push("theme and locale preserve selection and baseline");

  await a.locator("#mode-all").click();await a.locator("#element-search").fill("Tool output");
  await a.locator('.el[data-element="message:3"] .el-head').click();await a.locator(".tool-card").filter({hasText:"src/cache.ts"}).waitFor();
  await a.locator('.el[data-element="message:3"] .el-head').click();checks.push("tool card pairs the recorded call arguments");
  // Buttons without an id keep keyboard focus across the rebuild their own action triggers.
  await a.locator('.el[data-element="message:3"] .el-head').focus();await page.keyboard.press("Enter");await a.locator(".tool-card").waitFor();
  assert.match(await a.locator("body").evaluate(()=>document.activeElement?.dataset?.focus??""),/^el:.+:message:3$/);
  await page.keyboard.press("Enter");await a.locator(".tool-card").waitFor({state:"detached"});
  assert.match(await a.locator("body").evaluate(()=>document.activeElement?.dataset?.focus??""),/^el:.+:message:3$/);checks.push("keyboard focus survives rebuilds on buttons without an id");

  await page.request.get(base+"/append?session=sess_A&large=1");await refresh(a);
  await a.locator("#element-search").fill("END_OF_LONG_INPUT");await a.locator('.el[data-element="message:1"] .el-head').click();
  await a.locator("#content").filter({hasText:"long fixture"}).waitFor();assert.equal((await a.locator("#content").textContent()).length,12000);
  await a.locator("#body-search").fill("END_OF_LONG_INPUT");await a.locator("#next-match").waitFor();
  await page.waitForTimeout(350);await a.locator("#next-match").click();await a.locator("#content mark.current").filter({hasText:"END_OF_LONG_INPUT"}).waitFor();
  assert.ok((await a.locator("#content").textContent()).length<12000);
  await a.locator("#body-search").press("Shift+Enter");await a.locator(".find .muted").filter({hasText:/1 of 1|第 1 \/ 1 处/}).waitFor();
  await a.locator("#body-search").press("Escape");await a.locator("#content mark").first().waitFor({state:"detached"});
  await a.locator("#body-search").fill("END_OF_LONG_INPUT");await a.locator("#next-match").waitFor();
  checks.push("12k body parts, full-body search with Enter/Shift+Enter/Esc");

  for(const width of [320,360,420,520]) {
    await page.setViewportSize({width:width*2+24,height:1100});
    await page.locator("iframe").evaluateAll((frames,width)=>frames.forEach(x=>x.style.width=width+"px"),width);
    for(const mode of ["all","changes"]) {
      await a.locator("#mode-"+mode).click();
      for(const frame of page.frames().slice(1)) {
        const wide=await frame.locator("body").evaluate(body=>body.scrollWidth<=body.clientWidth+1?null
          :body.scrollWidth+"/"+body.clientWidth+" "+[...body.querySelectorAll("*")].filter(el=>el.getBoundingClientRect().right>body.clientWidth+1||getComputedStyle(el).overflowX==="visible"&&[...el.childNodes].some(n=>{if(n.nodeType!==3)return false;const r=document.createRange();r.selectNodeContents(n);return r.getBoundingClientRect().right>body.clientWidth+1;})).map(el=>el.tagName.toLowerCase()+(el.id?"#"+el.id:"")+(el.className?"."+String(el.className).replaceAll(" ","."):"")).slice(0,6).join(" "));
        assert.equal(wide,null,mode+" overflow at "+width+": "+wide);
      }
    }
    await a.locator("#mode-all").click();
    await page.screenshot({path:fileURLToPath(new URL("sidebar-"+width+".png",out)),fullPage:true});
  }
  checks.push("320/360/420/520 CSS px without horizontal overflow in both browser modes");

  await page.reload();await a.locator("#content").filter({hasText:"END_OF_LONG_INPUT"}).waitFor();
  assert.equal(await a.locator("#element-search").inputValue(),"END_OF_LONG_INPUT");checks.push("guest reconstruction restores selection, open content and filter");

  await page.request.get(base+"/append?session=sess_A&bulk=1");await refresh(a);
  await a.locator("#follow-state").filter({hasText:"正在阅读，已暂停跟随"}).waitFor();await a.locator("#latest").click();checks.push("following pauses while content is open");
  await a.locator("#element-search").fill("SEARCH_BEYOND_FIRST_PAGE");await a.locator('.el[data-element="message:88"] .el-head').click();
  await a.locator("#content").filter({hasText:"SEARCH_BEYOND_FIRST_PAGE"}).waitFor();checks.push("search beyond the first 40 elements");
  await a.locator("#element-search").fill("");await a.locator('.category[data-role="tool"] .more').click();
  await a.locator('.category[data-role="tool"] .el').nth(40).waitFor();checks.push("per-category show more loads that category's next page");
  const [,step,turn]=(await a.locator("#snapshot option:checked").textContent()).match(/第 (\d+) 步 · 回合 (\d+)/);
  const appended=a.locator('.category[data-role="tool"] .el[data-element="message:10"] .stamp');
  assert.equal(await appended.textContent(),"T"+turn+" S"+step);assert.equal(await appended.getAttribute("title"),"首次随第 "+turn+" 轮第 "+step+" 步进入上下文");
  // Every fixture request rewrites its messages, so only the unchanged system message traces back to the oldest loaded step.
  await a.locator('.category[data-role="system"] .cat-toggle').first().click();
  const earlier=a.locator('.category[data-role="system"] .el .stamp.before');
  assert.equal(await earlier.textContent(),"更早");assert.match(await earlier.getAttribute("title"),/第 1 步时已在上下文中/);
  await a.locator('.category[data-role="system"] .cat-toggle').first().click();
  checks.push("entry stamps name the step a message entered, or say earlier with the step it was traced to");

  await a.locator("#element-search").fill("fixture_1");await a.locator("#search-scope").click();
  // All / Changes does not apply across requests; the control says so instead of looking switched on.
  await a.locator("#mode").filter({hasText:"跨请求搜索列出全部匹配"}).waitFor();assert.equal(await a.locator("#mode-changes").count(),0);
  const hit=a.locator(".loaded-results .el").filter({hasText:"Recorded input"}).first();
  await hit.locator(".el-head").click();await a.locator("#content").filter({hasText:"fixture_1"}).waitFor();
  await a.locator(".el-body .note .btn").click();await a.locator("#follow-state").waitFor();
  assert.equal(await a.locator("#snapshot").inputValue(),oldest);
  await a.locator("#search-scope").click();await a.locator("#element-search").fill("");checks.push("bounded cross-request search opens content and jumps to its step");

  // The fixture's data service keeps events it already read, so a rerun against the same fixture starts with earlier ones.
  const priorCompactions=await a.locator(".event.compaction").count();
  await page.request.get(base+"/event?session=sess_A");await page.request.get(base+"/append?session=sess_A&gap=1");
  await refresh(a);await a.locator("#latest").click();await a.locator("#mode-changes").click();
  await a.locator("#diff-status").filter({hasText:"两次记录之间有缺口"}).waitFor();checks.push("history gap suppresses deletion and negative Delta");
  const compactions=a.locator(".event.compaction");await compactions.filter({hasText:"自动压缩"}).first().waitFor();
  assert.equal(await compactions.count(),priorCompactions+1);await compactions.first().filter({hasText:"完成"}).filter({hasText:"用时 0.1s"}).waitFor();
  checks.push("a compaction's started and completed records render as one row");
  await compactions.first().locator(".event-main").click();
  await a.locator("#browser .note").filter({hasText:"无法和事件之前的一步逐项对比"}).waitFor();
  assert.equal(await a.locator("#mode-all").getAttribute("aria-pressed"),"true");assert.equal(await compactions.first().locator(".event-main").getAttribute("aria-pressed"),"true");
  assert.ok(await a.locator("#browser").evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.top<innerHeight;}));
  checks.push("focusing a compaction pins the step after it, scrolls to the browser and explains a non-comparable baseline");
  await compactions.first().locator(".event-nav button").click();await a.locator("#follow-state").filter({hasText:"正在查看历史请求"}).waitFor();
  checks.push("compaction before-step navigation");
  // Event row buttons keep keyboard focus through the rebuild their own action causes.
  await compactions.first().locator(".event-nav button").last().focus();await page.keyboard.press("Enter");await a.locator("#follow-state").waitFor();
  assert.match(await a.locator("body").evaluate(()=>document.activeElement?.dataset?.focus??""),/^event-before:/);
  await compactions.first().locator(".event-main").focus();await page.keyboard.press("Enter");await a.locator("#focus").waitFor();
  assert.match(await a.locator("body").evaluate(()=>document.activeElement?.dataset?.focus??""),/^event:/);checks.push("event buttons keep keyboard focus");
  await page.request.get(base+"/inject?session=sess_A");await refresh(a);
  const inject=a.locator('.event.inject[data-evidence="recorded"]').first();await inject.waitFor();
  await inject.locator(".event-main").click();await a.locator(".el.open #content").filter({hasText:"Fixture TodoWrite reminder"}).waitFor();
  assert.equal(await inject.locator(".event-main").getAttribute("aria-pressed"),"true");
  checks.push("a recorded injection opens the message that carried it in the context browser");
  await inject.locator(".event-toggle").click();await inject.locator(".event-text").filter({hasText:"Fixture TodoWrite reminder"}).waitFor();
  checks.push("an injection's own text opens inline");

  // An MCP registration focuses the step after it on MCP tool schemas with its own baseline, pausing the user's own filter.
  await a.locator("#mode-all").click();await a.locator("#element-search").fill("Recorded input");
  await a.locator('.category[data-role="user"] .cat-count').filter({hasText:"/"}).waitFor();
  await page.request.get(base+"/tools?session=sess_A");await refresh(a);
  const tools=a.locator(".event.tools").first(),focus=a.locator("#focus");
  await tools.locator(".event-main").click();await focus.filter({hasText:"请求里有 1 个"}).filter({hasText:"注册了 3 个"}).waitFor();
  await focus.locator(".note").filter({hasText:"你的筛选「Recorded input」已暂停"}).waitFor();
  assert.equal(await a.locator("#element-search").getAttribute("class"),"paused");
  assert.equal(await a.locator("#mode-changes").getAttribute("aria-pressed"),"true");assert.match(await a.locator("#mode-changes").textContent(),/\+1 −0$/);
  assert.deepEqual(await a.locator('.category[data-role="schema"] .el .el-title').allTextContents(),["mcp__fixture__open"]);
  assert.equal(await a.locator('.category[data-role="schema"] .cat-badge').textContent(),"+1");
  assert.equal(await a.locator('.category[data-role="user"] .cat-badge').count(),0,"user messages changed but none is an MCP schema");
  assert.equal(await tools.locator(".event-main").getAttribute("aria-pressed"),"true");
  checks.push("an MCP registration focuses its step on MCP schemas, pauses the user's filter, and every count matches what it lists");
  await page.reload();await a.locator('.category[data-role="user"] .cat-count').filter({hasText:"/"}).waitFor();
  assert.equal(await focus.count(),0);assert.equal(await a.locator("#element-search").inputValue(),"Recorded input");
  await tools.locator(".event-main").click();await focus.waitFor();
  await a.locator("#snapshot-previous").click();await focus.waitFor({state:"detached"});
  assert.equal(await a.locator("#element-search").getAttribute("class"),null);assert.equal(await a.locator("#element-search").inputValue(),"Recorded input");
  assert.equal(await tools.locator(".event-main").getAttribute("aria-pressed"),"false");
  await a.locator("#snapshot-next").click();await tools.locator(".event-main").click();await focus.waitFor();
  await a.locator("#focus-exit").click();await focus.waitFor({state:"detached"});
  await a.locator('.category[data-role="user"] .cat-count').filter({hasText:"/"}).waitFor();
  checks.push("an event focus is not saved, and leaving its step or pressing × brings the user's filter back");

  // A +N badge lists exactly N changes, counted under the filter; the user category's unmatched addition shows no badge.
  await a.locator("#element-search").fill("Tool output");
  await a.locator('.category[data-role="tool"] .cat-badge.up').filter({hasText:"+1"}).waitFor();
  assert.equal(await a.locator('.category[data-role="user"] .cat-badge').count(),0);
  await a.locator('.category[data-role="tool"] .cat-badge.up').click();
  assert.equal(await a.locator("#mode-changes").getAttribute("aria-pressed"),"true");assert.match(await a.locator("#mode-changes").textContent(),/\+1 −1$/);
  assert.equal(await a.locator('.category[data-role="tool"] .el[data-kind="added"]').count(),1);
  await a.locator("#search-clear").click();assert.equal(await a.locator("#element-search").inputValue(),"");await a.locator("#mode-all").click();
  checks.push("a category's +N lists exactly N changes under the filter, and the filter has a clear button");

  // A registration with no request after it has no step: it says so, and the latest step is only an explicit, labelled choice.
  const pinnedStep=await a.locator("#snapshot").inputValue();
  await page.request.get(base+"/tools?session=sess_A&request=0");await refresh(a);
  const pending=a.locator(".event.tools").first();
  await pending.locator(".event-main").click();await pending.locator(".event-body .note").filter({hasText:"无法定位到对应的一步"}).waitFor();
  assert.equal(await a.locator("#snapshot").inputValue(),pinnedStep);assert.equal(await focus.count(),0);
  await pending.locator("#tools-latest").click();await focus.locator(".note").filter({hasText:"这里显示的是最新一步"}).waitFor();
  await a.locator("#focus-exit").click();await focus.waitFor({state:"detached"});
  checks.push("an MCP registration without a step after it says so instead of borrowing one");

  await a.locator("#trend-delta").click();await a.locator("#trend-scroll .bar").first().click();
  assert.equal(await a.locator("#trend-scroll .bar").first().getAttribute("aria-pressed"),"true");checks.push("trend Delta mode and bar selection");

  await a.locator("#trend-scroll .bar").last().dispatchEvent("mouseenter");await a.locator(".trend-tip").waitFor();
  await a.locator('.legend-item[data-role="tool"]').dispatchEvent("mouseenter");
  assert.equal(await a.locator("html").getAttribute("data-hl"),"tool");
  await a.locator('.legend-item[data-role="tool"]').dispatchEvent("mouseleave");assert.equal(await a.locator("html").getAttribute("data-hl"),null);
  checks.push("trend hover tip and cross-card category highlight");
  await a.locator("#gran-turn").click();await a.locator("#trend-scroll .bar-x").filter({hasText:/^T\d+$/}).first().waitFor();
  await a.locator("#gran-step").click();checks.push("turn granularity");

  await a.locator("#latest").click();await a.locator(".brief-row").filter({hasText:"本轮"}).waitFor();
  await a.locator("#base-turn").click();assert.equal(await a.locator("#base-turn").getAttribute("aria-pressed"),"true");
  await a.locator("#base-step").click();checks.push("turn brief and previous-turn baseline");
  const beforeKey=await a.locator("#snapshot").inputValue();
  await a.locator("#summary").press("ArrowLeft");await page.waitForTimeout(200);
  assert.notEqual(await a.locator("#snapshot").inputValue(),beforeKey);checks.push("arrow keys move between steps");

  for(let i=0;i<30;i++)await page.request.get(base+"/append?session=sess_A");
  await page.locator("#sess_A").evaluate(frame=>{frame.style.width="320px";});await refresh(a);await a.locator("#latest").click();
  await a.locator("#trend-adaptive").click();
  const scroller=a.locator("#trend-scroll");
  assert.ok(await scroller.evaluate(el=>el.scrollWidth>el.clientWidth),"trend scrolls");
  await scroller.evaluate(el=>{el.scrollLeft=el.scrollWidth;});await page.waitForTimeout(250);
  const endScale=await a.locator(".trend-card").getAttribute("data-scale");
  await scroller.evaluate(el=>{el.scrollLeft=0;});await page.waitForTimeout(250);
  const startScale=await a.locator(".trend-card").getAttribute("data-scale");
  assert.notEqual(startScale,endScale,"adaptive axis follows the visible bars");
  await a.locator("#trend-adaptive").click();checks.push("adaptive axis rescales to the visible bars ("+startScale+" → "+endScale+")");
  await b.locator("#show-usage").click();assert.equal(await b.locator("#calls").textContent(),"2");
  assert.deepEqual(errors,[]);
  await writeFile(new URL("result.json",out),JSON.stringify({passed:true,browser:await browser.version(),hostType:"SDK fixture, not ZCode Desktop",checks,pageErrors:errors},null,2)+"\n");
  console.log("Browser passed: "+checks.length+" interaction groups.");
}catch(error){console.error(error);await writeFile(new URL("failure.json",out),JSON.stringify({passed:false,checks,error:String(error),errors},null,2));throw error;}
finally{await browser.close();}
