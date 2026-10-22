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
    ('ssh','sftp','ftp','telnet','rlogin','serial','local','x11','xdmcp','rdp','vnc')),
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
