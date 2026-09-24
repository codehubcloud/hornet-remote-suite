# Hornet Remote Suite 软件详细说明设计书 V1.0

# 第9章 Plugin SDK详细设计

---

# 9.1 设计目标

Plugin SDK用于实现 Hornet Remote Suite 的插件扩展能力。

目标：

- 支持第三方功能扩展
- 支持企业内部插件开发
- 支持UI扩展
- 支持命令扩展
- 支持工具链扩展
- 支持硬件设备扩展


插件体系参考：

- VSCode Extension
- JetBrains Plugin
- Chrome Extension


---

# 9.2 Plugin总体架构


```
+------------------------------------------------+
| Hornet Application                             |
|                                                |
| Plugin Manager                                 |
| Plugin Runtime                                 |
| Plugin API                                     |
+----------------------+-------------------------+
                       |
                       |
+----------------------v-------------------------+
| Plugin Package                                 |
|                                                |
| package.json                                  |
| main.js                                        |
| ui components                                  |
| resources                                      |
+----------------------+-------------------------+
                       |
                       |
+----------------------v-------------------------+
| Host API                                       |
|                                                |
| Command                                        |
| Terminal                                       |
| FileSystem                                     |
| Session                                        |
+------------------------------------------------+

```


---

# 9.3 插件目录设计


标准插件：


```
hornet-plugin-demo


├── package.json


├── main.ts


├── src


│   ├── commands


│   ├── panels


│   └── services


├── resources


└── README.md

```


---

# 9.4 Plugin Manifest设计


文件：

```
package.json

```


示例：


```json
{
"name":"nvme-tools",
"version":"1.0.0",
"main":"main.js",
"description":"NVMe utility plugin",
"permissions":[
"terminal",
"filesystem"
]
}

```


字段：


|字段|说明|
|-|-|
|name|插件名称|
|version|版本|
|main|入口|
|permissions|权限|


---

# 9.5 Plugin生命周期设计


状态：


```
INSTALLED

 |

LOADED

 |

ACTIVATED

 |

RUNNING

 |

DEACTIVATED

 |

UNINSTALLED

```


---

# 9.6 Plugin Manager设计


职责：

- 扫描插件
- 加载插件
- 启停插件
- 管理版本


目录：


```
plugin


├── PluginManager.ts


├── PluginLoader.ts


├── PluginRegistry.ts


└── PermissionManager.ts

```


---

# 9.7 PluginManager类设计


```typescript
class PluginManager {


install(path:string);


load(id:string);


activate(id:string);


deactivate(id:string);


remove(id:string);


}

```


---

# 9.8 Plugin Runtime设计


目的：

提供插件运行环境。


能力：

- 生命周期管理
- API注入
- 异常隔离


模型：


```
Plugin

 |

Runtime Sandbox

 |

Host API

```


---

# 9.9 Plugin API设计


统一入口：


```typescript
interface PluginContext {


registerCommand();


registerPanel();


registerTerminal();


registerFileProvider();


}

```


---

# 9.10 Command扩展设计


插件注册：


```typescript
context.registerCommand(

"nvme.scan",

handler

);

```


调用流程：


```
User

 |

Command Palette

 |

CommandManager

 |

Plugin Handler

```


---

# 9.11 UI扩展设计


支持：


- Sidebar
- Panel
- Toolbar
- Menu
- Context Menu


示例：


```
Sidebar

 |

NVMe Tools

 |

Plugin Panel

```


---

# 9.12 Terminal扩展设计


插件可以增加Terminal命令。


例如：

```
hornet nvme info

```


流程：


```
Terminal

 |

Command Router

 |

Plugin Command

 |

Execute

```


---

# 9.13 FileSystem Provider设计


支持虚拟文件系统。


例如：

```
NVMe Device

 |

Plugin File Provider

 |

Explorer

```


接口：


```typescript
interface FileProvider {


list(path:string);


read(path:string);


write(path:string);


}

```


---

# 9.14 Session扩展设计


插件可以访问：

- SSH Session
- Terminal Session
- Workspace


接口：


```typescript
getCurrentSession()

```


---

# 9.15 权限模型设计


权限分类：


|权限|说明|
|-|-|
|terminal|执行命令|
|filesystem|文件访问|
|network|网络访问|
|device|硬件访问|


---

# 9.16 插件安全隔离


策略：

- 独立Runtime
- API权限控制
- 异常隔离


异常：


```
Plugin Crash

 |

Plugin Manager

 |

Disable Plugin

 |

Application Continue

```


---

# 9.17 插件签名设计


目的：

验证插件来源和完整性；签名不能证明代码无恶意。


流程：


```
Plugin Package

 |

Hash

 |

Signature Verify

 |

Install

```


支持：

- RSA
- SHA256


---

# 9.18 Marketplace设计


功能：

- 搜索
- 安装
- 更新
- 删除


流程：


```
User

 |

Marketplace

 |

Download

 |

Verify

 |

Install

```


---

# 9.19 插件数据库设计


```sql
CREATE TABLE plugin
(
id TEXT PRIMARY KEY,
name TEXT,
version TEXT,
status TEXT
);

```


---

# 9.20 测试设计


测试：

- 插件安装
- 插件加载
- API调用
- 权限控制
- 崩溃恢复


---

# 9.21 开发任务拆分


## HORNET-PLUGIN-001

Plugin Manager

工作量：

待 M0 技术验证后估算，见第18章。


## HORNET-PLUGIN-002

Runtime

工作量：

待 M0 技术验证后估算，见第18章。


## HORNET-PLUGIN-003

Plugin SDK

工作量：

待 M0 技术验证后估算，见第18章。


## HORNET-PLUGIN-004

Marketplace

工作量：

待 M0 技术验证后估算，见第18章。


---

# 9.22 可执行隔离边界与权限契约

本章为M4设计。独立Node进程只能隔离崩溃，拥有Node/fs/net的第三方插件可以绕过Host API；不能将其称为安全沙箱。默认第三方扩展仅允许无Node、固定CSP的隔离Web内容/受限运行时，经broker调用能力；任意Node/native扩展在完成OS级沙箱验证前仅允许明确标记的受信任内置插件。

permissions必须细化为作用域，如file.read(profileId, root)、file.write、terminal.execute(profileId)、network(domain)、ui.panel；主进程每次调用重新校验，禁止getCurrentSession返回原始连接或凭据。撤销权限后关闭对应句柄/订阅。插件不能自行构造租约越权访问另一主机。

插件manifest增加engines.hornet、apiVersion、入口摘要、权限schema；解包防路径穿越/符号链接，限制包大小，校验完整签名链后原子安装。升级新增权限不能静默继承。CPU/内存/请求速率超预算先终止该插件，主服务继续。

第三方UI不直接注入主React树；贡献点为受校验声明或隔离视图。Marketplace发布与购买属于可选服务，基础套件不依赖其在线状态。

# 下一章节


# 第10章 AI Agent详细设计

内容：

- Agent Runtime
- Tool Calling
- RAG
- AI Terminal
- Log Analyzer
- 企业私有AI
