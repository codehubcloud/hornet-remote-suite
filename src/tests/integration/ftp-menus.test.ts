import { it,expect } from 'vitest';
import { mkdtemp,writeFile,readFile,rm,realpath } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ftpFixture } from '../fixtures/ftp-server';
import { Storage } from '../../packages/storage/database';
import { Challenges } from '../../packages/security/challenges';
import { Connections } from '../../services/ssh/connections';
import { FtpConnections } from '../../services/ftp/connections';
import { FtpFiles } from '../../services/ftp/files';
import { FtpTransfers } from '../../services/ftp/transfers';
import { Transfers } from '../../services/file/transfers';
async function wait(test:()=>boolean){const end=Date.now()+10000;while(!test()){if(Date.now()>end)throw new Error('FTP timeout');await new Promise(resolve=>setTimeout(resolve,10));}}
it('executes FTP commands and verifies binary and ASCII uploads/downloads over real passive sockets',async()=>{
 const server=await ftpFixture(),root=await realpath(await mkdtemp(join(tmpdir(),'hornet-ftp-'))),db=new Storage(join(root,'data.db'),resolve('packages/storage/schema.sql'));
 const profile=db.saveProfile({profileId:randomUUID(),protocol:'ftp',ftpSecurity:'none',name:'ftp',host:'127.0.0.1',port:server.port,username:'tester',group:'',authType:'password',revision:0},0),challenges=new Challenges(()=>{}),ftp=new FtpConnections(db,challenges,()=>{},async()=> 'password'),ssh=new Connections(db,challenges,()=>{}),transfers=new Transfers(db,ssh,()=>{},new FtpTransfers(ftp,()=>{}));
 try{const lease=await ftp.acquire('a',profile.profileId);expect(await ftp.command('a',lease.connectionId,'NOOP')).toContain('200');await expect(ftp.command('a',lease.connectionId,'USER x\r\nPASS y')).rejects.toThrow();await expect(ftp.command('a',lease.connectionId,'PROT C')).rejects.toThrow();
  for(const text of [false,true]){await ftp.configure('a',lease.connectionId,text?'text':'binary');const name=text?'text.txt':'binary.bin',body=text?Buffer.from('first\nsecond\r\n中文\n'):Buffer.from([0,255,13,10,24,42,128]);await writeFile(join(root,name),body);
   const upload=await transfers.start('a',lease.connectionId,'upload',join(root,name),root,'/'+name,randomUUID());await wait(()=>['succeeded','failed','conflict'].includes(transfers.list('a').find(task=>task.taskId===upload.taskId)!.state));expect(transfers.list('a').find(task=>task.taskId===upload.taskId),JSON.stringify(transfers.list('a'))).toMatchObject({state:'succeeded'});expect(server.files.get('/'+name)).toEqual(text?Buffer.from('first\nsecond\n中文\n'):body);
   const download=await transfers.start('a',lease.connectionId,'download',join(root,'download-'+name),root,'/'+name,randomUUID());await wait(()=>['succeeded','failed','conflict'].includes(transfers.list('a').find(task=>task.taskId===download.taskId)!.state));expect(transfers.list('a').find(task=>task.taskId===download.taskId),JSON.stringify(transfers.list('a'))).toMatchObject({state:'succeeded'});expect(await readFile(join(root,'download-'+name))).toEqual(server.files.get('/'+name));
  }
  expect(server.commands).toContain('TYPE A');expect(server.commands).toContain('TYPE I');expect((await new FtpFiles(ftp).list('a',lease.connectionId,'/')).entries.length).toBe(2);
 }finally{await transfers.stop();ftp.stop();await ssh.stop();db.close();await server.close();await rm(root,{recursive:true,force:true});}
});
