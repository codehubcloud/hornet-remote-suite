# 应用 Logo

`source.png` 是用户提供的原始透明 Logo，保持原文件内容不变。`build/icons` 内是用于发行的 ICO、ICNS 与各尺寸 PNG；`apps/desktop/renderer/public/logo.png` 用于合并标题栏、关于窗口和 favicon。构建时复制图标到 dist，安装包只包含需要的运行资源。

在 `src` 下使用锁定依赖生成图标：

```sh
npm run prepare:icons
```

也可以导入替换用的 PNG：

```sh
npm run prepare:icons -- /absolute/path/Logo.png
```

脚本保留原始 PNG 及透明通道，将完整图片等比居中放入正方形，并使用透明留白补齐，不裁剪或填充背景。使用 electron-builder 配套且校验下载摘要的图标工具生成平台格式，不依赖本机图片编辑器。首次执行可能下载工具。生成结果已提交，普通构建与 Actions 不需要重复生成或访问用户下载目录。

更换 Logo 后应检查较小尺寸和关于窗口，在 Windows 打包后检查主程序及 NativeHost.exe 的实际图标，并通过各平台打包与启动验收。
