import { it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Storage } from '../../packages/storage/database';
import { Transfers } from '../../services/file/transfers';
import type { Connections } from '../../services/ssh/connections';
import type { HornetEvent,TaskSnapshot } from '../../packages/contracts';

it('clears only owned finished history, persists removal and retains paused and unresolved tasks',()=>{
 const db=new Storage(':memory:',resolve('packages/storage/schema.sql')),events:HornetEvent[]=[];
 try{
  const seed=(state:TaskSnapshot['state'],owner='a')=>{
   const snapshot:TaskSnapshot={taskId:randomUUID(),profileId:randomUUID(),direction:'upload',name:state,state,totalBytes:10,transferredBytes:10,revision:1,updatedAt:Date.now()};
   db.saveTask(snapshot,owner,randomUUID(),'hash',{});return snapshot.taskId;
  };
  const succeeded=seed('succeeded'),failed=seed('failed'),cancelled=seed('cancelled'),paused=seed('paused'),conflict=seed('conflict'),other=seed('succeeded','b');
  const transfers=new Transfers(db,{} as Connections,(_owner,event)=>events.push(event));
  expect(transfers.clearHistory('a',other)).toEqual([]);
  expect(transfers.clearHistory('a',paused)).toEqual([]);
  expect(transfers.clearHistory('a',succeeded)).toEqual([succeeded]);
  expect(events).toEqual([{type:'task.removed',taskIds:[succeeded]}]);
  expect(new Set(transfers.clearHistory('a'))).toEqual(new Set([failed,cancelled]));
  expect(new Set(transfers.list('a').map(task=>task.taskId))).toEqual(new Set([paused,conflict]));
  expect(transfers.list('b').map(task=>task.taskId)).toEqual([other]);
  expect(transfers.clearHistory('a')).toEqual([]);
  expect(db.db.prepare('SELECT task_id FROM transfer_task WHERE task_id=?').get(succeeded)).toBeUndefined();
  const restarted=new Transfers(db,{} as Connections,()=>{});
  expect(new Set(restarted.list('a').map(task=>task.taskId))).toEqual(new Set([paused,conflict]));
  expect(restarted.list('b').map(task=>task.taskId)).toEqual([other]);
 }finally{db.close();}
});
