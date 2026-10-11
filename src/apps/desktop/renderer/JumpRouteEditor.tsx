import type { Profile } from '../../../packages/contracts';
import { t } from './i18n';
export function JumpRouteEditor({profile,profiles,change}:{profile:Profile;profiles:Profile[];change:(ids:string[])=>void}){
 const ids=profile.jumpProfileIds??[],choices=profiles.filter(p=>p.profileId!==profile.profileId&&(p.protocol??'ssh')==='ssh'&&!p.jumpProfileIds?.length);
 function move(index:number,delta:number){const next=[...ids];[next[index],next[index+delta]]=[next[index+delta],next[index]];change(next);}
 return <fieldset className="jump-route"><legend>{t('SSH 跳板链（按顺序）')}</legend>
  {ids.map((id,i)=><div className="jump-hop" key={i}><span>{i+1}</span><select aria-label={t('跳板 {number}',{number:i+1})} value={id} onChange={e=>change(ids.map((old,j)=>j===i?e.target.value:old))}>{!choices.some(p=>p.profileId===id)&&<option value={id}>{t('请选择跳板')}</option>}{choices.filter(p=>p.profileId===id||!ids.includes(p.profileId)).map(p=><option key={p.profileId} value={p.profileId}>{p.name} · {p.username}@{p.host}:{p.port}</option>)}</select><button type="button" aria-label={t('上移跳板')} disabled={i===0} onClick={()=>move(i,-1)}>↑</button><button type="button" aria-label={t('下移跳板')} disabled={i===ids.length-1} onClick={()=>move(i,1)}>↓</button><button type="button" aria-label={t('移除跳板')} onClick={()=>change(ids.filter((_,j)=>j!==i))}>×</button></div>)}
  <button type="button" disabled={ids.length>=4||!choices.some(p=>!ids.includes(p.profileId))} onClick={()=>{const next=choices.find(p=>!ids.includes(p.profileId));if(next)change([...ids,next.profileId]);}}>{t('添加跳板')}</button><p className="muted">{t('留空直接连接，最多四跳。先保存各跳板的直连 SSH 配置，再按从本机到目标的顺序添加；每一跳分别认证和核验指纹。')}</p>
 </fieldset>;
}
