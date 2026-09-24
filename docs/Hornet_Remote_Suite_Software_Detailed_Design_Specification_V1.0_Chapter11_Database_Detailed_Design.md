# Hornet Remote Suite 软件详细说明设计书 V1.0

# 第11章 数据库详细设计

---

# 11.1 设计目标

数据库模块负责管理 Hornet Remote Suite 所有持久化数据。

包括：

- 用户配置
- SSH Session
- 服务器信息
- 文件缓存
- 传输任务
- Terminal历史
- Workspace
- Plugin信息
- AI历史
- 企业配置


设计目标：

- 数据可靠
- 查询高效
- 支持离线运行
- 支持云端同步
- 支持企业部署


---

# 11.2 数据库总体架构


```
+------------------------------------------------+
| Application Layer                              |
|                                                |
| Session Service                                |
| File Service                                   |
| Plugin Service                                 |
| AI Service                                     |
+----------------------+-------------------------+
                       |
                       |
+----------------------v-------------------------+
| Data Access Layer                              |
|                                                |
| Repository                                     |
| ORM                                            |
| Migration                                      |
+----------------------+-------------------------+
                       |
                       |
+----------------------v-------------------------+
| Database                                       |
|                                                |
| SQLite Client                                  |
| PostgreSQL Server                              |
+------------------------------------------------+

```


---

# 11.3 数据库分类设计


## 11.3.1 本地数据库


采用：

SQLite


用途：

- Session缓存
- 用户配置
- Terminal历史
- 文件缓存


路径：

```
~/.hornet/data/hornet.db

```


---

## 11.3.2 企业数据库


采用：

PostgreSQL


用途：

- 用户管理
- License
- 审计
- 插件市场


---

# 11.4 数据访问层设计


目录：

```
database


├── connection


├── repository


├── migration


├── model


└── query

```


---

# 11.5 Repository设计


统一接口：


```typescript
interface IRepository<T>{


find(id:string):Promise<T>;


insert(data:T):Promise<void>;


update(data:T):Promise<void>;


delete(id:string):Promise<void>;


}

```


---

# 11.6 Session数据表设计


用途：

保存SSH连接。


表：

```sql
CREATE TABLE session
(
id TEXT PRIMARY KEY,

name TEXT NOT NULL,

host TEXT NOT NULL,

port INTEGER DEFAULT 22,

username TEXT,

auth_type TEXT,

create_time INTEGER,

update_time INTEGER

);

```


---

# 11.7 SSH认证信息表


密码禁止明文保存。


表：

```sql
CREATE TABLE credential
(
id TEXT PRIMARY KEY,

session_id TEXT,

type TEXT,

secret_ref TEXT

);

```


secret_ref：

保存系统密钥管理引用。


---

# 11.8 Workspace表


```sql
CREATE TABLE workspace
(
id TEXT PRIMARY KEY,

name TEXT,

session_id TEXT,

remote_path TEXT,

language TEXT,

create_time INTEGER

);

```


---

# 11.9 文件缓存表


用途：

Remote IDE缓存。


```sql
CREATE TABLE file_cache
(
id INTEGER PRIMARY KEY,

path TEXT,

hash TEXT,

size INTEGER,

modify_time INTEGER,

content TEXT

);

```


索引：


```sql
CREATE INDEX idx_file_path

ON file_cache(path);

```


---

# 11.10 Transfer任务表


用于上传下载。


```sql
CREATE TABLE transfer_task
(
id TEXT PRIMARY KEY,

source TEXT,

target TEXT,

size INTEGER,

offset INTEGER,

status TEXT,

progress INTEGER

);

```


状态：

```
WAITING

RUNNING

PAUSED

SUCCESS

FAILED

```


---

# 11.11 Terminal历史表


```sql
CREATE TABLE terminal_history
(
id INTEGER PRIMARY KEY,

session_id TEXT,

command TEXT,

time INTEGER

);

```


---

# 11.12 Plugin表


```sql
CREATE TABLE plugin
(
id TEXT PRIMARY KEY,

name TEXT,

version TEXT,

status TEXT,

install_time INTEGER

);

```


---

# 11.13 AI历史表


```sql
CREATE TABLE ai_history
(
id INTEGER PRIMARY KEY,

session_id TEXT,

question TEXT,

answer TEXT,

time INTEGER

);

```


---

# 11.14 企业用户表


PostgreSQL：


```sql
CREATE TABLE user_account
(
id UUID PRIMARY KEY,

username VARCHAR(64),

email VARCHAR(128),

role_id UUID,

create_time TIMESTAMP

);

```


---

# 11.15 RBAC权限表


用户：

```sql
user_account

```


角色：

```sql
role

```


权限：

```sql
permission

```


关系：

```sql
user_role

role_permission

```


---

# 11.16 License表


```sql
CREATE TABLE license
(
id UUID PRIMARY KEY,

customer TEXT,

edition TEXT,

expire_time TIMESTAMP,

feature JSONB

);

```


---

# 11.17 Audit日志表


企业版：


```sql
CREATE TABLE audit_log
(
id BIGSERIAL,

user_id UUID,

action TEXT,

target TEXT,

time TIMESTAMP

);

```


---

# 11.18 数据迁移设计


采用：

Migration机制。


目录：

```
migration

├── V001_init.sql

├── V002_session.sql

└── V003_plugin.sql

```


启动：

```
Application Start

|

Check Version

|

Execute Migration

|

Ready

```


---

# 11.19 数据备份设计


支持：

- 自动备份
- 导出
- 恢复


本地：

```
hornet.db.backup

```


---

# 11.20 数据安全设计


包括：

- 敏感字段加密
- 数据访问控制
- SQL注入防护


禁止：

- 明文密码
- 明文Token


---

# 11.21 性能设计


优化：

- 索引
- 分页查询
- WAL模式


SQLite：

```sql
PRAGMA journal_mode=WAL;

```


---

# 11.22 测试设计


测试：

- 数据CRUD
- Migration
- 数据恢复
- 并发访问
- 大数据量查询


---

# 11.23 开发任务拆分


## HORNET-DB-001

SQLite框架

周期：

7天


## HORNET-DB-002

Repository层

周期：

10天


## HORNET-DB-003

Enterprise PostgreSQL

周期：

15天


---

# 下一章节


# 第12章 测试详细设计

内容：

- 测试体系
- UT
- ST
- IT
- 性能测试
- 安全测试
- 自动化测试
- CI集成
