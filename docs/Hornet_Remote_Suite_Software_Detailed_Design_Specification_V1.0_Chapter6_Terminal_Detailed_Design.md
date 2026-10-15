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


### 当前实现补充：终端文件工作区（2026-09-24）

接入 xterm SearchAddon，在当前终端滚屏内执行文本搜索。Ctrl+Shift+F 聚焦搜索，Enter/Shift+Enter 前后查找，Esc 清除选择并返回终端。终端工作区保留文件浏览租约，Shell 关闭不释放文件租约；关闭标签时释放两个租约。

### 当前实现补充：终端分屏（2026-09-24）

终端标题右键菜单提供水平（上下）、垂直（左右）分割，仅打开两个及以上终端时可用。分割排列全部已有终端，可跨 SSH 连接，不创建新 Shell。共享工作区以视图 ID 为叶子维护布局树，稳定挂载全部 xterm 实例；取消分屏、切换标签和重命名只改变布局或标题。分隔条支持鼠标及方向键；关闭叶子收拢父节点。工具栏不显示分割按钮。

分屏同时分割标签栏和终端内容：每个终端的原标签直接位于对应窗格顶部，不再保留一行全局终端标签并额外生成窗格标题。垂直分割的标签栏随各自窗格左右排列，水平分割的标签栏随窗格上下排列；标签继续支持右键分割、取消分屏、重命名及关闭。公共工作台、文件和工具标签位于文件栏上方；隐藏文件栏或活动终端无文件通道时，公共入口放在首个窗格的标签栏。退出终端工作区时恢复统一标签栏，返回时恢复分屏。

终端组件始终以稳定视图 ID 挂载，移动标签不重新创建 xterm、Shell 或 SSH 连接；搜索、录制和文件入口操作所在窗格，SFTP 目录继续跟随活动终端。关闭到只剩一个窗格时恢复普通标签栏。真实 Electron 回归验证窗格顶部位置、标签不重复、两个分割方向、重命名、分隔条调整、文件栏显隐、目录跟随、工作台切换、合并/关闭，以及 DOM 终端实例和远端 Shell 数量保持不变。

终端内容区域支持 Ctrl＋滚轮临时缩放字号：向上每格增加 1 像素，向下减少 1 像素，限制在现有字号设置的 8–32 像素范围。按视图维护临时字号，分屏之间互不影响；切换标签、分屏/合并及同视图重连保留临时字号，关闭视图后释放，应用终端设置时重置为设置值，不写入全局字号偏好。终端容器以非 passive 的捕获监听器处理该手势，阻止网页缩放、滚屏和终端鼠标报告；无 Ctrl 时沿用 xterm 的原滚轮处理。更改字体后通过 FitAddon 重新计算网格并同步远端 PTY 行列，不重建终端或连接。组件释放时移除监听器。

各终端保留独立输入序号、输出确认、Shell 与文件租约；同一主机连接复用 SSH transport。关闭标签或分屏仅释放对应终端，其他终端继续运行。搜索与文件侧栏跟随当前激活终端；每个终端保留自己的文件浏览位置。右键重命名采用 1–80 字符的临时标题，不修改主机配置。布局和临时标题不跨重启恢复。

### 实现增量：显示偏好、快速命令与文本导出（2026-10-10）

terminal-preferences 使用严格 schema 保存字体枚举、字号8–32、三种配色、光标及1000–100000行滚屏，本机持久化。TerminalView 更新现有 xterm options 并重新 fit/resize，不重建终端或 SSH Shell；隐藏分屏在显示时由 ResizeObserver 调整。

QuickCommands 保存最多100个命令，每项上限8192字符，拒绝终端控制字符（保留换行和制表符）。载入与执行分离，执行事件携带明确 viewId；各 TerminalView 只处理自身目标并复用原有输入序号，已关闭终端拒绝执行。UI 显示目标主机；命令库是本机明文偏好，不属于凭据库，未提供脚本API、条件等待或广播。

文本导出读取当前 xterm 缓冲区，拼接折行并去除显示控制序列，经专用主进程 IPC 验证大小后由系统保存对话框选定文件。上限4M字符且UTF-8不超过8MiB；包含当前保留的屏幕/滚屏文本，不等于原始字节日志或持续会话录制。编辑菜单同时提供全选和清除滚屏。

证据：TerminalSettings.tsx、QuickCommands.tsx、TerminalView.tsx、main/index.ts、tools/terminal-tools-smoke.mjs。

### 实现增量：Telnet 与持续终端日志（2026-10-10）

