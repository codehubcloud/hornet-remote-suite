import { z } from 'zod';

export const terminalEncodingSchema=z.enum(['utf8','gb18030','gbk','big5','shift_jis','euc-kr','windows-1251','windows-1252','iso-8859-1']);
export type TerminalEncoding=z.infer<typeof terminalEncodingSchema>;
export const terminalEncodingLabels:Record<TerminalEncoding,string>={utf8:'UTF-8',gb18030:'GB18030',gbk:'GBK',big5:'Big5',shift_jis:'Shift JIS', 'euc-kr':'EUC-KR','windows-1251':'Windows-1251','windows-1252':'Windows-1252','iso-8859-1':'ISO-8859-1'};
