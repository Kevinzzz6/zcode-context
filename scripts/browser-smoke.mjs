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

  await a.locator("#show-usage").click();assert.equal(await a.locator("#calls").textContent(),"2");assert.match(await a.locator("#daily").textContent(),/200 \/ 20/);
  await a.locator("#usage-back").click();checks.push("secondary SQLite usage with daily totals");

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
  await a.locator('.category[data-role="user"] .cat-head').click();
  const removed=a.locator('.el[data-kind="removed"]').filter({hasText:"Recorded input"});
  await removed.locator(".el-head").click();await a.locator("#content").filter({hasText:"fixture_2"}).waitFor();
  assert.equal(await a.locator("#snapshot").inputValue(),current);await removed.locator(".el-head").click();
  const added=a.locator('.el[data-kind="added"]').filter({hasText:"Recorded input"});
  await added.locator(".el-head").click();await a.locator("#content").filter({hasText:"fixture_5"}).waitFor();await added.locator(".el-head").click();
  await a.locator('.category[data-role="schema"] .cat-head').click();
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
      for(const frame of page.frames().slice(1))assert.ok(await frame.locator("body").evaluate(body=>body.scrollWidth<=body.clientWidth+1),mode+" overflow at "+width);
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

  await a.locator("#element-search").fill("fixture_1");await a.locator("#search-scope").click();
  const hit=a.locator(".loaded-results .el").filter({hasText:"Recorded input"}).first();
  await hit.locator(".el-head").click();await a.locator("#content").filter({hasText:"fixture_1"}).waitFor();
  await a.locator(".el-body .note .btn").click();await a.locator("#follow-state").waitFor();
  assert.equal(await a.locator("#snapshot").inputValue(),oldest);
  await a.locator("#search-scope").click();await a.locator("#element-search").fill("");checks.push("bounded cross-request search opens content and jumps to its step");

  await page.request.get(base+"/event?session=sess_A");await page.request.get(base+"/append?session=sess_A&gap=1");
  await refresh(a);await a.locator("#latest").click();await a.locator("#mode-changes").click();
  await a.locator("#diff-status").filter({hasText:"两次记录之间有缺口"}).waitFor();checks.push("history gap suppresses deletion and negative Delta");
  await a.locator(".event").filter({hasText:"自动压缩"}).first().waitFor();
  await a.locator(".event-nav button").first().click();await a.locator("#follow-state").filter({hasText:"正在查看历史请求"}).waitFor();
  checks.push("readable logged compaction with before/after step navigation");

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