TelnetTerminals 使用独立 TCP Socket，最多32个会话，连接超时10秒。复用 terminal.attach/write/ack/resize/close 契约及标签/分屏组件，保留会话所有者、generation、输入序号与输出 ACK 校验。输出未确认额度1MiB、单块32KiB；额度耗尽暂停读取，确认后恢复。关闭一个会话不影响其他会话；协议进程退出回收全部 Socket。

TelnetCodec 是跨数据块状态机，处理转义 IAC、CR NUL、CRLF、DO/DONT/WILL/WONT 与最大4096字节子协商，避免重复正向协商循环。支持 ECHO、SGA、双向 BINARY、TTYPE（XTERM-256COLOR）和 NAWS；尺寸参数的255字节转义。未实现选项明确拒绝，不把协商字节渲染为终端文字。依据 [RFC 854](https://www.rfc-editor.org/rfc/rfc854.html)、[RFC 1073](https://www.rfc-editor.org/rfc/rfc1073.html)、[RFC 1091](https://www.rfc-editor.org/rfc/rfc1091.html)。当前限定 UTF-8 输入，未提供 TLS、传统字符集协商和完整 LINEMODE 客户端行编辑。

Profile.protocol 支持 ssh/telnet，缺省仍为 SSH；沿用已有数据库 protocol 列，不修改基线 schema.sql 摘要。Telnet 默认23端口，用户名可空且只作备注；SSH 保持用户名必填。协议层连接不读取 SSH 凭据，SSH 连接管理器在认证前拒绝 Telnet 配置。文件、X11、VNC 和隧道入口仅选择 SSH 配置；Telnet 工作区不挂载文件侧栏，任务中心可回退底部。

TerminalLogs 位于主进程，直接订阅可信 terminal.data/closed 事件。terminalLogs.start/list/stop 由白名单 IPC 暴露；启动前后验证终端所有者并处理文件选择期间关闭的竞态。文件名由系统对话框选择，使用 wx 创建，不覆盖已有文件。Renderer 不提供待记录数据。文本模式使用增量 UTF-8 解码并去除 CSI/OSC/DCS 等控制序列；raw 保存解码 Telnet 协议后或 SSH 通道中的原始终端输出字节。文本模式保留 CR/LF/TAB 流顺序，不模拟屏幕编辑，也不等于快照导出。

日志状态为 starting/recording/stopping/stopped/failed，单终端最多一份活动日志、总活动上限32、状态记录上限100；单文件100MiB、缓冲积压1MiB。超限或磁盘错误终止日志并通知 UI，不中断终端。手动停止仅关闭日志，终端关闭/协议进程退出/正常应用退出自动结束日志，文件关闭等待上限5秒。开始前的滚屏不补录；切换后台标签仍记录。状态进度最长约250ms合并发布，字节数为已提交写入流的数量，不代表掉电持久性。未实现轮转、回放、跨启动索引或自动记录。

证据：services/terminal/telnet-codec.ts、telnet.ts、logs.ts；tests/unit/telnet-codec.test.ts、terminal-logs.test.ts；tests/integration/telnet.test.ts；tools/telnet-logs-smoke.mjs。实际验证范围见 src/VALIDATION.md。

### 实现增量：Windows 本地与串口适配（2026-10-10）

localTerminal.shells/open 和 serialTerminal.list/open 使用独立严格 DTO，经过 Renderer → Preload 白名单 → 主进程来源/schema 验证 → Protocol Host 二次验证。设备配置不复用远端 Profile 持久模型；Renderer View.source 区分 local/serial，临时展示元数据不会保存进远端主机或布局引用，不创建 SSH 租约。原有 SSH/Telnet 路由保持独立；terminal.attach/write/ack/resize/cwd/close/inspect 根据 ID 路由到 DeviceTerminals，日志仍直接订阅可信输出。

DeviceTerminals 在创建驱动前预留会话和串口独占键，限制最多16个。数据在 attach 前缓冲；每块最多32KiB，512KiB未确认额度触发 pause，ACK按序归还后 resume。排队与未确认输出总量超过1MiB显式失败并关闭，输入上限32KiB/调用、64KiB/秒。结束时发送排队尾部后关闭；用户主动关闭丢弃尚未送到界面的积压数据。所有操作校验 owner、generation 和序号。关闭幂等，设备释放完成后才移除独占键；后台服务停止时阻止新建，异步创建晚到的驱动立即回收。

本地驱动固定允许系统目录中的 powershell.exe/cmd.exe，并检查本机 Windows 构建号和起始目录。使用 node-pty 1.1.0 与随包 ConPTY DLL（useConptyDll），原生模块延迟加载，构建保持 external，避免打包破坏原生模块/worker 路径。Shell 仅接收固定启动参数，cwd 使用独立 spawn 选项；清理继承的 Electron/Node 调试及 Hornet 专用环境变量。PowerShell 使用 -NoLogo/-NoProfile，CMD 使用 /d 并初始化 UTF-8 代码页。Shell 自行退出和显式关闭均释放 PTY；显式关闭最长等待3秒，不把这个等待等同于任意外部脱离控制台进程的退出保证。

串口使用 serialport 13.0.0 的 Windows 驱动，路径限制为 COM 编号，autoOpen=false；打开超时10秒，超时后驱动晚到的成功回调立即关闭端口。配置包含50—4000000波特率、5—8数据位、1/1.5/2停止位、五种校验、硬件或软件流控、UTF-8、换行和本地回显；1.5停止位要求5数据位，具体组合仍受设备驱动能力限制。发送积压不超过64KiB，错误/拔出进入关闭状态；关闭最长等待3秒，不自动重连或重发。resize在串口为无操作；没有SFTP目录跟随。

本机偏好仅保存上次成功打开的设备参数，不保存会话进程、不自动连接设备。源码：services/terminal/devices.ts、local.ts、serial.ts；DeviceTerminalDialog.tsx；packages/contracts/device-terminal.ts。验证覆盖真实 ConPTY、模拟串口、缓冲上限/序号/所有者、失败与退出清理；实机串口、长时高吞吐和跨平台不在当前验收范围。依据：[node-pty](https://github.com/microsoft/node-pty)、[SerialPort](https://serialport.io/docs/api-serialport/)。


### 2026-10-11 终端操作实现补充

SSH/Telnet 重连先建立新资源，成功后替换同一 viewId 的 terminalId/连接租约，保留标题和布局；失败不丢弃原标签。重复重连被抑制；等待认证时若标签关闭，迟到会话立即释放，不重新添加标签。全部重连按启动时的标签快照串行处理，失败停止；不自动重开本地/串口。批量关闭通过原关闭流程处理未保存编辑，取消停止后续操作。

广播仅保存本次勾选的 viewId/terminalId 对，不保存到磁盘，数量 2–16。输入源必须属于目标集合；输入转发给其他已选终端时沿用各自序号，不递归再次广播。新会话不加入，terminal.closed 移除目标，少于两个时清空。命令面板 execute 操作继续单终端发送；可见广播条显示目标并提供停止。

新增 recording 格式：UTF-8 JSON Lines，首行包含 kind/version/cols/rows，输出帧为 [毫秒,"o",Base64 字节]，尺寸帧为 [毫秒,"r",cols,rows]；使用单调时钟保持序列，不依赖系统时间校准。限制 16 MiB、10 万事件及 7 天。只记录开始后的输出，不捕获历史屏幕或单独记录输入。回放在独立只读 xterm 中按原尺寸重建，支持暂停、倍速、定位；不注册远端输入、剪贴板或 URL 打开处理。仅经系统文件选择器或本次日志记录读取文件，校验大小、文件类型、版本、时间顺序、帧类型和尺寸；无时间的旧日志不推测时间轴。脚本、触发器、多编码和日志自动轮转仍未实现。


### 2026-10-11 增量落地：多编码及声明式脚本

profile.encoding 存在 options_json，旧数据默认 UTF-8；不改变 v1 schema.sql 校验和。terminal.encoding RPC 校验 owner/terminalId/generation，临时覆盖仅作用于当前传输。接收在协议边缘流式解码后转 UTF-8，供渲染、脚本、日志和回放共用；编码切换结束旧 decoder（未完成字符显示替换符），后续新 decoder 独立。发送使用 iconv-lite 0.7.3，接收使用 ICU TextDecoder（ISO-8859-1 直接 Latin-1，避免 WHATWG 的 Windows-1252 别名）。GB18030 每字节分包的补充平面字符有回归覆盖。Telnet 先解 IAC 后解码，发送先按编码转字节再转义；串口回显直接输出 Unicode，避免重复转码。

terminal.send 为可等待的输入 RPC，与键盘共用递增序号。renderer 每终端串行发送，分块不截断 UTF-16 代理对；发送失败不自动重试。ScriptRunner 注册在终端组件生命周期内，绑定具体 terminalId，不跟随视图重连。步骤 schema 拒绝未知字段和可执行代码，仅支持 send/wait/delay；等待保留跨包 UTF-8/ANSI 状态，纯文本消费匹配，不做终端屏幕仿真。取消传播到待发送分块，已投递后台的块无法撤回；取消后不发送下一步。超时、输出上限、终端释放均清理等待回调/计时器；最大 200 步/30 分钟/128 KiB 缓冲。脚本库只存本机用户明确保存内容，最多 30 个/1 MiB。

验证：tests/unit/script-runner.test.ts、tests/unit/terminal-encoding.test.ts、tests/integration/terminal-encoding.test.ts、tools/terminal-automation-smoke.mjs。
