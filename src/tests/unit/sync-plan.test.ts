import { it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { planSync } from '../../services/file/sync-plan';
import type { TreeEntry,TreeRequest } from '../../packages/contracts/file-tree';
const file=(path:string,modified=10000,hash='a'):TreeEntry=>({path,kind:'file',size:4,modified,hash});
const request:TreeRequest={connectionId:randomUUID(),rootId:randomUUID(),localPath:'',remotePath:'/',direction:'bidirectional',policy:'newer'};
const plan=(left:TreeEntry[],right:TreeEntry[],override:Partial<TreeRequest>={},windows=false)=>planSync({root:'local',entries:left},{root:'/',entries:right},{...request,...override},windows);
it('compares a union once, preserves unique files and chooses the newer side only for different content',()=>{
 const actions=plan([file('left'),file('up',20000),file('down',10000),file('same',30000),file('tie',10000)], [file('right'),file('up',10000,'b'),file('down',20000,'b'),file('same'),file('tie',11000,'b')]);
 expect(actions.find(a=>a.path==='left')).toMatchObject({action:'copy',direction:'upload'});expect(actions.find(a=>a.path==='right')).toMatchObject({action:'copy',direction:'download'});
 expect(actions.find(a=>a.path==='up')).toMatchObject({action:'replace',direction:'upload'});expect(actions.find(a=>a.path==='down')).toMatchObject({action:'replace',direction:'download'});
 expect(actions.find(a=>a.path==='same')?.action).toBe('skip');expect(actions.find(a=>a.path==='tie')?.action).toBe('conflict');
});
it('respects one-way boundaries and permits explicit side preference',()=>{
 const l=[file('a',10000)],r=[file('a',20000,'b'),file('remote-only')];
 expect(plan(l,r,{direction:'upload'})[0]).toMatchObject({path:'a',action:'skip'});
 expect(plan(l,r,{policy:'local'})[0]).toMatchObject({action:'replace',direction:'upload'});
 expect(plan(l,r,{policy:'remote'})[0]).toMatchObject({action:'replace',direction:'download'});
 expect(plan(l,r,{direction:'upload',policy:'skip'})[0].action).toBe('conflict');
});
it('keeps both originals and assigns distinct non-overwriting copy names',()=>{
 const actions=plan([file('a.txt'),file('a (local).txt')],[file('a.txt',10000,'b')],{policy:'keep-both'});
 expect(actions).toContainEqual(expect.objectContaining({path:'a (local 2).txt',sourcePath:'a.txt',direction:'upload',action:'copy'}));
 expect(actions).toContainEqual(expect.objectContaining({path:'a (remote).txt',sourcePath:'a.txt',direction:'download',action:'copy'}));
 expect(actions.some(a=>a.action==='replace')).toBe(false);
});
it('blocks descendants of type/case conflicts, links, device names and transfer scratch files',()=>{
 const actions=plan([{...file('folder'),kind:'directory'},file('folder/child'),file('Case'),file('NUL.txt'),{...file('link'),kind:'link'},file('.hornet-123abc.part')],[file('folder'),file('case',10000,'b')],{},true);
 expect(actions.every(a=>a.action==='conflict')).toBe(true);
 expect(plan([], [file('Case'),file('case')],{},true).every(a=>a.action==='conflict')).toBe(true);
});
