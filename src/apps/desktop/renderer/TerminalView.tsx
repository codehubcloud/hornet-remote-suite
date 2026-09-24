import { useEffect,useRef,useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { SearchAddon } from '@xterm/addon-search';
import { FitAddon } from '@xterm/addon-fit';
import { useStore,type View } from './store';
export function TerminalView({view,searchRequested=0}:{view:View;searchRequested?:number}){
 const element=useRef<HTMLDivElement>(null),searchInput=useRef<HTMLInputElement>(null);
 const search=useRef<SearchAddon|null>(null),terminal=useRef<Terminal|null>(null);
 const [searchOpen,setSearchOpen]=useState(false);
 useEffect(()=>{if(searchRequested)setSearchOpen(true);},[searchRequested]);
 useEffect(()=>{if(searchOpen)searchInput.current?.focus();},[searchOpen,searchRequested]);
 const closeSearch=()=>{setSearchOpen(false);terminal.current?.clearSelection();terminal.current?.focus();};
 const [query,setQuery]=useState(''),[result,setResult]=useState('');
 const find=(previous=false)=>{if(!query){terminal.current?.clearSelection();setResult('');return;}const found=previous?search.current?.findPrevious(query):search.current?.findNext(query);setResult(found?'已定位匹配':'未找到匹配');};
 useEffect(()=>{
  if(!element.current||!view.terminalId)return;
  const id=view.terminalId;
  const term=new Terminal({cursorBlink:true,fontSize:14,fontFamily:'Cascadia Code, Consolas, monospace',scrollback:10000,theme:{background:'#0b1220',foreground:'#d5e0ee',cursor:'#38d9c4',selectionBackground:'#29485d'},allowProposedApi:false});
  const fit=new FitAddon();term.loadAddon(fit);term.open(element.current);
  terminal.current=term;const addon=new SearchAddon();term.loadAddon(addon);search.current=addon;
  term.attachCustomKeyEventHandler(e=>{if(e.ctrlKey&&e.shiftKey&&e.code==='KeyF'){if(e.type==='keydown'){setSearchOpen(true);searchInput.current?.focus();}return false;}return true;});
  let inputSeq=0,ended=false;
  const unsubscribe=window.hornet.onEvent(e=>{
   if(e.type==='terminal.data'&&e.terminalId===id&&e.generation===view.generation){
    term.write(new Uint8Array(e.data),()=>{if(!ended)window.hornet.terminal.ack(id,e.seq);});
   }
   if(e.type==='terminal.closed'&&e.terminalId===id){ended=true;term.write('\r\n\x1b[33m[连接已关闭；重新连接会创建新的 Shell]\x1b[0m\r\n');}
  });
  const input=term.onData(data=>{if(!ended){for(let i=0;i<data.length;i+=4096)window.hornet.terminal.write(id,view.generation,++inputSeq,data.slice(i,i+4096));}});
  const resize=()=>{if(element.current?.offsetWidth&&element.current?.offsetHeight){fit.fit();if(!ended)void window.hornet.terminal.resize(id,view.generation,term.cols,term.rows).catch(useStore.getState().fail);}};
  const observer=new ResizeObserver(resize);observer.observe(element.current);
  const onPaste=(e:ClipboardEvent)=>{const text=e.clipboardData?.getData('text/plain')??'';if(/[\r\n]/.test(text)&&!window.confirm('将向 '+view.profile.name+' 粘贴多行文本，可能执行命令。继续？')){e.preventDefault();e.stopImmediatePropagation();}};
  element.current.addEventListener('paste',onPaste,true);
  void window.hornet.terminal.attach(id).then(resize).catch(useStore.getState().fail);
  term.focus();
  const el=element.current;
  return()=>{ended=true;unsubscribe();input.dispose();observer.disconnect();el.removeEventListener('paste',onPaste,true);search.current=null;terminal.current=null;term.dispose();};
 },[view.id]);
 return <>{searchOpen&&<form className="terminal-search" onSubmit={e=>{e.preventDefault();find();}}><input ref={searchInput} aria-label="搜索终端内容" placeholder="搜索终端 · Ctrl+Shift+F" value={query} onChange={e=>{setQuery(e.target.value);setResult('');}} onKeyDown={e=>{if(e.key==='Escape'){setQuery('');setResult('');closeSearch();}else if(e.key==='Enter'&&e.shiftKey){e.preventDefault();find(true);}}}/><button type="button" onClick={()=>find(true)}>上一个</button><button>下一个</button><span role="status">{result}</span><button type="button" aria-label="关闭终端搜索" onClick={closeSearch}>×</button></form>}<div className="terminal-host" ref={element}/></>;
}
