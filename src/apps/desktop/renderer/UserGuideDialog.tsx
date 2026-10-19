import { useEffect,useRef,useState } from 'react';
import { userGuideSections } from '../../../packages/core/user-guide';
import { useAppearance } from './appearance';
import { t } from './i18n';

export function UserGuideDialog({firstRun,close,tour}:{firstRun:boolean;close:()=>void;tour:()=>void}){
 const language=useAppearance(s=>s.value.language),sections=userGuideSections(language);
 const [selected,setSelected]=useState(sections[0].id),[query,setQuery]=useState(''),[pdfBusy,setPdfBusy]=useState(false),[pdfError,setPdfError]=useState(false);
 const root=useRef<HTMLElement>(null),search=useRef<HTMLInputElement>(null),article=useRef<HTMLElement>(null),closeRef=useRef(close);closeRef.current=close;
 const needle=query.trim().toLocaleLowerCase(),filtered=sections.filter(s=>!needle||[s.title,...s.steps].some(text=>text.toLocaleLowerCase().includes(needle)));
 const current=filtered.find(s=>s.id===selected)??filtered[0],index=filtered.findIndex(s=>s.id===current?.id);
 useEffect(()=>{article.current?.scrollTo(0,0);},[current?.id,language]);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;search.current?.focus();
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeRef.current();return;}
   if(event.key!=='Tab')return;
   const elements=[...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')??[])].filter(e=>e.getClientRects().length);
   const first=elements[0],last=elements.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  };
  window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('keydown',key,true);if(previous?.isConnected)previous.focus();};
 },[]);
 async function openPdf(){setPdfBusy(true);setPdfError(false);try{await window.hornet.help.openPdf(language);}catch{setPdfError(true);}finally{setPdfBusy(false);}}
 return <div className="modal-backdrop"><section ref={root} className="modal user-guide-dialog" role="dialog" aria-modal="true" aria-label={t('用户使用指引')}>
  <div className="modal-heading"><div><h2>{t('用户使用指引')}</h2><p className="muted">{firstRun?t('欢迎使用 Hornet Remote Suite。按步骤完成第一次连接。'):t('离线使用指引，可随时从帮助菜单重新打开。')}</p></div><button type="button" aria-label={t('关闭使用指引')} onClick={close}>×</button></div>
  <input ref={search} type="search" aria-label={t('搜索使用指引')} placeholder={t('搜索章节或操作步骤…')} value={query} onChange={event=>setQuery(event.target.value)}/>
  <div className="user-guide-body"><nav aria-label={t('指引目录')}>{filtered.map((s,i)=><button key={s.id} type="button" aria-current={current?.id===s.id?'page':undefined} onClick={()=>setSelected(s.id)}>{i+1}. {s.title}</button>)}</nav>
   <article ref={article} tabIndex={0} aria-label={current?.title??t('用户使用指引')}>{current?<><p className="muted">{t('第 {current} / {total} 章',{current:index+1,total:filtered.length})}</p><h3>{current.title}</h3><ol>{current.steps.map((step,i)=><li key={i}>{step}</li>)}</ol></>:<p role="status">{t('没有找到相关内容，请尝试其他关键词。')}</p>}</article></div>
  {pdfError&&<p role="alert">{t('无法打开帮助 PDF，请检查系统 PDF 查看器后重试。')}</p>}
  <div className="modal-actions"><button disabled={pdfBusy} onClick={()=>void openPdf()}>{pdfBusy?t('正在生成并打开帮助 PDF…'):t('打开帮助PDF')}</button><button onClick={tour}>{t('开始分步引导')}</button><span className="user-guide-page-actions"><button disabled={index<=0} onClick={()=>setSelected(filtered[index-1].id)}>{t('上一章')}</button><button disabled={index<0||index>=filtered.length-1} onClick={()=>setSelected(filtered[index+1].id)}>{t('下一章')}</button></span><button className="primary" onClick={close}>{firstRun?t('开始使用'):t('关闭')}</button></div>
 </section></div>;
}
