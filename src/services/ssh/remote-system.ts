import type { Client,ClientChannel } from 'ssh2';
import type { RemoteSystem } from '../../packages/contracts/remote-system';

export function parseRemoteSystem(output:string):RemoteSystem|undefined{
 const id=/^ID\s*=\s*["']?([a-z0-9_-]+)/im.exec(output)?.[1]?.toLowerCase();
 const distros:Record<string,RemoteSystem>={ubuntu:'ubuntu',debian:'debian',fedora:'fedora',centos:'centos',rhel:'rhel',rocky:'rocky',almalinux:'almalinux',alpine:'alpine',arch:'arch',opensuse:'suse','opensuse-leap':'suse','opensuse-tumbleweed':'suse',sles:'suse'};
 if(id&&Object.hasOwn(distros,id))return distros[id];
 if(/Microsoft Windows|Windows_NT|^MINGW|^MSYS|^CYGWIN/im.test(output))return 'windows';
 for(const [pattern,system] of [[/^Darwin\b/im,'macos'],[/^Linux\b/im,'linux'],[/^FreeBSD\b/im,'freebsd'],[/^OpenBSD\b/im,'openbsd'],[/^NetBSD\b/im,'netbsd'],[/^AIX\b/im,'aix'],[/^SunOS\b/im,'solaris']] as const)if(pattern.test(output))return system;
}
// A separate, bounded exec channel never writes probe commands into the user's shell.
export async function detectRemoteSystem(client:Client):Promise<RemoteSystem|undefined>{
 const probe=(command:string)=>new Promise<string>(resolve=>{
  let channel:ClientChannel|undefined,done=false,bytes=0,output='';
  const finish=()=>{if(done)return;done=true;clearTimeout(timer);channel?.destroy();resolve(output);};
  const timer=setTimeout(finish,2500);
  try{client.exec(command,(error,stream)=>{if(done){stream?.on('error',()=>{});stream?.destroy();return;}if(error){finish();return;}channel=stream;stream.on('error',finish);stream.on('close',finish);stream.on('data',(data:Buffer)=>{bytes+=data.length;if(bytes>16384){finish();return;}output+=data.toString('utf8');});stream.stderr.on('data',()=>{});});}catch{finish();}
 });
 return parseRemoteSystem(await probe('uname -s; cat /etc/os-release 2>/dev/null'))??parseRemoteSystem(await probe('cmd /c ver'));
}
