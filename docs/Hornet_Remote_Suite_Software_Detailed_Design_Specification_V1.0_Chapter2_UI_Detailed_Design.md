# Hornet Remote Suite 软件详细说明设计书 V1.0

# 第2章 UI详细说明设计

---

# 2.1 UI设计目标

Hornet Remote Suite UI目标：

- 接近 VSCode 使用体验
- 保持 Xshell/Xftp 操作习惯
- 支持多任务并行
- 支持插件扩展
- 支持主题切换


设计原则：

1. 功能区域固定
2. 状态变化可视化
3. 操作路径最短
4. 错误信息明确


---

# 2.2 主窗口设计


## 2.2.1 窗口参数


默认：

|属性|值|
|-|-|
|宽度|1440|
|高度|900|
|最小宽度|1024|
|最小高度|720|


窗口：

```
MainWindow

+------------------------------------------------+
| TitleBar                                       |
+------------------------------------------------+
| MenuBar                                        |
+------------------------------------------------+
| ToolBar                                        |
+------------------------------------------------+
|                                                |
| Sidebar | Main Workspace                       |
|         |                                      |
|         | Terminal/File/Editor                 |
|                                                |
+------------------------------------------------+
| StatusBar                                      |
+------------------------------------------------+

```


---

# 2.3 UI组件树设计


React组件结构：


```
App

├── MainLayout

│
├── TitleBar

├── MenuBar

├── Toolbar

│   ├── NewSessionButton

│   ├── ConnectButton

│   ├── UploadButton

│   ├── DownloadButton

│   └── SettingButton


├── SideBar

│   ├── ServerTree

│   └── FileTree


├── Workspace

│   ├── TabManager

│   ├── TerminalPanel

│   ├── EditorPanel

│   └── TransferPanel


└── StatusBar

```


---

# 2.4 Toolbar详细设计


## 2.4.1 New Session按钮


## 基本属性


组件：

```
components/toolbar/NewSessionButton.tsx

```


属性：

|属性|值|
|-|-|
|名称|New Session|
|类型|Button|
|尺寸|32x32|
|快捷键|Ctrl+N|


---

## 状态设计


状态：

```
NORMAL

DISABLED

LOADING

ERROR

```


显示：


|状态|表现|
|-|-|
|NORMAL|蓝色按钮|
|DISABLED|灰色|
|LOADING|显示Loading|
|ERROR|红色提示|


---

## 点击流程


```
Mouse Click

 |

NewSessionButton.onClick()

 |

SessionDialog.open()

 |

User Input

 |

validate()

 |

SessionService.create()

 |

SSHService.connect()

 |

Open Terminal Tab

```


---

## 前端实现接口


```typescript
interface NewSessionButtonProps {

disabled:boolean;

onSuccess:
(sessionId:string)=>void;

}

```


---

# 2.5 Session Dialog详细设计


## 页面布局


```
+--------------------------------+

New Session


Name

[                     ]


Host

[                     ]


Port

[22                   ]


Username

[                     ]


Authentication


(o) Password

( ) Private Key


        Cancel   Connect


+--------------------------------+

```


---

## 输入字段定义


|字段|类型|校验|
|-|-|-|
|Name|string|不能为空|
|Host|string|不能为空|
|Port|number|1-65535|
|Username|string|不能为空|
|Password|string|可选|


---

# 2.6 Server Explorer设计


功能：

管理服务器列表。


组件：

```
ServerTree

├── ServerNode

├── GroupNode

└── ContextMenu

```


显示：

```
Servers

├── Production

│    ├── Server01

│    └── Server02


└── Test

     └── Ubuntu

```


---

# 2.7 Server Node设计


数据结构：


```typescript
interface ServerNode {


id:string;

name:string;

host:string;

status:

"online"|
"offline";


}

```


---

# 2.8 Terminal Panel UI设计


布局：


```
+--------------------------------+
| terminal1 terminal2       +    |
+--------------------------------+
|                                |
| $ ls                           |
|                                |
|                                |
+--------------------------------+

```


组件：

```
TerminalPanel

├── TerminalTabs

├── TerminalView

└── TerminalToolbar

```


---

# 2.9 File Panel UI设计


双栏：


```
+--------------------------------+

Local              Remote


C:\project         /home/project


main.c             main.c


+--------------------------------+

```


组件：

```
FilePanel

├── LocalTree

├── RemoteTree

├── TransferQueue

```


---

# 2.10 Editor Panel UI设计


布局：


```
+--------------------------------+

Tab1.cpp Tab2.cpp


#include<stdio.h>


int main()

{


}


+--------------------------------+

```


组件：

```
EditorPanel

├── EditorTabs

├── MonacoEditor

└── EditorStatus

```


---

# 2.11 Theme系统设计


支持：

- Dark
- Light
- High Contrast


主题数据：


```typescript
interface ThemeConfig {

name:string;

background:string;

foreground:string;

}

```


---

# 2.12 UI状态管理设计


采用 Zustand。


Store：

```
store

├── sessionStore

├── terminalStore

├── editorStore

├── themeStore

└── transferStore

```


示例：


```typescript
interface SessionStore {


sessions:Session[];


current:string;


addSession():

void;


removeSession():

void;


}

```


---

# 2.13 异常显示设计


错误类型：

- 网络错误
- 登录错误
- 权限错误
- 文件错误


显示：

Toast：

```
SSH001 Connection Failed

Please check network

```


---

# 2.14 本章总结


本章定义：

- 主窗口
- UI组件树
- Toolbar
- Session Dialog
- Server Explorer
- Terminal UI
- File UI
- Editor UI
- Theme
- 状态管理


下一章：

# 第3章 Electron核心详细设计

内容：

- Main Process
- Renderer Process
- Preload
- IPC Framework
- Window Manager
- Event Bus
- 生命周期管理
