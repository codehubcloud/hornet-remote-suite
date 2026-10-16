import type { TerminalDisconnect } from '../../../packages/contracts/terminal-disconnect';
import { t } from './i18n';

// Server errors and session titles are data, never terminal control sequences.
export function disconnectText(value:string):string{
 return value.slice(0,1000).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\|$)/g,'')
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')
  .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,' ').trim();
}
export function disconnectTranscript(info:TerminalDisconnect,name:string,source?:'local'|'serial'):string{
 const time=new Date(info.at).toLocaleTimeString(undefined,{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
 const lines:string[]=[];
 if(info.error)lines.push(t('连接错误：{error}',{error:disconnectText(info.error)}));
 lines.push(info.reason==='user'?t('已主动断开连接。'):info.reason==='error'?t('连接异常中断。'):info.reason==='remote'?t('远程主机已关闭连接。'):t('终端会话已结束。'));
 lines.push('',t('已断开会话「{name}」，时间 {time}。',{name:disconnectText(name),time}));
 if(!source)lines.push('',t('选择“重新连接”可建立新的会话。'));
 return '\r\n\r\n'+lines.join('\r\n')+'\r\n';
}
