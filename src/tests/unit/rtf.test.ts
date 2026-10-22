import { expect,it } from 'vitest';
import { plainRtf } from '../../apps/desktop/main/rtf';
it('escapes RTF syntax and preserves Unicode, surrogate pairs and line breaks',()=>{
 const rtf=plainRtf('a{b}\\c\r\n中文😀');
 expect(rtf).toContain('a\\{b\\}\\\\c\\par\n');
 expect(rtf).toContain('\\u20013?\\u25991?\\u-10179?\\u-8704?');
 expect(rtf.startsWith('{\\rtf1')).toBe(true);
});
