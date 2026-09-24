# Hornet Remote Suite 软件详细说明设计书 V1.0

# 第8章 Remote IDE详细设计

------------------------------------------------------------------------

# 8.1 设计目标

Remote IDE模块用于实现类似 VSCode Remote SSH 的远程开发能力。

目标：

-   远程Workspace管理
-   Monaco代码编辑
-   Remote文件同步
-   语言服务支持
-   编译构建
-   Git集成
-   调试扩展

------------------------------------------------------------------------

# 8.2 Remote IDE总体架构

    +------------------------------------------------+
    | IDE UI                                         |
    |                                                |
    | Explorer                                       |
    | Monaco Editor                                  |
    | Terminal                                       |
    | Git Panel                                      |
    +----------------------+-------------------------+
                           |
                           |
    +----------------------v-------------------------+
    | Remote IDE Service                             |
    |                                                |
    | Workspace Manager                              |
    | File Cache                                     |
    | Language Service                               |
    | Build Manager                                  |
    | Git Manager                                    |
    +----------------------+-------------------------+
                           |
                           |
    +----------------------v-------------------------+
    | Remote Agent                                   |
    |                                                |
    | clangd                                         |
    | gcc                                            |
    | cmake                                          |
    | git                                            |
    | gdb                                            |
    +------------------------------------------------+

------------------------------------------------------------------------

# 8.3 模块目录设计

    services/ide


    ├── WorkspaceManager.ts


    ├── RemoteFileService.ts


    ├── FileCacheManager.ts


    ├── EditorManager.ts


    ├── LSPClient.ts


    ├── BuildManager.ts


    ├── GitManager.ts


    └── DebugManager.ts

------------------------------------------------------------------------

# 8.4 Workspace设计

## 8.4.1 Workspace定义

本章原Workspace更名为RemoteProject，避免与统一工作台WorkspaceLayout混淆。以下局部伪代码按第1章模型实现。

数据结构：

``` typescript
interface RemoteProject {


id:string;


name:string;


profileId:string;


remotePath:string;


language:string;


}
```

------------------------------------------------------------------------

# 8.5 Workspace创建流程

    Create Workspace

     |

    Select SSH Server

     |

    Select Remote Directory

     |

    Initialize Workspace

     |

    Load File Tree

     |

    Open Editor

------------------------------------------------------------------------

# 8.6 Remote File Cache设计

目的：

减少远程访问延迟。

目录：

    app.getPath("userData")/cache

缓存内容：

-   文件内容
-   修改时间
-   Hash

数据结构：

``` typescript
interface FileCache {


path:string;


hash:string;


modifyTime:number;


content:string;


}
```

------------------------------------------------------------------------

# 8.7 文件打开流程

    Double Click File

     |

    Check Cache

     |

    Download File

     |

    Monaco Load

     |

    Edit

------------------------------------------------------------------------

# 8.8 保存流程

打开文件时保存profileId、身份版本、路径与来源指纹。Ctrl+S经第7章统一FileService进行冲突检测、临时文件上传、提交与缓存版本更新；不能绕过任务系统直接覆盖。远端已变更时显示diff/另存/用户选择覆盖。保存失败保留本地dirty buffer，不错误显示已保存。

# 8.9 Monaco Editor设计

组件：

    EditorPanel


    ├── EditorTabs

    ├── MonacoEditor

    └── StatusBar

初始化：

``` typescript
monaco.editor.create(

container,

{

language:"cpp",

theme:"vs-dark"

}

)
```

------------------------------------------------------------------------

# 8.10 Language Service设计

采用：

Language Server Protocol。

架构：

    Monaco

     |

    LSP Client

     |

    SSH

     |

    Language Server

     |

    Remote Machine

------------------------------------------------------------------------

# 8.11 C/C++语言支持

支持：

-   clangd

能力：

-   自动补全
-   跳转定义
-   查找引用
-   重构
-   语义高亮

依赖：

    compile_commands.json

------------------------------------------------------------------------

# 8.12 Python语言支持

