import { expect } from '@playwright/test';
export async function dismissStartupGuide(page){
 const guide=page.getByRole('dialog',{name:'用户使用指引',exact:true});
 await expect(page.getByRole('dialog',{name:/^(用户使用指引|会话)$/})).toBeVisible({timeout:30000});
 if(await guide.isVisible())await guide.getByRole('button',{name:'开始使用',exact:true}).click();
}
// Exercise the normal startup preference so unrelated smoke tests can reach their workspace.
export async function dismissStartupSessions(page){
 await dismissStartupGuide(page);
 const dialog=page.getByRole('dialog',{name:'会话',exact:true});
 // Assertion timeouts are separate from page.setDefaultTimeout(). Slow CI
 // runners need the same startup allowance as the application launch checks.
 await expect(dialog).toBeVisible({timeout:30000});
 await dialog.getByRole('checkbox').uncheck();
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();
}
