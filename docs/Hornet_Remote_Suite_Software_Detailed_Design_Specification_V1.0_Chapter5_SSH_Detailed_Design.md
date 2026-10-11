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

# 5.4 SSHService契约

```typescript
interface ISSHService {
  acquire(profileId: string, purpose: string):
    Promise<{ connectionId: string; leaseId: string; generation: number }>;
  release(leaseId: string): Promise<void>;
  execute(connectionId: string, command: string):
    Promise<{ taskId: string }>;
  openShell(connectionId: string, cols: number, rows: number):
    Promise<{ channelId: string; terminalId: string }>;
}
```

服务接口是后台内部契约；IPC只能通过第4章受限方法调用。exec输出流式传输，终态必须包含exitCode或signal、stdout/stderr截断标志，不返回无限长字符串。

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

统一使用第1章RuntimeConnection状态：connecting → verifying → authenticating → ready。连接可保持ready并拥有多个运行任务，不因每个任务切换连接状态。网络中断转reconnecting；认证或信任失败转failed；主动断开closing → closed。

每条状态事件包含connectionId、generation和seq。用户取消MFA/信任挑战时终止本次握手并释放租约；未授权前不能创建业务channel。

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

配置保存使用第1章 ConnectionProfile，包含 host、port、username、credentialId、routeProfileIds 和经过schema校验的SSH选项。运行时SSHConfig由凭据服务解析，密码/私钥仅在认证期间按需传入，不出现在持久化配置或普通IPC响应中。

认证支持密码、加密私钥、Agent、keyboard-interactive；挑战按challengeId/connectionId绑定，MFA等待支持取消。GSSAPI/Kerberos、PKCS#11和OpenSSH CA列为第24章高级兼容，必须验证实际认证后端，不推断ssh2原生全部支持。

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

Sign Challenge（私钥留在Agent）

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

# 5.17 Connection Pool与租约

复用键和租约遵循1.6节。连接索引用connectionId，复用索引按端点、用户、凭据版本、跳板链/代理/信任策略构建；不能仅以host作为key。终端、SFTP、X11和隧道分别持有leaseId。

默认每连接8个活跃channel，全局32条连接；超过限制排队并可取消，参数通过性能测试后调整。大型传输可独立连接，仍复用认证资料，不要求所有操作挤在同一SSH transport。服务不向Renderer暴露原始ssh2对象。

# 5.18 自动重连设计

连接状态沿第1章状态机；握手中先verifying，再authenticating。网络暂态错误按1、2、4、8、16秒退避并增加±20%抖动，最多5次；用户可停止。认证失败、主机key改变和策略拒绝立即停止。

每次重连增加generation；旧channel关闭，旧输出事件丢弃。普通SSH shell不能恢复原进程；用户启用且远端安装tmux时，才可另建channel显式attach已保存的远端会话。不得回放输入、exec或登录脚本。SFTP由任务层验证检查点后恢复；X11遵循21章。

# 5.19 Host Key校验

在认证前校验算法、主机/端口、信任域及公钥指纹。首次连接在可信UI展示SHA-256指纹供核对，用户接受后写known_host；拒绝或超时则终止。已有key改变默认拒绝，不能自动覆盖或降级接受。

每一跳均独立校验，禁止因经跳板而跳过最终目标校验。并发首连同主机只允许一个有效信任挑战；可信记录更新后再次检查。算法允许列表随锁定库版本维护，弱算法不作为默认兼容策略。

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

工作量：

待 M0 技术验证后估算，见第18章。


## HORNET-SSH-002

认证模块

工作量：

待 M0 技术验证后估算，见第18章。


## HORNET-SSH-003

Connection Pool

工作量：

待 M0 技术验证后估算，见第18章。


## HORNET-SSH-004

Reconnect机制

工作量：

待 M0 技术验证后估算，见第18章。


---

# 5.25 跳板、代理、转发与Agent边界

跳板链通过上一跳的direct-tcpip建立下一跳SSH，逐跳认证并持有依赖租约；最多4跳、拒绝循环，取消时逆序清理。代理支持SOCKS5/HTTP CONNECT适配，区分代理认证与SSH认证。

TunnelService统一管理local、remote、dynamic转发。默认监听loopback；开放非本机地址需明确配置。remote转发检查服务端实际绑定结果；dynamic SOCKS按目的地址和端口策略控制，DNS解析位置需在配置中说明。转发记录connectionId、leaseId、监听地址、目的地、状态与字节统计。

