# Hornet Remote Suite 软件详细设计说明书 V1.0
## 第21章 X11 图形应用与 XDMCP 详细设计

修订日期：2026-09-24。需求 HRS-X11；本章为待实现设计。官方能力基线见 [Xmanager 功能表](https://www.xshell.com/en/xmanager-all-features/)。

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
