# Hornet Remote Suite 软件详细说明设计书 V1.0

# 第5章 SSH模块详细设计

---

# 5.1 设计目标

SSH模块是 Hornet Remote Suite 的核心通信模块。

负责：

- SSH连接建立
- 用户认证
- Session管理
- Shell创建
- Command执行
- Channel管理
- 自动重连
- 安全校验


设计目标：

- 高稳定
- 低延迟
- 多连接并发
- 安全可靠


---

# 5.2 SSH模块总体架构


```
+------------------------------------------------+
| SSH Service                                    |
+------------------------------------------------+
                      |
                      |
+---------------------v--------------------------+
| SSH Manager                                     |
|                                                 |
| Session管理                                    |
| Connection管理                                 |
+---------------------+--------------------------+
                      |
                      |
+---------------------v--------------------------+
| SSH Connection                                  |
|                                                 |
| Authentication                                  |
| Channel                                         |
| Shell                                           |
+---------------------+--------------------------+
                      |
                      |
+---------------------v--------------------------+
| ssh2 Library                                    |
+------------------------------------------------+

```


---

# 5.3 模块目录设计


```
services/ssh


├── SSHService.ts

├── SSHManager.ts

├── SSHClient.ts

├── SSHConnection.ts

├── SSHChannel.ts

├── AuthManager.ts

├── KeyManager.ts

├── HostVerifier.ts

└── ReconnectManager.ts

```


---

# 5.4 SSHService设计


## 职责


对外提供SSH能力。


接口：


```typescript
interface ISSHService {


connect(
config:SSHConfig
):Promise<SSHSession>;


disconnect(
id:string
):Promise<boolean>;


execute(
id:string,
command:string
):Promise<string>;


openShell(
id:string
):Promise<ShellChannel>;

}

```


---

# 5.5 SSHClient设计


## 职责


封装底层ssh2 Client。


文件：

```
SSHClient.ts

```


类：

```typescript
class SSHClient {


private client:Client;


private state:SSHState;


connect();


authenticate();


createChannel();


close();


}

```


---

# 5.6 SSH状态机设计


状态：


```
INIT

 |

CONNECTING

 |

AUTHENTICATING

 |

READY

 |

RUNNING

 |

DISCONNECTED


FAILED

```


状态说明：


|状态|说明|
|-|-|
|INIT|初始化|
|CONNECTING|建立TCP|
|AUTHENTICATING|认证|
|READY|连接完成|
|RUNNING|执行任务|
|FAILED|失败|
|DISCONNECTED|断开|


---

# 5.7 SSH连接流程


时序：


```
User

 |

UI

 |

SSHService

 |

SSHClient

 |

ssh2

 |

Server


connect()

 |

TCP Connect

 |

SSH Handshake

 |

Host Verify

 |

Authentication

 |

Session Ready

```


---

# 5.8 SSH配置设计


```typescript
interface SSHConfig {


host:string;


port:number;


username:string;


authType:AuthType;


password?:string;


privateKey?:string;


timeout:number;


}

```


---

# 5.9 认证模块设计


支持：


- Password
- Private Key
- SSH Agent


---

# 5.10 Password认证


流程：


```
Username

Password

 |

ssh2 authenticate

 |

Server Verify

```


错误：

- 密码错误
- 用户不存在
- 禁止登录


---

# 5.11 Private Key认证


支持：

- RSA
- ED25519
- ECDSA


配置：

```json
{
"type":"privateKey",
"path":"~/.ssh/id_ed25519"
}

```


---

# 5.12 SSH Agent设计


支持系统：

Windows:

```
OpenSSH Agent

```


Linux:

```
SSH_AUTH_SOCK

```


流程：

```
Client

 |

Agent

 |

Private Key

 |

Server

```


---

# 5.13 Channel设计


SSH支持多个Channel。


类型：

- Shell Channel
- Exec Channel
- Forward Channel


模型：


```typescript
interface SSHChannel {


id:string;


type:string;


write(data:string);


close();

}

```


---

# 5.14 Shell设计


创建流程：


```
Request Shell

 |

Request PTY

 |

Open Channel

 |

Bind Stream

 |

Terminal

```


---

# 5.15 Command执行设计


执行：

```typescript
execute(
command:string
)

```


流程：


```
Command

 |

Exec Channel

 |

Remote Shell

 |

stdout/stderr

 |

Return Result

```


---

# 5.16 PTY设计


参数：


```typescript
interface PTYConfig {


cols:number;


rows:number;


term:string;


}

```


默认：


```
xterm-256color

```


---

# 5.17 Connection Pool设计


目的：

管理多个服务器连接。


结构：


```typescript
Map<string,SSHConnection>

```


示例：

```
Server01

 ├── Shell1

 ├── Shell2


Server02

 └── Shell1

```


---

# 5.18 自动重连设计


触发：

- 网络断开
- Server关闭
- Socket异常


策略：

```
1s

5s

10s

30s

```


流程：

```
DISCONNECTED

 |

ReconnectManager

 |

Retry

 |

CONNECTED

```


---

# 5.19 Host Key校验


目的：

防止MITM攻击。


流程：

```
First Connect

 |

Get Host Key

 |

Known Hosts Check

 |

Save/Reject

```


---

# 5.20 密钥安全存储


禁止：

明文保存密码。


方案：


Windows:

```
Credential Manager

```


Linux:

```
Secret Service

```


macOS:

```
Keychain

```


---

# 5.21 SSH错误码


|错误码|说明|
|-|-|
|SSH001|连接失败|
|SSH002|认证失败|
|SSH003|Host Key错误|
|SSH004|Channel失败|
|SSH005|超时|
|SSH006|网络断开|


---

# 5.22 日志设计


示例：


```json
{
"module":"SSH",
"level":"INFO",
"message":"connected"
}

```


---

# 5.23 测试设计


## 单元测试


测试：

- SSHClient
- AuthManager
- ConnectionPool


## 集成测试


场景：

- Linux服务器
- openEuler服务器
- 网络断开恢复


---

# 5.24 开发任务拆分


## HORNET-SSH-001

SSHClient实现

周期：

7天


## HORNET-SSH-002

认证模块

周期：

5天


## HORNET-SSH-003

Connection Pool

周期：

7天


## HORNET-SSH-004

Reconnect机制

周期：

5天


---

# 下一章节


# 第6章 Terminal模块详细设计

内容：

- xterm.js集成
- PTY管理
- Terminal Session
- Tab管理
- 分屏
- 快捷键
- 主题
- 录制
- Shell恢复
