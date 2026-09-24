import { describe,it,expect } from 'vitest';
import { ShellIdentity } from '../../services/terminal/shell-identity';
import { tileTerminals,layoutRects,splitLeaf,removeLeaf,setRatio,type SplitTree } from '../../apps/desktop/renderer/terminal-layout';

describe('terminal directory identity and split geometry',()=>{
 it('tiles existing identities evenly and collapses without replacing surviving terminals',()=>{
  for(const axis of ['horizontal','vertical'] as const){
   const ids=['one','two','three','four','five'];
   let tree=tileTerminals(ids,axis)!;
   const layout=layoutRects(tree);
   expect([...layout.panes.keys()]).toEqual(ids);
   for(const rect of layout.panes.values())expect(axis==='vertical'?rect.width:rect.height).toBeCloseTo(20);
   for(const id of ids.slice(1))tree=removeLeaf(tree,id)!;
   expect(tree).toEqual({kind:'leaf',id:'one'});
  }
  expect(tileTerminals([],'horizontal')).toBeNull();
 });

 it('accepts only the session marker across arbitrary byte boundaries',()=>{
  const identity=new ShellIdentity();
  identity.feed(Buffer.from('\x1b]1337;HornetPID=wrong;123\x07'));
  expect(identity.pid).toBeUndefined();
  identity.feed(Buffer.alloc(100000,65));
  const marker=Buffer.from('\x1b]1337;HornetPID='+identity.token+';12345\x07');
  for(const byte of marker)identity.feed(Buffer.from([byte]));
  expect(identity.pid).toBe('12345');
  identity.feed(Buffer.from('\x1b]1337;HornetPID='+identity.token+';999\x07'));
  expect(identity.pid).toBe('12345');
 });
 it('keeps a stable pane identity when nested splits resize and collapse',()=>{
  let tree:SplitTree={kind:'leaf',id:'a'};
  tree=splitLeaf(tree,'a','b','vertical');tree=splitLeaf(tree,'b','c','horizontal');
  let layout=layoutRects(tree);
  expect(layout.panes.get('a')).toEqual({x:0,y:0,width:50,height:100});
  expect(layout.panes.get('c')).toEqual({x:50,y:50,width:50,height:50});
  tree=setRatio(tree,layout.dividers[0].node.id,0.6);
  tree=removeLeaf(tree,'b')!;layout=layoutRects(tree);
  expect([...layout.panes.keys()]).toEqual(['a','c']);
  expect(layout.panes.get('c')).toEqual({x:60,y:0,width:40,height:100});
  expect(layout.dividers).toHaveLength(1);
 });
});
