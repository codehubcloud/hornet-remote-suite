import { ScriptRunner,registerScriptRunner } from './script-runner';
import { t as tr } from './i18n';
import { useBroadcast } from './broadcast';
import { useCallback,useEffect,useRef,useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { SearchAddon } from '@xterm/addon-search';
import { FitAddon } from '@xterm/addon-fit';
import { terminalAction,terminalFonts,terminalThemes,useTerminalPreferences,type TerminalAction } from './terminal-preferences';
import { TerminalContextMenu,type TerminalContextAction } from './TerminalContextMenu';
import { useStore,type View } from './store';
export function TerminalView({view,searchRequested=0}:{view:View;searchRequested?:number}){
 const preferences=useTerminalPreferences(s=>s.value),resizeTerminal=useRef<(()=>void)|null>(null);
 const element=useRef<HTMLDivElement>(null),searchInput=useRef<HTMLInputElement>(null);
 const search=useRef<SearchAddon|null>(null),terminal=useRef<Terminal|null>(null);
 const inputAvailable=useRef<()=>boolean>(()=>false),closed=useStore(s=>!!s.closedTerminals[view.terminalId??'']);
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
  if(!element.current||!view.terminalId)return;
  const id=view.terminalId;
  const prefs=useTerminalPreferences.getState().value;
  const term=new Terminal({cursorBlink:prefs.cursorBlink,cursorStyle:prefs.cursorStyle,fontSize:prefs.fontSize,fontFamily:terminalFonts[prefs.font],scrollback:prefs.scrollback,theme:terminalThemes[prefs.theme],allowProposedApi:false});
  const fit=new FitAddon();term.loadAddon(fit);term.open(element.current);
  terminal.current=term;const addon=new SearchAddon();term.loadAddon(addon);search.current=addon;
  term.attachCustomKeyEventHandler(e=>{if(e.ctrlKey&&e.shiftKey&&e.code==='KeyF'){if(e.type==='keydown'){setSearchOpen(true);searchInput.current?.focus();}return false;}return true;});
  let inputSeq=0,ended=false;
  const runner=new ScriptRunner((text,signal)=>send(text,signal));
  inputAvailable.current=()=>!ended&&!runner.running;
  const unregister=registerScriptRunner(id,runner);
  const unsubscribe=window.hornet.onEvent(e=>{
   if(e.type==='terminal.data'&&e.terminalId===id&&e.generation===view.generation){
    runner.feed(new Uint8Array(e.data));
    term.write(new Uint8Array(e.data),()=>{if(!ended)window.hornet.terminal.ack(id,e.seq);});
   }
   if(e.type==='terminal.closed'&&e.terminalId===id){ended=true;runner.close();term.write(tr("\r\n\u001b[33m[连接已关闭；重新连接会创建新的会话]\u001b[0m\r\n"));}
  });
  let writes:Promise<void>=Promise.resolve();
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
   if(runner.running)return;
   void send(data).catch(useStore.getState().fail);const targets=useBroadcast.getState().targets;
   if(!ended&&targets.some(t=>t.terminalId===id))for(const target of targets)if(target.terminalId!==id)window.dispatchEvent(new CustomEvent<TerminalAction>('hornet:terminal-action',{detail:{viewId:target.viewId,terminalId:target.terminalId,kind:'input',text:data}}));
  });
  const action=(event:Event)=>{const detail=(event as CustomEvent<TerminalAction>).detail;if(detail.viewId!==view.id||detail.terminalId&&detail.terminalId!==id)return;
   if(runner.running&&['input','execute','paste'].includes(detail.kind))return;
   if(detail.kind==='input'&&detail.terminalId===id&&detail.text)void send(detail.text).catch(useStore.getState().fail);
   if(detail.kind==='execute'){if(ended){useStore.getState().fail(new Error(tr("终端已关闭，命令未发送。")));return;}if(detail.text){void send(detail.text.replace(/[\r\n]+$/,'').replace(/\r\n|\n/g,'\r')+'\r').catch(useStore.getState().fail);term.focus();}}
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
  const resize=()=>{if(element.current?.offsetWidth&&element.current?.offsetHeight){fit.fit();if(!ended)void window.hornet.terminal.resize(id,view.generation,term.cols,term.rows).catch(useStore.getState().fail);}};
  resizeTerminal.current=resize;
  const observer=new ResizeObserver(resize);observer.observe(element.current);
  const onPaste=(e:ClipboardEvent)=>{const text=e.clipboardData?.getData('text/plain')??'';if(/[\r\n]/.test(text)&&!window.confirm(tr("将向 ")+view.profile.name+tr(" 粘贴多行文本，可能执行命令。继续？"))){e.preventDefault();e.stopImmediatePropagation();}};
  element.current.addEventListener('paste',onPaste,true);
  void window.hornet.terminal.attach(id).then(resize).catch(useStore.getState().fail);
  term.focus();
  const el=element.current;
  return()=>{ended=true;inputAvailable.current=()=>false;unregister();window.removeEventListener('hornet:terminal-action',action);resizeTerminal.current=null;unsubscribe();input.dispose();observer.disconnect();el.removeEventListener('paste',onPaste,true);search.current=null;terminal.current=null;term.dispose();};
 },[view.id,view.terminalId,view.generation]);
 useEffect(()=>{const term=terminal.current;if(!term)return;term.options.fontSize=preferences.fontSize;term.options.fontFamily=terminalFonts[preferences.font];term.options.theme=terminalThemes[preferences.theme];term.options.scrollback=preferences.scrollback;term.options.cursorStyle=preferences.cursorStyle;term.options.cursorBlink=preferences.cursorBlink;resizeTerminal.current?.();},[preferences]);
 return <>{searchOpen&&<form className="terminal-search" onSubmit={e=>{e.preventDefault();find();}}><input ref={searchInput} aria-label={tr("搜索终端内容")} placeholder={tr("搜索终端 · Ctrl+Shift+F")} value={query} onChange={e=>{setQuery(e.target.value);setResult('');}} onKeyDown={e=>{if(e.key==='Escape'){setQuery('');setResult('');closeSearch();}else if(e.key==='Enter'&&e.shiftKey){e.preventDefault();find(true);}}}/><button type="button" onClick={()=>find(true)}>{tr("上一个")}</button><button>{tr("下一个")}</button><span role="status">{result}</span><button type="button" aria-label={tr("关闭终端搜索")} onClick={closeSearch}>×</button></form>}<div className="terminal-host" ref={element} onPointerDownCapture={event=>{if(event.button===2){rightClickSelection.current=terminal.current?.getSelection()??'';event.preventDefault();}else rightClickSelection.current=undefined;}} onContextMenuCapture={event=>{event.preventDefault();event.stopPropagation();openMenu(event.clientX,event.clientY,rightClickSelection.current);rightClickSelection.current=undefined;}} onKeyDownCapture={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();const box=element.current?.getBoundingClientRect();openMenu((box?.left??0)+20,(box?.top??0)+20);}}}/>{menu&&<TerminalContextMenu x={menu.x} y={menu.y} canCopy={!!menu.selection} canPaste={!closed&&inputAvailable.current()} choose={choose} close={closeMenu}/>} </>;
}
