export type SplitTree={kind:'leaf';id:string}|{kind:'split';id:string;axis:'horizontal'|'vertical';ratio:number;first:SplitTree;second:SplitTree};
export type Rect={x:number;y:number;width:number;height:number};
export function replaceLeaf(tree:SplitTree,id:string,nextId:string):SplitTree{return tree.kind==='leaf'?(tree.id===id?{kind:'leaf',id:nextId}:tree):{...tree,first:replaceLeaf(tree.first,id,nextId),second:replaceLeaf(tree.second,id,nextId)};}
export function splitLeaf(tree:SplitTree,id:string,newId:string,axis:'horizontal'|'vertical'):SplitTree {
 if(tree.kind==='leaf')return tree.id===id?{kind:'split',id:crypto.randomUUID(),axis,ratio:0.5,first:tree,second:{kind:'leaf',id:newId}}:tree;
 return {...tree,first:splitLeaf(tree.first,id,newId,axis),second:splitLeaf(tree.second,id,newId,axis)};
}
export function removeLeaf(tree:SplitTree,id:string):SplitTree|null {
 if(tree.kind==='leaf')return tree.id===id?null:tree;
 const first=removeLeaf(tree.first,id),second=removeLeaf(tree.second,id);
 return first&&second?{...tree,first,second}:first??second;
}
export function setRatio(tree:SplitTree,id:string,ratio:number):SplitTree {
 if(tree.kind==='leaf')return tree;
 if(tree.id===id)return {...tree,ratio:Math.max(0.2,Math.min(0.8,ratio))};
 return {...tree,first:setRatio(tree.first,id,ratio),second:setRatio(tree.second,id,ratio)};
}
export function layoutRects(tree:SplitTree,rect:Rect={x:0,y:0,width:100,height:100},panes=new Map<string,Rect>(),dividers:{node:Extract<SplitTree,{kind:'split'}>;rect:Rect}[]=[]){
 if(tree.kind==='leaf')panes.set(tree.id,rect);
 else{
  dividers.push({node:tree,rect});
  const vertical=tree.axis==='vertical',size=vertical?'width':'height',position=vertical?'x':'y';
  layoutRects(tree.first,{...rect,[size]:rect[size]*tree.ratio},panes,dividers);
  layoutRects(tree.second,{...rect,[position]:rect[position]+rect[size]*tree.ratio,[size]:rect[size]*(1-tree.ratio)},panes,dividers);
 }
 return {panes,dividers};
}

export function tileTerminals(ids:string[],axis:'horizontal'|'vertical'):SplitTree|null {
 if(!ids.length)return null;if(ids.length===1)return {kind:'leaf',id:ids[0]};
 const middle=Math.ceil(ids.length/2);return {kind:'split',id:crypto.randomUUID(),axis,ratio:middle/ids.length,first:tileTerminals(ids.slice(0,middle),axis)!,second:tileTerminals(ids.slice(middle),axis)!};
}
