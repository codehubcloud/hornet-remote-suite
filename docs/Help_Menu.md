# 帮助菜单

帮助菜单提供与终端、文件、图形和打印工作区共用的入口：

| 项目 | 行为 |
| --- | --- |
| Hornet 帮助 / F1 | 应用内离线使用指南，涵盖会话、认证、终端、快速命令、文件、界面、快捷键及支持范围 |
| 打开帮助PDF | 本地生成 A4 PDF，交由系统查看器打开；无需网络；文件位于用户数据目录的 help 子目录 |
| 访问网站 | 打开公开安装包仓库 README |
| 访问技术支持 | 打开公开仓库 Issues |
| 发送反馈意见 | 打开新 Issue 页面，用户自行填写并提交 |
| 检查更新 | 查询公开发布仓库 latest；显示版本比较、发布说明，提供下载页面与失败重试 |
| 关于 Hornet | 显示实际版本、平台、架构、Electron、Chromium、Node.js 版本 |

帮助正文和 PDF 提供中文/英文；其他语言使用英文正文。界面跟随当前主题与语言。更新检查最长等待 10 秒，不依赖 SSH 后台服务，不下载或安装程序；每次仅由用户点击触发，不上传连接、密码或日志。PDF 生成最多等待 20 秒，系统查看器未配置时可重试。

对外链接固定到公开发布仓库，renderer 不能请求打开任意 URL 或本地路径。反馈不会自动发送。更新结果拒绝草稿、预发布版本及无效版本，限制响应大小；服务器提供的外部链接不作为打开目标。

验证命令：在 src 中运行 npm run check、npm run test:help；实际打包后运行 npm run test:help:package。测试使用独立用户目录，替换浏览器/PDF 查看器打开动作及更新服务器响应；PDF 文件由真实 Chromium 打印引擎生成。五个平台的发布工作流均执行实际包验收。

实现依据：[Electron PDF 文档](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions)、[Electron shell 文档](https://www.electronjs.org/docs/latest/api/shell)。
