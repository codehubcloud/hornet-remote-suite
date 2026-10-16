import type { TerminalDisconnect } from '../../../packages/contracts/terminal-disconnect';
import { disconnectTranscript,disconnectText } from './terminal-disconnect';
import { ScriptRunner,registerScriptRunner } from './script-runner';
import { t as tr } from './i18n';
import { useBroadcast } from './broadcast';
import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { SearchAddon } from '@xterm/addon-search';
import { FitAddon } from '@xterm/addon-fit';
import { terminalAction,terminalFonts,terminalThemes,useTerminalPreferences,type TerminalAction } from './terminal-preferences';
import { TerminalContextMenu,type TerminalContextAction } from './TerminalContextMenu';
import { isTerminalClosed,reconnectView,useStore,type View } from './store';
export function TerminalView({view,searchRequested=0}:{view:View;searchRequested?:number}){
 const globalPreferences=useTerminalPreferences(s=>s.value),preferences=useMemo(()=>({...globalPreferences,...view.profile.session?.appearance}),[globalPreferences,view.profile.session?.appearance]),resizeTerminal=useRef<(()=>void)|null>(null);
 const session=useRef(view.profile.session);session.current=view.profile.session;
 const [bell,setBell]=useState(false);
 const [fontSize,setFontSize]=useState(preferences.fontSize),fontSizeRef=useRef(fontSize);fontSizeRef.current=fontSize;
 // A wheel zoom belongs to this view; applying terminal settings resets it.
 useEffect(()=>setFontSize(preferences.fontSize),[preferences.fontSize,preferences.font,preferences.theme,preferences.scrollback,preferences.cursorStyle,preferences.cursorBlink]);
 const element=useRef<HTMLDivElement>(null),searchInput=useRef<HTMLInputElement>(null);
 const search=useRef<SearchAddon|null>(null),terminal=useRef<Terminal|null>(null);
 const inputAvailable=useRef<()=>boolean>(()=>false),closed=useStore(s=>isTerminalClosed(view,s)),reconnecting=useStore(s=>!!s.reconnecting[view.id]);
 const rightClickSelection=useRef<string|undefined>(undefined);
 const [menu,setMenu]=useState<{x:number;y:number;selection:string}|null>(null);
 const closeMenu=useCallback((focus:boolean)=>{setMenu(null);if(focus&&useStore.getState().active===view.id)terminal.current?.focus();},[view.id]);
 const openMenu=(x:number,y:number,selection=terminal.current?.getSelection()??'')=>{useStore.getState().setActive(view.id);useStore.getState().setTerminalMenu(null);setMenu({x,y,selection});};
 const choose=(kind:TerminalContextAction)=>{const selection=menu?.selection;closeMenu(true);if(kind==='search')setSearchOpen(true);else terminalAction({viewId:view.id,terminalId:view.terminalId,kind,...(kind==='copy'?{text:selection}:{})});};
 const [searchOpen,setSearchOpen]=useState(false);
 useEffect(()=>{if(searchRequested)setSearchOpen(true);},[searchRequested]);
 useEffect(()=>{if(searchOpen)searchInput.current?.focus();},[searchOpen,searchRequested]);
 const closeSearch=()=>{setSearchOpen(false);terminal.current?.clearSelection();terminal.current?.focus();};
 const [query,setQuery]=useState(''),[result,setResult]=useState('');
 const find=(previous=false)=>{if(!query){terminal.current?.clearSelection();setResult('');return;}const found=previous?search.current?.findPrevious(query):search.current?.findNext(query);setResult(found?tr("已定位匹配"):tr("未找到匹配"));};
 useEffect(()=>{
  if(!element.current)return;
  const id=view.terminalId??view.id;
  const prefs=preferences;
  const term=new Terminal({disableStdin:!!view.connectionAttempt,cursorBlink:!view.connectionAttempt&&prefs.cursorBlink,cursorStyle:prefs.cursorStyle,fontSize:fontSizeRef.current,fontFamily:terminalFonts[prefs.font],scrollback:prefs.scrollback,theme:terminalThemes[prefs.theme],allowProposedApi:false});
  const fit=new FitAddon();term.loadAddon(fit);term.open(element.current);
  terminal.current=term;const addon=new SearchAddon();term.loadAddon(addon);search.current=addon;
  let bellTimer:ReturnType<typeof setTimeout>|undefined;
  const onBell=term.onBell(()=>{if(session.current?.terminal?.bell==='visual'){setBell(true);clearTimeout(bellTimer);bellTimer=setTimeout(()=>setBell(false),180);}});
  const titleChange=term.onTitleChange(title=>useStore.getState().updateTerminal(view.id,{terminalTitle:title.replace(/[\x00-\x1f\x7f]/g,'').slice(0,255)}));
  term.attachCustomKeyEventHandler(e=>{if(e.ctrlKey&&e.shiftKey&&e.code==='KeyF'){if(e.type==='keydown'){setSearchOpen(true);searchInput.current?.focus();}return false;}return true;});
  let inputSeq=0,ended=!!view.connectionAttempt;
  const runner=new ScriptRunner((text,signal)=>send(text,signal));
  const endTerminal=(detail?:TerminalDisconnect)=>{if(ended)return;ended=true;runner.close();term.options.disableStdin=true;term.options.cursorBlink=false;const state=useStore.getState(),current=state.views.find(v=>v.id===view.id)??view;
   const connection=state.connectionDisconnects[view.connectionId];
   const info=state.terminalDisconnects[id]??detail??(connection?.generation===view.generation?connection:undefined)??{reason:'remote',at:Date.now()};
   // Drain pending host output before inspecting the normal-buffer cursor.
   term.write('\x18\x1b\\',()=>{
    if(terminal.current!==term)return;
    const {cursorX,cursorY}=term.buffer.normal;
    // DECRST 1049 also restores an old saved cursor on a normal screen. Use
    // 47 instead and restore the actual normal-buffer position explicitly.
    const reset='\x1b[?47l\x1b[r\x1b[?6l\x1b[4l\x1b[?7h\x1b[?2026l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b(B\x0f\x1b[0m';
    term.write(reset+'\x1b['+(cursorY+1)+';'+(cursorX+1)+'H'+disconnectTranscript(info,current.title??current.profile.name,view.source),()=>{if(terminal.current===term)term.scrollToBottom();});
   });};
  const stopState=useStore.subscribe(state=>{if(isTerminalClosed(view,state))endTerminal();});
  inputAvailable.current=()=>!ended&&!runner.running;
  const unregister=registerScriptRunner(id,runner);
  const unsubscribe=window.hornet.onEvent(e=>{
   if(e.type==='terminal.data'&&e.terminalId===id&&e.generation===view.generation){
    runner.feed(new Uint8Array(e.data));
    term.write(new Uint8Array(e.data),()=>{if(!ended)window.hornet.terminal.ack(id,e.seq);});
   }
   if(e.type==='terminal.closed'&&e.terminalId===id&&(e.generation===undefined||e.generation===view.generation))endTerminal(e.disconnect);
   if(e.type==='connection.state'&&e.connectionId===view.connectionId&&e.generation===view.generation&&['closed','failed'].includes(e.state))endTerminal(e.disconnect??{reason:e.error?'error':'remote',at:Date.now(),error:e.error});
  });
  let writes:Promise<void>=Promise.resolve();
  // Reflowing or closing a pane can leave an already queued xterm reply. A
  // normal shell exit cancels that input; it must not become a global error.
  const reportInputFailure=(error:unknown)=>{if(!ended)useStore.getState().fail(error);};
  const send=(data:string,signal?:AbortSignal):Promise<void>=>{
   const operation=writes.then(async()=>{
    for(let i=0;i<data.length;){
     signal?.throwIfAborted();if(ended)throw new Error('SCRIPT_CLOSED');
     let end=Math.min(i+4096,data.length);if(end<data.length&&/[\uD800-\uDBFF]/.test(data[end-1]))end--;
     await window.hornet.terminal.send(id,view.generation,inputSeq+1,data.slice(i,end));inputSeq++;i=end;
    }
   });
   writes=operation.catch(()=>{});return operation;
  };
  const input=term.onData(data=>{
   if(ended||runner.running)return;
   if(session.current?.terminal?.backspace==='bs'&&data==='\x7f')data='\x08';
   if(session.current?.terminal?.enter==='crlf'&&data==='\r')data='\r\n';
   void send(data).catch(reportInputFailure);const targets=useBroadcast.getState().targets;
   if(!ended&&targets.some(t=>t.terminalId===id))for(const target of targets)if(target.terminalId!==id)window.dispatchEvent(new CustomEvent<TerminalAction>('hornet:terminal-action',{detail:{viewId:target.viewId,terminalId:target.terminalId,kind:'input',text:data}}));
  });
  const action=(event:Event)=>{const detail=(event as CustomEvent<TerminalAction>).detail;if(detail.viewId!==view.id||detail.terminalId&&detail.terminalId!==id)return;
   if(runner.running&&['input','execute','paste'].includes(detail.kind))return;
   if(detail.kind==='input'&&detail.terminalId===id&&detail.text&&!ended)void send(detail.text).catch(reportInputFailure);
   if(detail.kind==='execute'){if(ended){useStore.getState().fail(new Error(tr("终端已关闭，命令未发送。")));return;}if(detail.text){const text=detail.enter===false?detail.text:detail.text.replace(/[\r\n]+$/,'')+'\r';void send(text.replace(/\r\n|\n/g,'\r')).catch(reportInputFailure);term.focus();}}
   if(detail.kind==='copy'){const text=detail.text??term.getSelection();if(text)void window.hornet.clipboard.write(text).catch(useStore.getState().fail);term.focus();}
   if(detail.kind==='paste'&&!ended)void window.hornet.clipboard.read().then(text=>{if(!ended&&!runner.running&&useStore.getState().active===view.id&&(!/[\r\n]/.test(text)||window.confirm(tr("粘贴多行文本可能执行命令。继续？")))){term.paste(text);term.focus();}}).catch(useStore.getState().fail);
   if(detail.kind==='reset')term.reset();
   if(detail.kind==='selectAll'){term.selectAll();term.focus();}
   if(detail.kind==='clear')term.clear();
   if(detail.kind==='export'){
    const buffer=term.buffer.active,parts:string[]=[];let size=0;
    for(let i=0;i<buffer.length;i++){const line=buffer.getLine(i);if(!line)continue;const text=line.translateToString(true);size+=text.length+1;if(size>4194304){useStore.getState().fail(new Error(tr("终端文本超过导出上限，请减少滚屏行数后重试。")));return;}parts.push(text);if(!buffer.getLine(i+1)?.isWrapped)parts.push('\n');}
    void window.hornet.terminal.exportText(useStore.getState().views.find(v=>v.id===view.id)?.title??view.profile.name,parts.join('')).catch(useStore.getState().fail);
   }
  };
  window.addEventListener('hornet:terminal-action',action);
  const resize=()=>{if(element.current?.offsetWidth&&element.current?.offsetHeight){fit.fit();if(!ended)void window.hornet.terminal.resize(id,view.generation,term.cols,term.rows).catch(reportInputFailure);}};
  resizeTerminal.current=resize;
  const observer=new ResizeObserver(resize);observer.observe(element.current);
  const onWheel=(event:WheelEvent)=>{
   if(!event.ctrlKey||!Number.isFinite(event.deltaY)||event.deltaY===0)return;
   // Capture before xterm's scrolling/mouse reporting and Chromium page zoom.
   event.preventDefault();event.stopPropagation();
   setFontSize(size=>Math.max(8,Math.min(32,size+(event.deltaY<0?1:-1))));
  };
  element.current.addEventListener('wheel',onWheel,{capture:true,passive:false});
  const onPaste=(e:ClipboardEvent)=>{const text=e.clipboardData?.getData('text/plain')??'';if(/[\r\n]/.test(text)&&!window.confirm(tr("将向 ")+view.profile.name+tr(" 粘贴多行文本，可能执行命令。继续？"))){e.preventDefault();e.stopImmediatePropagation();}};
  element.current.addEventListener('paste',onPaste,true);
  // A background tab can receive the close event before its xterm mounts.
  if(isTerminalClosed(view,useStore.getState()))endTerminal();
  if(!ended)void window.hornet.terminal.attach(id).then(resize).catch(reportInputFailure);
  term.focus();
  const el=element.current;
  return()=>{ended=true;inputAvailable.current=()=>false;clearTimeout(bellTimer);onBell.dispose();stopState();unregister();window.removeEventListener('hornet:terminal-action',action);resizeTerminal.current=null;unsubscribe();input.dispose();titleChange.dispose();observer.disconnect();el.removeEventListener('wheel',onWheel,true);el.removeEventListener('paste',onPaste,true);search.current=null;terminal.current=null;term.dispose();};
 },[view.id,view.terminalId,view.generation]);
 useEffect(()=>{
  const attempt=view.connectionAttempt,term=terminal.current;if(!attempt||!term)return;
  term.reset();term.write(tr('正在连接 {host}:{port}…',{host:disconnectText(view.profile.host),port:view.profile.port})+'\r\n');
  if(attempt.state==='failed')term.write('\r\n'+tr('连接失败：{error}',{error:disconnectText(attempt.error??'')})+'\r\n\r\n'+tr('选择“重新连接”可建立新的会话。')+'\r\n',()=>{if(terminal.current===term)term.scrollToBottom();});
 },[view.connectionAttempt,view.profile.host,view.profile.port]);
 useEffect(()=>{const term=terminal.current;if(!term)return;term.options.fontSize=fontSize;term.options.fontFamily=terminalFonts[preferences.font];term.options.theme=terminalThemes[preferences.theme];term.options.scrollback=preferences.scrollback;term.options.cursorStyle=preferences.cursorStyle;term.options.cursorBlink=!view.connectionAttempt&&!closed&&preferences.cursorBlink;resizeTerminal.current?.();},[preferences,fontSize,closed,view.connectionAttempt]);
 return <>{view.connectionAttempt?.state==='connecting'&&<div className="terminal-disconnected" role="status"><strong>{tr('正在连接…')}</strong></div>}{closed&&<div className="terminal-disconnected" role="status"><strong>{view.connectionAttempt?tr('连接失败'):tr("已断开")}</strong>{!view.source&&<button disabled={reconnecting} onClick={()=>void reconnectView(view.id).catch(useStore.getState().fail)}>{tr("重新连接")}</button>}</div>}{searchOpen&&<form className="terminal-search" onSubmit={e=>{e.preventDefault();find();}}><input ref={searchInput} aria-label={tr("搜索终端内容")} placeholder={tr("搜索终端 · Ctrl+Shift+F")} value={query} onChange={e=>{setQuery(e.target.value);setResult('');}} onKeyDown={e=>{if(e.key==='Escape'){setQuery('');setResult('');closeSearch();}else if(e.key==='Enter'&&e.shiftKey){e.preventDefault();find(true);}}}/><button type="button" onClick={()=>find(true)}>{tr("上一个")}</button><button>{tr("下一个")}</button><span role="status">{result}</span><button type="button" aria-label={tr("关闭终端搜索")} onClick={closeSearch}>×</button></form>}<div className={'terminal-host'+(bell?' terminal-bell':'')} ref={element} onPointerDownCapture={event=>{if(event.button===2){rightClickSelection.current=terminal.current?.getSelection()??'';event.preventDefault();event.stopPropagation();openMenu(event.clientX,event.clientY,rightClickSelection.current);}else rightClickSelection.current=undefined;}} onContextMenuCapture={event=>{event.preventDefault();event.stopPropagation();openMenu(event.clientX,event.clientY,rightClickSelection.current);rightClickSelection.current=undefined;}} onKeyDownCapture={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();const box=element.current?.getBoundingClientRect();openMenu((box?.left??0)+20,(box?.top??0)+20);}}}/>{menu&&<TerminalContextMenu view={view} x={menu.x} y={menu.y} canCopy={!!menu.selection} canPaste={!closed&&inputAvailable.current()} choose={choose} close={closeMenu}/>} </>;
}
