import { afterEach,describe,expect,it,vi } from 'vitest';
import { readAppearance,useAppearance,appearanceKey,languages,themes,applyAppearance } from '../../apps/desktop/renderer/appearance';
import { challengeCopy } from '../../apps/desktop/renderer/challenge-copy';
import { t,formatDate } from '../../apps/desktop/renderer/i18n';
import { english } from '../../apps/desktop/renderer/locales/en';
import { catalogs } from '../../apps/desktop/renderer/locales/catalogs';
import { terminalThemes,terminalPreferencesSchema,readTerminalPreferences,terminalDefaults } from '../../apps/desktop/renderer/terminal-preferences';
afterEach(()=>{vi.unstubAllGlobals();useAppearance.setState({value:{language:'zh-CN',theme:'light'}});});
describe('application appearance',()=>{
 it.each([null,'{','null','[]','{"language":"zz","theme":"unknown"}'])('recovers corrupt or unsupported preferences %s',raw=>{
  expect(readAppearance(raw)).toEqual({language:'zh-CN',theme:'light'});
 });
 it('preserves the supported part of a preference when the other part is missing or invalid',()=>{
  expect(readAppearance('{"theme":"dark"}')).toEqual({language:'zh-CN',theme:'dark'});
  expect(readAppearance('{"language":"fr","theme":"unknown"}')).toEqual({language:'fr',theme:'light'});
  expect(readAppearance('{"language":"zz","theme":"nord"}')).toEqual({language:'zh-CN',theme:'nord'});
 });
 it('round-trips every supported language and theme, and applies system theme independently',()=>{
  vi.stubGlobal('document',{documentElement:{lang:'',dataset:{}}});
  for(const {id:language} of languages)for(const theme of themes){
   const value={language,theme};expect(readAppearance(JSON.stringify(value))).toEqual(value);
   applyAppearance(value,true);expect(document.documentElement.lang).toBe(language);expect(document.documentElement.dataset.theme).toBe(theme==='system'?'dark':theme);
  }
  applyAppearance({language:'ja',theme:'system'},false);expect(document.documentElement.dataset.theme).toBe('light');
 });
 it('persists only supported preferences, without publishing failed writes',()=>{
  const setItem=vi.fn();vi.stubGlobal('localStorage',{setItem});
  useAppearance.getState().save({language:'en',theme:'system'});
  expect(readAppearance(setItem.mock.calls[0][1])).toEqual({language:'en',theme:'system'});
  expect(setItem.mock.calls[0][0]).toBe(appearanceKey);
  setItem.mockImplementation(()=>{throw new Error('storage unavailable');});
  expect(()=>useAppearance.getState().save({language:'zh-CN',theme:'dark'})).toThrow('storage unavailable');
  expect(useAppearance.getState().value).toEqual({language:'en',theme:'system'});
 });
 it('translates application copy while preserving interpolation values and whitespace',()=>{
  useAppearance.setState({value:{language:'en',theme:'light'}});
  expect(t('文件')).toBe('File');expect(t(' 文件 ')).toBe(' File ');expect(t('  ')).toBe('  ');
  expect(t('literal {path}',{path:'/文件/默认分组/{other}'})).toBe('literal /文件/默认分组/{other}');
  expect(t('{constructor}')).toBe('{constructor}');expect(t('constructor')).toBe('constructor');expect(t('__proto__')).toBe('__proto__');
  useAppearance.setState({value:{language:'zh-CN',theme:'light'}});expect(t('文件')).toBe('文件');
 });
 it('localizes authentication instructions without modifying server data',()=>{
  useAppearance.setState({value:{language:'en',theme:'light'}});
  expect(challengeCopy({kind:'keyboard',title:'SSH 交互认证',message:'文件'})).toEqual({title:'SSH interactive authentication',message:'文件'});
  const copy=challengeCopy({kind:'trust',title:'首次连接：核对主机指纹',message:'中文主机:22\nSHA256:abc123\n请通过可信渠道核对，接受后保存。'});
  expect(copy.message).toBe('中文主机:22\nSHA256:abc123\nVerify through a trusted channel. Accepting saves this fingerprint.');
 });
 it('keeps translation placeholders intact',()=>{
  for(const catalog of [english,...Object.values(catalogs)])for(const [source,translated] of Object.entries(catalog)){
   expect(translated.trim(),source).not.toBe('');
   expect([...translated.matchAll(/\{(\w+)\}/g)].map(v=>v[1]).sort(),source).toEqual([...source.matchAll(/\{(\w+)\}/g)].map(v=>v[1]).sort());
  }
 });
 it('provides native menus in every language, with English fallback for technical descriptions',()=>{
  const expected={'zh-CN':'文件','zh-TW':'檔案',en:'File',ja:'ファイル',ko:'파일',de:'Datei',fr:'Fichier',es:'Archivo'};
  for(const {id:language} of languages){useAppearance.setState({value:{language,theme:'light'}});expect(t('文件')).toBe(expected[language]);}
  useAppearance.setState({value:{language:'ja',theme:'nord'}});
  const detailed='留空直接连接，最多四跳。先保存各跳板的直连 SSH 配置，再按从本机到目标的顺序添加；每一跳分别认证和核验指纹。';
  expect(t(detailed)).toBe(english[detailed]);
  expect(t('literal {path}',{path:'/文件/名前/{other}'})).toBe('literal /文件/名前/{other}');
  expect(formatDate(1700000000000)).toBe(new Date(1700000000000).toLocaleString('ja'));
  expect(Object.keys(catalogs['zh-TW']).sort()).toEqual(Object.keys(english).sort());
 });
 it('accepts the expanded terminal palettes without resetting existing terminal preferences',()=>{
  expect(readTerminalPreferences(JSON.stringify({...terminalDefaults,fontSize:17,theme:'solarized'}))).toEqual({...terminalDefaults,fontSize:17,theme:'solarized'});
  for(const theme of Object.keys(terminalThemes))expect(terminalPreferencesSchema.parse({...terminalDefaults,theme}).theme).toBe(theme);
 });
});
