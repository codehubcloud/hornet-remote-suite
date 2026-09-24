export function parseQuickAddress(value:string):{host:string;port:number;username:string}{
 const text=value.trim();
 if(!text||/[\s\x00-\x1f\x7f]/.test(text))throw new Error('请输入主机地址或 user@host:port。');
 if(text.includes('://')&&!text.startsWith('ssh://'))throw new Error('快速连接目前支持 SSH 地址。');
 let url:URL;
 try{url=new URL(text.startsWith('ssh://')?text:'ssh://'+text);}catch{throw new Error('地址格式无效；IPv6 地址请使用方括号。');}
 if(url.password||url.search||url.hash||(url.pathname&&url.pathname!=='/'))throw new Error('地址中不能包含密码、路径或查询参数。');
 const host=url.hostname.replace(/^\[|\]$/g,''),port=url.port?Number(url.port):22;
 let username:string;try{username=decodeURIComponent(url.username);}catch{throw new Error('用户名编码无效。');}
 if(!host||host.length>255||!Number.isInteger(port)||port<1||port>65535||username.length>255||/[\x00-\x1f\x7f]/.test(username))throw new Error('主机、用户名或端口无效。');
 return {host,port,username};
}
