export function menuPosition(anchor:{left:number;right:number;top:number;bottom:number},size:{width:number;height:number},viewport:{width:number;height:number},nested=false,point?:{x:number;y:number}){
 const left=point?.x??(nested?(anchor.right+size.width<=viewport.width-2?anchor.right-1:anchor.left-size.width+1):anchor.left);
 const top=point?.y??(nested?anchor.top:anchor.bottom);
 return {left:Math.max(2,Math.min(left,viewport.width-size.width-2)),top:Math.max(2,Math.min(top,viewport.height-size.height-4))};
}
