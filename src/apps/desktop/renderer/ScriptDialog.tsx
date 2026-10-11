import { useEffect,useRef,useState } from 'react';
import { z } from 'zod';
import { terminalScriptSchema,type TerminalScript,type ScriptStep } from '../../../packages/contracts/terminal-script';
import { getScriptRunner,type ScriptProgress } from './script-runner';
import { useStore,type View } from './store';
import { useBroadcast } from './broadcast';
import { t as tr } from './i18n';

const key='hornet.terminal.scripts.v1';
const librarySchema=z.array(terminalScriptSchema).max(30);
const fresh=():TerminalScript=>({version:1,name:'',steps:[{kind:'send',text:'pwd',enter:true},{kind:'wait',text:'$',timeoutMs:10000}]});
const step=(kind:ScriptStep['kind']):ScriptStep=>kind==='send'?{kind,text:'',enter:true}:kind==='wait'?{kind,text:'',timeoutMs:10000}:{kind,ms:1000};
function read(){try{return librarySchema.parse(JSON.parse(localStorage.getItem(key)??'[]'));}catch{return [];}}
function errorText(message:string){switch(message){case 'SCRIPT_TIMEOUT':return tr('等待输出超时');case 'SCRIPT_CANCELLED':return tr('脚本已停止');case 'SCRIPT_OUTPUT_LIMIT':return tr('脚本输出缓冲区超过 128 KiB');case 'SCRIPT_DEADLINE':return tr('脚本超过 30 分钟时限');case 'SCRIPT_CLOSED':return tr('目标终端已关闭');case 'SCRIPT_BUSY':return tr('目标终端正在运行脚本');default:return message;}}
export function ScriptDialog({view,close}:{view:View;close:()=>void}){
 const [library,setLibrary]=useState(read),[value,setValue]=useState(fresh),[savedName,setSavedName]=useState('');
 const [progress,setProgress]=useState<ScriptProgress|null>(null),[error,setError]=useState(''),mounted=useRef(true);
 const running=progress?.state==='running',closed=useStore(s=>!!s.closedTerminals[view.terminalId??'']);
 const ownRunner=useRef<ReturnType<typeof getScriptRunner>>(undefined);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;ownRunner.current?.cancel();};},[]);
 const update=(index:number,next:ScriptStep)=>setValue(v=>({...v,steps:v.steps.map((s,i)=>i===index?next:s)}));
 function persist(next:TerminalScript[]){const parsed=librarySchema.parse(next),json=JSON.stringify(parsed);if(json.length>1048576)throw new Error(tr('脚本库超过 1 MiB'));localStorage.setItem(key,json);setLibrary(parsed);}
 function save(){try{const parsed=terminalScriptSchema.parse(value);if(parsed.name!==savedName&&library.some(s=>s.name===parsed.name))throw new Error(tr('脚本名称已存在'));persist([...library.filter(s=>s.name!==savedName),parsed]);setSavedName(parsed.name);setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}}
 async function run(){setError('');try{
  const parsed=terminalScriptSchema.parse(value),runner=getScriptRunner(view.terminalId!);if(!runner||closed)throw new Error('SCRIPT_CLOSED');
  useBroadcast.getState().remove(view.terminalId!);ownRunner.current=runner;
  await runner.run(parsed,p=>{if(mounted.current)setProgress(p);});
 }catch(e){setError(errorText(e instanceof Error?e.message:String(e)));}}
 function finish(){ownRunner.current?.cancel();close();}
 return <div className="modal-backdrop"><section className="modal script-dialog" role="dialog" aria-modal="true" aria-label={tr('脚本管理器')}>
  <h2>{tr('脚本管理器')}</h2><p>{tr('发送到：')}{view.title??view.profile.name}</p>
  <p className="muted">{tr('按顺序发送文本、等待输出或延时。运行时暂停此终端的键盘和广播输入；停止不会撤销已发送的命令。脚本明文保存在本机，请勿保存密码。')}</p>
  <fieldset disabled={running}>
   <div className="script-toolbar"><select aria-label={tr('已保存脚本')} value={savedName} onChange={e=>{setSavedName(e.target.value);setValue(library.find(s=>s.name===e.target.value)??fresh());setProgress(null);setError('');}}><option value="">{tr('新建脚本')}</option>{library.map(s=><option key={s.name}>{s.name}</option>)}</select><input aria-label={tr('脚本名称')} placeholder={tr('脚本名称')} value={value.name} maxLength={80} onChange={e=>setValue({...value,name:e.target.value})}/><button onClick={save}>{tr('保存')}</button><button disabled={!savedName} onClick={()=>{try{persist(library.filter(s=>s.name!==savedName));setSavedName('');setValue(fresh());}catch(e){setError(String(e));}}}>{tr('删除')}</button></div>
   <div className="script-steps">{value.steps.map((item,index)=><div className="script-step" key={index}>
    <span>{index+1}</span><select aria-label={tr('步骤类型')} value={item.kind} onChange={e=>update(index,step(e.target.value as ScriptStep['kind']))}><option value="send">{tr('发送文本')}</option><option value="wait">{tr('等待输出')}</option><option value="delay">{tr('延时')}</option></select>
    {item.kind!=='delay'&&<textarea aria-label={tr('步骤文本')} maxLength={8192} value={item.text} onChange={e=>update(index,{...item,text:e.target.value})}/>}
    {item.kind==='send'?<label className="check"><input type="checkbox" checked={item.enter} onChange={e=>update(index,{...item,enter:e.target.checked})}/>{tr('追加回车')}</label>:<label>{item.kind==='wait'?tr('超时（毫秒）'):tr('延时（毫秒）')}<input type="number" aria-label={item.kind==='wait'?tr('超时（毫秒）'):tr('延时（毫秒）')} min={item.kind==='wait'?100:0} max={300000} value={item.kind==='wait'?item.timeoutMs:item.ms} onChange={e=>update(index,item.kind==='wait'?{...item,timeoutMs:Number(e.target.value)}:{...item,ms:Number(e.target.value)})}/></label>}
    <button aria-label={tr('上移步骤')} disabled={!index} onClick={()=>{const steps=[...value.steps];[steps[index-1],steps[index]]=[steps[index],steps[index-1]];setValue({...value,steps});}}>↑</button><button aria-label={tr('删除步骤')} disabled={value.steps.length===1} onClick={()=>setValue({...value,steps:value.steps.filter((_,i)=>i!==index)})}>×</button>
   </div>)}</div>
   <button disabled={value.steps.length>=200} onClick={()=>setValue({...value,steps:[...value.steps,step('send')]})}>{tr('添加步骤')}</button>
  </fieldset>
  <p className="muted">{tr('等待按纯文本匹配，区分大小写并消费已匹配输出；每步最多 5 分钟，总计最多 30 分钟。')}</p>
  {progress&&<p role="status">{progress.state==='running'?tr('正在执行'):progress.state==='completed'?tr('执行完成'):progress.state==='cancelled'?tr('脚本已停止'):tr('执行失败')} · {progress.step}/{progress.total}{progress.state==='failed'?' · '+errorText(progress.error??''):''}</p>}
  {error&&<p role="alert" className="error">{error}</p>}
  <div className="modal-actions"><button onClick={finish}>{tr('关闭')}</button><button disabled={!running} onClick={()=>ownRunner.current?.cancel()}>{tr('停止脚本')}</button><button className="primary" disabled={running||closed} onClick={()=>void run()}>{tr('运行脚本')}</button></div>
 </section></div>;
}
