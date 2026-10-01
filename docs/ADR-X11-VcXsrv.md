# X Server 适配决策（2026-10-01）

选择 VcXsrv 21.1.16.1 作为 Windows 首个实验适配；以受管理独立原生窗口呈现，未实现 Electron 窗口嵌入。用户通过原生文件选择器指定引擎，程序保存路径、文件版本与 SHA-256，每次启动检查可执行文件是否改变。应用不自动下载或重新分发引擎；测试准备脚本只解压至项目缓存。

- 官方发布及源码：[VcXsrv 21.1.16.1](https://github.com/marchaesen/vcxsrv/releases/tag/21.1.16.1)、[固定版本源码](https://github.com/marchaesen/vcxsrv/tree/21.1.16.1)。
- 本次官方安装包 `vcxsrv-64.21.1.16.1.installer.exe` SHA-256：`df7fed8f49665d0592528ab6be9d07111ea73c6848283d128b77690e05b8f90b`。
- 本次 `vcxsrv.exe` SHA-256：`c7c54444eeacf1820d3f1ee2781209d011bad4373aa7893aef24b54a14cfc961`。指纹记录用于复现，不能替代发布者签名。
- 当前使用上游预编译包，未自行编译引擎。项目只编译自己的 .NET Framework 原生监督程序。若未来打包分发，必须另行完成上游及各组件许可证、源码提供义务和签名审查；本决策不是再分发许可结论。

每个受管理 SSH 会话独占 X Server 进程、显示号、随机 authority cookie 和 SSH 连接，不共享显示。原生辅助进程将引擎放入启用 KILL_ON_JOB_CLOSE 的 Windows Job Object；stdin 断开会停止引擎。认证文件所在目录关闭继承，仅允许当前 Windows 用户访问；正常关闭、失败及辅助进程退出时清理。与操作系统账户相同的恶意进程不在该隔离边界内。

启动参数保持访问控制、禁用剪贴板和原生 WGL，并验证正确 cookie 能握手、随机错误 cookie 被拒绝。VcXsrv 上游 TCP 监听使用通配接口，`-from` 只选择 XDMCP 源地址，不能作为 TCP 接口隔离。界面要求明确启用 IPv4 网络监听；不修改防火墙、不提供 `-ac`。**本实现未满足设计 21.3 的“仅本地转发入口可达”门槛**；目前隔离边界是独立显示与 cookie 认证。公开网络部署仍不属于已验证范围。

XDMCP 使用定向 UDP Query 验证目标响应，解析严格长度、来源地址/端口及 Willing/Unwilling；后续 Request/Accept/Manage、桌面登录和保活由 VcXsrv 实现。原生参数中 `-port` 必须在 `-query` 之前。本轮仅开放明确私网/VPN IPv4 地址和本机接口，显式确认未加密直连；不做自动广播或扫描，不实现 SecureXDMCP。协议依据 [X.Org XDMCP](https://xorg.freedesktop.org/releases/X11R7.6/doc/libXdmcp/xdmcp.html)。

证据：真实 VcXsrv/xclock 的两显示、交叉 cookie 拒绝和关闭隔离；真实 VcXsrv 与本机协议夹具完成 XDMCP 协商并显示图形应用。Linux/OpenSSH、真实 Linux 显示管理器登录、跨机器防火墙、GLX/字体/IME/剪贴板和长时性能仍需目标环境验证。不能据此宣称 Xmanager 全功能替代或完整 M2 验收。
