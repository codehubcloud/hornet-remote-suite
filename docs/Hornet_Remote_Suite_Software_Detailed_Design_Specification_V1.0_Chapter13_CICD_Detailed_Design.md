# Hornet Remote Suite 软件详细说明设计书 V1.0

# 第13章 CI/CD详细设计

当前已实现的编译、打包和发布步骤见 [编译、打包与发布操作指南](Build_Package_Release_Guide.md)，实际配置见 [release.yml](../.github/workflows/release.yml)。本章保留总体设计和概念示例；当前发布分支为 master，通过版本标签或手动运行触发，与下文 Git Flow 设想分开阅读。

------------------------------------------------------------------------

# 13.1 设计目标

CI/CD系统用于支撑 Hornet Remote Suite 持续集成、持续测试、持续交付。

目标：

-   自动编译
-   自动测试
-   自动打包
-   自动发布
-   多平台构建
-   版本管理
-   制品管理

------------------------------------------------------------------------

# 13.2 CI/CD总体架构

    Developer

       |

    Git Push / Merge Request

       |

    CI Server

       |

    +------------------------------+

    | Build Pipeline               |

    |                              |

    | Compile                     |

    | Unit Test                   |

    | Integration Test            |

    | Package                     |

    | Release                     |

    +------------------------------+

       |

    Artifact Repository

       |

    User Download

------------------------------------------------------------------------

# 13.3 构建与发布平台

首发认证Windows 11 x64。Windows ARM64、Linux x64/ARM64、macOS Intel/Apple Silicon为独立构建目标，只有对应协议引擎和安装包验收通过才发布。平台列表不等于当前全部支持。

# 13.4 Git流程设计

采用 Git Flow。

分支：

    main

    develop

    feature/*

    release/*

    hotfix/*

------------------------------------------------------------------------

# 13.5 Merge Request流程

流程：

    Developer

     |

    Feature Branch

     |

    Create MR

     |

    CI Trigger

     |

    Code Review

     |

    Merge

     |

    Release Build

------------------------------------------------------------------------

# 13.6 Pipeline阶段设计

完整流水线：

    Stage1

    Checkout


    ↓

    Stage2

    Dependency Install


    ↓

    Stage3

    Lint


    ↓

    Stage4

    Build


    ↓

    Stage5

    Unit Test


    ↓

    Stage6

    Package


    ↓

    Stage7

    Upload Artifact

------------------------------------------------------------------------

# 13.7 Build环境设计

Windows使用Windows runner，macOS使用macOS runner；Linux可使用固定镜像Docker runner。Docker不替代macOS原生签名/公证和Windows GUI、打印、原生模块测试。开发容器只用于可移植构建/服务夹具。

# 13.8 运行时与依赖版本

Node.js、pnpm、Electron及原生引擎锁定精确版本，保存toolchain manifest与lockfile；CI使用frozen-lockfile。Node使用实施时仍维护且与Electron工具链兼容的LTS，不继续把Node 20写成长期固定推荐；支持周期参考 [Node官方发布表](https://nodejs.org/en/about/previous-releases)。

构建Node与Electron内置Node分开记录；node-pty/SQLite等native模块按Electron ABI及目标架构重建，不能只在系统Node下测试。

# 13.9 前端构建流程

流程：

    pnpm install

    ↓

    pnpm lint

    ↓

    pnpm test

    ↓

    pnpm build

输出：

    dist/

------------------------------------------------------------------------

# 13.10 Electron打包设计

工具：

    electron-builder

输出：

Windows:

    .exe

    .msi

Linux:

    .AppImage

    .deb

    .rpm

macOS:

    .dmg

    .pkg

------------------------------------------------------------------------

# 13.11 Native模块编译

C++模块：

    native/

    ├── CMakeLists.txt

    └── src

流程：

    cmake configure

    ↓

    cmake build

    ↓

    copy library

------------------------------------------------------------------------

# 13.12 自动测试集成

Pipeline：

    Build

    ↓

    UT

    ↓

    IT

    ↓

    Report

测试报告：

-   JUnit XML
-   HTML Report

------------------------------------------------------------------------

# 13.13 多平台构建矩阵

示例：

    Windows x64

    Windows ARM64

    Ubuntu x64

    Ubuntu ARM64

    macOS ARM64

------------------------------------------------------------------------

# 13.14 制品管理

保存：

-   安装包
-   Debug包
-   Symbol文件

结构：

    artifact

    |

    version

    |

    platform

    |

    package

------------------------------------------------------------------------

# 13.15 自动发布设计

Release流程：

    Tag Create

     |

    CI Trigger

     |

    Build

     |

    Sign

     |

    Upload

     |

    Publish

------------------------------------------------------------------------

# 13.16 版本管理设计

版本：

    Major.Minor.Patch

例如：

    3.1.0

含义：

Major:

架构变化

Minor:

功能增加

Patch:

Bug修复

------------------------------------------------------------------------

# 13.17 自动更新设计

客户端：

    Check Update

     |

    Download

     |

    Verify

     |

    Install

     |

    Restart

支持：

-   增量更新
-   回滚

------------------------------------------------------------------------

# 13.18 软件签名设计

Windows：

-   Code Signing Certificate

macOS：

-   Apple Developer Certificate

Linux：

-   GPG Signature

------------------------------------------------------------------------

# 13.19 CI安全设计

包括：

-   Secret管理
-   Token隔离
-   权限控制
-   Runner隔离

------------------------------------------------------------------------

# 13.20 监控设计

收集：

-   Build失败
-   测试失败
-   发布状态

通知：

-   Email
-   企业微信
-   钉钉

------------------------------------------------------------------------

# 13.21 企业CI部署

支持：

## SaaS CI

    Git

    |

    Cloud Runner

## 私有CI

    Git Server

    |

    Private Runner

    |

    Artifact Server

------------------------------------------------------------------------

# 13.22 开发任务拆分

## HORNET-CI-001

Pipeline框架

工作量：

待 M0 技术验证后估算，见第18章。

## HORNET-CI-002

多平台Build

工作量：

待 M0 技术验证后估算，见第18章。

## HORNET-CI-003

Release系统

工作量：

待 M0 技术验证后估算，见第18章。

------------------------------------------------------------------------

# 13.23 套件发布流水线与原生制品

发布流水线：静态检查/UT → 编译 → 协议IT → 打包 → 安装包级GUI与故障测试 → 签名/验证 → 制品入库 → 分阶段发布。不是Tag创建后未经验收直接公开发布。

每个制品登记应用/引擎版本、架构、摘要、签名、SBOM、第三方通知和兼容矩阵。X/RDP/打印helper作为受控版本资源打包，不能启动PATH中同名二进制。M0确认每个依赖的分发材料再确定打包方式。

发布前执行第12章门槛和第24章矩阵检查；私有签名材料仅可信发布runner可用，外部贡献PR不可访问。离线包包含核心运行依赖，不能首次启动联网下载才能打开X11或打印。

# 下一章节

# 第14章 部署与运维详细设计

内容：

-   安装部署
-   配置管理
-   日志系统
-   监控
-   企业部署
-   升级回滚
