# Hornet Remote Suite 软件详细说明设计书 V1.0

# 第4章 IPC通信详细设计

---

# 4.1 设计目标

IPC（Inter Process Communication）模块负责 Electron Main Process 与 Renderer Process 之间的数据通信。

设计目标：

- 统一通信接口
- 类型安全
- 参数校验
- 异常隔离
- 支持同步请求
- 支持异步事件推送
- 支持大数据传输


---

# 4.2 IPC总体架构


```
+------------------------------+
| Renderer Process             |
|                              |
| React Component              |
| Zustand Store                |
+--------------+---------------+
               |
               |
        window.hornet API
               |
               |
+--------------v---------------+
| Preload Process              |
|                              |
| contextBridge                |
| IPC Wrapper                  |
+--------------+---------------+
               |
               |
        ipcRenderer.invoke()
               |
               |
+--------------v---------------+
| Main Process                 |
|                              |
| IPCManager                   |
| Handler                      |
+--------------+---------------+
               |
               |
+--------------v---------------+
| Service Layer                |
|                              |
| SSH/SFTP/Terminal            |
+------------------------------+

```


---

# 4.3 IPC设计原则


## 4.3.1 禁止直接访问


Renderer禁止：

- require
- fs
- child_process
- net


原因：

防止恶意代码访问系统。


---

## 4.3.2 统一API入口


所有调用：

```typescript
window.hornet.xxx()
```


示例：

```typescript
window.hornet.ssh.connect()

window.hornet.file.upload()

window.hornet.terminal.create()

```


---

# 4.4 IPC目录设计


```
electron/ipc


├── IPCManager.ts


├── ssh.ipc.ts


├── file.ipc.ts


├── terminal.ipc.ts


├── session.ipc.ts


└── system.ipc.ts

```


---

# 4.5 IPCManager设计


## 职责


负责：

- 注册Channel
- 分发请求
- 参数校验
- 异常转换


---

## 类定义


```typescript
class IPCManager {


registerChannel();


handle();


validate();


sendEvent();


}

```


---

# 4.6 Channel命名规范


格式：

```
module.action

```


规则：

小写模块名 + 动作。


示例：

```
ssh.connect

ssh.disconnect

ssh.execute


file.list

file.upload

file.download


terminal.create

terminal.write


session.create

session.delete

```


---

# 4.7 Request/Response模型


统一返回：


```typescript
interface IPCResult<T>{


code:number;


message:string;


data?:T;


}

```


成功：


```json
{
"code":0,
"message":"success",
"data":{}
}

```


失败：


```json
{
"code":1001,
"message":"connection failed"
}

```


---

# 4.8 SSH IPC设计


## ssh.connect


请求：


```typescript
interface SSHConnectRequest {


host:string;


port:number;


username:string;


authType:string;


}

```


调用流程：


```
React

 |

ssh.connect

 |

IPCManager

 |

SSHService

 |

SSHClient

```


响应：


```typescript
interface SSHConnectResponse {


sessionId:string;


}

```


---

# 4.9 File IPC设计


## file.upload


请求：


```typescript
interface UploadRequest {


localPath:string;


remotePath:string;


sessionId:string;


}

```


返回：

```typescript
interface UploadResponse {


taskId:string;


}

```


---

# 4.10 Terminal IPC设计


## terminal.create


请求：


```typescript
interface CreateTerminalRequest {


sessionId:string;


cols:number;


rows:number;


}

```


响应：


```typescript
interface TerminalResponse {


terminalId:string;


}

```


---

# 4.11 事件推送机制


部分业务不能使用request/response。


例如：

- 文件进度
- Terminal输出
- SSH断开


采用Event。


---

事件格式：


```typescript
interface IPCEvent {


event:string;


data:any;


time:number;


}

```


---

# 4.12 Event Channel设计


## terminal.data


方向：

Main -> Renderer


数据：


```json
{
"terminalId":"001",
"data":"hello"
}

```


---

## transfer.progress


数据：


```json
{
"taskId":"001",
"progress":50
}

```


---

# 4.13 超时机制


所有请求必须设置timeout。


默认：

```
30000ms

```


流程：


```
Request

 |

Timer Start

 |

Service

 |

Response


Timeout

 |

Return Error

```


---

# 4.14 重试机制


适用：

- 网络请求
- SSH连接


策略：

```
1s

5s

10s

30s

```


---

# 4.15 参数校验设计


采用：

zod。


示例：


```typescript
const schema=z.object({

host:z.string(),

port:z.number()

});

```


失败：

返回：

```
PARAM_INVALID

```


---

# 4.16 错误码设计


|错误码|说明|
|-|-|
|IPC001|Channel不存在|
|IPC002|参数错误|
|IPC003|Timeout|
|IPC004|Service异常|
|IPC005|Permission拒绝|


---

# 4.17 安全设计


包括：

- 参数过滤
- 权限检查
- 数据长度限制
- 文件路径校验


禁止：

```
../../etc/passwd

```


---

# 4.18 IPC性能设计


优化：

- 避免大对象复制
- Buffer使用ArrayBuffer
- 大文件使用Stream


---

# 4.19 测试设计


## 单元测试


测试：

- Channel注册
- 参数校验
- 错误处理


## 集成测试


场景：

- SSH连接
- 文件上传
- Terminal输出


---

# 4.20 开发任务拆分


## HORNET-IPC-001

实现IPCManager


周期：

5天


## HORNET-IPC-002

实现Preload API


周期：

5天


## HORNET-IPC-003

实现Event Push


周期：

7天


---

# 下一章节


# 第5章 SSH模块详细设计


内容：

- SSH架构
- SSHClient类
- Connection Pool
- Authentication
- Channel
- Shell
- 自动重连
- Host Key校验
- 密钥管理
- 完整时序设计
