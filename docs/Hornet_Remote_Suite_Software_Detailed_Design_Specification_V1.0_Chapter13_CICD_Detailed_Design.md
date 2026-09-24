# Hornet Remote Suite 软件详细说明设计书 V1.0

# 第13章 CI/CD详细设计

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

# 13.3 支持平台设计

构建目标：

  平台      架构
  --------- ---------------------
  Windows   x64/ARM64
  Linux     x64/ARM64
  macOS     Intel/Apple Silicon

------------------------------------------------------------------------

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

采用Docker隔离。

目录：

    ci

    ├── docker

    │   ├── windows

    │   ├── linux

    │   └── macos

    └── scripts

------------------------------------------------------------------------

# 13.8 Node环境管理

要求：

    Node.js LTS

    pnpm

版本固定：

``` json
{
"engines":
{
"node":">=20"
}
}
```

------------------------------------------------------------------------

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

周期：

10天

## HORNET-CI-002

多平台Build

周期：

15天

## HORNET-CI-003

Release系统

周期：

10天

------------------------------------------------------------------------

# 下一章节

# 第14章 部署与运维详细设计

内容：

-   安装部署
-   配置管理
-   日志系统
-   监控
-   企业部署
-   升级回滚
