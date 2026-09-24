# Hornet Remote Suite 软件详细说明设计书 V1.0

# 第7章 SFTP / FTP 文件管理详细设计

------------------------------------------------------------------------

# 7.1 设计目标

文件模块覆盖SFTP及FTP，通过统一FileProvider和任务中心管理；协议能力不同，不能由SFTP接口推断FTP具备同样语义。

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

状态：queued → running → verifying → committing → succeeded。running可转pausing → paused；用户取消转cancelling → cancelled；任何阶段可转failed或conflict。paused经重新验证后回queued，终态不能直接复用taskId再跑新任务。

全局默认4个执行任务、每主机2个；可配置到10并发后按12章验证。队列支持优先级、限速、暂停/取消、错误重试与调度。关闭文件视图不释放任务租约。进度由确认字节/总字节计算，总量未知时显示已传字节，不伪造百分比。

# 7.13 大文件与提交设计

使用有界流读写，默认256KiB IO缓冲，限制并发请求。SFTP直接按offset写同一个受控临时文件，不依赖远端安装Agent或“Remote Merge”命令。临时文件放目标同目录，命名带taskId，成功关闭/校验后才rename为目标。

有posix-rename等已验证原子覆盖能力时才承诺原子替换；缺少支持则提示覆盖存在非原子窗口，用户选择另存或显式覆盖。失败保留或清理临时文件依策略，不删除未知同名对象。

# 7.14 断点续传设计

检查点包含profile身份版本、路径、来源大小/mtime/可用hash、目标临时对象、已确认offset及块摘要。恢复先重查来源和目标前缀；大小/mtime相同只能作初筛，不能证明内容相同。验证不了前缀则重新传输或显式提示风险，禁止仅凭offset继续。

来源变化转conflict，由用户重新开始或另存。暂停在流关闭并提交检查点后确认；取消不能把半文件标成功。应用重启时原running任务先转paused，不立即写远端。

# 7.15 文件校验设计

默认SHA-256；远端SFTP通常不保证提供hash扩展，按能力探测选择远端已支持的校验、用户允许的SSH命令或回读计算。不能默认远端存在sha256sum；失败时显示“仅大小校验”而非“内容校验通过”。禁止通过未转义路径拼shell校验命令。

# 7.16 文件同步设计

Local→Remote、Remote→Local及双向同步均先生成计划。默认不删除；镜像删除单独开启。双向同步保存上次成功基线，双方均变化或一方删除另一方修改时转冲突，不能简单last-write-wins。用户确认计划后执行前再次校验源/目标版本；目录变化时使计划失效。

处理忽略规则、隐藏文件、时间精度/时区、大小写碰撞、权限和符号链接。默认不跟随符号链接递归，不越出同步根；无法可靠判断的条目显示待确认。

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

# 7.20 持久化设计

唯一schema见第11章file_cache、task、transfer_task。缓存键必须包含profileId、身份版本与远端路径，任务包含源/目标身份、来源版本及确认offset。禁止另建只有path的缓存表。

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

按第12章T-PERF-03/05验证10GiB文件、10任务配置与10万目录项。协议未提供分页时后台流式读取并在本地分页/虚拟化；取消目录读取应释放handle。

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

工作量：

待 M0 技术验证后估算，见第18章。

## HORNET-SFTP-002

File Explorer

工作量：

待 M0 技术验证后估算，见第18章。

## HORNET-SFTP-003

Transfer Manager

工作量：

待 M0 技术验证后估算，见第18章。

## HORNET-SFTP-004

Sync Manager

工作量：

待 M0 技术验证后估算，见第18章。

------------------------------------------------------------------------

# 7.25 FTP适配、调度和远程编辑

FileProvider按能力声明list/read/write/rename/resume/chmod/hash/atomicReplace；不支持返回CAPABILITY_UNAVAILABLE。FTP默认被动模式、独立数据连接，断点续传需验证REST等服务端支持；主动模式/FXP为M3显式能力。FTP明文连接需用户配置，FTPS作为Hornet可选扩展，不把它混称SFTP或对标必有功能。

远程编辑保存基于打开时的版本指纹，重新stat/必要时hash后再写临时文件提交；仅靠stat后rename无法保证对外部并发写者的原子CAS，须说明剩余竞争窗口，严格场景使用远端Agent条件写或另存。外部编辑器通过受限缓存文件监听，防抖并检查冲突，不对任意路径自动上传。

调度保存时区、下次执行、错过执行策略；默认错过不补跑，幂等键按调度实例产生。命令行传输使用同一任务API和凭据服务，不能在命令行传密码。文件过滤、同步导航与下载优先级属于M2；FXP及批量高级兼容见24章。

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


### 当前实现补充：终端文件工作区（2026-09-24）

终端侧栏复用 SFTP 文件操作，新增当前目录名称筛选及 file.chmod IPC。schema 验证整数 0–511，服务检查租约所有者、文件类型后通过 SFTP 设置权限；拒绝符号链接与特殊文件。三位模式会清除特殊权限位；lstat 与 chmod 并非原子操作，不能防止远端路径并发替换。目录异步响应通过请求序号避免过期列表覆盖最新路径。尚未实现 Shell cd 自动同步、目录同步和大目录虚拟化。

### 当前实现补充：跟随活动终端（2026-09-24）

文件侧栏新增“跟随终端”开关，默认关闭。仅活动标签启用轮询，以约 800ms 间隔串行请求 terminal.cwd，切换分屏后丢弃旧请求结果，目录或终端 ID 变化时加载目录。关闭跟随后停止更新，继续手动浏览；目录失败在文件栏内提示，不打断终端。

Linux 能力优先通过 SFTP readlink('/proc/self') 探测，查询与 SFTP 初始化共用 8 秒上限；失败后通过独立 SSH exec 执行 readlink 查询。cwd 查询同样支持回退，并缓存成功的 exec 查询方式。辅助通道使用随机响应标识隔离登录横幅、限制输出大小、超时关闭，路径仅允许服务生成的 /proc/self 或数字 PID 的 cwd。支持时使用 PTY exec 的 sh 包装命令报告带随机会话标识的 PID，再 exec 用户登录 Shell；固定长度缓冲处理分片标识，不解析提示符或猜测 cd 输入。terminal.cwd 验证终端所有者，仅允许读取已绑定数字 PID 的 cwd 链接，校验返回路径。探测失败或 exec 请求被拒绝时回退普通 shell 请求。

本轮范围为初始登录 Shell 的物理 cwd；嵌套 ssh、容器、tmux、子 Shell 和受限 SFTP 命名空间不保证跟随。现有运行会话不注入命令，需重新打开终端。实现依据：https://docs.kernel.org/filesystems/proc.html 。
