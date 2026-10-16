import { useEffect,useState } from 'react';
import type { AppInfo,UpdateInfo } from '../../../packages/contracts/help';
import { manualSections } from '../../../packages/core/help-content';
import { t } from './i18n';
import { useAppearance } from './appearance';
export type HelpPage='manual'|'pdf'|'updates'|'about';
export function HelpDialog({page,close}:{page:HelpPage;close:()=>void}){
 const language=useAppearance(s=>s.value.language),[info,setInfo]=useState<AppInfo>(),[update,setUpdate]=useState<UpdateInfo>(),[error,setError]=useState(false),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let live=true;setError(false);setBusy(true);setDone(false);
  const work=page==='updates'?window.hornet.help.checkUpdates().then(value=>{if(live)setUpdate(value);}):page==='pdf'?window.hornet.help.openPdf(language):page==='about'?window.hornet.help.info().then(value=>{if(live)setInfo(value);}):Promise.resolve();
  void work.then(()=>{if(live)setDone(true);}).catch(()=>{if(live)setError(true);}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};
 },[page,language,attempt]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[close]);
 const title=page==='manual'?t('Hornet 帮助'):page==='pdf'?t('打开帮助PDF'):page==='updates'?t('检查更新…'):t('关于 Hornet');
 const link=(id:'releases'|'support')=>void window.hornet.help.openLink(id).catch(()=>setError(true));
 return <div className="modal-backdrop"><section className={'modal help-dialog '+(page==='manual'?'help-manual':'')} role="dialog" aria-modal="true" aria-label={title}>
  <h2>{title}</h2>
  {page==='manual'&&<><p className="muted">Hornet Remote Suite {__APP_VERSION__}</p><div className="help-manual-content">{manualSections(language).map(s=><section key={s.title}><h3>{s.title}</h3><p>{s.text}</p></section>)}</div></>}
  {page==='about'&&<><img src="./logo.png" alt="Hornet Remote Suite" width="64" height="64"/><h3>Hornet Remote Suite</h3><p>{t('统一远程工作台')}</p><dl className="help-app-info"><dt>{t('版本')}</dt><dd>{info?.version??__APP_VERSION__}</dd><dt>{t('平台')}</dt><dd>{info?info.platform+' · '+info.arch:'…'}</dd><dt>Electron</dt><dd>{info?.electron??'…'}</dd><dt>Chromium</dt><dd>{info?.chrome??'…'}</dd><dt>Node.js</dt><dd>{info?.node??'…'}</dd></dl><p className="muted">Copyright © 2026 codehubcloud</p></>}
  {busy&&<p role="status">{page==='pdf'?t('正在生成并打开帮助 PDF…'):t('正在检查…')}</p>}
  {page==='pdf'&&done&&!error&&<p role="status">{t('帮助 PDF 已交给系统查看器打开。')}</p>}
  {page==='updates'&&done&&update&&!error&&<><p role="status">{update.available?t('发现新版本 {version}',{version:update.latest}):t('当前已是最新版本')}</p><p>{t('当前版本：{version}',{version:update.current})} · {t('最新版本：{version}',{version:update.latest})}</p>{update.available&&<pre className="help-release-notes">{update.notes}</pre>}<p className="muted">{t('打开发布页面后选择对应平台的安装包，更新不会自动安装。')}</p></>}
  {error&&<p role="alert">{page==='pdf'?t('无法打开帮助 PDF，请检查系统 PDF 查看器后重试。'):t('请求失败，请检查网络或稍后重试。')}</p>}
  <div className="modal-actions">{error&&<button disabled={busy} onClick={()=>setAttempt(attempt+1)}>{t('重试')}</button>}{page==='manual'&&<button onClick={()=>void window.hornet.help.openPdf(language).catch(()=>setError(true))}>{t('打开帮助PDF')}</button>}{page==='updates'&&<button onClick={()=>link('releases')}>{t('访问发布页面')}</button>}{page==='about'&&<button onClick={()=>link('support')}>{t('访问技术支持')}</button>}<button autoFocus onClick={close}>{t('关闭')}</button></div>
 </section></div>;
}
