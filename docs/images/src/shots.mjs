// README raw screenshots from the README fixture.
//   node docs/images/src/shots.mjs <playwright index.mjs> <out dir> [zh|en] [light|dark] [full|partial]
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const out = process.argv[3], lang = process.argv[4] ?? "zh", theme = process.argv[5] ?? "light", mode = process.argv[6] ?? "full";
const suffix = (lang === "en" ? ".en" : "") + (theme === "dark" ? ".dark" : "");
mkdirSync(out, { recursive: true });
const name = base => `${out}/${base}${suffix}.png`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 2500 }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:${process.env.PORT ?? 4185}/?width=420`);
  if (theme === "dark") await page.click("#dark");
  if (lang === "en") await page.click("#english");
  const frame = page.frameLocator("#sess_A");
  await frame.locator("#summary").waitFor();
  await page.waitForTimeout(1800);
  const box = await page.locator("#sess_A").boundingBox();
  const top = sel => frame.locator(sel).first().evaluate(el => el.getBoundingClientRect().top);
  const bottom = sel => frame.locator(sel).first().evaluate(el => el.getBoundingClientRect().bottom);
  const shot = (file, y, height) => page.screenshot({ path: name(file), clip: { x: box.x, y: box.y + y, width: 420, height } });
  const settle = () => page.waitForTimeout(500);
  if (mode === "partial") {
    await frame.locator("#partial-hint").waitFor();
    await shot("sidebar-partial", 0, Math.ceil(await bottom(".trend-card")) + 8);
    console.log("partial written"); process.exit(0);
  }
  // Overview: summary, trend with a hover tip, the browser head.
  await frame.locator('.legend-item[data-role="tool"]').dispatchEvent("mouseenter");
  await frame.locator("#trend-scroll .bar").nth(13).dispatchEvent("mouseenter");
  await settle();
  await shot("sidebar-overview", 0, 760);
  await frame.locator('.legend-item[data-role="tool"]').dispatchEvent("mouseleave");
  await frame.locator(".trend-tip").evaluate(el => el.remove()).catch(() => {});
  // Context events: the whole card at rest.
  const eventsTop = await top("#events");
  await shot("sidebar-events", eventsTop - 10, Math.ceil(await bottom("#events")) - eventsTop + 20);
  // Row positions inside that shot, for the arrows in events-flow.html.
  const rows = await frame.locator("#events .event").evaluateAll((els, origin) => els.map(el => {
    const r = el.querySelector(".event-main").getBoundingClientRect(), box = el.getBoundingClientRect();
    return { kind: el.dataset.kind, label: el.querySelector(".kind").textContent, y: Math.round(r.top + r.height / 2 - origin),
      top: Math.round(box.top - origin), bottom: Math.round(box.bottom - origin) };
  }), eventsTop - 10);
  writeFileSync(`${out}/events-rows${suffix}.json`, JSON.stringify(rows));
  // What a compaction summarized.
  await frame.locator('.event[data-kind="compaction"] .event-toggle').click();
  await frame.locator(".summarized-list").waitFor();
  await settle();
  const compTop = await top('.event[data-kind="compaction"]');
  await shot("sidebar-summarized", compTop + 2, Math.min(640, Math.floor(await bottom('.event[data-kind="compaction"]')) - compTop - 4));
  await frame.locator('.event[data-kind="compaction"] .event-toggle').click();
  // A compaction opens the browser on the step after it, compared with the step before.
  await frame.locator('.event[data-kind="compaction"] .event-main').click();
  await page.waitForTimeout(1200);
  if (await frame.locator("#mode-changes").count()) await frame.locator("#mode-changes").click();
  await frame.locator('.category[data-role="tool"]').waitFor();
  for (const role of ["user", "assistant", "system", "schema"]) if (await frame.locator(`.category[data-role="${role}"].open`).count()) await frame.locator(`.category[data-role="${role}"] .cat-head`).click();
  if (!(await frame.locator('.category[data-role="tool"].open').count())) await frame.locator('.category[data-role="tool"] .cat-head').click();
  await settle();
  const browserTop = await top("#browser");
  await shot("sidebar-changes", browserTop, 640);
  // An injection opens the message that carried it.
  await frame.locator("#latest").click();
  await page.waitForTimeout(800);
  await frame.locator('.event[data-kind="inject"] .event-main', { hasText: "TodoWrite" }).click();
  await page.waitForTimeout(1400);
  const focused = frame.locator(".el.open, .el.focus, .el.on").first();
  const listTop = await top('.category[data-role="system"]');
  const focusEnd = (await focused.count()) ? await focused.evaluate(el => el.getBoundingClientRect().bottom) : listTop + 480;
  await shot("sidebar-event-focus", listTop - 6, Math.ceil(focusEnd - listTop) + 14);
  // Tool card and schemas on the latest step.
  await frame.locator("#latest").click();
  await page.waitForTimeout(800);
  await frame.locator("#mode-all").click();
  for (const role of ["user", "schema", "system", "assistant"]) if (await frame.locator(`.category[data-role="${role}"].open`).count()) await frame.locator(`.category[data-role="${role}"] .cat-head`).click();
  if (!(await frame.locator('.category[data-role="tool"].open').count())) await frame.locator('.category[data-role="tool"] .cat-head').click();
  await frame.locator('.category[data-role="tool"] .el-head').first().click();
  await frame.locator(".tool-card").waitFor();
  await settle();
  const cardTop = await top('.category[data-role="tool"]');
  await shot("sidebar-tool-card", cardTop - 10, 520);
  await frame.locator('.category[data-role="tool"] .cat-head').click();
  await frame.locator('.category[data-role="schema"] .cat-head').click();
  await frame.locator('.category[data-role="schema"] .el').first().waitFor();
  await settle();
  const schemaTop = await top('.category[data-role="schema"]');
  await shot("sidebar-schemas", schemaTop - 10, 400);
  console.log("screenshots written: " + suffix);
} finally { await browser.close(); }
