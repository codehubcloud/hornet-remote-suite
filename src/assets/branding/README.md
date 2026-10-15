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

脚本保留原始 PNG 文件及透明通道不变，通过构建期依赖 pngjs 读取像素。以 alpha ≥ 16 的可见主体范围计算正方形视口，每边保留主体最长边 2% 的透明余量；忽略极淡的外围噪点，避免原始留白把任务栏图标缩小。仅调整包含原图的 SVG 视口，主体保持原比例、颜色和透明度，不重绘、不拉伸、不填充背景。全透明或任一边超过 8192 像素的输入会被拒绝。

使用 electron-builder 配套且校验下载摘要的图标工具生成平台格式，不依赖本机图片编辑器。首次执行可能下载工具。生成结果已提交，普通构建与 Actions 不需要重复生成或访问用户下载目录。pngjs 为仅构建期依赖，不随安装包分发；解析 API 见 [pngjs 官方说明](https://github.com/pngjs/pngjs#sync-api)。

更换 Logo 后应检查较小尺寸和关于窗口，在 Windows 打包后检查主程序及 NativeHost.exe 的实际图标，并通过各平台打包与启动验收。
