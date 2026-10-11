# Hornet Remote Suite 软件详细设计说明书 V1.0
## 第21章 X11 图形应用与 XDMCP 详细设计

修订日期：2026-09-24。需求 HRS-X11；本章为目标设计，当前实现差异见21.8。官方能力基线见 [Xmanager 功能表](https://www.xshell.com/en/xmanager-all-features/)。

## 21.1 能力与实现边界

交付本地 X Server 管理、SSH X11 转发、远程应用启动配置、单窗口/多窗口、显示号管理、剪贴板与字体配置。XDMCP 为独立会话类型。Render、RandR、GLX、字体和旧应用视觉模式逐项实测，不由“可启动 xclock”推导为完整兼容。

Electron 不是 X Server，xterm.js 也不提供 X11。采用可维护的原生 X Server 作为受控辅助进程，通过 XServerAdapter 管理，不从零编写 X 协议。Windows 的 X.Org 派生实现为候选；锁定具体引擎之前必须记录版本、源码、构建方法、分发材料和兼容结果。Linux/macOS 本地显示服务器适配单独验证。

## 21.2 服务及接口

```typescript
interface XServerAdapter {
  probe(): Promise<{ available: boolean; capabilities: string[]; version: string }>;
  start(profile: XServerProfile): Promise<{ xServerId: string; display: string }>;
  stop(xServerId: string): Promise<void>;
}
interface XServerProfile {
  mode: "singleWindow" | "multiWindow";
  clipboard: "disabled" | "toRemote" | "fromRemote" | "bidirectional";
  dpi: number;
  fontProfileId?: string;
}
interface XLaunchProfile {
  id: string;
  sshProfileId: string;
  command: string; // 用户保存的远端命令，执行前展示；不是本地 shell 参数
  serverProfileId: string;
}
```

XSession 持有 xServerId、connectionId、leaseId、launchProfileId、状态、窗口列表。Cookie 只在受控服务内存/受限权限的临时 authority 文件中存在，不进入 IPC 响应、数据库和日志。

## 21.3 SSH X11 启动时序

1. 校验 SSH 配置和图形引擎能力；分配独占显示实例/信任域，检查端口冲突。
2. 启动 X Server，等待 readiness；为该实例配置随机 authority cookie，只开放当前用户及本地转发入口，禁止使用 -ac 或 xhost +。
3. 获取 SSH 租约，验证主机密钥并认证。请求 X11 forwarding，使用会话随机伪 cookie。
4. 服务端通常负责远端 DISPLAY 与 xauth；检测远端 xauth/sshd X11 支持，失败返回 X11_FORWARD_DENIED 或 X11_XAUTH_MISSING，不强行改服务器配置。
5. 转发代理验证远端 X 客户端握手中的伪 cookie，仅在本地代理替换为真实 cookie，再连接所属 X Server；处理字节序、分片和长度上限。
6. 启动保存的远端命令，记录 stdout/stderr 和启动超时。远端命令退出不一定代表所有 X 窗口退出。
7. 关闭时停止接受新 X 通道，关闭会话窗口与通道，释放 SSH 租约、authority 文件和 X Server。

ssh2 提供 X11 请求/通道基础，完整 cookie 代理和进程管理由 Hornet 实现；需按锁定版本验证，见 [ssh2 官方仓库](https://github.com/mscdex/ssh2)。

## 21.4 窗口与工作台集成

多窗口模式保留原生 X 顶层窗口，工作台标签列出窗口、激活/最小化/关闭动作与连接状态。默认不同不可信主机使用独立 X Server 实例，避免共享显示导致跨应用读取输入。

单窗口模式先验证原生窗口承载：DPI、IME、焦点、Alt-Tab、缩放、剪贴板、最小化恢复、退出清理。不能假设任意 HWND 重设父窗口即可稳定嵌入 Electron。若 M0 未通过，版本明确使用“受管理的原生窗口”，记录差异，不把外部窗口宣传为内嵌标签。

剪贴板默认关闭，启用后按方向授权、大小上限1MiB、仅文本；不自动共享文件和敏感剪贴板格式。

## 21.5 XDMCP 与网络模式

XDMCP 通常使用 UDP 177 发现/协商，随后 X 客户端连接本地 X Server；默认 TCP 显示端口为6000 + display number，具体由引擎配置验证。局域网直连须选择网卡、服务器地址、允许来源及显示端口范围，不自动向公网开放。发现仅在用户指定子网运行，限速且可停止。

普通 SSH TCP 转发不能直接承载 XDMCP 的 UDP 协商，也不能自动解决显示回连。SecureXDMCP 等价能力列为 M3 验证项：先验证显式 UDP relay/VPN 路由及 X 回连，再交付；M2 优先提供 SSH X11 应用与普通受控局域网 XDMCP。禁止将设置 DISPLAY 等同于加密。

## 21.6 状态和异常

状态：preparing → startingServer → connecting → launching → running → closing → closed；任一步可失败并逆序回收已分配资源。错误包括 X11_ENGINE_MISSING、X11_DISPLAY_BUSY、X11_COOKIE_REJECTED、X11_FORWARD_DENIED、X11_LAUNCH_FAILED。

X Server 崩溃使所属全部 X 客户端失效，标记 failed 并清理 SSH X11 channel；不自动重复启动远端命令。网络重连不保证原图形进程可恢复，由用户重新启动，必要时检查远端残留进程。

## 21.7 验收与工作项

T-X11-01：两台主机分别启动简单 X 应用与实际目标 GUI，独立输入/剪贴板、窗口定位、退出无残留。
T-X11-02：错误 cookie、分片握手、显示端口冲突、缺少 xauth、X Server 崩溃、跨主机隔离。
T-X11-03：受控 LAN XDMCP 登录与取消；防火墙阻断时有可诊断错误。

工程任务：HORNET-X11-001 引擎 PoC；002 cookie 代理；003 生命周期与窗口管理；004 XDMCP；005 扩展/字体兼容清单。M0 未完成001不得承诺 M2 工期。

## 21.8 当前源码实现及明确差异

`src/services/x11` 已实现 SSH X11 exec 请求、随机伪 cookie、MIT-MAGIC-COOKIE-1 握手验证/替换、大小端与分片处理、10秒握手超时、32通道限制、SSH租约及停止清理。外部显示模式通过 Main 原生文件选择器读取Xauthority；受管理模式由服务生成独立cookie并写入当前Windows用户专用ACL目录，不返回Renderer。

受管理模式适配VcXsrv 21.1.16.1。用户选择本机引擎后保存文件版本/摘要，启动前检查文件未改变；每个SSH会话独占X Server进程、显示号、cookie和SSH连接。启动验证正确cookie成功、随机错误cookie失败，支持单窗口/多窗口、72–240 DPI，禁用剪贴板和原生WGL；最多8个显示，自动分配:10–:99。NativeHost以Windows Job Object及stdin父进程监测管理生命周期，停止/崩溃回收引擎及认证目录。外部模式仍限一个会话；远端命令不自动重跑，stdout/stderr只排空。关闭转发不承诺后台化的远端程序必然退出。

XDMCP提供明确私网/VPN IPv4服务器、本机接口、UDP端口和显示号表单。先发送定向Query并严格验证Willing/Unwilling及来源，再由VcXsrv执行Request/Accept/Manage和原生桌面登录。状态只区分查询、启动、等待原生窗口登录和失败，不将引擎启动当作登录成功。未实现子网扫描、广播发现、SecureXDMCP或登录状态集成。

已验证真实VcXsrv/xclock两显示、交叉cookie拒绝、独立停止及本机XDMCP协议夹具协商后的真实图形窗口。实际Linux/OpenSSH、真实Linux显示管理器登录、字体/GLX/IME/DPI矩阵和跨机器网络策略仍待目标环境。**VcXsrv TCP监听通配IPv4接口；当前不能满足21.3“只开放本地转发入口”的门槛。** 界面要求显式允许网络监听及XDMCP未加密直连，不修改系统防火墙。显示隔离通过独立进程/cookie实现，不等于仅回环网络隔离。当前仍是实验适配，详见[引擎决策与证据](ADR-X11-VcXsrv.md)。

会话管理增量：列表提供准备、SSH连接、命令启动、运行、命令退出及失败状态，展示活动通道数、退出码/信号和错误原因。准备/启动阶段可停止；迟到的SSH租约会释放，迟到的命令通道会销毁，不影响其他共享连接使用者。正常退出保留已有图形通道，显式停止回收；非零退出、信号终止及SSH断线回收并保留最多20条内存失败记录。ssh2在命令通道关闭后不再接受该会话的新X11通道。更新Xauthority失败不会破坏上一次有效认证；非法cookie、非ASCII认证名和未完成握手EOF会被拒绝。

### 启动预设实现（2026-10-10）

X11Panel 增加通过 schema 验证的本机启动预设（最多100条）。记录名称、SSH profileId、命令、managed/external 模式、窗口模式、DPI 和外部显示号；支持保存、另存、切换和删除。选择预设不执行远端命令，网络监听许可重置且不持久化；认证数据仍由既有凭据服务处理。预设引用的主机被删除时禁止启动，外部显示号与已配置认证不一致时必须重新选择 Xauthority。
