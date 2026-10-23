import { readFileSync,writeFileSync,renameSync,mkdirSync,existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { scheduleInput,type ScheduleInput,type TransferSchedule } from '../../../packages/contracts/transfer-schedules';
const schema=scheduleInput.extend({id:z.string().uuid(),profileRevision:z.number().int().nonnegative(),profileName:z.string(),localPath:z.string(),localParent:z.string(),state:z.enum(['scheduled','waiting','starting','submitted','failed','cancelled']),taskId:z.string().uuid().optional(),error:z.string().optional()});
/** Persist the user's native file selection; never infer a new filesystem grant. */
export class TransferSchedules {
 private jobs:TransferSchedule[]=[];private working=false;private timer:ReturnType<typeof setInterval>;
 constructor(private file:string,private execute:(job:TransferSchedule)=>Promise<string>){
  if(existsSync(file)){this.jobs=z.array(schema).max(200).parse(JSON.parse(readFileSync(file,'utf8'))).map(job=>job.state==='starting'?{...job,state:'failed',error:'上次提交结果未知，请检查任务中心后再继续。'}:job.state==='scheduled'&&job.at<=Date.now()?{...job,state:'waiting'}:job);this.save();}
  this.timer=setInterval(()=>void this.tick(),1000);this.timer.unref();
 }
 private save(){mkdirSync(dirname(this.file),{recursive:true});writeFileSync(this.file+'.tmp',JSON.stringify(this.jobs),{mode:0o600});renameSync(this.file+'.tmp',this.file);}
 list(){return this.jobs.map(job=>({...job}));}
 add(input:ScheduleInput,profileRevision:number,profileName:string,localPath:string,localParent:string){
  scheduleInput.parse(input);if(input.at<Date.now()+1000)throw new Error('请选择未来的执行时间。');if(this.jobs.length>=200)throw new Error('最多保留 200 条传输计划。');
  const job:TransferSchedule={...input,id:randomUUID(),profileRevision,profileName,localPath,localParent,state:'scheduled'};this.jobs.push(job);this.save();return {...job};
 }
 cancel(id:string){const job=this.jobs.find(job=>job.id===id);if(!job||job.state==='starting'||job.state==='submitted')throw new Error('此计划已提交，请到任务中心操作。');job.state='cancelled';this.save();}
 remove(id:string){if(this.jobs.some(job=>job.id===id&&job.state==='starting'))throw new Error('计划正在提交。');this.jobs=this.jobs.filter(job=>job.id!==id);this.save();}
 async run(id:string){
  const job=this.jobs.find(job=>job.id===id);if(!job||!['scheduled','waiting','failed'].includes(job.state))throw new Error('此计划不能重复提交。');
  job.state='starting';job.error=undefined;this.save();
  try{job.taskId=await this.execute({...job});job.state='submitted';}catch(error){job.state='failed';job.error=error instanceof Error?error.message:String(error);}this.save();return {...job};
 }
 private async tick(){if(this.working)return;this.working=true;try{for(const job of this.jobs)if(job.state==='scheduled'&&job.at<=Date.now())await this.run(job.id);}catch{/* An I/O error must not trigger an automatic duplicate submission. */}finally{this.working=false;}}
 stop(){clearInterval(this.timer);}
}
