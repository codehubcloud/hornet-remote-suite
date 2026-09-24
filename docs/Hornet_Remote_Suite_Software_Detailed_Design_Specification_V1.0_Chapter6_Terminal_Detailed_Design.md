# Hornet Remote Suite 软件详细说明设计书 V1.0

# 第6章 Terminal模块详细设计

---

# 6.1 设计目标

Terminal模块负责实现类似 Xshell、SecureCRT 的终端能力。

功能：

- SSH Shell终端
- 本地终端
- 多标签Terminal
- 分屏
- 输入输出处理
- PTY管理
- 主题管理
- 快捷键
- 会话恢复
- Terminal录制


---

# 6.2 Terminal总体架构


```
+------------------------------------------------+
| Terminal UI                                   |
|                                                |
| TerminalTabs                                  |
| TerminalView                                  |
| Toolbar                                       |
+----------------------+-------------------------+
                       |
                       |
+----------------------v-------------------------+
| Terminal Manager                               |
|                                                |
| Session Manager                                |
| PTY Manager                                    |
| Buffer Manager                                 |
+----------------------+-------------------------+
                       |
                       |
+----------------------v-------------------------+
| Backend                                        |
|                                                |
| SSH Channel                                    |
| node-pty                                       |
+------------------------------------------------+

```


---

# 6.3 模块目录设计


```
terminal


├── TerminalManager.ts


├── TerminalSession.ts


├── TerminalView.tsx


├── TerminalTabs.tsx


├── PTYManager.ts


├── BufferManager.ts


├── ShortcutManager.ts


├── ThemeManager.ts


└── Recorder.ts

```


---

# 6.4 TerminalManager设计


## 职责


负责：

- 创建Terminal
- 管理Terminal生命周期
- 绑定Session


接口：


```typescript
interface ITerminalManager {


create(config:TerminalConfig)
:TerminalSession;


close(id:string)
:void;


write(id:string,data:string)
:void;


resize(id:string,cols:number,rows:number)
:void;


}

```


---

# 6.5 TerminalSession设计


## 数据结构


```typescript
interface TerminalSession {


id:string;


type:

"ssh"|"local"|"serial"|"telnet";


connectionId?:string;

profileId:string;


status:string;


cols:number;


rows:number;


}

```


---

# 6.6 Terminal生命周期


状态：


```
CREATED

 |

INITIALIZING

 |

RUNNING

 |

DISCONNECTED

 |

CLOSED

```


---

# 6.7 Terminal创建流程


```
User Click Terminal

 |

TerminalManager.create()

 |

Create xterm instance

 |

Create PTY

 |

Bind Channel

 |

Start Shell

 |

Ready

```


---

# 6.8 xterm.js集成设计


初始化：


```typescript
const terminal=new Terminal({

cols:120,

rows:40,

cursorBlink:true,

theme:theme

});

```


加载：


```
terminal.open(dom)

```


---

# 6.9 输入输出设计


## 输入


流程：


```
Keyboard

 |

xterm.onData()

 |

TerminalManager.write()

 |

SSH Channel.write()

 |

Remote Shell

```


代码模型：


```typescript
terminal.onData(data=>{

window.hornet.terminal.write(terminalId, data); // 经受限字节流桥

});

```


---

## 输出


流程：


```
Remote Shell

 |

SSH stdout

 |

Channel data

 |

Terminal.write()

 |

Screen Render

```


---

# 6.10 PTY管理设计


PTY配置：


```typescript
interface PTYConfig {


cols:number;


rows:number;


term:string;


}

```


默认：


```
TERM=xterm-256color

```


---

# 6.11 Resize设计


触发：

- 窗口变化
- 分屏变化


流程：


```
Resize Event

 |

Terminal.resize()

 |

PTY resize

 |

Remote tty update

```


---

# 6.12 Terminal Tab设计


UI：


```
+--------------------------------+
| Server01 | Server02 | +        |
+--------------------------------+

```


数据：


```typescript
interface TerminalTab {


id:string;


title:string;


terminalId:string;


active:boolean;


}

```


---

# 6.13 分屏设计


支持：

- 左右
- 上下


布局：


```
+-------------+-------------+
| Terminal1   | Terminal2   |
+-------------+-------------+

```


实现：

React Split Pane。


---

# 6.14 Terminal Toolbar设计


按钮：


