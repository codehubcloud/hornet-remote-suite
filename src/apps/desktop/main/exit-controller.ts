// Exit must not depend on a responsive renderer, backend or log filesystem.
// Only the user confirmation is unbounded; accepted cleanup has a hard limit.
export class ExitController {
 private pending=false;private exiting=false;
 constructor(private confirm:()=>Promise<boolean>,private cleanup:()=>Promise<unknown>,private finish:()=>void,private timeoutMs=5000){}
 async request(){
  if(this.pending||this.exiting)return;
  this.pending=true;
  try{
   if(!await this.confirm())return;
   this.exiting=true;
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{await Promise.race([Promise.resolve().then(this.cleanup).catch(()=>{}),new Promise<void>(resolve=>{timer=setTimeout(resolve,this.timeoutMs);})]);}
   finally{clearTimeout(timer);this.finish();}
  }finally{this.pending=false;}
 }
}
