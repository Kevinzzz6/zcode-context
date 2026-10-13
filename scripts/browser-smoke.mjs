import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {fileURLToPath,pathToFileURL} from "node:url";
const {chromium}=process.argv[2]?await import(pathToFileURL(process.argv[2]).href):await import("playwright");
const out=new URL("../output/playwright/",import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:"chrome",headless:true});
const errors=[],checks=[];
try {
  const page=await browser.newPage({viewport:{width:1064,height:1100}});
  page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  await page.request.get("http://127.0.0.1:4174/reset");await page.goto("http://127.0.0.1:4174");
  const a=page.frameLocator("#sess_A"),b=page.frameLocator("#sess_B");
  await a.locator("#session").filter({hasText:"sess_A"}).waitFor({state:"attached"});
  await b.locator("#session").filter({hasText:"sess_B"}).waitFor({state:"attached"});
  await a.locator(".category").first().waitFor();checks.push("SDK handshake and session-scoped composition");
  await a.locator("#show-usage").click();assert.equal(await a.locator("#calls").textContent(),"2");assert.match(await a.locator("#daily").textContent(),/IN 200 \/ OUT 20/);
  await a.locator("#usage-back").click();checks.push("secondary SQLite usage with daily totals");
  const keys=await a.locator("#snapshot option").evaluateAll(options=>options.map(x=>x.value));
  await a.locator("#snapshot").selectOption(keys[0]);await a.locator("#follow-state").filter({hasText:"已固定"}).waitFor();
  const oldTotal=await a.locator("#selected-total").textContent();
  await a.locator("#tab-changes").click();await a.locator("#diff-status").filter({hasText:"没有上一快照"}).waitFor();
  await a.locator("#tab-composition").click();await a.locator("#element-search").fill("Recorded input");
  await a.locator('.element-row[data-element="message:1"]').waitFor();
  await a.locator('.element-row[data-element="message:1"]').click();await a.locator("#content").filter({hasText:"fixture_1"}).waitFor();
  assert.ok(!(await a.locator("#content").textContent()).includes("sess_B"));
  await a.locator("#format-raw").click();await a.locator("#content").filter({hasText:'"role"'}).waitFor();
  await a.locator("#back").click();assert.equal(await a.locator("#element-search").inputValue(),"Recorded input");
  checks.push("history composition, missing baseline and return state");
  await page.request.get("http://127.0.0.1:4174/append?session=sess_B");await b.locator("#refresh").click();
  await page.request.get("http://127.0.0.1:4174/append?session=sess_A");await a.locator("#refresh").click();
  await a.locator("#latest").filter({hasText:"有新请求"}).waitFor();
  assert.equal(await a.locator("#snapshot").inputValue(),keys[0]);assert.equal(await a.locator("#selected-total").textContent(),oldTotal);
  checks.push("refresh preserves pinned history and interleaved A/B isolation");
  await a.locator("#latest").click();await a.locator("#tab-changes").click();
  await a.locator("#diff-status").filter({hasText:"Δ"}).waitFor();
  const current=await a.locator("#snapshot").inputValue();
  await a.locator('.change-row[data-kind="removed"] .element-row').filter({hasText:"Recorded input"}).click();
  await a.locator("#content").filter({hasText:"fixture_2"}).waitFor();await a.locator("#back").click();
  assert.equal(await a.locator("#snapshot").inputValue(),current);
  await a.locator('.change-row[data-kind="added"] .element-row').filter({hasText:"Recorded input"}).click();
  await a.locator("#content").filter({hasText:"fixture_5"}).waitFor();await a.locator("#back").click();
  await a.locator(".diff-open").filter({hasText:"Read"}).click();await a.locator("#content .added").waitFor();await a.locator("#content .removed").waitFor();
  await a.locator("#back").click();checks.push("added/removed navigation and verified schema body Diff");
  await a.locator("#baseline").selectOption(keys[0]);await a.locator("#refresh").click();
  assert.equal(await a.locator("#baseline").inputValue(),keys[0]);
  await page.locator("#dark").click();await page.locator("#english").click();
  await a.locator("#heading").filter({hasText:"Context"}).waitFor();assert.equal(await a.locator("html").getAttribute("data-theme"),"dark");
  assert.equal(await a.locator("#snapshot").inputValue(),current);checks.push("theme and locale preserve selected snapshot and baseline");
  await a.locator("#tab-composition").click();await a.locator("#element-search").fill("Tool output");
  await a.locator('.element-row[data-element="message:3"]').click();await a.locator("#content").filter({hasText:"Tool output"}).waitFor();
  assert.match(await a.locator("#content-view").textContent(),/src\/cache.ts/);await a.locator("#back").click();checks.push("readable tool evidence with arguments");
  await page.request.get("http://127.0.0.1:4174/append?session=sess_A&large=1");await a.locator("#refresh").click();await a.locator("#latest").click();
  await a.locator("#element-search").fill("END_OF_LONG_INPUT");await a.locator('.element-row[data-element="message:1"]').click();
  await a.locator("#content").filter({hasText:"long fixture"}).waitFor();assert.equal((await a.locator("#content").textContent()).length,12000);
  await a.locator("#body-search").fill("END_OF_LONG_INPUT");await a.locator("#next-match").waitFor();
  await page.waitForTimeout(350);await a.locator("#next-match").click();await a.locator("#content mark").filter({hasText:"END_OF_LONG_INPUT"}).waitFor();
  assert.ok((await a.locator("#content").textContent()).length<12000);checks.push("12k body chunks and full-body search navigation");
  for(const width of [320,360,420,520]) {
    await page.setViewportSize({width:width*2+24,height:1100});
    await page.locator("iframe").evaluateAll((frames,width)=>frames.forEach(x=>x.style.width=width+"px"),width);
    for(const frame of page.frames().slice(1))assert.ok(await frame.locator("body").evaluate(body=>body.scrollWidth<=body.clientWidth+1),"overflow at "+width);
    await page.screenshot({path:fileURLToPath(new URL("sidebar-"+width+".png",out)),fullPage:true});
  }
  checks.push("320/360/420/520 CSS px without horizontal overflow");
  // Rebuild the guest via a host reload; session authority is always re-established by the bridge.
  await page.reload();await a.locator("#content").filter({hasText:"END_OF_LONG_INPUT"}).waitFor();
  await a.locator("#back").click();assert.equal(await a.locator("#element-search").inputValue(),"END_OF_LONG_INPUT");checks.push("guest reconstruction restores selection, content offset and search");
  await page.request.get("http://127.0.0.1:4174/append?session=sess_A&bulk=1");await a.locator("#refresh").click();await a.locator("#latest").click();
  await a.locator("#element-search").fill("SEARCH_BEYOND_FIRST_PAGE");await a.locator('.element-row[data-element="message:88"]').waitFor();
  await a.locator('.element-row[data-element="message:88"]').click();await a.locator("#content").filter({hasText:"SEARCH_BEYOND_FIRST_PAGE"}).waitFor();
  await a.locator("#back").click();checks.push("search beyond the first 40 elements");
  await a.locator("#search-scope").selectOption("loaded");await a.locator("#element-search").fill("fixture_1");
  await a.locator(".element-row").filter({hasText:"Recorded input"}).first().click();await a.locator("#content").filter({hasText:"fixture_1"}).waitFor();
  await a.locator("#back").click();assert.equal(await a.locator("#snapshot").inputValue(),keys[0]);
  await a.locator("#search-scope").selectOption("selected");await a.locator("#element-search").fill("");checks.push("bounded cross-snapshot search selects the content snapshot");
  await page.request.get("http://127.0.0.1:4174/event?session=sess_A");await page.request.get("http://127.0.0.1:4174/append?session=sess_A&gap=1");
  await a.locator("#refresh").click();await a.locator("#latest").click();await a.locator("#tab-changes").click();
  await a.locator("#diff-status").filter({hasText:"快照之间有记录缺口"}).waitFor();checks.push("history gap suppresses deletion and negative Delta");
  await a.locator("#tab-events").click();await a.locator(".event").filter({hasText:"自动压缩"}).waitFor();
  await a.locator(".event button").filter({hasText:"此前记录"}).click();await a.locator("#follow-state").filter({hasText:"已固定"}).waitFor();
  checks.push("readable logged compaction with evidence-labelled before/after navigation");
  for(const width of [320,360,420,520]) {
    await page.setViewportSize({width:width*2+24,height:1100});await page.locator("iframe").evaluateAll((frames,width)=>frames.forEach(x=>x.style.width=width+"px"),width);
    for(const tab of ["composition","changes","events"]) {
      await a.locator("#tab-"+tab).click();
      for(const frame of page.frames().slice(1))assert.ok(await frame.locator("body").evaluate(body=>body.scrollWidth<=body.clientWidth+1),tab+" overflow at "+width);
    }
  }
  await a.locator("#tab-composition").click();await a.locator("#layout").selectOption("browse");await a.locator(".fold-trend summary").click();
  await a.locator("#refresh").click();assert.equal(await a.locator(".fold-trend").getAttribute("open"),"");
  await a.locator("#trend-delta").click();await a.locator("#trend button").first().click();
  checks.push("all diagnostic tabs fit four widths; browsing preference and chart selection work");
  await b.locator("#show-usage").click();assert.equal(await b.locator("#calls").textContent(),"2");
  assert.deepEqual(errors,[]);
  await writeFile(new URL("result.json",out),JSON.stringify({passed:true,browser:await browser.version(),hostType:"SDK fixture, not ZCode Desktop",checks,pageErrors:errors},null,2)+"\n");
  console.log("Browser passed: "+checks.length+" interaction groups.");
}catch(error){console.error(error);await writeFile(new URL("failure.json",out),JSON.stringify({passed:false,checks,error:String(error),errors},null,2));throw error;}
finally{await browser.close();}
