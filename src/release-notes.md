Hornet Remote Suite 0.0.2：修复 Windows 安装版启动时“后台服务退出”。

Windows 打包机的 CRLF 换行曾导致数据库结构校验值与已有 LF 数据库不一致，误判为版本不兼容。现已统一打包结构文件的换行，并兼容 0.0.1 的 LF / CRLF 历史校验值。安装升级后原有连接、分组及配置保留，无需删除数据库或重新配置。

启动失败现在会显示安全的具体原因；五个平台新增已有 LF/CRLF 数据库的升级验收。

统一会话管理、SSH/SFTP、FTP/FTPS、Telnet、终端分屏、文件传输、多语言和主题。

| 平台 | 安装包 |
| --- | --- |
| Windows x64 | `.exe`，支持选择安装目录 |
| macOS Intel / Apple Silicon | 对应 `x64` / `arm64` 的 `.dmg` |
| Linux x64 / ARM64 | 对应架构的 `.AppImage` / `.deb` |

当前 Windows 专用能力包括本地 PowerShell/CMD、串口、原生 RDP、VcXsrv 引擎管理与系统打印提交；其他平台的安装包不提供这些 Windows 适配器。VcXsrv 需自行安装，未随包分发。

安装包尚未配置商业代码签名及 Apple 公证。下载后请使用 `SHA256SUMS` 核对完整性。

此仓库仅公开安装包、校验文件与发布说明；项目源码保留在私有仓库。公开下载不代表源码开源或授予开源许可。安装包中第三方组件按各自随附许可分发。
