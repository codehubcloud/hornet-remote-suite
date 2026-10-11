import { afterEach,describe,expect,it,vi } from 'vitest';
import { readAppearance,useAppearance,appearanceKey } from '../../apps/desktop/renderer/appearance';
import { challengeCopy } from '../../apps/desktop/renderer/challenge-copy';
import { t } from '../../apps/desktop/renderer/i18n';
import { english } from '../../apps/desktop/renderer/locales/en';
afterEach(()=>{vi.unstubAllGlobals();useAppearance.setState({value:{language:'zh-CN',theme:'light'}});});
describe('application appearance',()=>{
 it.each([null,'{','null','[]','{"theme":"dark"}','{"language":"fr","theme":"light"}','{"language":"en","theme":"unknown"}'])('recovers corrupt or unsupported preferences %s',raw=>{
  expect(readAppearance(raw)).toEqual({language:'zh-CN',theme:'light'});
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
  for(const [source,translated] of Object.entries(english)){
   expect(translated.trim(),source).not.toBe('');
   expect([...translated.matchAll(/\{(\w+)\}/g)].map(v=>v[1]).sort(),source).toEqual([...source.matchAll(/\{(\w+)\}/g)].map(v=>v[1]).sort());
  }
 });
});
