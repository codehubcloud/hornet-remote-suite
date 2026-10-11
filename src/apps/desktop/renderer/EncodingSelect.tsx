import { terminalEncodingLabels,type TerminalEncoding } from '../../../packages/contracts/terminal-encoding';
import { t as tr } from './i18n';
export function EncodingSelect({value,change}:{value?:TerminalEncoding;change:(value:TerminalEncoding)=>void}){
 return <label>{tr('字符编码')}<select aria-label={tr('字符编码')} value={value??'utf8'} onChange={e=>change(e.target.value as TerminalEncoding)}>{Object.entries(terminalEncodingLabels).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>;
}
