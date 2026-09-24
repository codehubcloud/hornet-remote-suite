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

"ssh"|"local";


sessionId:string;


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

channel.write(data);

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


支持：

快捷键：

```
Ctrl+C

Ctrl+V

Shift+Insert

```


处理：

- 浏览器事件
- Terminal选择区域


---

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


目的：

- 问题复现
- 培训


记录：

- 输入
- 输出
- 时间


格式：

```
terminal.cast

```


---

# 6.21 Session恢复


启动：


```
Application Start

 |

Load History

 |

Restore Tabs

 |

Reconnect SSH

 |

Restore Layout

```


---

# 6.22 Buffer设计


目的：

避免大量输出导致卡顿。


策略：

- Ring Buffer
- 分页渲染


---

# 6.23 性能设计


目标：

|项目|指标|
|-|-|
|Terminal延迟|<50ms|
|100万字符输出|不卡顿|
|100 Terminal|稳定|


---

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

周期：

5天


HORNET-TERM-002

PTY管理

周期：

7天


HORNET-TERM-003

Tab系统

周期：

5天


HORNET-TERM-004

分屏

周期：

7天


---

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
