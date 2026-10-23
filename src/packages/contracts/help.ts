export type HelpLink = 'website'|'support'|'feedback'|'releases';
export interface UpdateInfo { current:string; latest:string; available:boolean; url:string; notes:string; installerAvailable:boolean; downloaded?:UpdateDownload }
export interface UpdateDownload { fileName:string; size:number }
export interface AppInfo { version:string; platform:string; arch:string; electron:string; chrome:string; node:string }
