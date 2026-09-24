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

Workspace表示一个远程开发工程。

数据结构：

``` typescript
interface Workspace {


id:string;


name:string;


host:string;


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

    ~/.hornet/cache

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

Ctrl+S：

    Editor Save Event

     |

    EditorManager

     |

    FileService

     |

    SFTP Upload

     |

    Remote Update

------------------------------------------------------------------------

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

目标：

  项目       指标
  ---------- ----------
  打开文件   \<1s
  代码补全   \<200ms
  远程构建   稳定
  大工程     10万文件

------------------------------------------------------------------------

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

周期：

7天

## HORNET-IDE-002

Remote Cache

周期：

10天

## HORNET-IDE-003

LSP支持

周期：

15天

## HORNET-IDE-004

Build Manager

周期：

10天

------------------------------------------------------------------------

# 下一章节

# 第9章 Plugin SDK详细设计

内容：

-   Plugin Runtime
-   Plugin API
-   插件生命周期
-   权限模型
-   Marketplace
