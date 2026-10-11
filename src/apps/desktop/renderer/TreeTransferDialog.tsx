import { t as tr } from './i18n';
import type { TreePreview,SyncPolicy } from '../../../packages/contracts/file-tree';
import { formatBytes } from './FileView';

export function TreeTransferDialog({preview,busy,execute,close,recompare}:{preview:TreePreview;busy:boolean;execute:()=>void;close:()=>void;recompare:(policy:SyncPolicy)=>void}){
 const labels={copy:tr("传输文件"),replace:tr('覆盖文件'),mkdir:tr("创建目录"),conflict:tr("跳过冲突"),skip:tr('保留不变')};
 return <div className="modal-backdrop"><section className="modal tree-transfer-dialog" role="dialog" aria-modal="true" aria-label={tr("目录传输预览")}>
  <h2>{preview.direction==='bidirectional'?tr('双向同步'):preview.direction==='upload'?tr("本地 → 远端"):tr("远端 → 本地")}{tr("· 目录传输预览")}</h2>
  <p className="mono">{tr("本地：")}{preview.localPath}<br/>{tr("远端：")}{preview.remotePath}</p>
  <p>{preview.files}{tr("个文件 ·")}{formatBytes(preview.bytes)}{tr("· 新建")}{preview.directories}{tr("个目录 ·")}{preview.conflicts}{tr("个冲突")}</p>
  <label>{tr('同名文件策略')}<select aria-label={tr('同名文件策略')} disabled={busy} value={preview.policy??'skip'} onChange={e=>recompare(e.target.value as SyncPolicy)}><option value="skip">{tr('跳过同名文件')}</option><option value="newer">{tr('较新文件优先')}</option>{preview.direction!=='download'&&<option value="local">{tr('本地优先')}</option>}{preview.direction!=='upload'&&<option value="remote">{tr('远端优先')}</option>}<option value="keep-both">{tr('保留双方副本')}</option></select></label>
  <p>{tr('不删除独有文件。非跳过策略会校验同名文件内容；较新优先在内容不同且时间相差不超过 2 秒时保留冲突。链接和类型冲突不自动处理。')}</p>
  <p className="muted">{tr('切换策略会重新比较。执行只提交任务，传输结果和暂停、取消在任务中心查看。远端覆盖需要 OpenSSH 原子重命名支持。')}</p>
  <div className="table-scroll"><table><thead><tr><th>{tr("相对路径")}</th><th>{tr('方向')}</th><th>{tr("操作")}</th><th>{tr("大小 / 原因")}</th></tr></thead><tbody>
   {preview.actions.map(action=><tr key={action.path+':'+(action.direction??'')}><td className="mono">{action.sourcePath? action.sourcePath+' → ':''}{action.path}</td><td>{action.direction==='upload'?tr('本地 → 远端'):action.direction==='download'?tr('远端 → 本地'):'—'}</td><td>{tr(labels[action.action])}</td><td>{action.reason?tr(action.reason):(action.kind==='file'?formatBytes(action.size):'—')}</td></tr>)}
  </tbody></table>{!preview.actions.length&&<p className="empty">{tr("源目录为空，没有需要传输的条目。")}</p>}</div>
  <div className="modal-actions"><button disabled={busy} onClick={close}>{tr("关闭预览")}</button><button className="primary" disabled={busy||(!preview.files&&!preview.directories)} onClick={execute}>{busy?tr("正在处理…"):preview.direction==='bidirectional'||preview.policy&&preview.policy!=='skip'?tr('执行同步'):tr("执行补齐传输")}</button></div>
 </section></div>;
}
