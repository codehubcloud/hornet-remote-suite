# Hornet Remote Suite 软件详细说明设计书 V1.0

# 第10章 AI Agent详细设计

---

# 10.1 设计目标

AI Agent模块用于为 Hornet Remote Suite 提供智能化开发和运维能力。

目标：

- AI Terminal Assistant
- 自然语言生成命令
- 命令解释
- 日志分析
- 编译错误分析
- Firmware问题分析
- 自动化运维
- 企业私有AI部署


---

# 10.2 AI Agent总体架构


```
+------------------------------------------------+
| Hornet Client                                  |
|                                                |
| AI Assistant UI                                |
| AI Terminal Panel                              |
| Log Analyzer                                   |
+----------------------+-------------------------+
                       |
                       |
+----------------------v-------------------------+
| AI Agent Runtime                               |
|                                                |
| Agent Loop                                     |
| Planner                                        |
| Tool Manager                                   |
| Context Manager                                |
| Memory Manager                                 |
+----------------------+-------------------------+
                       |
                       |
+----------------------v-------------------------+
| Tool Layer                                     |
|                                                |
| SSH Tool                                       |
| File Tool                                      |
| Terminal Tool                                  |
| Build Tool                                     |
| Log Tool                                       |
| Git Tool                                       |
+----------------------+-------------------------+
                       |
                       |
+----------------------v-------------------------+
| LLM Provider                                   |
|                                                |
| Cloud LLM                                      |
| Private LLM                                    |
| Local Model                                    |
+------------------------------------------------+

```


---

# 10.3 模块目录设计


```
services/ai


├── AgentRuntime.ts


├── AgentLoop.ts


├── Planner.ts


├── ToolManager.ts


├── ContextManager.ts


├── MemoryManager.ts


├── RAGService.ts


├── PromptManager.ts


└── SecurityGuard.ts

```


---

# 10.4 Agent Runtime设计


## 职责


负责：

- Agent生命周期
- 请求处理
- 状态管理
- Tool调度


接口：


```typescript
interface IAgentRuntime {


run(
request:string
):Promise<AIResponse>;


stop();


reset();


}

```


---

# 10.5 Agent Loop设计


核心流程：


```
User Request

 |

Understand Intent

 |

Create Plan

 |

Select Tool

 |

Execute Tool

 |

Observe Result

 |

Generate Answer

```


---

# 10.6 Planner设计


职责：

将用户需求转换为执行计划。


输入：

```
检查服务器磁盘空间

```


输出：


```
Step1:

execute df -h


Step2:

analyze result


Step3:

generate report

```


---

# 10.7 Tool Manager设计


负责管理所有AI工具。


接口：


```typescript
interface AITool {


name:string;


description:string;


execute(
params:any
):Promise<any>;


}

```


---

# 10.8 内置Tool设计


## SSH Tool


功能：

执行远程命令。


接口：

```typescript
ssh.execute(command)

```


---

## File Tool


功能：

文件读取和修改。


接口：

```typescript
file.read(path)

file.write(path,data)

```


---

## Terminal Tool


功能：

创建Terminal任务。


---

## Build Tool


功能：

执行：

- make
- cmake
- ninja


---

## Log Tool


功能：

分析：

- kernel log
- application log
- firmware log


---

# 10.9 Context Manager设计


保存当前上下文。


内容：

- Session
- Host
- 当前目录
- 打开文件
- 最近命令
- 编译环境


数据结构：


```typescript
interface AIContext {


profileId:string;

connectionId:string;

generation:number;


host:string;


cwd:string;


history:string[];


files:string[];


}

```


---

# 10.10 Memory Manager设计


用于保存长期信息。


类型：

- Session Memory
- User Preference
- Project Knowledge


存储：

SQLite + Vector Database


---

# 10.11 RAG知识库设计


目标：

让AI理解：

- 产品文档
- API文档
- SDK
- Firmware手册
- 错误码


流程：


```
Document

 |

Chunk

 |

Embedding

 |

Vector DB

 |

Retrieve

 |

LLM

```


---

# 10.12 AI Terminal Assistant设计


