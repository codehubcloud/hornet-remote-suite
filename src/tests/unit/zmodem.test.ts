import { it,expect } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp,writeFile,readFile,rm,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZmodemTransfers,type BinaryTerminal } from '../../services/terminal/zmodem';
const ZM=createRequire(import.meta.url)('zmodem.js');
async function wait(test:()=>boolean){const end=Date.now()+5000;while(!test()){if(Date.now()>end)throw new Error('ZMODEM fixture timeout');await new Promise(resolve=>setTimeout(resolve,5));}}
function wire(){let consume:(data:Buffer)=>void=()=>{},peer:{consume(bytes:number[]):void};const errors:unknown[]=[];const terminal:BinaryTerminal={begin:fn=>{consume=fn;},write:async data=>{queueMicrotask(()=>{try{peer.consume([...data]);}catch(error){errors.push(error);}});},output:()=>{},end:()=>{}};return {errors,terminal,setPeer:(value:typeof peer)=>peer=value,toLocal:(bytes:number[])=>queueMicrotask(()=>consume(Buffer.from(bytes)))};}
it('sends binary files over a real ZMODEM packet exchange',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'hornet-zsend-'))),file=join(root,'binary.bin'),manager=new ZmodemTransfers(),w=wire(),data=Buffer.from(Array.from({length:65001},(_,index)=>index%256));
 const receiver=new ZM.Session.Receive(),chunks:Buffer[]=[];receiver.set_sender(w.toLocal);receiver.on('offer',(offer:ZmodemOffer)=>{void offer.accept({on_input:bytes=>chunks.push(Buffer.from(bytes))});});w.setPeer(receiver);
 try{await writeFile(file,data);const job=manager.start('fixture','send',file,root,w.terminal);receiver.start();await wait(()=>!['waiting','transferring'].includes(manager.list()[0].state));expect(manager.list()[0],manager.list()[0].error).toMatchObject({state:'completed',bytes:data.length});expect(Buffer.concat(chunks)).toEqual(data);manager.cancel(job.id);}finally{await rm(root,{recursive:true,force:true});}
});
it('receives binary data with exclusive commit, rejects unsafe names and preserves existing files',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'hornet-zrecv-'))),data=Buffer.from([0,255,24,13,10,128,42]);
 try{for(const name of ['received.bin','../escape','existing.bin']){
  if(name==='existing.bin')await writeFile(join(root,name),'keep');const manager=new ZmodemTransfers(),w=wire();let end=false;
  let sender:ZmodemSession|undefined;
  const sentry=new ZM.Sentry({to_terminal:()=>{},sender:w.toLocal,on_retract:()=>{},on_detect:(detection:{confirm():ZmodemSession})=>{sender=detection.confirm();sender.on('session_end',()=>{end=true;});}});w.setPeer(sentry);const job=manager.start('fixture','receive',root,root,w.terminal);
  w.toLocal(ZM.Header.build('ZRQINIT').to_hex());await wait(()=>!!sender);
  const offered=sender!.send_offer({name,size:data.length,mtime:0,files_remaining:1});
  const transfer=name==='received.bin'?await offered:undefined;void offered.catch(()=>{});
  if(name==='received.bin'){expect(transfer).toBeDefined();await (transfer as unknown as {end(bytes:number[]):Promise<void>}).end([...data]);await sender!.close();await wait(()=>manager.list()[0].state==='completed');expect(await readFile(join(root,name))).toEqual(data);expect(end).toBe(true);expect(w.errors).toEqual([]);}else{await wait(()=>manager.list()[0].state==='failed');if(name==='existing.bin')expect(await readFile(join(root,name),'utf8')).toBe('keep');}
  manager.cancel(job.id);
 }}finally{await rm(root,{recursive:true,force:true});}
});
