# Hornet Remote Suite 软件详细设计说明书 V1.0
## 第22章 RDP / VNC 远程桌面详细设计

修订日期：2026-09-24。需求 HRS-DESK。完整集成目标为工作台内画面、统一配置与生命周期。

## 22.1 引擎决策与验证

RDP 候选为 [FreeRDP](https://www.freerdp.com/) 原生辅助进程；VNC 候选为 [noVNC](https://github.com/novnc/noVNC) 加本地受控 WebSocket-to-TCP bridge。候选不代表已经完成集成或兼容所有扩展。

RDP M0 对比原生窗口承载与帧输出到 Canvas 的方案；默认设计选择辅助进程输出有界 BGRA 完整帧，输入经独立控制通道回传。先支持单显示器，性能验证后扩展共享内存/纹理及多显示器。不得用 mstsc 外部启动冒充完成嵌入。

## 22.2 配置与接口

```typescript
interface DesktopOptions {
  protocol: "rdp" | "vnc";
  width: number;
  height: number;
  scaling: "fit" | "actual";
  clipboard: "disabled" | "text";
  readOnly: boolean;
  securityMode: "tls" | "sshTunnel" | "trustedLan";
}
interface DesktopAdapter {
  probe(): Promise<{ version: string; capabilities: string[] }>;
  open(profileId: string, options: DesktopOptions): Promise<{ desktopId: string }>;
  resize(desktopId: string, width: number, height: number): Promise<void>;
  close(desktopId: string): Promise<void>;
}
```

RDP 特有配置包含 domain、NLA、证书策略；VNC 包含协商的安全类型、显示端口、共享/独占。密码只通过私有控制通道传给引擎，不写命令行。远端截图与帧默认不持久化。

## 22.3 连接流程

读取 profile → 能力探测 → 获取凭据/可选 SSH 隧道租约 → 启动辅助进程/bridge → 证书/协议安全协商 → 创建渲染流 → 显示首帧 → 接受输入。

RDP/VNC 连接不复用 SSH shell；只有传输路径为 sshTunnel 时依赖 SSH 转发。证书变化默认拒绝，可信 UI 显示指纹再作决策。VNC 禁用未经策略许可的无认证/无加密远程连接；可使用 SSH 隧道保护已有 VNC 服务。

## 22.4 帧与输入通道

Frame 包含 desktopId、generation、seq、width、height、stride、pixelFormat 和数据长度。后台验证尺寸、整数溢出和长度，单显示器上限3840×2160，目标最高30fps；最多保留2个完整帧，旧完整帧可被新帧替代。后续引入增量帧必须维护重建状态，不能套用随意丢帧策略。

Pointer 坐标由 CSS 尺寸映射到远端像素，包含按键掩码；键盘处理扫描码/Unicode、组合键与焦点。失焦/断线发送全部按键释放，避免 Ctrl/Alt 卡住；Ctrl+Alt+Del 使用协议专用动作。只读模式必须在后台拒绝输入，不能仅禁用按钮。

VNC bridge 绑定 loopback 随机端口，验证 Origin 与一次性短期 token，仅连接绑定的远端 endpoint，不开放任意 TCP 代理。Token 不放日志/持久化 URL。视图关闭立刻注销；仅绑定127.0.0.1仍需鉴权。

## 22.5 生命周期与重连

状态：connecting、verifying、authenticating、active、disconnected、reconnecting、closing、closed、failed。重连重置帧缓存、generation、按键和剪贴板订阅，不重放鼠标键盘事件。最多5次指数退避，认证失败/证书变化停止自动重试。

关闭视图后终止该辅助进程/bridge，释放关联隧道。一个引擎崩溃不能带走终端和传输；Main 维护心跳与进程退出事件，超时回收资源。

## 22.6 重定向范围

M2 提供文本剪贴板（用户按会话开启）、缩放、全屏、只读、分辨率调整。音频、磁盘/USB/智能卡/打印机重定向、多显示器列入 M3 兼容清单，逐项按引擎能力验收。RDP 打印重定向与第23章 LPD 服务是不同功能。

## 22.7 验收与工作项

T-DESK-01：RDP/VNC 混合标签，中文输入、200% DPI、焦点切换、只读和剪贴板策略。
T-DESK-02：证书变化、无效 VNC token、Origin 伪造、协议畸形帧、断网、引擎崩溃、关闭无残留。
T-PERF-04：第12章桌面帧率和延迟条件。

HORNET-DESK-001 原生帧桥 PoC；002 VNC bridge；003 输入与剪贴板；004 恢复与资源回收；005 扩展兼容验证。