本地Agent只用于签名，不导出私钥；Agent forwarding是独立权限，默认关闭。使用本地Agent不意味着允许远端访问Agent。X11转发委托21章，不能只把DISPLAY设成远端IP。

参考 [ssh2 官方API](https://github.com/mscdex/ssh2)，实现时锁定版本并逐项互通测试；库具备基础转发API不等于完整产品能力已实现。

### 5.25.1 当前静态转发实现与限制（2026-09-24）

`src/services/ssh/tunnels.ts` 实现 local / remote TCP 转发，通过 `tunnel.create/list/stop` 白名单 IPC 在工作台管理。每条隧道独立持有 SSH 租约，记录实际监听端口、状态、活动流数和两个方向的字节数。关闭终端不影响隧道；停止隧道关闭所属监听和流；断线及应用退出清理资源。

本版只允许 `127.0.0.1` / `::1`，端口 `0` 由操作系统或 SSH 服务器分配。远程请求必须得到成功回复及有效端口，但协议没有返回实际绑定接口，不能断言服务端一定仅监听回环；真实部署必须核对 GatewayPorts 策略。本地转发的目标由服务器解析，远程转发的目标由本机解析。

限制为32个活动隧道、每隧道64条流，TCP流使用背压；远程监听请求和目标连接有超时。远程停止未获确认时保留租约并显示错误，允许重试；迟到的成功回复仍会完成清理。停止操作有所有者校验且终态幂等。配置与流量仅在当前进程内保存，不在重启后自动恢复监听。

自动化证据见 `src/tests/integration/tunnels.test.ts` 和桌面冒烟测试：真实 SSH 上的双向二进制转发、半关闭后回包、端口冲突、租约复用/隔离、活动流停止、断线清理。跳板链、上游代理和非回环监听仍未实现；真实 OpenSSH/IPv6/服务端策略矩阵仍待验证。

### 5.25.2 动态 SOCKS5 实现（2026-09-24）

`src/services/ssh/socks.ts` 按 [RFC 1928](https://www.rfc-editor.org/rfc/rfc1928) 实现无认证TCP CONNECT子集，接入同一隧道租约、限额和工作台。IPv4/域名/IPv6请求转换为SSH direct-tcpip；域名交给SSH服务器解析。仅监听回环，本机其他进程可访问，不提供SOCKS账户认证。BIND、UDP、其他认证方式明确拒绝，不宣称完整SOCKS5协议覆盖。

支持分片/合并报文、预发送业务数据、半关闭和背压；握手至建连总时限15秒，初始缓冲64KiB。用户可配置最多64项精确目标地址及64项端口；空列表允许全部，地址`*`允许全部，其他通配符不提供匹配语义。域名忽略大小写及末尾点，IPv6规范化后匹配。策略针对客户端请求名称，不是解析后的IP/CIDR过滤，不作为防DNS重绑定边界。字节统计只包含业务负载。

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


### 2026-10-11 显式跳板链实现补充

Profile.jumpProfileIds 保存最多四个有序跳板引用；引用目标必须是已保存的直连 SSH 配置，禁止重复、自身、Telnet 和嵌套隐式链。存储层在事务中校验全图；删除跳板/分组时检查外部引用，导入完整配置包时统一重建引用，失败整批回滚。数据使用已有 options_json，不改变基础数据库校验和。

Connections 通过上一跳 Client.forwardOut 创建到下一跳 host:port 的通道，并交给下一跳 Client.connect 的 sock；每跳独立执行原有密码/私钥/Agent/交互认证和 host:port 主机密钥校验。中间连接使用隔离租约，由下游持有，目标关闭时逐级释放；不影响其他独立连接。为链预留连接配额，异步打开期间保护被引用配置，整链 110 秒截止及单次转发 30 秒截止，取消信号传递至认证 challenge、连接和转发通道，失败/超时关闭认证窗口并释放资源。

验证：jump-chain.test.ts 使用两级跳板和只能由跳板解析的夹具主机名，检查三次认证/指纹、SFTP、目标复用、上游回收、认证失败、目标指纹变化和超时取消；session-advanced-smoke.mjs 验证真实表单配置及逐跳认证。上游代理、高级认证扩展和真实服务器互通矩阵仍待补齐。
