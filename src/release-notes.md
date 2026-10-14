Hornet Remote Suite 首个二进制发行版。

统一会话管理、SSH/SFTP、FTP/FTPS、Telnet、终端分屏、文件传输、多语言和主题。

| 平台 | 安装包 |
| --- | --- |
| Windows x64 | `.exe`，支持选择安装目录 |
| macOS Intel / Apple Silicon | 对应 `x64` / `arm64` 的 `.dmg` |
| Linux x64 / ARM64 | 对应架构的 `.AppImage` / `.deb` |

当前 Windows 专用能力包括本地 PowerShell/CMD、串口、原生 RDP、VcXsrv 引擎管理与系统打印提交；其他平台的安装包不提供这些 Windows 适配器。VcXsrv 需自行安装，未随包分发。

安装包尚未配置商业代码签名及 Apple 公证。下载后请使用 `SHA256SUMS` 核对完整性。

此仓库仅公开安装包、校验文件与发布说明；项目源码保留在私有仓库。公开下载不代表源码开源或授予开源许可。安装包中第三方组件按各自随附许可分发。
