import { traditionalChinese } from './zh-TW';
import { nativeUi } from './native-ui';
import type { Language } from '../appearance';
const languageColumns=['ja','ko','de','fr','es'] as const;
export const catalogs:Record<Exclude<Language,'zh-CN'|'en'>,Record<string,string>>={
 'zh-TW':traditionalChinese,
 ...Object.fromEntries(languageColumns.map((id,index)=>[id,Object.fromEntries(Object.entries(nativeUi).map(([key,row])=>[key,row[index]]))])) as Record<typeof languageColumns[number],Record<string,string>>,
};
