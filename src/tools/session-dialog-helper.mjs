import { expect } from '@playwright/test';
// Exercise the normal startup preference so unrelated smoke tests can reach their workspace.
export async function dismissStartupSessions(page){
 const dialog=page.getByRole('dialog',{name:'会话',exact:true});
 await expect(dialog).toBeVisible();
 await dialog.getByRole('checkbox').uncheck();
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();
}