用户输入：

```
查看CPU占用最高的进程

```


Agent生成：


```bash
top -b -n 1
```


执行：


```
Confirm

 |

SSH Tool

 |

Server

 |

Result

```


---

# 10.13 命令安全控制


AI生成命令必须经过安全检查。


等级：


```
READ_ONLY

SAFE

CONFIRM_REQUIRED

ADMIN_APPROVAL

```


---

# 10.14 命令与工具授权

rm、dd等黑名单仅用于提示，不能作为安全边界。模型输出、终端日志和检索文档均不可信；任意shell可通过解释器、重定向、管道或编码间接改变系统。

默认提供结构化只读工具及作用域校验。执行任意shell、写文件、发布或打印等副作用需由可信UI展示实际目标主机、目录、命令/变更，并生成绑定tool + 参数摘要 + profileId + connection generation + 有效期的一次性授权。参数或目标变化必须重新授权，模型不能自批。

企业策略可以进一步限制，但不能仅信任模型标注的READ_ONLY/SAFE。

# 10.15 日志分析设计


支持：

- dmesg
- journalctl
- kernel panic
- 编译日志
- SSD FW日志


流程：


```
Log File

 |

Parser

 |

AI Analyzer

 |

Problem Summary

 |

Suggestion

```


---

# 10.16 Firmware日志分析


针对：

- SSD Firmware
- Embedded Linux


能力：

- 错误码解析
- 时间线分析
- 异常聚类
- Root Cause分析


---

# 10.17 编译错误分析


支持：

- gcc
- clang
- cmake


分析：

- undefined reference
- include错误
- ABI问题
- 链接错误


---

# 10.18 Prompt管理


统一管理：

- System Prompt
- Tool Prompt
- Domain Prompt


目录：

```
prompts

├── linux

├── cpp

├── firmware

└── general

```


---

# 10.19 企业私有AI部署


支持：

- OpenAI API
- Azure OpenAI
- 私有LLM
- 本地模型


架构：


```
Hornet Client

 |

AI Gateway

 |

Enterprise LLM

 |

Knowledge Base

```


---

# 10.20 AI数据库设计


历史记录：


```sql
CREATE TABLE ai_history
(
id INTEGER PRIMARY KEY,
profile_id TEXT,
question TEXT,
answer TEXT,
time INTEGER
);

```


---

# 10.21 UI设计


AI Panel：


```
+--------------------------------+

AI Assistant


User:

Analyze this error


AI:

Root cause...


[Explain] [Fix] [Run]


+--------------------------------+

```


---

# 10.22 测试设计


测试：

- Tool调用
- 命令安全
- 日志分析
- RAG检索
- 长上下文


---

# 10.23 开发任务拆分


## HORNET-AI-001

Agent Runtime

工作量：

待 M0 技术验证后估算，见第18章。


## HORNET-AI-002

Tool Calling

工作量：

待 M0 技术验证后估算，见第18章。


## HORNET-AI-003

RAG Service

工作量：

待 M0 技术验证后估算，见第18章。


## HORNET-AI-004

Security Guard

工作量：

待 M0 技术验证后估算，见第18章。


---

# 10.24 数据外发、停止与阶段约束

本章为M4增量，不作为核心套件连接前置。默认不自动上传终端历史、文件和日志；提供上下文预览、脱敏、主机作用域与云/私有模型选项。系统凭据、私钥与X cookie永不进入上下文。历史保存可关闭、可删除，不能默认把所有会话内容写ai_history。

工具调用复用既有服务和第4章权限/任务契约；不得另建绕过主机信任的SSH客户端。Agent设置最大步数、执行时长与费用预算，stop停止新工具并尽力取消运行任务，明确已发生副作用不能撤销。不自动重试结果未知的命令。

验收以权限约束、数据范围和执行结果为准，包含日志提示注入、跨主机上下文污染、审批后修改参数与取消竞争。

# 下一章节


# 第11章 数据库详细设计

内容：

- SQLite设计
- PostgreSQL设计
- 数据模型
- Session表
- File Cache表
- Plugin表
- AI历史表
- 企业数据表
