import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
export function usageDatabase(root) {
  mkdirSync(join(root,"db"),{recursive:true});const path=join(root,"db","db.sqlite");const db=new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;");
  db.exec(`CREATE TABLE model_usage(id TEXT PRIMARY KEY,logical_request_id TEXT,session_id TEXT,turn_id TEXT,trace_id TEXT,
    query_source TEXT,provider_id TEXT,model_id TEXT,status TEXT,started_at INTEGER,duration_ms INTEGER,time_to_first_token_ms INTEGER,
    input_tokens INTEGER,output_tokens INTEGER,reasoning_tokens INTEGER,cache_creation_input_tokens INTEGER,cache_read_input_tokens INTEGER,
    provider_total_tokens INTEGER,computed_total_tokens INTEGER,retry_count INTEGER,raw_usage_json TEXT)`);
  const statement=db.prepare("INSERT INTO model_usage VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  let tools=null;
  return {path,db,add(sessionId,id,input=100,output=10,time=Date.now(),raw={inputTokens:input,outputTokens:output},source="main_turn"){
    statement.run(id,id,sessionId,"turn_"+id,"trace_"+id,source,"demo","demo-model","completed",time,1000,200,
      input,output,3,0,Math.floor(input*.5),raw===null?null:input+output,input+output,0,raw===null?null:JSON.stringify(raw));
  },tool(sessionId,id,name,status="completed",time=Date.now()){
    // The real tool_usage table has more columns; the reader only needs these.
    if(!tools){db.exec("CREATE TABLE tool_usage(id TEXT PRIMARY KEY,session_id TEXT,turn_id TEXT,tool_call_id TEXT,tool_name TEXT,status TEXT,started_at INTEGER,duration_ms INTEGER,exit_code INTEGER,error_type TEXT)");
      tools=db.prepare("INSERT INTO tool_usage VALUES (?,?,?,?,?,?,?,?,?,?)");}
    tools.run(id,sessionId,"turn_"+id,"call_"+id,name,status,time,10,null,status==="error"?"tool_execution_failed":null);
  }};
}
export function modelRecord(sessionId,requestId,messages,extra={}) {
  return {type:"model_io",sessionId,requestId,attempt:1,querySource:"main_turn",startedAt:new Date().toISOString(),
    model:{providerId:"demo",modelId:"demo-model"},request:{messages,messagesKind:"full",messageCount:messages.length,toolNames:[]},
    response:{text:"done",usage:{inputTokens:100,outputTokens:10}},...extra};
}
// ZCode's conversation store: message and part rows whose data is the JSON the reader extracts fields from.
export function conversationStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS message(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,time_created INTEGER NOT NULL,time_updated INTEGER NOT NULL,data TEXT NOT NULL,sequence INTEGER);
    CREATE TABLE IF NOT EXISTS part(id TEXT PRIMARY KEY,message_id TEXT NOT NULL,session_id TEXT NOT NULL,time_created INTEGER NOT NULL,time_updated INTEGER NOT NULL,data TEXT NOT NULL,sequence INTEGER)`);
  const message=db.prepare("INSERT INTO message VALUES (?,?,?,?,?,?)"),part=db.prepare("INSERT INTO part VALUES (?,?,?,?,?,?,?)");
  let sequence=0;
  return {
    message(sessionId,id,time,data){message.run(id,sessionId,time,time,JSON.stringify(data),++sequence);return id;},
    part(sessionId,messageId,id,time,data){part.run(id,messageId,sessionId,time,time,JSON.stringify(data),0);return id;},
    reminder(sessionId,id,time,text,kind="todo_reminder",source="todo_reminder"){
      this.message(sessionId,id,time,{role:"user",synthetic:true,semantics:{origin:"agent_runtime",kind,source,providerVisibility:"visible"}});
      this.part(sessionId,id,id+"_text",time,{type:"text",text,synthetic:true,metadata:{source}});
    },
    prompt(sessionId,id,time,text){
      this.message(sessionId,id,time,{role:"user",semantics:{origin:"real_user",kind:"user_prompt",providerVisibility:"visible"}});
      this.part(sessionId,id,id+"_text",time,{type:"text",text});
    },
    reply(sessionId,id,time,text,tools=[]){
      this.message(sessionId,id,time,{role:"assistant",semantics:{origin:"model",kind:"assistant_response",providerVisibility:"visible"}});
      this.part(sessionId,id,id+"_text",time,{type:"text",text});
      for(const [i,[tool,input,output,callID]] of tools.entries())this.part(sessionId,id,id+"_tool"+i,time,{type:"tool",tool,callID:callID??id+"_call"+i,state:{status:"completed",input,output,time:{start:time,end:time+5}}});
    },
    compaction(sessionId,id,time,{summaryId,lastSummarizedId,pre=90000,post=11000,count=3,trigger="auto"}){
      this.message(sessionId,summaryId,time+50,{role:"user",summary:{title:"Compact summary",body:"Summary body"},semantics:{origin:"agent_runtime",kind:"compact_summary",providerVisibility:"visible"}});
      const boundary={boundaryId:"compact_"+id,trigger,summarizedMessageCount:count,keptMessageCount:0,lastSummarizedMessageId:lastSummarizedId,summaryMessageId:summaryId};
      this.part(sessionId,summaryId,id+"_sep",time,{type:"compaction",trigger,boundaryId:"compact_"+id,operationId:"cmp_"+id,summaryMessageId:summaryId,preCompactTokenCount:pre,truePostCompactTokenCount:post,time:{start:time,end:time+40},timelineStatus:"completed"});
      this.part(sessionId,summaryId,id+"_boundary",time,{type:"compaction",trigger,compactBoundary:boundary});
    },
    modelChange(sessionId,id,time,from,to){
      this.message(sessionId,id,time,{role:"assistant",semantics:{origin:"system",kind:"timeline_event",providerVisibility:"hidden"}});
      this.part(sessionId,id,id+"_timeline",time,{type:"timeline",timelineType:"model_change",time:{start:time,end:time},fromModelSelection:{label:from},toModelSelection:{label:to}});
    },
    // A rewind deletes nothing; ZCode records the active branch on the session row.
    revert(sessionId,revert){
      db.exec("CREATE TABLE IF NOT EXISTS session(id TEXT PRIMARY KEY,revert TEXT)");
      db.prepare("INSERT OR REPLACE INTO session VALUES (?,?)").run(sessionId,JSON.stringify(revert));
    },
    timeline(sessionId,messageId,id,time,data){this.part(sessionId,messageId,id,time,{type:"compaction",time:{start:time},...data});},
    remove(id){db.prepare("DELETE FROM part WHERE message_id=?").run(id);db.prepare("DELETE FROM message WHERE id=?").run(id);}
  };
}
