import { t as tr } from './i18n';
import { useState } from 'react';
import { terminalDefaults,terminalFonts,terminalThemes,terminalThemeLabels,useTerminalPreferences,type TerminalPreferences } from './terminal-preferences';
import { useStore } from './store';

export function TerminalSettings({close}:{close:()=>void}){
 const preferences=useTerminalPreferences(),[value,setValue]=useState({...preferences.value});
 const change=<K extends keyof TerminalPreferences>(key:K,next:TerminalPreferences[K])=>setValue(old=>({...old,[key]:next}));
 return <div className="modal-backdrop"><form className="modal" role="dialog" aria-modal="true" aria-label={tr("终端设置")} onSubmit={e=>{e.preventDefault();try{preferences.save(value);close();}catch(error){useStore.getState().fail(error);}}}>
  <h2>{tr("终端设置")}</h2><p>{tr("应用于所有已打开和新建的终端。降低滚屏行数会丢弃超出的历史内容。")}</p>
  <label>{tr("字体")}<select aria-label={tr("终端字体")} value={value.font} onChange={e=>change('font',e.target.value as TerminalPreferences['font'])}><option value="cascadia">Cascadia Code</option><option value="consolas">Consolas</option><option value="courier">Courier New</option></select></label>
  <label>{tr("字号")}<input aria-label={tr("终端字号")} type="number" min={8} max={32} required value={value.fontSize} onChange={e=>change('fontSize',Number(e.target.value))}/></label>
  <label>{tr("配色")}<select aria-label={tr("终端配色")} value={value.theme} onChange={e=>change('theme',e.target.value as TerminalPreferences['theme'])}>{Object.entries(terminalThemeLabels).map(([theme,label])=><option key={theme} value={theme}>{tr(label)}</option>)}</select></label>
  <label>{tr("滚屏行数")}<input aria-label={tr("终端滚屏行数")} type="number" min={1000} max={100000} required value={value.scrollback} onChange={e=>change('scrollback',Number(e.target.value))}/></label>
  <label>{tr("光标")}<select aria-label={tr("终端光标")} value={value.cursorStyle} onChange={e=>change('cursorStyle',e.target.value as TerminalPreferences['cursorStyle'])}><option value="block">{tr("方块")}</option><option value="bar">{tr("竖线")}</option><option value="underline">{tr("下划线")}</option></select></label>
  <label className="check"><input type="checkbox" checked={value.cursorBlink} onChange={e=>change('cursorBlink',e.target.checked)}/>{tr("光标闪烁")}</label>
  <pre className="terminal-style-preview" style={{background:terminalThemes[value.theme].background,color:terminalThemes[value.theme].foreground,fontFamily:terminalFonts[value.font],fontSize:value.fontSize}}>user@host:~$ ls{'\n'}{tr("Documents  Downloads  项目目录")}</pre>
  <div className="modal-actions"><button type="button" onClick={()=>setValue({...terminalDefaults})}>{tr("恢复默认")}</button><button type="button" onClick={close}>{tr("取消")}</button><button className="primary">{tr("应用设置")}</button></div>
 </form></div>;
}
