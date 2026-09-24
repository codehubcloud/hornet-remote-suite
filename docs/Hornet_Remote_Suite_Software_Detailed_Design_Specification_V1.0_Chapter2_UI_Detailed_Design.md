# Hornet Remote Suite 软件详细设计说明书 V1.0
## 第2章 统一工作台 UI 详细设计

修订日期：2026-09-24。目标：一个产品内完成四类套件任务；对象模型见第1章。

## 2.1 主窗口与信息结构

默认1440×900，最小1024×720；支持高 DPI、键盘导航、深色/浅色/高对比主题。颜色不能作为唯一状态提示。

```text
标题栏 / 菜单 / 快速连接 / 命令面板
侧栏：主机、收藏、工作区、隧道、打印、设置
工作区：混合标签组 [终端] [文件] [X11] [RDP/VNC] [编辑器]
底部：任务 / 传输 / 日志 / 可选构建与问题
状态栏：当前主机、协议、连接状态、凭据锁定、后台任务数
```

视图共用 TabManager 与分屏树，不分别建立 TerminalTabs、EditorTabs、DesktopTabs 三套生命周期。协议特有工具栏由视图贡献，关闭操作交由 ViewCoordinator。

## 2.2 新建连接

先选择协议，再显示对应字段。SSH/SFTP 要求主机、端口、用户和认证配置；RDP/VNC 展示桌面参数；串口选择设备/波特率；本地终端选择 shell；X11 选择 SSH 启动配置或 XDMCP；打印在打印中心建队列。

提供“保存”和“保存并连接”，保存配置不能隐式连接。端口为1—65535，主机禁止控制字符；IPv6 地址独立解析。秘密不进入 Zustand、localStorage 或 URL。表单输入秘密时仅短暂驻留内存，提交/关闭即释放引用，不宣称 JavaScript 可以保证物理擦除。

## 2.3 主机树与认证中心

主机树支持文件夹、标签、搜索、收藏、最近连接、批量编辑与导入预览。节点展开显示多个协议配置及运行中的视图。在线状态来自连接事件，不能通过一个 SSH 状态推断整个主机所有协议可用。

认证中心支持密码、加密私钥引用、Agent、交互认证配置，展示引用该凭据的连接列表。修改凭据只影响下一次认证；不自动断开现有任务。无法解锁时允许只保存主机配置。

## 2.4 混合标签与恢复模型

```typescript
type ViewKind = "terminal" | "files" | "x11" | "desktop" | "editor" | "print";
interface ViewDescriptor {
  viewId: string;
  kind: ViewKind;
  profileId?: string;
  title: string;
  dirty: boolean;
  restoreState: Record<string, unknown>;
}
type LayoutNode =
  | { kind: "tabs"; viewIds: string[]; activeViewId?: string }
  | { kind: "split"; direction: "horizontal" | "vertical";
      ratio: number; children: [LayoutNode, LayoutNode] };
```

持久化只保存 profileId、视图参数、布局、路径等非敏感数据，不保存 connectionId、cookie、认证响应或桌面图像。布局恢复先展示“已断开”，仅用户启用自动连接时重新建立会话。编辑器未保存缓冲单独保护，不能被恢复布局覆盖。

## 2.5 跨功能动作

| 起点 | 动作 | 结果 |
|---|---|---|
| 主机/终端 | 打开文件 | 使用同安全上下文连接，文件面板定位已知目录 |
| 文件目录 | 在此打开终端 | 新 shell；目录参数按目标 shell 转义，禁止拼接未转义路径 |
| 文件 | 编辑 | 打开缓存并记录远端版本；保存时检查冲突 |
| 主机 | 启动 X 应用 | 按21章建立图形会话并显示所属窗口 |
| 主机 | 打开远程桌面 | 内嵌桌面视图，清晰显示协议和剪贴板开关 |
| 任务中心 | 定位来源 | 聚焦关联视图；源视图已关闭时展示任务详情 |
| 打印队列 | 作业详情/取消/重打 | 展示接收状态与系统打印状态，重打创建新作业 |

目录联动采用用户动作或明确启用的 shell integration；不从任意终端输出猜测 cwd，不向终端偷偷发送 pwd。

## 2.6 关闭与后台任务

关闭终端只关闭对应 shell；关闭文件标签不取消传输；关闭桌面释放输入焦点、剪贴板与桌面连接租约；关闭 X11 视图前展示受影响的 X 客户端；未保存编辑器须处理保存/丢弃。

关闭主窗口时汇总传输、打印和图形会话。默认退出应用前处理任务；“后台继续”仅在托盘/打印服务实际可用时提供。UI 退出与 Windows 打印服务停止是独立操作。

## 2.7 终端交互

默认 Ctrl+Shift+C/V 复制粘贴，Ctrl+C 保持中断语义；允许按平台映射。多行粘贴先预览，保留 bracketed paste；广播必须显示目标列表与醒目状态，断线后不向新连接补发。快捷命令、脚本、触发器各有管理界面和执行记录。

## 2.8 错误与能力显示

能力状态统一为 available、unavailable、needsSetup、disabledByPolicy，附原因与修复入口。缺少 X Server、RDP 引擎或打印服务时不得显示连接成功。认证取消、网络错误、主机密钥变化、文件冲突使用不同提示；信任决策不能用一闪而过的 Toast。

## 2.9 组件与验收

核心组件：HostExplorer、CredentialCenter、WorkspaceLayout、ViewHost、TaskCenter、TunnelPanel、PrintCenter、CapabilityBanner。UI 仅订阅第4章事件和调用受限 API；运行时服务状态由后台管理。

验收：HRS-UNI 对应 T-UNI-01/02/03；混合标签焦点、200% DPI、键盘可达、断线标识、后台任务不丢失见第12章。
