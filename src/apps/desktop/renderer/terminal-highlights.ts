import type { Terminal,IMarker,IDecoration } from '@xterm/xterm';
import { useTerminalRules } from './terminal-rules';
export function installHighlights(term:Terminal){
 let timer:ReturnType<typeof setTimeout>|undefined,disposed=false;
 let marks:{marker:IMarker;decoration:IDecoration}[]=[];
 const clear=()=>{for(const item of marks){item.decoration.dispose();item.marker.dispose();}marks=[];};
 const paint=()=>{
  timer=undefined;if(disposed)return;clear();const rules=useTerminalRules.getState().value.highlights.filter(rule=>rule.enabled);if(!rules.length)return;
  const buffer=term.buffer.active,cursor=buffer.baseY+buffer.cursorY;
  for(let y=buffer.viewportY;y<Math.min(buffer.length,buffer.viewportY+term.rows);y++){
   const line=buffer.getLine(y);if(!line)continue;let text='';const columns:number[]=[];
   for(let x=0;x<line.length;x++){const cell=line.getCell(x);if(!cell||cell.getWidth()===0)continue;const chars=cell.getChars()||' ';for(let i=0;i<chars.length;i++)columns.push(x);text+=chars;}columns.push(line.length);
   for(const rule of rules)for(let from=0;from<text.length;){const index=text.indexOf(rule.text,from);if(index<0)break;from=index+rule.text.length;const x=columns[index],end=columns[from]??term.cols;if(end<=x||marks.length>=500)continue;const marker=term.registerMarker(y-cursor);if(!marker)continue;const decoration=term.registerDecoration({marker,x,width:Math.min(term.cols-x,end-x),backgroundColor:rule.background,foregroundColor:rule.foreground});if(decoration)marks.push({marker,decoration});else marker.dispose();}
  }
 };
 const schedule=()=>{if(!timer&&!disposed)timer=setTimeout(paint,80);};
 const events=[term.onWriteParsed(schedule),term.onScroll(schedule),term.onResize(schedule)],stop=useTerminalRules.subscribe(schedule);schedule();
 return()=>{disposed=true;clearTimeout(timer);stop();events.forEach(event=>event.dispose());clear();};
}
