// Native macOS full-screen transitions are asynchronous. Retain the most
// recent user request until the transition's completion event arrives.
export class FullscreenController {
 private target:boolean|undefined;
 private transitioning=false;
 constructor(private current:()=>boolean,private apply:(value:boolean)=>void){}
 set(value:boolean){this.target=value;this.reconcile();}
 toggle(){this.set(!(this.target??this.current()));}
 completed(){this.transitioning=false;this.reconcile();}
 private reconcile(){
  if(this.transitioning||this.target===undefined)return;
  if(this.target===this.current()){this.target=undefined;return;}
  this.transitioning=true;this.apply(this.target);
 }
}
