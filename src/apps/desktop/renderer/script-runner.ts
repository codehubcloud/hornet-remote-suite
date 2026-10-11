import { terminalScriptSchema,type TerminalScript } from '../../../packages/contracts/terminal-script';
import { TerminalText } from '../../../packages/core/terminal-text';

export type ScriptProgress={state:'running'|'completed'|'cancelled'|'failed';step:number;total:number;error?:string};
type Run={controller:AbortController;text:TerminalText;buffer:string;wake?:()=>void};

// One run per physical terminal, with bounded output and no executable JS/eval.
// Matching consumes output in stream order, including replies arriving during send.
export class ScriptRunner {
 private current?:Run;
 private closed=false;
 get running(){return !!this.current;}
 constructor(private send:(text:string,signal:AbortSignal)=>Promise<void>){}
 feed(data:Uint8Array){const run=this.current;if(!run)return;run.buffer+=run.text.write(data);if(run.buffer.length>131072){run.controller.abort(new Error('SCRIPT_OUTPUT_LIMIT'));return;}run.wake?.();}
 cancel(){this.current?.controller.abort(new Error('SCRIPT_CANCELLED'));}
 close(){this.closed=true;this.cancel();}
 async run(value:TerminalScript,progress:(value:ScriptProgress)=>void):Promise<ScriptProgress>{
  if(this.closed)throw new Error('SCRIPT_CLOSED');
  if(this.current)throw new Error('SCRIPT_BUSY');
  const script=terminalScriptSchema.parse(value),run:Run={controller:new AbortController(),text:new TerminalText(),buffer:''};
  this.current=run;const signal=run.controller.signal;
  const totalTimer=setTimeout(()=>run.controller.abort(new Error('SCRIPT_DEADLINE')),30*60*1000);
  let step=0;
  try{
   for(const item of script.steps){
    signal.throwIfAborted();progress({state:'running',step:++step,total:script.steps.length});
    if(item.kind==='send')await this.sendStep(item.text.replace(/\r\n|\n/g,'\r')+(item.enter?'\r':''),signal);
    else if(item.kind==='delay')await this.wait(run,item.ms);
    else await this.wait(run,item.timeoutMs,item.text);
   }
   signal.throwIfAborted();
   const result:ScriptProgress={state:'completed',step,total:script.steps.length};progress(result);return result;
  }catch(error){
   const message=error instanceof Error?error.message:String(error),result:ScriptProgress={state:message==='SCRIPT_CANCELLED'?'cancelled':'failed',step,total:script.steps.length,error:message};progress(result);return result;
  }finally{clearTimeout(totalTimer);if(this.current===run)this.current=undefined;}
 }
 private sendStep(text:string,signal:AbortSignal):Promise<void>{
  return new Promise((resolve,reject)=>{
   const abort=()=>reject(signal.reason);
   signal.addEventListener('abort',abort,{once:true});
   if(signal.aborted){signal.removeEventListener('abort',abort);abort();return;}
   Promise.resolve().then(()=>{signal.throwIfAborted();return this.send(text,signal);}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
 }
 private wait(run:Run,ms:number,match?:string):Promise<void>{
  return new Promise((resolve,reject)=>{
   const signal=run.controller.signal;
   let timer:ReturnType<typeof setTimeout>;
   const finish=(error?:unknown)=>{clearTimeout(timer);signal.removeEventListener('abort',aborted);run.wake=undefined;error?reject(error):resolve();};
   const check=()=>{if(match===undefined)return;const index=run.buffer.indexOf(match);if(index>=0){run.buffer=run.buffer.slice(index+match.length);finish();}};
   const aborted=()=>finish(signal.reason);
   timer=setTimeout(()=>finish(match===undefined?undefined:new Error('SCRIPT_TIMEOUT')),ms);
   run.wake=check;signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();else check();
  });
 }
}

const runners=new Map<string,ScriptRunner>();
export function registerScriptRunner(id:string,runner:ScriptRunner){runners.set(id,runner);return()=>{runner.close();if(runners.get(id)===runner)runners.delete(id);};}
export function getScriptRunner(id:string){return runners.get(id);}
