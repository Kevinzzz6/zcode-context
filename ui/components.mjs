import { palette } from "./i18n.mjs";
export const fmt=n=>n==null?"—":Intl.NumberFormat().format(n);
export const when=n=>n?new Date(n).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"—";
export function node(tag,attrs={},...children) {
  const el=document.createElement(tag);
  for(const [key,value] of Object.entries(attrs)) {
    if(key==="class")el.className=value;
    else if(key.startsWith("on"))el.addEventListener(key.slice(2).toLowerCase(),value);
    else if(key==="style")Object.assign(el.style,value);
    else if(key==="dataset")Object.assign(el.dataset,value);
    else if(value!==undefined&&value!==null)el[key]=value;
  }
  el.append(...children.filter(x=>x!==null&&x!==undefined));return el;
}
export const button=(text,action,attrs={})=>node("button",{type:"button",onclick:action,...attrs},text);
const note=text=>node("p",{class:"muted"},text);
const total=s=>s?.composition?.buckets.reduce((n,x)=>n+x.estimatedTokens,0)??0;
export function snapshotControls(ctx) {
  const {t,view,items,selected,actions:a}=ctx,index=items.findIndex(x=>x.key===view.selectedKey);
  const select=node("select",{id:"snapshot",value:view.selectedKey??"",onchange:e=>a.select(e.target.value)});
  for(const [i,x] of items.entries())select.append(node("option",{value:x.key,selected:x.key===view.selectedKey},`R${i+1} · ${when(x.startedAt)} · ${x.querySource} #${x.attempt}`));
  return node("section",{class:"snapshot-controls"},node("div",{class:"controls"},
    button("‹",()=>a.select(items[index-1]?.key),{id:"snapshot-previous",disabled:index<=0,ariaLabel:t("previous")}),select,
    button("›",()=>a.select(items[index+1]?.key),{id:"snapshot-next",disabled:index<0||index>=items.length-1,ariaLabel:t("next")})),
    node("div",{class:"row-head"},node("span",{id:"follow-state",class:"muted"},t(view.follow?"following":"pinned")),
      button((!view.follow&&items.at(-1)?.key!==view.selectedKey?t("newRequests")+" · ":"")+t("latest"),a.latest,{id:"latest",disabled:view.follow})),
    selected?node("div",{class:"overview-number"},node("span",{},t("estimate")),node("strong",{id:"selected-total"},fmt(total(selected))),
      node("span",{id:"selected-delta",class:"muted"},selected.delta?`Δ ${selected.delta.chars>=0?"+":""}${fmt(selected.delta.chars)} ${t("chars")}`:t("noDiff")+" · "+t(selected.deltaReason??"no_previous_snapshot")),
      note(selected.complete?selected.model?.modelId??"":t("partial")),
      note(`Provider IN ${fmt(selected.usage?.inputTokens)} / OUT ${fmt(selected.usage?.outputTokens)} · Cache ${fmt(selected.usage?.cacheReadTokens)}`)):note(t("empty")));
}
export function trend(ctx) {
  const {t,view,items,actions:a}=ctx;
  const end=Math.max(0,items.length-view.trendPage*10),window=items.slice(Math.max(0,end-10),end);
  const scale=Math.max(1,...window.map(s=>view.trend==="total"?total(s):Math.max(
    s.delta?.categories.filter(x=>x.charsDelta>0).reduce((n,x)=>n+x.charsDelta,0)??0,
    -(s.delta?.categories.filter(x=>x.charsDelta<0).reduce((n,x)=>n+x.charsDelta,0)??0))));
  const chart=node("div",{class:"trend",id:"trend",role:"group",ariaLabel:t("estimate")});
  for(const s of window) {
    const delta=view.trend==="delta",bar=button("",()=>a.select(s.key),{class:"trend-column"+(s.key===view.selectedKey?" selected":""),title:`${s.requestId} · ${fmt(total(s))}`,dataset:{key:s.key},ariaLabel:`${when(s.startedAt)} ${fmt(total(s))}`});
    bar.setAttribute("aria-pressed",String(s.key===view.selectedKey));
    const nearby=ctx.overview.events?.filter(e=>[e.navigation?.beforeKey,e.navigation?.afterKey].includes(s.key))??[];
    if(nearby.length){bar.classList.add("event-range");bar.title+=" · "+t("timeRange");bar.append(node("span",{class:"event-marker",title:t("timeRange")},"◇"));}
    const positive=node("div",{class:delta?"stack-column positive":"stack-column"}),negative=node("div",{class:"stack-column negative"});
    if(delta&&!s.delta)positive.append(node("span",{class:"missing"},"?"));
    for(const x of delta?s.delta?.categories??[]:s.composition?.buckets??[]) {
      const value=delta?x.charsDelta:x.estimatedTokens;
      const seg=node("span",{class:"trend-segment",style:{height:Math.abs(value)/scale*(delta?47:94)+"px",background:palette[x.role]??palette.unknown},title:t(x.role)+" "+fmt(value)});
      (value<0?negative:positive).append(seg);
    }
    bar.append(positive);if(delta)bar.append(negative);
    bar.append(node("small",{},when(s.startedAt).slice(0,5)));chart.append(bar);
  }
  const legend=node("div",{class:"color-legend"});for(const role of Object.keys(palette).filter(x=>x!=="unknown"))legend.append(node("span",{},node("i",{style:{background:palette[role]}}),t(role)));
  if(ctx.overview.events?.length)legend.append(node("span",{},"◇ "+t("timeRange")));
  const body=node("section",{class:"trend-section"},node("div",{class:"row-head"},note(t("trendNote")),node("div",{class:"controls"},
    ...["total","delta"].map(mode=>button(t(mode),()=>a.set({trend:mode}),{class:view.trend===mode?"active":"",id:"trend-"+mode})))),
    node("div",{class:"axis"},fmt(scale)+(view.trend==="total"?" est. tokens":" chars")),chart,legend,
    node("div",{class:"controls"},button(t("older"),()=>a.olderTrend(),{id:"older",disabled:!ctx.hasOlder&&end<=10}),
    button(t("newer"),()=>a.set({trendPage:Math.max(0,view.trendPage-1)}),{disabled:view.trendPage===0})));
  if(view.layout==="browse")return node("details",{class:"fold-trend",open:view.trendOpen,ontoggle:e=>a.remember({trendOpen:e.target.open})},node("summary",{},t("total")+" / Delta"),body);
  return body;
}
export function compositionView(ctx) {
  const {t,view,detail:d,actions:a}=ctx;if(!d)return note(t("loading")+" · "+t("hostPermission"));
  const search=node("input",{id:"element-search",type:"search",placeholder:t("search"),value:view.search,maxLength:200,oninput:e=>a.search(e.target.value)});
  const sort=node("select",{id:"sort",onchange:e=>a.set({sort:e.target.value,page:0},true)});
  for(const key of ["size","order"])sort.append(node("option",{value:key,selected:key===view.sort},t(key)));
  const scope=node("select",{id:"search-scope",onchange:e=>a.set({searchScope:e.target.value,page:0},true)},
    node("option",{value:"selected",selected:view.searchScope==="selected"},t("selectedScope")),
    node("option",{value:"loaded",selected:view.searchScope==="loaded"},t("loadedScope")));
  const container=node("section",{},node("div",{class:"search-controls"},search,sort),scope,
    note(`${t("range")} · ${fmt(d.filteredCount)} / ${fmt(d.elementCount)}`));
  if(!d.composition.complete)container.append(note(t("partial")+" · "+(d.summary.incompleteReason??"")));
  if(!d.composition.schemasRecorded)container.append(note(t("schemasUnknown")));
  if(d.searchScope==="all_loaded_snapshots") {
    container.append(note(t("loadedRange")+" · "+d.loadedSnapshotCount+" snapshots · "+d.filteredCount+" matches"));
    for(const item of d.elements)container.append(node("div",{},note(when(item.snapshotTime)+" · "+t(item.role)),elementRow(item,()=>a.openSearch(item),ctx)));
    container.append(node("div",{class:"pager"},button(t("previous"),()=>a.set({page:view.page-1},true),{disabled:view.page===0}),button(t("next"),()=>a.set({page:view.page+1},true),{disabled:(view.page+1)*40>=d.filteredCount})));
    return container;
  }
  const buckets=[...d.composition.buckets].sort((a,b)=>b.chars-a.chars),sum=buckets.reduce((n,x)=>n+x.chars,0);
  for(const bucket of buckets) {
    const expanded=view.expanded.includes(bucket.role),group=node("section",{class:"category",dataset:{role:bucket.role}});
    const head=button("",()=>a.expand(bucket.role),{class:"category-head",ariaExpanded:expanded});
    head.append(node("span",{class:"category-name"},node("i",{style:{background:palette[bucket.role]??palette.unknown}}),t(bucket.role),` · ${bucket.count}`),
      node("span",{class:"numbers"},fmt(bucket.estimatedTokens)+" est. · "+Math.round(bucket.chars/Math.max(1,sum)*100)+"% "+(expanded?"▾":"▸")));
    group.append(head);
    if(expanded) {
      const rows=d.elements.filter(x=>x.role===bucket.role);
      for(const item of rows)group.append(elementRow(item,()=>a.open(item),ctx));
      if(!rows.length)group.append(note(t("noResults")));
    }
    container.append(group);
  }
  if(d.elements.length)container.append(button(t("large"),()=>a.open(d.largest??[...d.elements].sort((a,b)=>b.chars-a.chars)[0]),{id:"open-largest"}));
  container.append(node("div",{class:"pager"},button(t("previous"),()=>a.set({page:view.page-1},true),{disabled:view.page===0}),
    node("span",{class:"muted"},`${view.page+1} / ${Math.max(1,Math.ceil(d.filteredCount/40))}`),
    button(t("next"),()=>a.set({page:view.page+1},true),{id:"elements-next",disabled:(view.page+1)*40>=d.filteredCount})));
  return container;
}
export function elementRow(item,action,{t}) {
  const row=button("",action,{class:"element-row",dataset:{element:item.key}});
  row.append(
    node("div",{class:"row-head"},node("b",{},item.toolName??item.preview.slice(0,65)??item.key),node("span",{class:"numbers"},fmt(item.estimatedTokens)+" est.")),
    node("small",{class:"muted"},item.preview));
  return row;
}
export function changesView(ctx) {
  const {t,view,detail:d,actions:a}=ctx;if(!d)return note(t("loading")+" · "+t("hostPermission"));const diff=d.diff;
  const baseline=node("select",{id:"baseline",onchange:e=>a.set({baselineKey:e.target.value||null,changePage:0},true)},node("option",{value:""},t("auto")));
  for(const item of d.baselineOptions)baseline.append(node("option",{value:item.key,selected:item.key===view.baselineKey},when(item.startedAt)+(item.complete?"":" · "+t("partial"))));
  const container=node("section",{},node("label",{},t("baseline"),baseline),note(t("observed")));
  if(!diff.available){container.append(node("p",{class:"notice",id:"diff-status"},t("noDiff")+" · "+t(diff.reason)));return container;}
  container.append(node("p",{id:"diff-status",class:"notice"},`Δ ${diff.charsDelta>=0?"+":""}${fmt(diff.charsDelta)} ${t("chars")} · +${diff.addedCount} / −${diff.removedCount}`),
    note(t("baseline")+": "+when(d.baselineOptions.find(x=>x.key===diff.previousKey)?.startedAt)));
  if(!diff.schemasComparable)container.append(note(t("schemasUnknown")));
  if(diff.modelChanged)container.append(note(t("modelChanged")));if(diff.reordered)container.append(note(t("reordered")));
  for(const c of diff.categories)container.append(node("div",{class:"row-head category-delta"},node("span",{},t(c.role)),
    node("span",{class:"numbers"},`${c.charsDelta>=0?"+":""}${fmt(c.charsDelta)} · +${c.addedCount} / −${c.removedCount}`)));
  for(const change of diff.changed??[])container.append(button(t("bodyDiff")+" · "+(change.after.toolName??change.after.key),()=>a.open(change.after,{diffBeforeElement:change.before.key}),{class:"diff-open"}));
  for(const [kind,key,items] of [["added",view.selectedKey,diff.added],["removed",diff.previousKey,diff.removed]]) {
    container.append(node("h2",{},t(kind)));
    for(const item of items)container.append(node("div",{class:"change-row",dataset:{kind}},elementRow(item,()=>a.open(item,{key}),ctx)));
  }
  container.append(node("div",{class:"pager"},button(t("previous"),()=>a.set({changePage:view.changePage-1},true),{disabled:!view.changePage}),
    button(t("next"),()=>a.set({changePage:view.changePage+1},true),{disabled:(view.changePage+1)*40>=Math.max(diff.addedCount,diff.removedCount,diff.changedCount)})));
  return container;
}
export function eventsView(ctx) {
  const {t,overview:o,view,actions:a}=ctx;
  const container=node("section",{},note(t("eventNote")));
  for(const event of o.events??[]) {
    const kind=event.event.includes(".micro")?"microCompact":event.event.includes(".auto")?"autoCompact":event.event.includes(".reactive")?"reactiveCompact":"manualCompact";
    const status=event.event.split(".").at(-1),nav=event.navigation??{};
    const row=node("article",{class:"event"},node("b",{},t(kind)+" · "+t(status)),note(when(event.timestamp)+" · "+(event.turnId??t("unknown"))),
      note(t("reason")+": "+(event.reason??t("noCause"))),note(t(nav.evidence==="turn_range"?"turnRange":"timeRange")));
    if(event.tokensSavedEstimate!=null)row.append(note(t("saved")+": "+fmt(event.tokensSavedEstimate)));
    if(event.clearedMessageCount!=null)row.append(note(t("cleared")+": "+fmt(event.clearedMessageCount)));
    row.append(node("div",{class:"controls"},button(t("before"),()=>a.select(nav.beforeKey),{disabled:!nav.beforeKey}),
      button(t("after"),()=>a.select(nav.afterKey),{disabled:!nav.afterKey})));
    for(const key of nav.turnKeys??[])row.append(button(t("turnRange")+" · "+key.slice(0,8),()=>a.select(key),{class:key===view.selectedKey?"active":""}));
    container.append(row);
  }
  if(!o.events?.length)container.append(note(t("noEvents")));return container;
}
export function markdown(text) {
  const fragment=document.createDocumentFragment();let code=false;
  for(const line of text.split("\n")) {
    if(line.startsWith("```")){code=!code;continue;}
    const match=!code&&line.match(/^(#{1,3})\s+(.*)$/);
    fragment.append(node(code?"pre":match?"h"+(Number(match[1].length)+1):"p",{},match?match[2]:line||" "));
  }
  return fragment;
}
export function contentView(ctx) {
  const {t,view,contentData:d,actions:a}=ctx,pointer=view.detail;
  const container=node("section",{id:"content-view"},button("‹ "+t("back"),a.back,{id:"back"}));
  if(!d?.content){container.append(note(t("loading")+" · "+t("hostPermission")));return container;}
  const c=d.content,diff=d.bodyDiff,text=diff?.text??c.text,offset=diff?.offset??c.offset,totalChars=diff?.totalChars??c.totalChars;
  container.append(node("h2",{},diff?t("bodyDiff"):t(c.role)+" · "+(c.toolName??c.preview.slice(0,80))),
    note(t("origin")+": "+when(d.summary.startedAt)+" · "+d.summary.requestId),
    note(`${fmt(c.lineCount)} ${t("line")} · ${fmt(totalChars)} ${t("chars")} · ${offset}–${offset+text.length}`));
  if(diff)container.append(note(t("baseline")+": "+diff.beforeKey.slice(0,8)+" → "+diff.afterKey.slice(0,8)),note(t("diffMethod")));
  if(c.role==="tool") {
    container.append(note(t("status")+": "+(c.status??t("unknown"))));
    if(c.tool){container.append(node("h3",{},(c.tool.name??c.toolName??"")+" · "+t("params")),node("pre",{},c.tool.arguments+(c.tool.argumentsTruncated?"…":"")));}
    else container.append(note(t("noParams")));
  }
  const controls=node("div",{class:"controls"},button(t("copy"),()=>a.copy(text),{id:"copy"}));
  if(!diff)for(const format of ["readable","markdown","raw"])controls.append(button(t(format),()=>a.contentFormat(format),{id:"format-"+format,class:pointer.format===format?"active":""}));
  container.append(controls);
  if(!diff) {
    container.append(node("input",{id:"body-search",type:"search",value:pointer.search??"",placeholder:t("bodySearch"),maxLength:200,oninput:e=>a.bodySearch(e.target.value)}),
      node("div",{class:"row-head"},note(`${fmt(c.matchCount)} ${t("match")}${c.matchCount>100?" · "+t("first100"):""} · ${t("chunk")}`),
        button(t("next")+" "+t("match"),a.nextMatch,{id:"next-match",disabled:!c.hits.length})));
  }
  const body=node(pointer.format==="markdown"&&!diff?"article":"pre",{id:"content",tabIndex:0,class:diff?"body-diff":"body-text"});
  if(diff)for(const line of text.split("\n"))body.append(node("div",{class:line.startsWith("+ ")?"added":line.startsWith("- ")?"removed":""},line));
  else if(pointer.format==="markdown")body.append(markdown(text));
  else if(pointer.search) {
    const query=pointer.search.toLowerCase(),lower=text.toLowerCase();let start=0,at;
    while((at=lower.indexOf(query,start))>=0){body.append(text.slice(start,at),node("mark",{},text.slice(at,at+query.length)));start=at+query.length;}
    body.append(text.slice(start));
  }else body.textContent=text;
  container.append(body,node("div",{class:"pager"},button(t("previous"),()=>a.chunk(Math.max(0,offset-12000)),{id:"chunk-previous",disabled:offset===0}),
    button(t("more"),()=>a.chunk(offset+12000),{id:"more",disabled:!(diff?.hasMore??c.hasMore)})));
  container.append(node("details",{},node("summary",{},t("recordInfo")),node("pre",{},`key: ${pointer.key}\nelement: ${c.key}\ntoolCallId: ${c.toolCallId??t("unknown")}\nsource: ${d.summary.querySource}`)));
  return container;
}
export function usageView(ctx) {
  const {t,overview:o,actions:a}=ctx,u=o.usage,totals=u?.totals??{};
  const container=node("section",{id:"usage-view"},button("‹ "+t("back"),()=>a.set({usage:false}),{id:"usage-back"}),node("h2",{},t("usage")),note(t("usageNote")));
  if(!u?.available){container.append(note(t("unknown")));return container;}
  const metrics=node("div",{class:"metrics"});
  for(const [id,key,value] of [["input","input",fmt(totals.inputTokens)],["output","output",fmt(totals.outputTokens)],["calls","calls",fmt(totals.requestCount)],["cache","cache",totals.cacheHitRate==null?"—":Math.round(totals.cacheHitRate*100)+"%"]])metrics.append(node("div",{},node("span",{},t(key)),node("strong",{id},value)));
  container.append(metrics);if(totals.inputMissingCount||totals.outputMissingCount||totals.missingUsageCount)container.append(note(t("partUsage")));
  container.append(node("h2",{},t("daily")));const daily=node("div",{id:"daily"});
  for(const day of u.days??[])daily.append(node("div",{class:"row-head"},node("span",{},day.utcDay),node("span",{class:"numbers"},`IN ${fmt(day.inputTokens)} / OUT ${fmt(day.outputTokens)}`)));
  container.append(daily);
  for(const fact of u.facts??[])container.append(node("div",{class:"usage-fact"},node("b",{},fact.modelId??t("unknown")),note(`${when(fact.startedAt)} · ${fact.querySource} · ${fact.status}`),note(`IN ${fmt(fact.inputTokens)} / OUT ${fmt(fact.outputTokens)} · ${fmt(fact.durationMs)} ms`)));
  return container;
}
