export const startupSessionsKey='hornet.sessions.showOnStartup';
export function readStartupSessions(raw:string|null){return raw!=='false';}
export function showStartupSessions(){
 try{return readStartupSessions(localStorage.getItem(startupSessionsKey));}catch{return true;}
}
