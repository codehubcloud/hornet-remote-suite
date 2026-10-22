import type { Profile } from '../contracts';

/** Cosmetic/session settings can change while the existing transport keeps its snapshot. */
export function sameTransport(a:Profile,b:Profile){
 return JSON.stringify([a.protocol??'ssh',a.host,a.port,a.username,a.authType,a.ftpSecurity,a.jumpProfileIds??[],a.session?.mosh??false,a.session?.s3??false,a.session?.s3Region])===JSON.stringify([b.protocol??'ssh',b.host,b.port,b.username,b.authType,b.ftpSecurity,b.jumpProfileIds??[],b.session?.mosh??false,b.session?.s3??false,b.session?.s3Region]);
}
