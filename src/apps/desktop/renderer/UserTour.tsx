import { useEffect,useId,useLayoutEffect,useRef,useState } from 'react';
import { useAppearance } from './appearance';
import { t } from './i18n';

const steps=[
 {title:'分步使用引导',text:'接下来会逐一介绍常用操作区域。点击“下一步”继续，也可以随时返回或跳过；引导不会连接服务器或执行命令。',targets:[]},
 {title:'新建会话',text:'从这里新建连接，填写主机、端口、用户名和密码，也可以选择私钥。保存后可重复使用；首次连接请核对服务器指纹。',targets:['[data-tour="new-session"]','.start-connect button[type="button"]']},
 {title:'会话管理器',text:'左侧保存并管理已有连接，可分组、搜索和编辑。双击会话打开连接，Alt＋O 可打开会话窗口。',targets:['.sidebar','[data-tour="sessions"]']},
 {title:'快速连接',text:'在地址栏输入会话名称或 user@host:port 快速连接。Alt＋D 可聚焦地址栏，例如 tester@192.168.1.10:22。',targets:['.quick-connect-bar','.start-connect']},
 {title:'终端',text:'连接成功后在这里操作终端。选中文字可右键复制，Ctrl＋Shift＋V 粘贴，Ctrl＋滚轮调整字号；底部状态区分连接中、已连接和已断开。',targets:['.workspace .content']},
 {title:'任务中心',text:'SSH 连接后可打开 SFTP 文件栏上传下载。任务中心显示传输及校验进度，请等待最终完成状态；覆盖或同步前核对方向与目标目录。',targets:['.task-center','.statusbar']},
 {title:'快速命令',text:'在“查看 → 快速命令”管理常用命令，添加按钮并设置颜色。发送前核对当前终端，勾选回车会立即执行命令。',targets:['[data-menu="查看"]','.quick-command-surface']},
 {title:'语言与主题',text:'从这里切换界面语言和主题。终端字体与配色可单独设置；右键顶部区域可以调整工具栏的显示与隐藏。',targets:['[data-tour="appearance"]','[data-menu="工具"]']},
 {title:'帮助',text:'帮助菜单可以重新打开分步引导、查阅详细使用指引和离线 PDF，也提供检查更新、技术支持和反馈入口。',targets:['[data-menu="帮助"]','.menu-restore']},
 {title:'开始使用',text:'引导完成！现在可以新建你的第一个连接。需要复习时，从“帮助 → 分步使用引导”重新开始，或打开详细用户使用指引。',targets:[]}
] as const;
type Rect={x:number;y:number;width:number;height:number};

export function UserTour({close,manual}:{close:()=>void;manual:()=>void}){
 const language=useAppearance(s=>s.value.language),[index,setIndex]=useState(0),step=steps[index];
 const root=useRef<HTMLElement>(null),next=useRef<HTMLButtonElement>(null),closeRef=useRef(close),nextRef=useRef(()=>{});closeRef.current=close;
 const [position,setPosition]=useState<{spot:Rect|null;left:number;top:number}>({spot:null,left:16,top:60});
 const mask=useId();
 nextRef.current=()=>{if(index===steps.length-1)close();else setIndex(index+1);};
 useLayoutEffect(()=>{
  const measure=()=>{
   const vw=document.documentElement.clientWidth,vh=document.documentElement.clientHeight,pad=16,card=root.current;if(!card)return;
   const target=step.targets.flatMap(selector=>[...document.querySelectorAll<HTMLElement>(selector)]).find(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<vw&&r.top<vh;});
   const rect=target?.getBoundingClientRect(),spot=rect?{x:Math.max(4,rect.left-5),y:Math.max(4,rect.top-5),width:0,height:0}:null;
   if(spot&&rect){spot.width=Math.max(0,Math.min(vw-4,rect.right+5)-spot.x);spot.height=Math.max(0,Math.min(vh-4,rect.bottom+5)-spot.y);}
   const w=card.offsetWidth,h=card.offsetHeight,fit=(value:number,size:number,max:number)=>Math.max(pad,Math.min(value,max-size-pad));
   let left=fit((vw-w)/2,w,vw),top=fit((vh-h)/2,h,vh);
   if(spot){
    if(spot.x+spot.width+pad+w<=vw-pad){left=spot.x+spot.width+pad;top=fit(spot.y,h,vh);}
    else if(spot.x-pad-w>=pad){left=spot.x-pad-w;top=fit(spot.y,h,vh);}
    else if(spot.y+spot.height+pad+h<=vh-pad){left=fit(spot.x,w,vw);top=spot.y+spot.height+pad;}
    else if(spot.y-pad-h>=pad){left=fit(spot.x,w,vw);top=spot.y-pad-h;}
   }
   setPosition(previous=>JSON.stringify(previous)===JSON.stringify({spot,left,top})?previous:{spot,left,top});
  };
  measure();const observer=new ResizeObserver(measure);if(root.current)observer.observe(root.current);observer.observe(document.documentElement);
  for(const selector of step.targets)for(const target of document.querySelectorAll(selector))observer.observe(target);
  window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);
  return()=>{observer.disconnect();window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true);};
 },[index,language]);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeRef.current();return;}
   if(event.key==='ArrowRight'&&!event.altKey&&!event.ctrlKey&&!event.metaKey){event.preventDefault();event.stopImmediatePropagation();nextRef.current();}
   if(event.key==='ArrowLeft'&&!event.altKey&&!event.ctrlKey&&!event.metaKey){event.preventDefault();event.stopImmediatePropagation();setIndex(i=>Math.max(0,i-1));}
   if(event.key!=='Tab')return;
   const buttons=[...root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]],first=buttons[0],last=buttons.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  };
  window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('keydown',key,true);if(previous?.isConnected)previous.focus();};
 },[]);
 useEffect(()=>{next.current?.focus({preventScroll:true});},[index]);
 const spot=position.spot;
 return <div className="modal-backdrop user-tour-overlay">
  <svg aria-hidden="true" className="user-tour-mask"><defs><mask id={mask}><rect width="100%" height="100%" fill="white"/>{spot&&<rect {...spot} rx="7" fill="black"/>}</mask></defs><rect width="100%" height="100%" fill="rgba(0,0,0,.64)" mask={'url(#'+mask+')'}/>{spot&&<rect {...spot} rx="7" fill="none" className="user-tour-highlight"/>}</svg>
  <section ref={root} className="user-tour-card" role="dialog" aria-modal="true" aria-label={t('分步使用引导')} data-tour-step={index} style={{left:position.left,top:position.top}}>
   <p className="muted" aria-live="polite">{t('第 {current} / {total} 步',{current:index+1,total:steps.length})}</p><h2>{t(step.title)}</h2><p className="user-tour-copy">{t(step.text)}</p>
   {!!step.targets.length&&!spot&&<p className="muted">{t('该区域当前隐藏，结束引导后可从顶部菜单或工具栏打开。')}</p>}
   <div className="user-tour-dots" aria-hidden="true">{steps.map((s,i)=><span key={s.title} className={i===index?'active':''}/>)}</div>
   <button className="user-tour-manual" onClick={manual}>{t('用户使用指引')}</button>
   <div className="user-tour-actions"><button onClick={close}>{t('跳过引导')}</button><span/><button disabled={index===0} onClick={()=>setIndex(index-1)}>{t('上一步')}</button><button className="primary" ref={next} onClick={()=>nextRef.current()}>{index===steps.length-1?t('完成引导'):t('下一步')}</button></div>
  </section>
 </div>;
}
