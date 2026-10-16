import { layoutRects,removeLeaf,replaceLeaf,splitLeaf,type SplitTree } from './terminal-layout';
import type { View } from './store';
export const tabGroup=(view:View)=>view.tabGroupId??'main';
export function selectTab(views:View[],tree:SplitTree|null,id:string):SplitTree|null{
 const view=views.find(v=>v.id===id&&v.kind==='terminal');if(!tree||!view)return tree;
 const visible=[...layoutRects(tree).panes.keys()];if(visible.includes(id))return tree;
 const peer=views.find(v=>v.kind==='terminal'&&tabGroup(v)===tabGroup(view)&&visible.includes(v.id));return peer?replaceLeaf(tree,peer.id,id):tree;
}
export function removeTab(views:View[],tree:SplitTree|null,id:string){
 if(!tree)return tree;const view=views.find(v=>v.id===id),replacement=view&&views.find(v=>v.id!==id&&v.kind==='terminal'&&tabGroup(v)===tabGroup(view));
 return replacement?replaceLeaf(tree,id,replacement.id):removeLeaf(tree,id);
}
export function createTabGroup(views:View[],tree:SplitTree|null,id:string,axis:'horizontal'|'vertical'){
 const view=views.find(v=>v.id===id&&v.kind==='terminal'),peer=view&&views.find(v=>v.kind==='terminal'&&v.id!==id&&tabGroup(v)===tabGroup(view));
 if(!view||!peer)return {views,terminalLayout:tree};
 const base=tree?replaceLeaf(selectTab(views,tree,id)!,id,peer.id):{kind:'leaf' as const,id:peer.id};
 return {views:views.map(v=>v.id===id?{...v,tabGroupId:crypto.randomUUID()}:v),terminalLayout:splitLeaf(base,peer.id,id,axis)};
}
export function moveTab(views:View[],tree:SplitTree|null,id:string,groupId:string){
 const view=views.find(v=>v.id===id&&v.kind==='terminal');if(!view||tabGroup(view)===groupId||!views.some(v=>v.kind==='terminal'&&tabGroup(v)===groupId))return {views,terminalLayout:tree};
 const remaining=removeTab(views,tree,id),next=views.map(v=>v.id===id?{...v,tabGroupId:groupId}:v);
 return {views:next,terminalLayout:selectTab(next,remaining,id)};
}
