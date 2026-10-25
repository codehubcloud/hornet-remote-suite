# Hornet Remote Suite 详细设计文档

修订日期：2026-09-24。文档版本V1.0；状态为设计修订稿，未完成软件实现验收。

目标：将原SSH/SFTP/IDE草案调整为覆盖Xmanager Power Suite 8四类核心用途的统一桌面套件，补齐图形、打印，以及跨模块共享配置、认证、任务与生命周期。对标来源和差异见第24章。

建议先读第1章把握架构、第24章核对范围、第19章查看问题与待验证决策、第12章查看验收、第18章安排实施。Windows首先验证是当前设计假设，不代表其他平台已验证或被永久排除。

## 章节目录

实际编译和安装包发布请参阅 [编译、打包与发布操作指南](Build_Package_Release_Guide.md)。该指南依据当前脚本与 Actions 工作流，覆盖本地构建、五平台打包验收、公开或私有源码仓库的发布授权、七安装包与八语说明校验、更新缓存及失败排查；下列章节中的 CI/CD 概念示例不替代实际操作指南。

| 章节 | 内容 |
|---|---|
| 1 | [系统总体设计](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter1_System_Design.md) |
| 2 | [统一工作台 UI](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter2_UI_Detailed_Design.md) |
| 3 | [Electron 核心](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter3_Electron_Core_Detailed_Design.md) |
| 4 | [IPC 契约](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter4_IPC_Detailed_Design.md) |
| 5 | [SSH 与隧道](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter5_SSH_Detailed_Design.md) |
| 6 | [终端](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter6_Terminal_Detailed_Design.md) |
| 7 | [SFTP / FTP 文件管理](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter7_SFTP_File_Manager_Detailed_Design.md) |
| 8 | [Remote IDE（扩展）](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter8_Remote_IDE_Detailed_Design.md) |
| 9 | [插件 SDK（扩展）](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter9_Plugin_SDK_Detailed_Design.md) |
| 10 | [AI Agent（扩展）](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter10_AI_Agent_Detailed_Design.md) |
| 11 | [数据库与持久化](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter11_Database_Detailed_Design.md) |
| 12 | [测试与验收](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter12_Test_Detailed_Design.md) |
| 13 | [CI/CD](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter13_CICD_Detailed_Design.md) |
| 14 | [部署与运维](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter14_Deployment_Operation_Detailed_Design.md) |
| 15 | [安全](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter15_Security_Detailed_Design.md) |
| 16 | [企业架构（扩展）](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter16_Enterprise_Architecture_Detailed_Design.md) |
| 17 | [商业化（待定方案）](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter17_Product_Commercialization_Ecosystem_Detailed_Design.md) |
| 18 | [路线图与实施计划](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter18_Product_Roadmap_Project_Implementation_Plan.md) |
| 19 | [架构评审与决策](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter19_Architecture_Summary_Technical_Review.md) |
| 20 | [工程目录与规范](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter20_Source_Code_Project_Structure_and_Coding_Standard.md) |
| 21 | [X11 / XDMCP](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter21_X11_Detailed_Design.md) |
| 22 | [RDP / VNC](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter22_Remote_Desktop_Detailed_Design.md) |
| 23 | [LPD 远程打印](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter23_LPD_Print_Detailed_Design.md) |
| 24 | [对标功能矩阵](Hornet_Remote_Suite_Software_Detailed_Design_Specification_V1.0_Chapter24_Feature_Parity_Matrix_Detailed_Design.md) |

## 共同契约

- 第1章统一领域对象，第4章统一IPC，第11章统一数据库，第20章统一目录。
- 第3、5—10及13—17章保留的局部示例是概念伪代码，必须服从共同契约，不能直接作为完整实现。
- 原任务“周期：若干天”是未经验证的估算，第18章已废止其排期效力。
- 第8—10、16—17章为扩展或待定商业方案，不是首发全部承诺。
- 软件M1为0.x基础工作台，M2为四类核心用途V1.0候选，M3补齐高级兼容；未验收不得称完全替代。
- 安全章节重复文件保留为跳转页，唯一正文为第15章主文件。
- 文中的配额、性能目标和引擎候选须经测试定稿；没有实测结果不能写“已支持”。

## 修订说明

新增21—24章；重写总体、UI、IPC、数据、测试、路线图、评审与工程规范；修正连接复用、恢复、续传、缓存隔离、插件/AI边界和部署。问题R01—R12见第19章。

本次范围为设计文档，不代表已实现协议引擎、安装包或完成实际兼容性测试。
