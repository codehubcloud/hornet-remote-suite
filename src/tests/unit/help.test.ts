import { describe,it,expect,vi } from 'vitest';
import { checkForUpdates,newerVersion,helpLinks,helpBase } from '../../packages/core/help';
import { manualHtml,manualSections } from '../../packages/core/help-content';
import { userGuideSections } from '../../packages/core/user-guide';
import { localizedReleaseNotes } from '../../packages/core/release-notes';
import translations from '../../release-notes.json';
const release=(tag_name='v0.0.12',extra={})=>new Response(JSON.stringify({tag_name,draft:false,prerelease:false,body:'release notes',...extra}));
describe('application help and release checks',()=>{
 it('fetches bounded, version-bound translation metadata',async()=>{
  const latest=translations.version,url=`${helpBase}/releases/download/v${latest}/release-notes.json`;
  const fetcher=vi.fn<typeof fetch>(async address=>String(address)===url?new Response(JSON.stringify(translations)):release('v'+latest,{body:'Plain English release notes',assets:[{name:'release-notes.json',browser_download_url:url}]}));
  const result=await checkForUpdates('0.0.27',fetcher);
  for(const [language,text]of Object.entries(translations.notes))expect(localizedReleaseNotes(result.notes,language,latest)).toBe(text);
  expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('ignores untrusted, mismatched, oversized or unavailable optional notes while preserving update checks',async()=>{
  const latest=translations.version,url=`${helpBase}/releases/download/v${latest}/release-notes.json`;
  for(const metadata of [new Response('',{status:503}),new Response(JSON.stringify({...translations,version:'99.0.0'})),new Response('x'.repeat(65537)),new Response('{}')]){
   const result=await checkForUpdates('0.0.27',async address=>String(address)===url?metadata:release('v'+latest,{assets:[{name:'release-notes.json',browser_download_url:url}]}));
   expect(result.available).toBe(true);expect(result.notes).toBe('release notes');
  }
  const fetcher=vi.fn<typeof fetch>(async()=>release('v'+latest,{assets:[{name:'release-notes.json',browser_download_url:'https://untrusted.example/notes.json'}]}));
  await checkForUpdates('0.0.27',fetcher);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('compares numeric stable versions without offering downgrades',()=>{
  expect(newerVersion('0.0.12','0.0.9')).toBe(true);expect(newerVersion('0.0.12','0.0.12')).toBe(false);expect(newerVersion('0.0.11','0.0.12')).toBe(false);expect(()=>newerVersion('v1.0.0','0.0.1')).toThrow();
 });
 it('queries only the public repository with a bounded request and constructs a trusted release URL',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>release('v0.0.12',{html_url:'https://untrusted.example'}));
  const result=await checkForUpdates('0.0.11',fetcher as typeof fetch);expect(result).toEqual({current:'0.0.11',latest:'0.0.12',available:true,url:helpBase+'/releases/tag/v0.0.12',notes:'release notes',installerAvailable:false});
  expect(fetcher.mock.calls[0][0]).toContain('/hornet-remote-suite-release/releases/latest');expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  expect(helpLinks.website).toBe('https://codehub.org.cn/products/hornet-remote-suite/');
  expect([helpLinks.support,helpLinks.feedback,helpLinks.releases].every(url=>url.startsWith(helpBase))).toBe(true);
 });
 it('rejects failures, drafts, malformed versions and oversized response streams',async()=>{
  for(const response of [new Response('',{status:403}),release('v0.0.12',{draft:true}),release('v0.0.12',{prerelease:true}),release('../other'),new Response('x'.repeat(262145)),new Response('{}',{headers:{'content-length':'262145'}})])await expect(checkForUpdates('0.0.11',async()=>response)).rejects.toThrow();
  await expect(checkForUpdates('0.0.11',async()=>{throw new Error('offline');})).rejects.toThrow('offline');
 });
 it('ships an offline guide covering commands, files, session settings and support without executable content',()=>{
  expect(manualSections('zh-CN')).toHaveLength(8);expect(manualSections('de')[0].title).toBe('Connections and authentication');
  const html=manualHtml('en','<script>');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).toContain("default-src 'none'");expect(html).toContain('Quick commands');
  for(const language of ['zh-CN','zh-TW','en','ja','ko','de','fr','es']){
   const sections=userGuideSections(language),pdf=manualHtml(language,'0.0.13');
   expect(sections).toHaveLength(12);expect(new Set(sections.map(s=>s.id)).size).toBe(sections.length);
   for(const section of sections){expect(section.steps.length).toBeGreaterThanOrEqual(3);expect(pdf).toContain(`id="guide-${section.id}"`);expect(pdf).toContain(section.title);}
  }
  expect(userGuideSections('zh-TW')[0].title).toContain('安裝');expect(userGuideSections('en')[0].title).toContain('Installation');
 });
});
