import type { Profile } from '../../../packages/contracts';
import { t as tr } from './i18n';
import { isTerminalClosed,useStore } from './store';
export function CurrentSessionProperties({edit}:{edit:(profile:Profile)=>void}){
 const s=useStore(),view=s.views.find(v=>v.id===s.active&&v.kind==='terminal');
 if(!view)return null;
 const p=view.profile,protocol=view.source==='local'?tr('本地终端'):view.source==='serial'?tr('串口终端'):(p.protocol??'ssh').toUpperCase();
 const properties=[['name',tr('名称'),view.title??p.name],['host',tr('主机'),p.host],['username',tr('用户名'),p.username],['protocol',tr('协议'),protocol],['port',tr('端口'),p.port?String(p.port):'—'],['description',tr('说明'),p.description??''],['state',tr('状态'),isTerminalClosed(view,s)?tr('已断开'):tr('已连接')]];
 return <section className="current-session-properties" aria-label={tr('当前终端属性')}><dl>{properties.map(([key,label,value])=><div key={key} className={'session-property-'+key} data-session-property={key}><dt>{label}</dt><dd title={value}>{value||'—'}</dd></div>)}</dl><button type="button" aria-label={tr('编辑当前会话属性')} title={tr('编辑当前会话属性')} disabled={!!view.source} onClick={()=>edit(s.profiles.find(saved=>saved.profileId===p.profileId)??p)}>…</button></section>;
}
