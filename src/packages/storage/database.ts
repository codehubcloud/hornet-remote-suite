import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { profileSchema, type Profile, type Layout, type TaskSnapshot } from '../contracts';
import { AppError } from '../core/errors';

export class Storage {
  readonly db: DatabaseSync;
  constructor(path: string, schemaFile: string) {
    if (path !== ':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get() as {user_version:number};
    // Git checkouts and installed packages may differ only in line endings.
    // Schema identity must not depend on the operating system that built it.
    const schema = readFileSync(schemaFile,'utf8').replace(/\r\n/g,'\n');
    const checksum = createHash('sha256').update(schema).digest('hex');
    if (version.user_version === 0) {
      this.db.exec('PRAGMA journal_mode=WAL;');
      this.transaction(() => {
        this.db.exec(schema.replace('PRAGMA journal_mode = WAL;',''));
        this.db.prepare('INSERT INTO schema_migration VALUES (1,?,?)').run(checksum,Date.now());
        this.db.exec('PRAGMA user_version=1;');
      });
    } else {
      if (version.user_version !== 1) { this.db.close(); throw new AppError('DATA_VERSION','数据库版本不兼容，已停止写入。'); }
      const stored=(this.db.prepare('SELECT checksum FROM schema_migration WHERE version=1').get() as {checksum:string}|undefined)?.checksum;
      const legacyWindowsChecksum=createHash('sha256').update(schema.replace(/\n/g,'\r\n')).digest('hex');
      if (stored !== checksum && stored !== legacyWindowsChecksum) {
        this.db.close(); throw new AppError('DATA_VERSION','数据库版本不兼容，已停止写入。');
      }
      // Only migrate the proven CRLF equivalent, without rebuilding tables or
      // discarding profiles. Unknown schema checksums remain an error.
      if (stored !== checksum) this.transaction(()=>{this.db.prepare('UPDATE schema_migration SET checksum=? WHERE version=1 AND checksum=?').run(checksum,stored);});
    }
  }
  transaction<T>(action:()=>T):T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; } catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  profiles(): Profile[] {
    return (this.db.prepare('SELECT c.*, h.group_path, k.kind FROM connection_profile c JOIN host_profile h ON c.host_id=h.id JOIN credential_profile k ON k.id=c.credential_id ORDER BY c.name').all() as Record<string,unknown>[]).map(row => {
      const endpoint = JSON.parse(String(row.endpoint_json)) as {host:string;port:number};
      const options=JSON.parse(String(row.options_json)) as {description?:string;jumpProfileIds?:string[];encoding?:string;ftpSecurity?:string};
      return profileSchema.parse({...(row.protocol==='ftp'?{ftpSecurity:options.ftpSecurity??'none'}:{}),...(options.encoding?{encoding:options.encoding}:{}),...(options.jumpProfileIds?.length?{jumpProfileIds:options.jumpProfileIds}:{}),...(options.description?{description:options.description}:{}),updatedAt:row.updated_at,...(row.protocol==='telnet'||row.protocol==='ftp'?{protocol:row.protocol}:{}),profileId:row.id,name:row.name,...endpoint,username:row.username,group:row.group_path,authType:row.kind,revision:row.revision});
    });
  }
  profile(id: string):Profile { const p=this.profiles().find(p=>p.profileId===id); if(!p) throw new AppError('PROFILE_MISSING','连接配置不存在。'); return p; }
  saveProfile(profile:Profile, expectedRevision:number):Profile { return this.transaction(()=>{const saved=this.saveInner(profile,expectedRevision);this.validateRoutes();return saved;}); }
  private validateRoutes(){
    const profiles=this.profiles(),byId=new Map(profiles.map(p=>[p.profileId,p]));
    for(const p of profiles)for(const id of p.jumpProfileIds??[]){const hop=byId.get(id);if(!hop||(hop.protocol??'ssh')!=='ssh'||hop.jumpProfileIds?.length)throw new AppError('PROFILE_ROUTE','跳板必须是已保存的直连 SSH 配置；请按顺序列出全部跳板。');}
  }
  private saveInner(input:Profile,expected:number):Profile {
    const p=profileSchema.parse(input);
    const existing=this.db.prepare('SELECT revision FROM connection_profile WHERE id=?').get(p.profileId) as {revision:number}|undefined;
    if((existing?.revision??0)!==expected) throw new AppError('PROFILE_CONFLICT','配置已被修改，请刷新后重试。');
    const revision=expected+1,updatedAt=Date.now();
    this.db.prepare('INSERT INTO host_profile(id,name,group_path) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,group_path=excluded.group_path,revision=revision+1').run(p.profileId,p.name,p.group);
    this.db.prepare('INSERT INTO credential_profile(id,name,kind) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,revision=revision+1').run(p.profileId,p.name,p.authType);
    this.db.prepare(`INSERT INTO connection_profile(id,host_id,credential_id,name,protocol,endpoint_json,username,revision,updated_at,options_json) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,protocol=excluded.protocol,endpoint_json=excluded.endpoint_json,username=excluded.username,revision=excluded.revision,identity_revision=identity_revision+1,updated_at=excluded.updated_at,options_json=json_set(CASE WHEN excluded.protocol='ftp' THEN json_set(connection_profile.options_json,'$.ftpSecurity',json_extract(excluded.options_json,'$.ftpSecurity')) ELSE json_remove(connection_profile.options_json,'$.ftpSecurity') END,'$.encoding',json_extract(excluded.options_json,'$.encoding'),'$.description',json_extract(excluded.options_json,'$.description'),'$.jumpProfileIds',json_extract(excluded.options_json,'$.jumpProfileIds'))`).run(p.profileId,p.profileId,p.profileId,p.name,p.protocol??'ssh',JSON.stringify({host:p.host,port:p.port}),p.username,revision,updatedAt,JSON.stringify({ftpSecurity:p.ftpSecurity,encoding:p.encoding??'utf8',description:p.description??'',jumpProfileIds:p.jumpProfileIds??[]}));
    const {protocol,description,jumpProfileIds,...fields}=p;
    return {...fields,encoding:p.encoding??'utf8',...(protocol==='telnet'||protocol==='ftp'?{protocol}:{}),...(description?{description}:{}),...(jumpProfileIds?.length?{jumpProfileIds}:{}),revision,updatedAt};
  }
  removeGroup(path:string,members:{profileId:string;revision:number}[]) {
    const normalize=(value:string)=>value.split('/').map(s=>s.trim()).filter(Boolean).join('/')||'默认分组';
    const target=normalize(path);
    if(target==='默认分组')throw new AppError('PROFILE_CONFLICT','默认分组不能删除。');
    this.transaction(()=>{
      const affected=this.profiles().filter(p=>{const group=normalize(p.group);return group===target||group.startsWith(target+'/');});
      const expected=new Map(members.map(p=>[p.profileId,p.revision]));
      if(expected.size!==members.length||affected.length!==members.length||affected.some(p=>expected.get(p.profileId)!==p.revision))throw new AppError('PROFILE_CONFLICT','分组中的连接已变化，请刷新后重试。');
      if(this.profiles().some(p=>!expected.has(p.profileId)&&p.jumpProfileIds?.some(id=>expected.has(id))))throw new AppError('PROFILE_ROUTE','分组中的跳板仍被其他连接引用。');
      for(const p of affected){
        this.db.prepare('DELETE FROM connection_profile WHERE id=?').run(p.profileId);
        this.db.prepare('DELETE FROM host_profile WHERE id=?').run(p.profileId);
        this.db.prepare('DELETE FROM credential_profile WHERE id=?').run(p.profileId);
      }
    });
  }
  deleteProfile(id:string,revision:number) {
    this.transaction(()=>{
      if(this.profiles().some(p=>p.jumpProfileIds?.includes(id)))throw new AppError('PROFILE_ROUTE','此跳板仍被其他连接引用，请先修改跳板链。');
      const changed=this.db.prepare('DELETE FROM connection_profile WHERE id=? AND revision=?').run(id,revision);
      if(Number(changed.changes)!==1) throw new AppError('PROFILE_CONFLICT','配置已修改或被任务引用，无法删除。');
      this.db.prepare('DELETE FROM host_profile WHERE id=?').run(id);
      this.db.prepare('DELETE FROM credential_profile WHERE id=?').run(id);
    });
  }
  importProfiles(profiles:Profile[]) { return this.transaction(()=>{
    const ids=new Map(profiles.map(p=>[p.profileId,randomUUID()]));if(ids.size!==profiles.length)throw new AppError('PROFILE_ROUTE','导入配置包含重复标识。');
    for(const p of profiles){const jumpProfileIds=p.jumpProfileIds?.map(id=>{const mapped=ids.get(id);if(!mapped)throw new AppError('PROFILE_ROUTE','导入包缺少跳板配置。');return mapped;});this.saveInner({...p,profileId:ids.get(p.profileId)!,jumpProfileIds,revision:0},0);}
    this.validateRoutes();return profiles.length;
  }); }
  trust(host:string,port:number):string[] {
    return (this.db.prepare('SELECT fingerprint FROM known_host WHERE host=? AND port=? AND trust_scope=?').all(host,port,'local') as {fingerprint:string}[]).map(r=>r.fingerprint);
  }
  rememberHost(host:string,port:number,key:Buffer) {
    const size=key.readUInt32BE(0); const algorithm=key.subarray(4,4+size).toString('ascii');
    const fingerprint='SHA256:'+createHash('sha256').update(key).digest('base64').replace(/=+$/,'');
    const known=this.trust(host,port);
    if(known.length && !known.includes(fingerprint)) throw new AppError('SSH003','主机密钥已改变，拒绝覆盖。');
    this.db.prepare('INSERT OR IGNORE INTO known_host VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),host,port,algorithm,fingerprint,key.toString('base64'),'local',Date.now());
  }
  saveTask(snapshot:TaskSnapshot,owner:string,key:string,hash:string,detail:unknown) {
    this.transaction(()=>{
      this.db.prepare('INSERT INTO task(id,owner_id,kind,state,revision,idempotency_key,request_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,revision=excluded.revision,updated_at=excluded.updated_at').run(snapshot.taskId,owner,'transfer',snapshot.state,snapshot.revision,key,hash,Date.now(),snapshot.updatedAt);
      this.db.prepare('INSERT INTO transfer_task(task_id,source_json,target_json,total_bytes,confirmed_bytes,source_version_json,conflict_policy) VALUES (?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET source_json=excluded.source_json,total_bytes=excluded.total_bytes,confirmed_bytes=excluded.confirmed_bytes').run(snapshot.taskId,JSON.stringify({snapshot,detail}),'{}',snapshot.totalBytes,0,'{}','fail');
    });
  }
  loadTasks(): {owner:string;key:string;hash:string;snapshot:TaskSnapshot;detail:unknown}[] {
    return (this.db.prepare('SELECT t.owner_id,t.idempotency_key,t.request_hash,x.source_json FROM task t JOIN transfer_task x ON x.task_id=t.id WHERE t.kind=? ORDER BY t.created_at DESC').all('transfer') as Record<string,unknown>[]).map(r=>({...JSON.parse(String(r.source_json)),owner:String(r.owner_id),key:String(r.idempotency_key),hash:String(r.request_hash)}));
  }
  layout():Layout { const row=this.db.prepare('SELECT layout_json FROM workspace_layout WHERE id=?').get('default') as {layout_json:string}|undefined; return row?JSON.parse(row.layout_json):{profileIds:[]}; }
  saveLayout(layout:Layout) { this.db.prepare('INSERT INTO workspace_layout VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET layout_json=excluded.layout_json,revision=revision+1').run('default','工作台',JSON.stringify(layout),1,1); }
  close() { this.db.close(); }
}
