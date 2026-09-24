# Hornet Remote Suite 软件详细说明设计书 V1.0

# 第7章 SFTP文件管理详细设计

------------------------------------------------------------------------

# 7.1 设计目标

SFTP模块用于替代 Xftp，实现企业级远程文件管理能力。

目标：

-   本地/远程双栏文件管理
-   高性能文件传输
-   大文件支持
-   断点续传
-   文件同步
-   文件权限管理
-   Remote Edit联动

------------------------------------------------------------------------

# 7.2 SFTP总体架构

    +------------------------------------------------+
    | File Manager UI                                |
    |                                                |
    | Local Explorer                                 |
    | Remote Explorer                                |
    | Transfer Panel                                 |
    +----------------------+-------------------------+
                           |
                           |
    +----------------------v-------------------------+
    | File Service                                   |
    |                                                |
    | FileManager                                    |
    | TransferManager                                |
    | SyncManager                                    |
    +----------------------+-------------------------+
                           |
                           |
    +----------------------v-------------------------+
    | SFTP Client                                    |
    |                                                |
    | Connection                                     |
    | File Operation                                 |
    | Stream Transfer                                |
    +----------------------+-------------------------+
                           |
                           |
    +----------------------v-------------------------+
    | SSH Channel                                    |
    +------------------------------------------------+

------------------------------------------------------------------------

# 7.3 模块目录设计

    services/sftp


    ├── SFTPService.ts


    ├── SFTPClient.ts


    ├── FileManager.ts


    ├── FileTree.ts


    ├── TransferManager.ts


    ├── UploadTask.ts


    ├── DownloadTask.ts


    ├── SyncManager.ts


    ├── HashCalculator.ts


    └── PermissionManager.ts

------------------------------------------------------------------------

# 7.4 File Manager UI设计

## 双栏布局

    +------------------------------------------------+

    | Upload Download Sync Refresh                  |

    +------------------------------------------------+

    | Local Explorer       | Remote Explorer         |

    |                      |                         |

    | C:\project           | /home/project           |

    | main.cpp             | main.cpp                |

    | build.sh             | build.sh                |

    |                      |                         |

    +------------------------------------------------+

    | Transfer Queue                                |

    | firmware.bin       60% uploading              |

    +------------------------------------------------+

------------------------------------------------------------------------

# 7.5 FileTree设计

组件：

    FileTree


    ├── TreeNode

    ├── FileIcon

    ├── LazyLoader

    └── ContextMenu

------------------------------------------------------------------------

# 7.6 FileNode数据结构

``` typescript
interface FileNode {


name:string;


path:string;


type:

"file"|"directory";


size:number;


modifyTime:number;


permission:string;


}
```

------------------------------------------------------------------------

# 7.7 目录加载流程

采用懒加载。

流程：

    Click Folder

     |

    FileTree.expand()

     |

    SFTP.list()

     |

    Create Child Nodes

     |

    Render UI

------------------------------------------------------------------------

# 7.8 SFTPClient设计

职责：

封装SFTP协议。

接口：

``` typescript
interface ISFTPClient {


connect();


list(path:string);


upload(task:UploadTask);


download(task:DownloadTask);


remove(path:string);


rename(oldPath,newPath);


}
```

------------------------------------------------------------------------

# 7.9 文件上传设计

流程：

    Select File

     |

    Create UploadTask

     |

    TransferManager

     |

    SFTP Stream

     |

    Remote File

     |

    Refresh Tree

------------------------------------------------------------------------

# 7.10 UploadTask设计

``` typescript
interface UploadTask {


id:string;


localPath:string;


remotePath:string;


size:number;


offset:number;


status:string;


progress:number;


}
```

------------------------------------------------------------------------

# 7.11 文件下载设计

流程：

    Remote File

     |

    Download Button

     |

    Create DownloadTask

     |

    SFTP.get()

     |

    Local Save

------------------------------------------------------------------------

# 7.12 TransferManager设计

职责：

统一管理传输任务。

状态机：

    CREATED

     |

    WAITING

     |

    RUNNING

     |

    PAUSED

     |

    SUCCESS


    FAILED

接口：

``` typescript
interface ITransferManager {


add(task);


pause(id);


resume(id);


cancel(id);


}
```

------------------------------------------------------------------------

# 7.13 大文件传输设计

应用：

-   Firmware包
-   镜像文件
-   大型数据文件

优化：

-   Stream
-   Buffer控制
-   分块记录
-   断点恢复

流程：

    Large File

     |

    Chunk

     |

    Transfer Queue

     |

    SFTP Stream

     |

    Remote Merge

------------------------------------------------------------------------

# 7.14 断点续传设计

保存：

``` json
{
"file":"firmware.bin",
"size":10737418240,
"offset":5368709120
}
```

恢复：

    Read Offset

     |

    Seek

     |

    Continue Transfer

------------------------------------------------------------------------

# 7.15 文件校验设计

支持：

-   MD5
-   SHA256

接口：

``` typescript
calculateHash(
path:string
):Promise<string>
```

------------------------------------------------------------------------

# 7.16 文件同步设计

支持：

-   Local -\> Remote
-   Remote -\> Local
-   Bidirectional

流程：

    Scan Local

    +

    Scan Remote

            |

           Diff

            |

    ADD

    DELETE

    MODIFY

    SAME

------------------------------------------------------------------------

# 7.17 Diff算法设计

比较：

  字段         作用
  ------------ ----------
  Name         文件名
  Size         大小
  ModifyTime   修改时间
  Hash         内容

------------------------------------------------------------------------

# 7.18 文件权限管理

显示：

-   Owner
-   Group
-   Permission

支持：

    chmod

    chown

接口：

``` typescript
chmod(
path,
mode
)
```

------------------------------------------------------------------------

# 7.19 Remote Edit联动

流程：

    Double Click File

     |

    Download Cache

     |

    Monaco Editor

     |

    Edit

     |

    Ctrl+S

     |

    Upload

------------------------------------------------------------------------

# 7.20 SQLite缓存设计

文件缓存：

``` sql
CREATE TABLE file_cache
(
path TEXT,
hash TEXT,
size INTEGER,
modify_time INTEGER
);
```

传输任务：

``` sql
CREATE TABLE transfer_task
(
id TEXT,
source TEXT,
target TEXT,
status TEXT,
progress INTEGER
);
```

------------------------------------------------------------------------

# 7.21 异常处理设计

错误：

  错误       处理
  ---------- ----------
  网络断开   暂停任务
  权限不足   提示
  磁盘不足   停止传输
  文件冲突   询问用户

------------------------------------------------------------------------

# 7.22 性能设计

指标：

  项目         目标
  ------------ ----------
  单文件10GB   稳定
  并发任务     \>=10
  大目录       10万文件

------------------------------------------------------------------------

# 7.23 测试设计

测试：

-   小文件上传
-   大文件上传
-   断网恢复
-   文件同步
-   权限异常

------------------------------------------------------------------------

# 7.24 开发任务拆分

## HORNET-SFTP-001

SFTP Client

周期：

7天

## HORNET-SFTP-002

File Explorer

周期：

10天

## HORNET-SFTP-003

Transfer Manager

周期：

10天

## HORNET-SFTP-004

Sync Manager

周期：

10天

------------------------------------------------------------------------

# 下一章节

# 第8章 Remote IDE详细设计

内容：

-   Monaco Editor
-   Workspace
-   LSP
-   clangd
-   Remote Build
-   Git集成
-   Debug
