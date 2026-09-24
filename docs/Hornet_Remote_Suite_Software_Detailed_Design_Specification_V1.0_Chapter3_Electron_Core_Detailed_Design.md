# Hornet Remote Suite 软件详细说明设计书 V1.0

# 第3章 Electron核心详细设计

------------------------------------------------------------------------

# 3.1 设计目标

本章定义 Hornet Remote Suite Electron 桌面框架详细实现。

目标：

-   明确 Main Process职责
-   明确 Renderer Process职责
-   定义 Preload安全通信机制
-   定义 IPC协议
-   定义窗口生命周期
-   定义服务管理机制

------------------------------------------------------------------------

# 3.2 Electron总体架构

    +------------------------------------------------+
    | Renderer Process                               |
    |                                                |
    | React Application                              |
    | Zustand Store                                  |
    | UI Components                                  |
    +-----------------------+------------------------+
                            |
                            |
                      contextBridge
                            |
                            |
    +-----------------------v------------------------+
    | Preload Isolated Context                                |
    |                                                |
    | Secure API Bridge                              |
    | IPC Wrapper                                    |
    +-----------------------+------------------------+
                            |
                            |
    +-----------------------v------------------------+
    | Main Process                                   |
    |                                                |
    | WindowManager                                  |
    | IPCManager                                     |
    | ServiceManager                                 |
    | PluginManager                                  |
    | UpdateManager                                  |
    +------------------------------------------------+

------------------------------------------------------------------------

# 3.3 Main Process详细设计

## 3.3.1 职责

Main Process负责：

-   应用启动
-   窗口管理
-   系统资源访问
-   后台服务管理
-   IPC消息转发

------------------------------------------------------------------------

# 3.3.2 文件结构

    electron/main


    ├── main.ts

    ├── window

    │   └── WindowManager.ts


    ├── ipc

    │   └── IPCManager.ts


    ├── service

    │   └── ServiceManager.ts


    ├── plugin

    │   └── PluginManager.ts


    └── update

        └── UpdateManager.ts

------------------------------------------------------------------------

# 3.4 应用启动流程

获取单实例锁 → app.whenReady → 打开凭据服务与数据库/迁移 → 注册受限 IPC → 启动核心服务并等待就绪 → 创建窗口/加载本地 UI → 恢复配置和布局。耗时协议服务按需启动；加载 UI 前须能响应请求，避免原流程先加载 Renderer 再注册 IPC 的竞争。失败显示诊断窗口，不进入伪 READY。

# 3.5 启动伪代码

```typescript
async function bootstrap() {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  await app.whenReady();
  await dataService.openAndMigrate();
  await credentialService.initialize();
  ipcManager.register();
  await serviceManager.startCore();
  await windowManager.create();
}
```

入口捕获失败并逆序释放已启动服务；数据库迁移失败不加载可写业务界面。

# 3.6 WindowManager设计

## 职责

负责：

-   创建窗口
-   保存窗口实例
-   窗口状态恢复

------------------------------------------------------------------------

## 类定义

文件：

    window/WindowManager.ts

代码结构：

``` typescript
class WindowManager {


private mainWindow:BrowserWindow;


create():

void;


close():

void;


restore():

void;


}
```

------------------------------------------------------------------------

## 创建窗口

参数：

``` typescript
interface WindowConfig {


width:number;


height:number;


minWidth:number;


minHeight:number;


}
```

默认：

``` json
{
"width":1440,
"height":900,
"minWidth":1024,
"minHeight":720
}
```

------------------------------------------------------------------------

# 3.7 Renderer Process设计

## 职责

负责：

-   UI渲染
-   用户操作
-   状态维护

目录：

    renderer/src


    ├── App.tsx

    ├── router

    ├── components

    ├── store

    └── services

------------------------------------------------------------------------

# 3.8 Preload安全设计

## 设计目标

禁止Renderer直接访问Node API。

采用：

    contextIsolation=true

    nodeIntegration=false

    sandbox=true

------------------------------------------------------------------------

# 3.9 contextBridge设计

Preload：

``` typescript
contextBridge.exposeInMainWorld(

"hornet",

{

ssh:{

connect()

}


}

)
```

Renderer调用：

``` typescript
window.hornet.ssh.connect()
```

------------------------------------------------------------------------

# 3.10 IPC Manager设计

## 职责

统一管理：

-   注册Channel
-   参数校验
-   异常处理

------------------------------------------------------------------------

