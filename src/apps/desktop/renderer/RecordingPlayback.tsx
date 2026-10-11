import { useEffect,useRef,useState } from 'react';
import { Terminal } from '@xterm/xterm';
import type { TerminalRecording } from '../../../packages/contracts/terminal-recording';
import { useTerminalPreferences,terminalThemes,terminalFonts } from './terminal-preferences';
import { t } from './i18n';

export function RecordingPlayback({recording,close}:{recording:TerminalRecording;close:()=>void}){
 const element=useRef<HTMLDivElement>(null),seek=useRef<(time:number,reset?:boolean)=>void>(()=>{});
 const [time,setTime]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1);
 const position=useRef(0);
 useEffect(()=>{
  const prefs=useTerminalPreferences.getState().value;
  const term=new Terminal({cols:recording.header.cols,rows:recording.header.rows,disableStdin:true,cursorBlink:false,fontSize:prefs.fontSize,fontFamily:terminalFonts[prefs.font],theme:terminalThemes[prefs.theme],scrollback:prefs.scrollback,allowProposedApi:false});
  term.open(element.current!);
  // No input listener, remote connection, clipboard handler or URL opener is installed.
  let disposed=false,index=0,epoch=0,appliedEpoch=0,target=0,pumping=false;
  const pump=async()=>{
   if(pumping)return;pumping=true;
   try{while(!disposed){
    if(epoch!==appliedEpoch){term.reset();term.resize(recording.header.cols,recording.header.rows);index=0;appliedEpoch=epoch;}
    const frame=recording.frames[index];if(!frame||frame[0]>target)break;
    index++;
    if(frame[1]==='r')term.resize(frame[2],frame[3]);
    else await new Promise<void>(resolve=>term.write(Uint8Array.from(atob(frame[2]),c=>c.charCodeAt(0)),resolve));
    if(index%32===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
   }}finally{pumping=false;}
  };
  seek.current=(next,reset=false)=>{target=next;if(reset)epoch++;void pump();};seek.current(0);
  return()=>{disposed=true;seek.current=()=>{};term.dispose();};
 },[recording]);
 useEffect(()=>{
  if(!playing)return;let previous=performance.now();
  const timer=setInterval(()=>{const now=performance.now(),next=Math.min(recording.duration,position.current+(now-previous)*speed);previous=now;position.current=next;setTime(next);seek.current(next);if(next>=recording.duration)setPlaying(false);},40);
  return()=>clearInterval(timer);
 },[playing,speed,recording]);
 function jump(next:number){position.current=next;setTime(next);seek.current(next,true);}
 const seconds=(value:number)=>(value/1000).toFixed(1)+'s';
 return <div className="modal-backdrop"><section className="modal recording-dialog" role="dialog" aria-modal="true" aria-label={t('日志回放')}>
  <div className="modal-heading"><h2>{t('日志回放')} · {recording.name}</h2><button onClick={close} aria-label={t('关闭回放')}>×</button></div>
  <p className="muted">{t('离线回放，仅显示录制输出，不向任何终端发送命令。')}</p>
  <div className="recording-screen" ref={element}/>
  <div className="recording-controls"><button disabled={!recording.frames.length} onClick={()=>{if(!playing&&time>=recording.duration)jump(0);setPlaying(!playing);}}>{playing?t('暂停回放'):t('播放')}</button><button onClick={()=>{setPlaying(false);jump(0);}}>{t('回到开头')}</button><input type="range" aria-label={t('回放进度')} min={0} max={Math.max(1,recording.duration)} step={1} value={time} onChange={e=>jump(Number(e.target.value))}/><span>{seconds(time)} / {seconds(recording.duration)}</span><select aria-label={t('回放速度')} value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.25,.5,1,2,4,8].map(v=><option key={v} value={v}>{v}×</option>)}</select></div>
 </section></div>;
}