|按钮|功能|
|-|-|
|New|新建|
|Close|关闭|
|Split|分屏|
|Reconnect|重连|
|Clear|清屏|
|Search|搜索|
|Record|录制|


---

# 6.15 Clear功能设计


流程：


```
Click

 |

Terminal.clear()

 |

xterm.clear()

```


---

# 6.16 Search功能设计


支持：

- 文本搜索
- 正则
- 大小写


实现：

xterm SearchAddon。


---

# 6.17 Copy/Paste设计

默认Ctrl+Shift+C复制、Ctrl+Shift+V粘贴，Ctrl+C保留远端中断；macOS按平台映射。多行粘贴显示预览和目标主机，保留bracketed paste。远端OSC52剪贴板写入默认禁用，启用时限制方向、长度并由可信UI控制。链接打开只允许安全scheme，不把终端输出当HTML。

# 6.18 Theme设计


主题：

- Dark
- Light
- VSCode Dark
- Solarized


数据：


```typescript
interface TerminalTheme {


background:string;


foreground:string;


cursor:string;


}

```


---

# 6.19 Shortcut设计


配置：

```json
{

"newTerminal":"Ctrl+Shift+T",

"closeTerminal":"Ctrl+W",

"search":"Ctrl+F"

}

```


---

# 6.20 Terminal录制设计

录制默认关闭，启用后记录输出、相对时间与resize事件，可导出兼容cast的格式。默认不保存原始输入，避免捕获密码；输出也可能含敏感信息，应提供暂停、删除与导出预览。录制回放只渲染，不执行其中命令/链接/剪贴板控制序列。SSH加密不保护本地录制文件，按用户数据目录权限与保留策略存储。

# 6.21 恢复语义

恢复布局只重建标签与尺寸。网络断开后原shell及channel不可继续使用；重连后新建shell，显示“新会话”。tmux可选恢复需用户开启、服务端可用、保存明确会话标识，不能宣称普通SSH提供进程恢复。任何键盘缓存和广播待发输入在断线后清空。

# 6.22 Buffer设计

按第4章二进制字节流和credit机制消费；每终端未消费队列上限1MiB，满时暂停上游，不能任意截断转义序列。UTF-8使用流式解码，旧编码由后台适配，分片字符不得重复或丢失。scrollback默认10000行、可配置，并与传输队列分开限制。

# 6.23 性能设计

负载、延迟起止点与门槛以第12章T-PERF-02为准。20活跃终端与100空闲终端分别测试；不承诺100路持续满速输出。

# 6.24 测试设计


测试：

- 长时间运行
- 大量输出
- 网络断开恢复
- 多Terminal


---

# 6.25 开发任务拆分


HORNET-TERM-001

xterm集成

工作量：

待 M0 技术验证后估算，见第18章。


HORNET-TERM-002

PTY管理

工作量：

待 M0 技术验证后估算，见第18章。


HORNET-TERM-003

Tab系统

工作量：

待 M0 技术验证后估算，见第18章。


HORNET-TERM-004

分屏

工作量：

待 M0 技术验证后估算，见第18章。


---

# 6.26 终端增强与兼容

Local使用PTY适配，远程SSH使用远端PTY，不在本地再启动shell充当SSH传输。串口配置device、baudRate、dataBits、stopBits、parity、flowControl，并处理设备拔出；Telnet采用独立IAC协商适配，清晰标明明文协议。SSH1/RLOGIN等遗留协议范围见24章。

快捷命令按组/参数模板保存；发送前显示最终文本和目标。广播默认关闭，每次开启明确选定终端，断线/新增标签不自动加入。Compose编辑区支持多行和发送延迟。触发器仅匹配有界输出片段，限制频率和递归，自触发回路立即停用。

脚本由独立受限自动化运行时提供session-scoped API、超时、停止与审计；脚本录制只记录显式用户动作，不保存密码。旧VB/JScript/Python脚本不承诺源码直接兼容，列入M3迁移差异。

编码、按键映射、高亮、日志查看、终端锁定、终端打印、Hex视图、X/Y/ZMODEM和多种仿真模式在24章分项管理；xterm.js可用不等于所有历史终端仿真已支持。

# 下一章节


# 第7章 SFTP文件管理详细设计

内容：

- File Manager
- SFTP Client
- 文件树
- 上传下载
- Transfer Queue
- 断点续传
- 文件同步
