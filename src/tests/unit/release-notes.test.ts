import { expect,it } from 'vitest';
import { localizedReleaseNotes } from '../../packages/core/release-notes';
import bundled from '../../packages/core/legacy-release-notes.json';
it('selects only the configured language from multilingual releases',()=>{
 const body=Object.entries(bundled.notes).map(([language,text])=>`<!-- hornet-notes:${language} -->\n${text}\n<!-- /hornet-notes -->`).join('\n');
 for(const [language,text]of Object.entries(bundled.notes))expect(localizedReleaseNotes(body,language,'9.0.0')).toBe(text);
 expect(localizedReleaseNotes(body,'invalid','9.0.0')).toBeUndefined();
});
it('localizes the legacy 0.0.27 body without leaking another language into an incomplete release',()=>{
 for(const [language,text]of Object.entries(bundled.notes))expect(localizedReleaseNotes('old Chinese body',language,bundled.version)).toBe(text);
 expect(localizedReleaseNotes('legacy body','en','0.0.1')).toBeUndefined();
 expect(localizedReleaseNotes('<!-- hornet-notes:zh-CN -->中文<!-- /hornet-notes -->','en',bundled.version)).toBeUndefined();
});
