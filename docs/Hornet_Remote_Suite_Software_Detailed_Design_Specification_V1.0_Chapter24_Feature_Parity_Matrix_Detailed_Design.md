# Hornet Remote Suite 软件详细设计说明书 V1.0
## 第24章 Power Suite 8 功能对照与验收追踪

核对日期：2026-09-24。基线为NetSarang官方四产品规格页及版本8功能标记。网页会更新，不把全部功能都当作版本8新增。所有Hornet实现状态均为“待实现/待验证”，本表不是兼容认证报告。

## 24.1 对标口径

四类核心用途必须进入同一工作台。逐功能等价还需验证协议扩展、脚本/会话格式、认证和操作行为。M1是SSH/SFTP MVP；M2是四类用途套件；M3补齐高级兼容；M4为IDE/AI/企业扩展。

本表为功能组级基线，不宣称穷尽官方每个选项。开发时须展开子用例，保存对标产品8.x版本、Hornet引擎版本与实测证据。未明确项记为差异，不默认支持。

## 24.2 功能组追踪

| 追踪ID | 功能组 | 原文缺口 | Hornet方案 / 阶段 | 设计 / 验收 |
|---|---|---|---|---|
| C-UNI-01 | 会话、分组、认证配置、导入导出 | 只有SSH Session | 共用profile、凭据、布局；M1—M2 | 1/2/11；T-UNI-01/03、T-DATA-02 |
| C-UNI-02 | 主密码与凭据管理 | 只提加密 | M1 OS凭据库；M3主密码保险库另行设计 | 5/15；T-SEC-02 |
| C-TERM-01 | 多标签/分屏、本地shell、复制搜索 | 部分概念 | 共用ViewHost、PTY、键盘规则；M1 | 2/6；T-TERM-01 |
| C-TERM-02 | SSH、Telnet、串口 | 缺后两项 | 独立adapter、明文提示；M2 | 5/6；T-TERM-03 |
| C-TERM-03 | 广播、Compose、快捷命令、触发器、脚本 | 缺设计 | 显式目标、受限运行时、取消/限频；M2 | 6；T-TERM-02 |
| C-TERM-04 | 录制、日志查看、锁定、Hex、终端打印 | 缺或简略 | 输出录制与显示工具；M2—M3 | 6/15；T-TERM-02及M3子用例 |
| C-TERM-05 | 仿真、编码、按键、字体/高亮、X/Y/ZMODEM | 未分解 | 目标设备/仿真与传输逐项测试；M3 | 6；M3兼容用例 |
| C-SSH-01 | 跳板、代理、静态/动态转发 | 缺设计 | 租约依赖、TunnelService；M2 | 5；T-SSH-02/03 |
| C-SSH-02 | 密码/公钥/交互认证、Agent | 缺交互认证 | challenge和Agent签名；M1—M2 | 5；T-SSH-02 |
| C-SSH-03 | GSSAPI、PKCS#11/CAPI、OpenSSH CA | 缺设计 | 认证adapter与真实环境验证；M3 | 5/19；M3认证矩阵 |
| C-FILE-01 | SFTP/FTP、并发、暂停/续传 | 缺FTP和一致性 | provider与持久任务；M1—M2 | 7/11；T-FILE-01/02/04 |
| C-FILE-02 | 同步、过滤、导航、编辑、权限 | 缺冲突模型 | 预览与版本检查；M2 | 7/8；T-FILE-03/04 |
| C-FILE-03 | 调度、优先级、命令行、搜索/缩略图 | 缺设计 | 共用队列与受限预览；M2—M3 | 7；T-FILE-04及M3子用例 |
| C-FILE-04 | FXP、主动FTP与旧传输方式 | 缺设计 | 能力探测，不把SFTP中转叫FXP；M3 | 7；M3协议用例 |
| C-X11-01 | PC X Server、SSH启动X应用 | 整体缺失 | 原生引擎、cookie代理；M2 | 21；T-X11-01/02 |
| C-X11-02 | 单/多窗口、显示号、剪贴板、多显示器/用户 | 缺设计 | 每信任域实例、窗口管理；M2—M3 | 21；T-X11-01及M3子用例 |
| C-X11-03 | XDMCP、发现、SecureXDMCP | 缺设计 | M2受控LAN；加密UDP/回连M3验证 | 21；T-X11-03 |
| C-X11-04 | Render/RandR/GLX、字体/视觉模式、键盘/XBell | 缺设计 | 目标应用能力报告；M3 | 21；M3图形兼容矩阵 |
| C-DESK-01 | RDP/VNC | 整体缺失 | 内嵌画面、输入桥和统一状态；M2 | 22；T-DESK-01/02 |
| C-PRINT-01 | LPD、队列/作业、本机打印 | 整体缺失 | receiver、spool、OS adapter；M2 | 23；T-PRINT-01/02/03 |
| C-PRINT-02 | 文本格式、预览、日志、失败/重打 | 缺设计 | M2文本/Raw；M3额外格式与预览 | 23；T-PRINT-01及M3格式用例 |
| C-DEPLOY-01 | 安装、静默部署、配置分发、维护 | 泛化跨平台 | 统一安装包与能力表；M2 | 13/14；T-OPS-01 |
| C-LEGACY-01 | SSH1、RSH、REXEC、RLOGIN及旧算法 | 未说明 | 默认不实现/不启用，明确记录差异 | 15；发布差异清单 |

