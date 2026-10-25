import { expect } from '@playwright/test';
const sessionPromptPages=new WeakSet();
// Unrelated fixtures accept the normal session-close prompt. A test can install
// its own dialog listener to exercise cancellation or inspect the actual message.
function acceptSessionPrompts(page){
 if(sessionPromptPages.has(page))return;sessionPromptPages.add(page);
 page.on('dialog',dialog=>{
  if(page.listeners('dialog').length>1)return;
  const session=/您已连接到 |您已連線至 |You are connected to |接続先: |에 연결되어 있습니다\.|Sie sind mit |Vous êtes connecté à |Está conectado a /.test(dialog.message());
  void(session?dialog.accept():dialog.dismiss());
 });
}
export async function dismissStartupGuide(page){
 const guide=page.getByRole('dialog',{name:'用户使用指引',exact:true});
 await expect(page.getByRole('dialog',{name:/^(用户使用指引|会话)$/})).toBeVisible({timeout:30000});
 if(await guide.isVisible())await guide.getByRole('button',{name:'开始使用',exact:true}).click();
}
// Exercise the normal startup preference so unrelated smoke tests can reach their workspace.
export async function dismissStartupSessions(page){
 acceptSessionPrompts(page);
 await dismissStartupGuide(page);
 const dialog=page.getByRole('dialog',{name:'会话',exact:true});
 // Assertion timeouts are separate from page.setDefaultTimeout(). Slow CI
 // runners need the same startup allowance as the application launch checks.
 await expect(dialog).toBeVisible({timeout:30000});
 await dialog.getByRole('checkbox').uncheck();
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();
}
