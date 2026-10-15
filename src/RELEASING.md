# 二进制发布

完整操作流程、平台命令、版本准备、验收和故障排查见 [docs/Build_Package_Release_Guide.md](../docs/Build_Package_Release_Guide.md)。本文保留发布入口摘要；实际工作流以 `.github/workflows/release.yml` 为准。

私有源仓库：`codehubcloud/hornet-remote-suite`。
公开安装包仓库：`codehubcloud/hornet-remote-suite-release`。
首个版本：`0.0.1`，对应标签 `v0.0.1`。

## 自动发布

工作流位于私有源仓库 `.github/workflows/release.yml`，通过 `v*` 标签或手动运行触发。

1. 将 `src/package.json` 和 `src/package-lock.json` 的版本同步递增；UI 从 package.json 注入版本号。
2. 在私有源仓库 Actions secrets 配置 `RELEASE_TOKEN`。推荐只允许访问公开 release 仓库、具有 Contents write 权限的 fine-grained PAT；普通 `GITHUB_TOKEN` 无法发布到另一个仓库。不要将令牌写入仓库或日志。
3. 提交并推送私有源仓库，创建并推送相同版本标签，例如 `git tag v0.0.1`、`git push origin v0.0.1`。
4. 等待 Windows x64、macOS x64/arm64、Linux x64/arm64 五个构建任务完成。每个平台使用本机安装/生成的 Node-API 原生模块，在目标 Electron 运行时验证加载，并用实际打包程序验证沙箱 preload、后台服务、存储、SSH/SFTP。
5. 发布任务只接受七个精确命名的安装包，生成 SHA256SUMS；全部上传成功后才公开 draft release。任一平台失败则不发布。重新运行失败任务可恢复草稿上传；已公开的版本不能被该流程覆盖。

Windows 为 NSIS EXE，macOS 为 DMG，Linux 为 AppImage 和 DEB。公开仓库的自动源码归档只含该仓库自己的下载说明，不包含私有源码。构建日志和中间产物留在私有仓库，安装包中排除项目 TS/TSX、source map、设计文档和测试。Electron JavaScript 运行产物仍可被提取，ASAR 不是源码加密。

首版不自动捆绑 VcXsrv，也未配置 Windows 签名证书及 Apple Developer 签名/公证。Windows 专用功能不会因跨平台打包自动转换为 macOS/Linux 适配器；公开下载说明已注明支持范围。

## 本机构建

在 `src` 下使用 Node 24.x 和对应系统工具链：

```sh
npm ci
npm run check
npm run test:release
npm run package
npm run test:package
npm run test:clipboard:package
npm run test:titlebar:package
npm run test:terminal-tabs:package
```

输出在 `src/release/`。macOS 安装包在 macOS 构建，不通过 Windows 伪装跨编译。

发布依据 Electron Builder v26 配置与 GitHub 官方权限说明：
[Electron Builder](https://www.electron.build/v26/docs/configuration/)、
[GitHub token 权限](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions)、
[GitHub 托管构建机](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

## 0.0.2 升级验收

数据库结构文件必须按 LF 打包。Storage 只接受当前内容对应的 LF / CRLF 两种历史校验值，并将历史 CRLF 值规范为 LF；不接受其他校验值，不删除或重建已有配置。每个平台的打包程序验收分别注入已有 LF 和 CRLF 数据库，并检查已有连接保持不变。
