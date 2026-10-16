import { t as tr } from './i18n';
import { commandTextColor,quickCommandStyle,type QuickCommandAppearance } from './quick-command-appearance';

const presets:[string,QuickCommandAppearance][]=[
 ['红色',{kind:'solid',color:'#dc2626'}],['绿色',{kind:'solid',color:'#15803d'}],['蓝色',{kind:'solid',color:'#2563eb'}],['橙色',{kind:'solid',color:'#ea580c'}],
 ['蓝紫渐变',{kind:'linear',from:'#2563eb',to:'#7c3aed',angle:135}],['日落渐变',{kind:'linear',from:'#be123c',to:'#ea580c',angle:90}],['青绿渐变',{kind:'linear',from:'#0f766e',to:'#0369a1',angle:135}],
];
export function QuickCommandAppearanceEditor({value,name,change}:{value:QuickCommandAppearance|undefined;name:string;change:(value:QuickCommandAppearance|undefined)=>void}){
 const kind=value?.kind??'theme',from=value?(value.kind==='solid'?value.color:value.from):'#2563eb',to=value&&value.kind!=='solid'?value.to:'#7c3aed';
 const angle=value?.kind==='linear'?value.angle:135;
 const make=(nextKind:typeof kind,nextFrom=from,nextTo=to,nextAngle=angle,textColor=value?.textColor):QuickCommandAppearance|undefined=>nextKind==='theme'?undefined:nextKind==='solid'?{kind:'solid',color:nextFrom,textColor}:nextKind==='linear'?{kind:'linear',from:nextFrom,to:nextTo,angle:nextAngle,textColor}:{kind:'radial',from:nextFrom,to:nextTo,textColor};
 return <fieldset className="quick-command-appearance"><legend>{tr('按钮外观')}</legend>
  <label>{tr('填充方式')}<select aria-label={tr('填充方式')} value={kind} onChange={event=>change(make(event.target.value as typeof kind))}><option value="theme">{tr('跟随主题')}</option><option value="solid">{tr('纯色')}</option><option value="linear">{tr('线性渐变')}</option><option value="radial">{tr('径向渐变')}</option></select></label>
  <div className="quick-command-color-presets" aria-label={tr('预设颜色')}>{presets.map(([label,preset])=><button type="button" key={label} aria-label={tr(label)} title={tr(label)} style={quickCommandStyle(preset)} onClick={()=>change(preset)}>{tr(label)}</button>)}</div>
  {value&&<><div className="quick-command-color-fields"><label>{tr(kind==='solid'?'背景颜色':'起始颜色')}<input aria-label={tr(kind==='solid'?'背景颜色':'起始颜色')} type="color" value={from} onChange={event=>change(make(kind,event.target.value))}/></label>{kind!=='solid'&&<label>{tr('结束颜色')}<input aria-label={tr('结束颜色')} type="color" value={to} onChange={event=>change(make(kind,from,event.target.value))}/></label>}{kind==='linear'&&<label>{tr('渐变角度')}<input aria-label={tr('渐变角度')} type="number" min={0} max={360} step={1} value={angle} onChange={event=>change(make(kind,from,to,Number(event.target.value)))}/></label>}</div>
  <div className="quick-command-text-color"><label className="checkbox"><input type="checkbox" checked={!value.textColor} onChange={event=>{if(event.target.checked){const {textColor,...automatic}=value;change(automatic);}else change({...value,textColor:commandTextColor(value)});}}/>{tr('自动文字颜色')}</label><label>{tr('文字颜色')}<input aria-label={tr('文字颜色')} type="color" disabled={!value.textColor} value={commandTextColor(value)} onChange={event=>change({...value,textColor:event.target.value})}/></label></div></>}
  <div className="quick-command-appearance-preview"><button type="button" className={value?'quick-command-colored':undefined} aria-label={tr('按钮外观预览')} style={quickCommandStyle(value)}>{name||tr('示例命令')}</button><button type="button" disabled={!value} onClick={()=>change(undefined)}>{tr('恢复主题默认')}</button></div>
 </fieldset>;
}
