# Hornet Remote Suite 软件详细设计说明书 V1.0
## 第11章 数据库与持久化详细设计

修订日期：2026-09-24。本章替代其他章节局部建表示例。以下 SQL 是新建本地数据库的核心基线，可按顺序执行；不是已部署数据库的无损迁移脚本。

## 11.1 所有权与位置

单用户客户端采用 SQLite，DatabaseService 单写入，协议进程经 Repository 请求持久化。目录统一为 Electron app.getPath("userData") 下 data、cache、logs、spool 子目录；服务模式打印暂存使用独立服务账户目录，UI 通过受限管理通道读取元数据。服务模式PrintHelper独占自己的print.db，复用本章task/print_queue/print_job与迁移定义，桌面只缓存只读投影；不能由两个进程写同一份队列数据库。

密码、私钥口令、Token、X11 cookie 不进入 SQLite。credential_profile.secret_ref 仅为系统凭据库引用，导出时剔除；没有可用凭据库时只允许本次使用。

## 11.2 核心表（SQLite）

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE schema_migration (
  version INTEGER PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
CREATE TABLE host_profile (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_path TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);
CREATE TABLE credential_profile (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  secret_ref TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);
CREATE TABLE connection_profile (
  id TEXT PRIMARY KEY,
  host_id TEXT REFERENCES host_profile(id) ON DELETE RESTRICT,
  credential_id TEXT REFERENCES credential_profile(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK(protocol IN
    ('ssh','sftp','ftp','telnet','serial','local','x11','xdmcp','rdp','vnc')),
  endpoint_json TEXT NOT NULL,
  username TEXT,
  options_json TEXT NOT NULL DEFAULT '{}',
  identity_revision INTEGER NOT NULL DEFAULT 1 CHECK(identity_revision > 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  updated_at INTEGER NOT NULL
);
CREATE TABLE connection_route (
  profile_id TEXT NOT NULL REFERENCES connection_profile(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  hop_profile_id TEXT NOT NULL REFERENCES connection_profile(id) ON DELETE RESTRICT,
  PRIMARY KEY(profile_id, ordinal),
  CHECK(profile_id <> hop_profile_id)
);
CREATE TABLE known_host (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
  algorithm TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  public_key TEXT NOT NULL,
  trust_scope TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  UNIQUE(host, port, algorithm, fingerprint, trust_scope)
);
CREATE TABLE workspace_layout (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE remote_project (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES connection_profile(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  remote_path TEXT NOT NULL,
  language TEXT
);
CREATE TABLE file_cache (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES connection_profile(id) ON DELETE CASCADE,
  identity_revision INTEGER NOT NULL,
  remote_path TEXT NOT NULL,
  cache_object_id TEXT NOT NULL,
  source_size INTEGER NOT NULL CHECK(source_size >= 0),
  source_mtime INTEGER,
  source_hash TEXT,
  dirty INTEGER NOT NULL DEFAULT 0 CHECK(dirty IN (0,1)),
  UNIQUE(profile_id, identity_revision, remote_path)
);
CREATE TABLE task (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT,
  request_hash TEXT NOT NULL,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_id, kind, idempotency_key)
);
CREATE TABLE transfer_task (
  task_id TEXT PRIMARY KEY REFERENCES task(id) ON DELETE CASCADE,
  source_profile_id TEXT REFERENCES connection_profile(id) ON DELETE RESTRICT,
  target_profile_id TEXT REFERENCES connection_profile(id) ON DELETE RESTRICT,
  source_json TEXT NOT NULL,
  target_json TEXT NOT NULL,
  temporary_object TEXT,
  total_bytes INTEGER CHECK(total_bytes >= 0),
  confirmed_bytes INTEGER NOT NULL DEFAULT 0 CHECK(confirmed_bytes >= 0),
  source_version_json TEXT NOT NULL,
  conflict_policy TEXT NOT NULL,
  CHECK(total_bytes IS NULL OR confirmed_bytes <= total_bytes)
);
CREATE TABLE print_queue (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  printer_id TEXT NOT NULL,
  config_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE print_job (
  task_id TEXT PRIMARY KEY REFERENCES task(id) ON DELETE CASCADE,
  queue_id TEXT NOT NULL REFERENCES print_queue(id) ON DELETE RESTRICT,
  source_address TEXT NOT NULL,
  claimed_user TEXT,
  spool_object_id TEXT NOT NULL,
  byte_count INTEGER NOT NULL CHECK(byte_count >= 0),
  os_job_id TEXT,
  reprint_of TEXT REFERENCES task(id) ON DELETE SET NULL
);
CREATE TABLE view_profile (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('xserver','xlaunch','desktop','terminal')),
  connection_profile_id TEXT REFERENCES connection_profile(id) ON DELETE RESTRICT,
  config_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE audit_event (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_id TEXT,
  result TEXT NOT NULL,
  request_id TEXT,
  time INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_task_owner_state ON task(owner_id, state, updated_at);
CREATE INDEX idx_profile_host ON connection_profile(host_id);
CREATE INDEX idx_print_queue ON print_job(queue_id, task_id);
CREATE INDEX idx_audit_time ON audit_event(time);
```

JSON 列必须经业务 schema 校验且拒绝秘密字段。SQLite INTEGER 为64位；超出 JS 安全整数的文件大小在 IPC 用十进制字符串，存储适配层检查范围。connection_route 在事务内检查循环和深度（默认最多4跳）。

主机端点/用户/信任上下文改变时增加 identity_revision 对应的缓存身份版本；脏缓存必须先另存或确认迁移，不能复用到另一台主机。运行时 connectionId、leaseId、generation 不持久化为可恢复连接。

## 11.3 数据一致性

配置更新使用 UPDATE ... WHERE id=? AND revision=?，影响0行返回冲突，不能覆盖其他窗口的新配置。创建 task 与领域明细在一个事务提交，再启动副作用。

transfer_task.confirmed_bytes 只记录对端确认/本地持久化的检查点，不能用“已发送字节”替代。服务重启把未完成传输转 paused；打印 submitting 恢复按23章处理 unknown；未结束 exec 不自动重新执行。

文件内容存 cache_object_id 对应的受控文件，不作为巨大 TEXT 放入 SQLite。多个服务器的相同路径不共享缓存。符号链接和路径大小写遵循目标文件系统，不无条件 lower-case。

## 11.4 旧模型迁移

旧 session → host_profile + connection_profile；credential.session_id → profile 的 credential_id；旧 workspace → remote_project。旧 file_cache 只有 path 无服务器身份，不能可靠归属，作为隔离旧缓存保留，不直接命中；无法关联身份的旧 transfer_task 置需人工核对，不自动续传。

迁移前使用 SQLite 一致性备份 API 或停写/完成 WAL checkpoint 后备份；不能直接复制正在写入的 db 文件。记录迁移版本和校验和，在事务内更新 schema。失败回滚；未知更高 schema 拒绝写入。旧版本回滚必须恢复配套数据库快照，不能用旧程序强读新 schema。

## 11.5 导入、导出与保留

Hornet 配置包包含 formatVersion、profiles、layouts、非敏感视图配置和校验和。导入先校验格式、大小和引用，再显示增删冲突；按新 UUID 重映射内部引用，单事务提交。认证资料只导入空引用提示重新绑定，不复制本机凭据库指针。

第三方会话导入只读取用户提供的可识别字段，预览未知项；不承诺解密专有密码格式。默认日志滚动7天、成功任务30天；文件脏缓存不得自动清理，打印保留按23章。

## 11.6 扩展与企业模型

插件清单、AI 历史、终端录制通过后续 migration 加表，默认不持久化终端原始输入和 AI 上下文。M4 企业 PostgreSQL 的 tenant_id 必须进入用户、角色、资源、审计与授权关系，采用组合唯一键/外键与服务端隔离检查，不能只给 tenant 表加一个 ID 就宣称多租户隔离完成。客户端不直连 PostgreSQL。

## 11.7 验收

T-DATA-01 验证外键、版本冲突、两主机同路径缓存、重复 task 去重及重启恢复。
T-DATA-02 验证旧数据迁移、磁盘满事务回滚、WAL 备份恢复、导入引用重映射和无秘密导出。
