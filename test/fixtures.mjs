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
  return {path,db,add(sessionId,id,input=100,output=10,time=Date.now(),raw={inputTokens:input,outputTokens:output},source="main_turn"){
    statement.run(id,id,sessionId,"turn_"+id,"trace_"+id,source,"demo","demo-model","completed",time,1000,200,
      input,output,3,0,Math.floor(input*.5),raw===null?null:input+output,input+output,0,raw===null?null:JSON.stringify(raw));
  }};
}
export function modelRecord(sessionId,requestId,messages,extra={}) {
  return {type:"model_io",sessionId,requestId,attempt:1,querySource:"main_turn",startedAt:new Date().toISOString(),
    model:{providerId:"demo",modelId:"demo-model"},request:{messages,messagesKind:"full",messageCount:messages.length,toolNames:[]},
    response:{text:"done",usage:{inputTokens:100,outputTokens:10}},...extra};
}
