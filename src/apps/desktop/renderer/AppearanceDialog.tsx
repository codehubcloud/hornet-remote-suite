import { languages,themes,useAppearance,type Theme } from './appearance';
import { useStore } from './store';
import { t as tr } from './i18n';
export const themeLabels:Record<Theme,string>={light:'经典浅色',dark:'深色','github-light':'GitHub 浅色','github-dark':'GitHub 深色','vscode-light':'VS Code 浅色','vscode-dark':'VS Code 深色','visual-studio-light':'Visual Studio 浅色','visual-studio-dark':'Visual Studio 深色','visual-studio-blue':'Visual Studio 蓝色',solarized:'Solarized', 'solarized-light':'Solarized 浅色',dracula:'Dracula',nord:'Nord',gruvbox:'Gruvbox', 'one-dark':'One Dark','rose-pine':'Rosé Pine',coffee:'暖色浅色',contrast:'高对比度',system:'跟随系统'};
export function AppearanceDialog({close}:{close:()=>void}){
 const {value,save}=useAppearance();
 return <div className="modal-backdrop"><section className="modal appearance-dialog" role="dialog" aria-modal="true" aria-label={tr('语言与主题')} onKeyDown={e=>{if(e.key==='Escape')close();}}>
  <h2>{tr('语言与主题')}</h2>
  <label>{tr('界面语言')}<select autoFocus aria-label={tr('界面语言')} value={value.language} onChange={e=>{try{save({...value,language:e.target.value as typeof value.language});}catch(error){useStore.getState().fail(error);}}}>{languages.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
  <label>{tr('界面主题')}<select aria-label={tr('界面主题')} value={value.theme} onChange={e=>{try{save({...value,theme:e.target.value as typeof value.theme});}catch(error){useStore.getState().fail(error);}}}>{themes.map(theme=><option key={theme} value={theme}>{tr(themeLabels[theme])}</option>)}</select></label>
  <p className="muted">{tr('设置即时生效并保存在本机。终端配色由终端设置独立控制。')}</p>
  <p className="muted">{tr('尚未翻译的详细说明显示英文。主机名称、路径和终端输出保持原样。')}</p>
  <div className="appearance-preview"><strong>{tr('预览')}</strong><p>{tr('当前会话与后台任务继续运行。')}</p><button>{tr('普通按钮')}</button> <button className="primary">{tr('主要操作')}</button></div>
  <div className="modal-actions"><button onClick={close}>{tr('关闭')}</button></div>
 </section></div>;
}
