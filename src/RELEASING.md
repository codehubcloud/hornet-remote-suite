# 二进制构建与发布入口

更新日期：2026-10-25。完整命令、平台依赖、全部验收、公开源码授权、发布后检查和故障恢复，统一维护在 [编译、打包与发布操作指南](../docs/Build_Package_Release_Guide.md)。本页为摘要，实际执行以该指南及 [release.yml](../.github/workflows/release.yml) 为准。

| 用途 | 位置 |
| --- | --- |
| 源码与构建 | `codehubcloud/hornet-remote-suite`，分支 `master` |
| 公开安装包 | [codehubcloud/hornet-remote-suite-release](https://github.com/codehubcloud/hornet-remote-suite-release/releases) |
| 版本来源 | package.json、package-lock.json 与 release-notes.json，三者保持一致 |
| 核对基线 | 0.0.35；后续版本以实际源码为准 |

## 本地安装包

使用 Node 24.x（工作流固定 24.21.0），在与目标相同的系统和 CPU 架构下打包。Windows PowerShell 进入 `src`，在关闭本仓库开发/测试应用后执行：

```powershell
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。' }
npm.cmd run check
if ($LASTEXITCODE -ne 0) { throw '源码检查失败。' }
npm.cmd run test:release
if ($LASTEXITCODE -ne 0) { throw '发布配置检查失败。' }
npm.cmd run package
if ($LASTEXITCODE -ne 0) { throw '打包失败。' }
npm.cmd run test:package
if ($LASTEXITCODE -ne 0) { throw '打包应用验收失败。' }
```

Windows 安装程序在 `src/release/Hornet-Remote-Suite-<版本>-windows-x64.exe`。上述为基础本机检查；正式发布须完成详细指南中的全部验收。`package` 不上传文件；`package:dir` 只生成解包程序，`test:package` 不会重新构建。独立输出目录、EBUSY 和 Electron 下载故障见详细指南第 3、5、9 章。

## 全平台发布

1. 准备尚未公开的新版本，更新 package.json、lockfile、八语 release-notes.json 与中文概要；完成本地检查，提交并推送完整源码，记录 SHA。
2. 在源码仓库 Actions secrets 中配置 `RELEASE_TOKEN`，授权其对公开下载仓库写入 Release 和附件。不要写入源码或日志。
3. 选择一种触发方式：私有源码仓库可推送 `v<版本>` 标签；公开源码仓库优先使用 workflow_dispatch，填写匹配版本并将 `allow_public_source_release` 设为 true。当前仅 v0.0.35 有精确的公开标签授权例外；未来版本不会自动继承。详见指南 6.3 节。
4. 等待 verify、Windows x64、macOS x64/ARM64、Linux x64/ARM64 五个 build 及 publish 全部成功。任一失败都会阻止发布；同一版本不要重复触发。
5. 发布脚本只接受完整七个安装包，生成 SHA256SUMS，并另行上传当前源码中的 release-notes.json。九个附件上传并核对完成后才公开草稿、设为 latest。公开正文仅使用英文，八语通过 JSON 附件提供。
6. 核对公开版本、附件、哈希、语言与旧客户端更新流程；在 VALIDATION.md 记录提交和 run 链接，在下载仓库独立更新 README。已公开版本不能覆盖，应修复后发布新版本。

下载仓库的源码归档来自下载仓库自身；源码仓库是否公开是独立设置。不要假定发布到另一个仓库就隐藏了公开源码，也不要将可见性切换写成自动发布步骤。

## 验收与限制

所有平台在真实打包程序中检查 LF/CRLF 历史数据库升级、SSH/SFTP、剪贴板、分屏标签、断线恢复、凭据、帮助更新、传输校验、退出和高级菜单。Windows 另有安装器运行占用提示及延后安装验证。完整命令和测试边界见详细指南第 5 章。

当前提供 EXE、DMG、AppImage、DEB，不捆绑 VcXsrv；未配置 Windows 商业签名及 Apple 签名/公证。Windows 专用功能不会因跨平台打包自动转换。ASAR 是打包格式，编译后 JavaScript 仍可提取。安装器的暂缓安装不要求重启电脑，已校验下载可在下次软件启动或检查更新时复用。