C-LEGACY-01是本设计的安全取舍，不是用户已确认的“可忽略需求”。目标环境若必须使用，应单独确认兼容范围、隔离和测试；存在差异时不能宣称逐功能完全替代。

## 24.3 一体化的额外要求

这些是Hornet设计决策，不是对竞品内部实现的推断。

| 要求 | 验收判定 |
|---|---|
| 主机资料与多协议 | 同一资产统一关联；协议端点可不同 |
| 认证中心 | 不在各模块分别存明文密码；协议认证语义仍独立 |
| 混合工作区 | 终端/文件/桌面可分屏；X原生窗口统一定位与关闭 |
| 任务中心 | 传输、图形启动、打印均有状态、错误与取消语义 |
| 生命周期 | 关闭标签不误断共享资源，后台服务状态明确 |
| 安装维护 | 原生引擎版本受管理，离线核心可用，卸载无本产品监听残留 |

## 24.4 已知差异与发布声明

脚本API和专有会话/密码格式不承诺源码或加密数据直接兼容；提供字段迁移报告。X11多窗口允许原生窗口，内嵌单窗口须PoC；SecureXDMCP、历史X扩展和认证扩展尚待验证。Windows首先验证，其他OS/架构不能列为完整支持。

RDP高级重定向、FTPS、IDE、AI为独立扩展，不能掩盖对标缺项。每个C-*组发布时填写未实现、部分支持、已验证支持或明确差异，并附子用例/版本/证据。当前全部尚无实现验收证据。

## 24.5 官方来源与技术依据

| 来源 | 用途 |
|---|---|
| [Power Suite 官方产品页](https://sales.netsarang.com/e_sales/online_store.html?open=xfp) | 四产品组成与8系列名称 |
| [Xmanager 功能规格](https://www.xshell.com/en/xmanager-all-features/) | X Server与图形连接 |
| [Xshell 功能规格](https://www.xshell.com/en/xshell-all-features/) | 终端、认证、转发与自动化 |
| [Xftp 功能规格](https://www.xshell.com/en/xftp-all-features/) | 文件协议、队列与管理 |
| [Xlpd 功能规格](https://www.xshell.com/en/xlpd-all-features/) | 打印与队列 |
| [Electron 安全文档](https://www.electronjs.org/docs/latest/tutorial/security) | Renderer、Preload和IPC边界 |
| [ssh2 官方仓库](https://github.com/mscdex/ssh2) | SSH API候选 |
| [FreeRDP](https://www.freerdp.com/) / [noVNC](https://github.com/novnc/noVNC) | 桌面引擎候选 |
| [RFC 1179](https://www.rfc-editor.org/rfc/rfc1179) | LPD协议 |

资料用于核对公开能力，非复制专有实现。引擎选型、资源模型、阈值与分期是本项目设计决策。