目录：

    ipc


    ├── IPCManager.ts

    ├── ssh.ipc.ts

    ├── file.ipc.ts

    └── terminal.ipc.ts

------------------------------------------------------------------------

# 3.11 IPC调用模型

    Renderer

     |

    invoke(channel,data)

     |

    IPCManager

     |

    Service

     |

    Return Result

------------------------------------------------------------------------

# 3.12 IPC规范

命名：

    module.action

示例：

    ssh.connect

    ssh.disconnect

    file.upload

    file.download

    terminal.create

------------------------------------------------------------------------

# 3.13 ServiceManager设计

## 职责

统一管理后台服务。

服务：

    SSHService

    SFTPService

    TerminalService

    TransferService

    AIService

------------------------------------------------------------------------

## 类定义

``` typescript
class ServiceManager {


services:Map<string,any>;


register();


get();


start();


stop();


}
```

------------------------------------------------------------------------

# 3.14 EventBus设计

用途：

模块间异步通信。

例如：

SSH断开：

    SSHService

     |

    EventBus.emit(
    "ssh.disconnect"
    )

     |

    Terminal

     |

    Update UI

接口：

``` typescript
interface EventBus {


on(event:string,callback);


emit(event:string,data);


off(event:string);

}
```

------------------------------------------------------------------------

# 3.15 应用生命周期设计

状态：

    INIT

     |

    STARTING

     |

    READY

     |

    RUNNING

     |

    CLOSING

     |

    CLOSED

------------------------------------------------------------------------

# 3.16 异常恢复设计

异常：

-   Renderer崩溃
-   Service异常
-   网络异常

处理：

    Error

     |

    ErrorManager

     |

    Log

     |

    Recover

     |

    Notify User

------------------------------------------------------------------------

# 3.17 日志设计

Main Process日志：

    logs/main.log

Renderer日志：

    logs/ui.log

格式：

``` json
{
"time":"",
"level":"ERROR",
"module":"IPC",
"message":"timeout"
}
```

------------------------------------------------------------------------

# 3.18 测试设计

测试：

## Unit Test

-   WindowManager
-   IPCManager
-   ServiceManager

## Integration Test

-   启动流程
-   IPC通信
-   服务加载

------------------------------------------------------------------------

# 3.19 开发任务拆分

## HORNET-ELECTRON-001

实现WindowManager

输入：

WindowConfig

输出：

BrowserWindow

工作量：

待 M0 技术验证后估算，见第18章。

------------------------------------------------------------------------

## HORNET-ELECTRON-002

实现IPC Framework

工作量：

待 M0 技术验证后估算，见第18章。

------------------------------------------------------------------------

## HORNET-ELECTRON-003

实现ServiceManager

工作量：

待 M0 技术验证后估算，见第18章。

------------------------------------------------------------------------

# 3.20 进程划分、监督与退出

Main 只负责窗口、能力授权、资源协调与服务监督；SSH/SFTP/FTP/PTY 在核心 utility process，SQLite 由数据服务单写，X Server/RDP/打印由受控原生辅助进程运行。Preload 不独立成进程。utility process 用于故障隔离，不自动构成第三方代码安全沙箱。API依据 [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)。

服务注册接口为 start/health/stop；登记服务版本、协议版本和拥有的 resourceId。启动超时15秒；运行中每5秒心跳，连续3次丢失标故障。后台服务恢复仅重建基础设施，副作用按 task 类型处理，不能自动重执行命令。

Renderer 崩溃只丢视图订阅；服务可保留其任务和租约30秒以便重建视图，逾期清理无任务所属的资源。Main 崩溃时辅助进程必须检测父管道断开并退出；安装为独立打印服务的进程是明确例外。

退出顺序：停止接收请求 → 展示未完成任务 → 保存布局/检查点 → 关闭协议通道和原生窗口 → 停服务 → 关闭数据库。等待超过10秒显示仍运行任务并允许用户选择继续等待或强制结束；不得以超时直接把打印标为成功。监听器、MessagePort、临时cookie和子进程句柄都需登记释放。

服务清单包含 ConnectionCoordinator、CredentialService、TransferService、TunnelService、X11Service、DesktopService、PrintService。窗口/数据/服务不能各自维护另一份权威连接状态。

# 3.21 下一章节

第4章 IPC通信详细设计

内容：

-   IPC Channel完整定义
-   请求响应模型
-   数据结构
-   错误码
-   超时机制
-   事件推送机制
