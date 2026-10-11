import { t } from './i18n';
export function parseQuickAddress(value:string):{host:string;port:number;username:string;protocol?:'telnet'|'ftp';ftpSecurity?:'none'|'explicit'}{
 const text=value.trim();
 if(!text||/[\s\x00-\x1f\x7f]/.test(text))throw new Error(t('请输入主机地址或 user@host:port。'));
 if(text.includes('://')&&!text.startsWith('ssh://')&&!text.startsWith('telnet://')&&!text.startsWith('ftp://')&&!text.startsWith('ftps://'))throw new Error(t('快速连接支持 SSH、Telnet、FTP 或 FTPS 地址。'));
 let url:URL;
 try{url=new URL(text.includes('://')?text:'ssh://'+text);}catch{throw new Error(t('地址格式无效；IPv6 地址请使用方括号。'));}
 if(url.password||url.search||url.hash||(url.pathname&&url.pathname!=='/'))throw new Error(t('地址中不能包含密码、路径或查询参数。'));
 const host=url.hostname.replace(/^\[|\]$/g,''),port=url.port?Number(url.port):(url.protocol==='telnet:'?23:url.protocol==='ftp:'||url.protocol==='ftps:'?21:22);
 let username:string;try{username=decodeURIComponent(url.username);}catch{throw new Error(t('用户名编码无效。'));}
 if(!host||host.length>255||!Number.isInteger(port)||port<1||port>65535||username.length>255||/[\x00-\x1f\x7f]/.test(username))throw new Error(t('主机、用户名或端口无效。'));
 return {...(url.protocol==='ftp:'||url.protocol==='ftps:'?{protocol:'ftp' as const,ftpSecurity:url.protocol==='ftp:'?'none' as const:'explicit' as const}:{}),...(url.protocol==='telnet:'?{protocol:'telnet' as const}:{}),host,port,username};
}
