import { createServer, type Server, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { printConfigSchema, printQueueSchema, type PrintQueue, type PrintConfig, type PrintJob } from '../../packages/contracts/native';
import { AppError } from '../../packages/core/errors';

class Reader {
  private iterator: AsyncIterator<Buffer>; private buffer = Buffer.alloc(0);
  constructor(socket: Socket) { this.iterator = socket[Symbol.asyncIterator](); }
  private async more() { const item = await this.iterator.next(); if (item.done) throw new Error('接收中断。'); this.buffer = Buffer.concat([this.buffer, item.value]); }
  async bytes(n: number) { while (this.buffer.length < n) await this.more(); const value = this.buffer.subarray(0,n); this.buffer = this.buffer.subarray(n); return value; }
  async line() { while (!this.buffer.includes(10)) { if(this.buffer.length>1024) throw new Error('LPD 命令过长。'); await this.more(); } const i=this.buffer.indexOf(10);if(i>1024)throw new Error('LPD 命令过长。');return this.bytes(i+1); }
}
export class LpdService {
  private server?: Server; private sockets = new Set<Socket>(); private jobs: PrintJob[] = []; private config?: PrintConfig;
  private queues:PrintQueue[]=[];private receiving=new Map<string,number>();
  private defaultQueue?:string;
  private events:{at:number;message:string}[]=[];
  private reserved = 0; private stopped = false; private submitting = false;
  constructor(private root: string, private submit: (job: PrintJob, path: string) => Promise<number|undefined>) {
    mkdirSync(root,{recursive:true,mode:0o700});
    if(existsSync(join(root,'jobs.json')))this.jobs=JSON.parse(readFileSync(join(root,'jobs.json'),'utf8'));
    for(const job of this.jobs)if(job.state==='submitting'){job.state='unknown';job.error='上次提交结果不确定，请在系统打印队列核实；不会自动重打。';}
    // Only generated, unreferenced spool objects may be removed after interrupted receive.
    for(const name of readdirSync(root))if(/^[a-f0-9-]{36}\.control$/.test(name)||(/^[a-f0-9-]{36}\.spool$/.test(name)&&!this.jobs.some(j=>name===j.jobId+'.spool'&&j.state!=='cancelled')))unlinkSync(join(root,name));
    if(existsSync(join(root,'queues.json')))this.queues=printQueueSchema.array().max(32).parse(JSON.parse(readFileSync(join(root,'queues.json'),'utf8')));
    if(existsSync(join(root,'default.json'))){const value=JSON.parse(readFileSync(join(root,'default.json'),'utf8'));if(typeof value==='string'&&this.queues.some(q=>q.queue===value))this.defaultQueue=value;}
    this.save();
  }
  private save() { const path=join(this.root,'jobs.json');writeFileSync(path+'.tmp',JSON.stringify(this.jobs),{mode:0o600});const fd=openSync(path+'.tmp','r+');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(path+'.tmp',path); }
  private saveQueues(next:PrintQueue[]){const path=join(this.root,'queues.json');writeFileSync(path+'.tmp',JSON.stringify(next),{mode:0o600});const fd=openSync(path+'.tmp','r+');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(path+'.tmp',path);this.queues=next;}
  saveQueue(input:PrintQueue){const queue=printQueueSchema.parse(input),next=[...this.queues.filter(q=>q.queue!==queue.queue),queue];if(next.length>32)throw new Error('最多可配置 32 个打印队列。');this.saveQueues(next);this.log('Saved queue: '+queue.queue);return this.status();}
  removeQueue(name:string){if(this.receiving.get(name)||this.jobs.some(j=>j.queue===name&&['held','submitting'].includes(j.state)))throw new Error('请先处理该队列正在接收或待提交的作业。');if(this.server&&this.config?.queue===name)throw new Error('请先停止监听再删除启动队列。');this.saveQueues(this.queues.filter(q=>q.queue!==name));if(this.defaultQueue===name){unlinkSync(join(this.root,'default.json'));this.defaultQueue=undefined;}this.log('Removed queue: '+name);return this.status();}
  status() { return { defaultQueue:this.defaultQueue,events:this.events.map(e=>({...e})),queues:this.queues.map(q=>({...q})),listening: !!this.server?.listening, config: this.config, jobs: this.jobs.map(j=>({...j})) }; }
  private log(message:string){this.events.push({at:Date.now(),message:message.slice(0,2048)});if(this.events.length>1000)this.events.shift();}
  setDefault(name:string){if(!this.queues.some(q=>q.queue===name))throw new AppError('PRINT_STATE','打印队列不存在。');writeFileSync(join(this.root,'default.json.tmp'),JSON.stringify(name),{mode:0o600});renameSync(join(this.root,'default.json.tmp'),join(this.root,'default.json'));this.defaultQueue=name;this.log('Default queue: '+name);return this.status();}
  readJob(id:string){const job=this.jobs.find(j=>j.jobId===id);if(!job||job.state==='cancelled')throw new AppError('PRINT_STATE','打印作业数据不存在。');return {name:job.name,data:readFileSync(join(this.root,job.jobId+'.spool'))};}
  removeJobs(ids:string[]){
    const selected=this.jobs.filter(job=>ids.includes(job.jobId));if(selected.some(job=>job.state==='submitting'))throw new AppError('PRINT_BUSY','不能删除正在提交的作业。');
    const previous=this.jobs;this.jobs=this.jobs.filter(job=>!ids.includes(job.jobId));try{this.save();}catch(error){this.jobs=previous;throw error;}
    for(const job of selected){const path=join(this.root,job.jobId+'.spool');if(existsSync(path))unlinkSync(path);this.log('Cancelled '+job.jobId);}
    this.log('Removed '+selected.length+' jobs');return this.status();
  }
  async start(input: PrintConfig) {
    if(this.stopped)throw new Error('打印服务已停止。');
    if(this.server)throw new Error('请先停止当前 LPD 监听。');
    const config=printConfigSchema.parse(input);this.saveQueue({queue:config.queue,printer:config.printer,mode:config.mode,enabled:true});this.config=config;
    const server=this.server=createServer(socket=>{
      const source=(socket.remoteAddress??'').replace(/^::ffff:/,'');
      if(this.sockets.size>=4||!config.allowedSources.includes(source)){socket.destroy();return;}
      this.sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>this.sockets.delete(socket));
      socket.setTimeout(30000,()=>socket.destroy());
      void this.receive(socket,source,config).catch(error=>{this.log(source+': '+String(error));if(!socket.destroyed)socket.end(Buffer.from([1]));});
    });
    try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.bindHost,resolve);});config.port=(server.address() as {port:number}).port;this.log('Listening '+config.bindHost+':'+config.port);server.on('error',()=>{void this.stop();});return this.status();}
    catch(e){this.server=undefined;server.close();throw e;}
  }
  async stop() { const server=this.server;this.server=undefined;for(const socket of this.sockets)socket.destroy();if(server){await new Promise<void>(r=>server.close(()=>r()));this.log('Stopped listener');} }
  private async receive(socket: Socket, source: string, config: PrintConfig) {
    const reader=new Reader(socket),jobId=randomUUID(),path=join(this.root,jobId+'.spool');let committed=false,allocation=0,receivingQueue:string|undefined;
    try {
      const first=await reader.line(),queue=first.subarray(1).toString('ascii').trim().split(/\s+/)[0];
      const target=this.queues.find(q=>q.queue===queue);if(!target)throw new Error('未知队列。');
      const queueConfig={...target};
      if(first[0]===3||first[0]===4){socket.end(this.jobs.filter(j=>j.queue===queue).map(j=>`${j.jobId} ${j.state} ${j.bytes} bytes\n`).join('')||'no entries\n');return;}
      if(first[0]!==2)throw new Error('不支持远程删除或自动打印命令。');
      if(!queueConfig.enabled)throw new Error('队列已暂停接收。');
      receivingQueue=queue;this.receiving.set(queue,(this.receiving.get(queue)??0)+1);
      socket.write(Buffer.from([0]));
      let control: Buffer|undefined, dataName:string|undefined, dataBytes=0;
      for(let part=0;part<2;part++){
        const line=await reader.line();if(line[0]===1)throw new Error('客户端取消。');
        if(line[0]!==2&&line[0]!==3)throw new Error('非法子命令。');
        const match=/^([0-9]{1,9}) ([A-Za-z0-9_-][A-Za-z0-9_.-]{0,127})\n$/.exec(line.subarray(1).toString('ascii'));
        if(!match)throw new Error('文件元数据无效。');const size=Number(match[1]),name=match[2];
        if((line[0]===2&&(control||size>65536))||(line[0]===3&&(dataName||size>10*1024*1024)))throw new Error('文件重复或超过配额。');
        if(line[0]===3){
          if(this.jobs.length>=1000||this.jobs.filter(j=>j.state!=='cancelled').reduce((n,j)=>n+j.bytes,0)+this.reserved+size>100*1024*1024)throw new Error('打印暂存配额已满。');
          allocation=size;this.reserved+=size;
        }
        socket.write(Buffer.from([0]));
        const data=await reader.bytes(size);if((await reader.bytes(1))[0]!==0)throw new Error('文件结束标记错误。');
        if(line[0]===2){control=data;const controlPath=join(this.root,jobId+'.control');writeFileSync(controlPath,data,{mode:0o600});const fd=openSync(controlPath,'r+');try{fsyncSync(fd);}finally{closeSync(fd);}}
        else {dataName=name;dataBytes=size;writeFileSync(path,data,{mode:0o600});const fd=openSync(path,'r+');try{fsyncSync(fd);}finally{closeSync(fd);}}
        if(control&&dataName){
          const lines=control.toString('utf8').split('\n');
          const references=lines.filter(l=>/^[a-z]/.test(l));
          if(references.length!==1||!['f','l'].includes(references[0][0])||references[0].slice(1)!==dataName)throw new Error('仅支持单个 f/l 数据文件，引用不匹配。');
          const job:PrintJob={jobId,queue,printer:queueConfig.printer,mode:queueConfig.mode,source,owner:(lines.find(l=>l.startsWith('P'))?.slice(1)??'').replace(/[\x00-\x1f\x7f]/g,'').slice(0,128),host:(lines.find(l=>l.startsWith('H'))?.slice(1)??'').replace(/[\x00-\x1f\x7f]/g,'').slice(0,128),name:(lines.find(l=>l.startsWith('J'))?.slice(1)??dataName).replace(/[\x00-\x1f\x7f]/g,'').slice(0,128),bytes:dataBytes,state:'held',createdAt:Date.now()};
          this.jobs.push(job);try{this.save();}catch(e){this.jobs.pop();throw e;}committed=true;this.log('Received '+job.jobId+' '+job.name+' '+job.bytes+' B');
        }
        socket.write(Buffer.from([0]));
      }
      socket.end();
    }finally{
      if(receivingQueue){const count=(this.receiving.get(receivingQueue)??1)-1;if(count)this.receiving.set(receivingQueue,count);else this.receiving.delete(receivingQueue);}
      this.reserved-=allocation;
      if(!committed&&existsSync(path))unlinkSync(path);
      const controlPath=join(this.root,jobId+'.control');if(existsSync(controlPath))unlinkSync(controlPath);
    }
  }
  async print(id:string) {
    if(this.stopped||this.submitting)throw new AppError('PRINT_BUSY','打印服务正在停止或已有提交正在处理。');
    const job=this.jobs.find(j=>j.jobId===id);if(!job||job.state!=='held')throw new AppError('PRINT_STATE','只能提交待处理作业；不确定的任务不能自动重打。');
    job.state='submitting';try{this.save();}catch(e){job.state='held';throw e;}this.submitting=true;
    try {
      try {job.osJobId=await this.submit({...job},join(this.root,id+'.spool'));job.state='submitted';}
      catch {job.state='unknown';job.error='提交结果不确定，请核实系统队列，避免重复打印。';}
      this.save();this.log('Submitted '+job.jobId+': '+job.state);return {...job};
    }finally{this.submitting=false;}
  }
  cancel(id:string) {const job=this.jobs.find(j=>j.jobId===id);if(!job||!['held','cancelled'].includes(job.state))throw new Error('仅可取消尚未提交的任务。');job.state='cancelled';this.save();const path=join(this.root,id+'.spool');if(existsSync(path))unlinkSync(path);}
  async shutdown(){this.stopped=true;await this.stop();}
}