支持：

-   pyright
-   pylsp

能力：

-   类型提示
-   补全
-   错误检查

------------------------------------------------------------------------

# 8.13 Build Manager设计

支持：

-   Make
-   CMake
-   Ninja

接口：

``` typescript
interface IBuildManager {


build();


clean();


configure();


}
```

------------------------------------------------------------------------

# 8.14 Remote Build流程

    Click Build

     |

    BuildManager

     |

    SSH Execute

     |

    cmake/make

     |

    Parse Output

     |

    Display Result

------------------------------------------------------------------------

# 8.15 Build Output设计

解析：

    error:

    main.cpp:20

    undefined reference

生成：

    Problem:

    main.cpp

    Line 20

支持：

点击错误跳转代码。

------------------------------------------------------------------------

# 8.16 Git Manager设计

功能：

-   status
-   diff
-   commit
-   push
-   pull

接口：

``` typescript
interface IGitManager {


status();


diff();


commit();


push();


pull();


}
```

------------------------------------------------------------------------

# 8.17 Debug设计

预留：

Debug Adapter Protocol。

架构：

    Monaco

     |

    DAP Client

     |

    SSH

     |

    gdb/lldb

     |

    Target

------------------------------------------------------------------------

# 8.18 UI布局设计

    +------------------------------------------------+

    Explorer | Editor


             Monaco


    +------------------------------------------------+

    Terminal / Output / Problems


    +------------------------------------------------+

------------------------------------------------------------------------

# 8.19 错误处理设计

错误：

  错误         处理
  ------------ ----------
  文件不存在   刷新
  SSH断开      重连
  编译失败     显示错误
  LSP异常      重新启动

------------------------------------------------------------------------

# 8.20 性能设计

扩展阶段单独验收：≤1MiB文本在受控LAN打开p95≤1秒；语言服务已完成索引后的补全p95≤200ms。10万文件工程记录索引时间、资源消耗与取消响应，需按语言与实际工程制定门槛，不称“可接受”。不把语言服务器冷启动算成编辑器渲染性能。

# 8.21 测试设计

测试：

-   大工程打开
-   LSP补全
-   编译
-   Git操作
-   网络恢复

------------------------------------------------------------------------

# 8.22 开发任务拆分

## HORNET-IDE-001

Monaco集成

工作量：

待 M0 技术验证后估算，见第18章。

## HORNET-IDE-002

Remote Cache

工作量：

待 M0 技术验证后估算，见第18章。

## HORNET-IDE-003

LSP支持

工作量：

待 M0 技术验证后估算，见第18章。

## HORNET-IDE-004

Build Manager

工作量：

待 M0 技术验证后估算，见第18章。

------------------------------------------------------------------------

# 8.23 Agent、LSP与执行边界

本章属M4扩展；基础远程编辑可在M1/M2以SFTP完成，不依赖Agent。Monaco不等于VSCode Remote：LSP client、JSON-RPC传输、URI映射、语言服务器安装、调试适配器与扩展兼容都需单独实现。

Agent为可选部署，用户明确启用后在远端用户目录按版本/架构安装，验证包签名/摘要，失败回滚，不默认sudo。通信用已认证SSH通道和版本握手，不开放公网端口。无Agent时提供受限编辑与显式SSH命令，禁用无法满足的能力。

LSP通过stdio/受控SSH子通道桥接，区分诊断日志与协议字节；URI携带profile与工程映射。取消、断线与进程崩溃使请求失败，不能无限重复执行构建。DAP需真正的debug adapter，gdb/lldb本身不能直接当成DAP服务器。

构建/Git使用明确cwd与参数，参数化启动；用户shell命令按目标shell规则处理，不用字符串拼接不可信文件名。工程首次打开设信任状态，构建脚本及Git hooks执行前遵循信任策略。

# 下一章节

# 第9章 Plugin SDK详细设计

内容：

-   Plugin Runtime
-   Plugin API
-   插件生命周期
-   权限模型
-   Marketplace
