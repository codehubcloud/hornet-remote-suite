import { it,expect } from 'vitest';
import { menuPosition } from '../../apps/desktop/renderer/menu-position';
const viewport={width:1024,height:768},size={width:270,height:200};
it('opens a submenu to the left when the right edge has insufficient room, leaving its trigger clickable',()=>{
 const anchor={left:720,right:1020,top:300,bottom:325},position=menuPosition(anchor,size,viewport,true);
 expect(position.left+size.width).toBeLessThanOrEqual(anchor.left+1);expect(position.left).toBeGreaterThanOrEqual(2);
 expect(position.top).toBe(anchor.top);
});
it('keeps a submenu on the right when there is room and constrains root menus to the viewport',()=>{
 const anchor={left:200,right:500,top:300,bottom:325},right=menuPosition(anchor,size,viewport,true);
 expect(right.left).toBeGreaterThanOrEqual(anchor.right-1);expect(right.left+size.width).toBeLessThan(viewport.width);
 const root=menuPosition(anchor,size,viewport,false,{x:1010,y:750});
 expect(root.left+size.width).toBeLessThan(viewport.width);expect(root.top+size.height).toBeLessThan(viewport.height);
});
