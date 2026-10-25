import type { Profile } from '../../../packages/contracts';
const labels:Record<string,string>={ubuntu:'Ubuntu',debian:'Debian',fedora:'Fedora',centos:'CentOS',rhel:'Red Hat Enterprise Linux',rocky:'Rocky Linux',almalinux:'AlmaLinux',alpine:'Alpine Linux',arch:'Arch Linux',suse:'openSUSE / SUSE',linux:'Linux',windows:'Windows',macos:'macOS',freebsd:'FreeBSD',openbsd:'OpenBSD',netbsd:'NetBSD',aix:'AIX',solaris:'Solaris'};
export function SystemIcon({profile}:{profile:Profile}){
 const system=profile.remoteSystem??(profile.protocol==='local'?(window.hornet.windowChrome.platform==='win32'?'windows':window.hornet.windowChrome.platform==='darwin'?'macos':'linux'):undefined);
 if(!system)return <span className="host-symbol" aria-hidden="true">{profile.protocol==='ftp'?'▰':profile.protocol==='rdp'?'▣':'›_'}</span>;
 return <span className="system-icon" data-system={system} title={labels[system]} role="img" aria-label={labels[system]}><svg viewBox="0 0 32 32" aria-hidden="true">
  {system==='windows'?<g fill="#00a4ef"><path d="M2 6l12-2v11H2zm14-2l14-2v13H16zM2 17h12v11L2 26zm14 0h14v13l-14-2z"/></g>:
   system==='ubuntu'?<><circle cx="16" cy="16" r="15" fill="#e95420"/><circle cx="16" cy="16" r="8" fill="none" stroke="white" strokeWidth="3"/>{[[25,16],[11.5,8.2],[11.5,23.8]].map(([x,y],i)=><circle key={i} cx={x} cy={y} r="3.1" fill="white" stroke="#e95420" strokeWidth="1.8"/>)}</>:
   system==='debian'?<path d="M16 29C0 20 8 1 21 5c10 4 3 20-5 15-5-3-2-10 3-8-4-5-10 4-5 9 9 8 20-10 9-17C8-5-7 17 16 29" fill="#d70a53"/>:
   system==='macos'?<g fill="currentColor"><path d="M19 8c0-4 3-6 6-6 0 4-3 7-6 6M16 10c-4-3-12-1-12 7 0 7 5 14 8 13 3-2 5-2 8 0 3 1 7-5 8-8-5-2-5-8-1-11-3-4-7-3-11-1"/></g>:
   ['linux','alpine','arch','suse'].includes(system)?<><ellipse cx="16" cy="18" rx="10" ry="13" fill="#222" stroke="#888"/><ellipse cx="16" cy="21" rx="7" ry="9" fill="#f4f4f4"/><ellipse cx="13" cy="10" rx="2" ry="3" fill="white"/><ellipse cx="19" cy="10" rx="2" ry="3" fill="white"/><path d="M12 13l4-2 4 2-4 3zM4 27l9-2 1 5H3zm15-2l9 2 1 3H18z" fill="#f9c440"/><circle cx="13" cy="10" r="1"/><circle cx="19" cy="10" r="1"/></>:
   <><rect x="1" y="1" width="30" height="30" rx="8" fill={system==='fedora'?'#294172':system==='rhel'?'#c00':system==='centos'?'#932279':system==='rocky'?'#10b981':'#425c88'}/><text x="16" y="22" textAnchor="middle" fill="white" fontSize="18" fontFamily="Segoe UI,sans-serif" fontWeight="bold">{system==='fedora'?'f':system==='centos'?'C':system==='rocky'?'R':labels[system][0]}</text></>}
 </svg></span>;
}
