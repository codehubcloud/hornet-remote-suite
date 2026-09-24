# Hornet Remote Suite 软件详细设计说明书 V1.0
## 第20章 工程目录与代码规范

修订日期：2026-09-24。以下是拟建工程规范，当前src尚无可验收实现；不代表目录已落地。

## 20.1 唯一工程布局

```text
apps/
  desktop/
    main/           # 窗口、授权、服务监督、IPC路由
    preload/        # 最小白名单桥
    renderer/       # React UI、ViewHost、Zustand视图状态
  cli/              # 复用任务API的命令行入口
packages/
  contracts/        # DTO、Zod schema、错误码、IPC registry
  core/             # Profile、ConnectionCoordinator、租约、任务
  storage/          # Repository、SQLite迁移、一致性备份
  security/         # 凭据适配、信任、策略、脱敏
  ui/               # 共享组件
  plugin-sdk/       # M4受限API
services/           # 本地后台服务源码，不代表云服务
  protocol-host/
  ssh/
  terminal/
  file/             # SFTP/FTP provider、传输与同步
  tunnel/
  x11/
  desktop/
  print/
  ide/              # M4
  ai/               # M4
native/
  xserver-adapter/
  rdp-helper/
  print-helper/
  platform/
server/             # M4可选企业服务，与本地services区分
tests/
  unit/
  integration/
  e2e/
  performance/
  fixtures/
ci/
  scripts/
  manifests/
docs/
```

所有旧章节中的electron/main、renderer/src或database等目录均为模块内示意，以此布局归一化；不同时建立apps/desktop/main和apps/desktop/electron/main。实施迁移时再处置现有src，不在文档任务中移动源码。

## 20.2 依赖规则

renderer只能依赖contracts、ui和受限preload类型；禁止导入ssh2、fs、net、storage、native。preload只依赖contracts和Electron桥API。服务依赖core/contracts/security及自己的adapter，不能反向依赖UI。企业server不作为desktop编译/启动必需项。

contracts不依赖Electron/Node运行时；数据类型、schema与IPC注册表只维护一份。UI state不是连接/任务的权威存储。每个辅助进程有协议版本握手与健康状态。

## 20.3 编码规范

TypeScript strict模式；边界用unknown和schema收窄，禁止以any绕过IPC/插件校验。类/组件PascalCase，函数camelCase，常量UPPER_SNAKE_CASE；名称表达profile、connection、channel、lease、view与task语义，避免含糊sessionId。

异步接口Promise，内部异常映射到第4章Result；副作用以taskId跟踪。资源实现dispose/close并绑定所有者，订阅返回unsubscribe；取消使用AbortSignal/服务任务协议，不把Promise.race超时当成操作已停止。

禁止拼接不可信shell命令、把密码放命令行、从Renderer指定可执行路径、日志输出秘密。主机、URI和文件路径通过对应平台/协议解析器处理。

## 20.4 原生与工具链

Native限定操作系统/协议桥接职责，使用CMake与固定编译工具链；优先进程隔离，N-API仅在必要处使用并做ABI测试。自研crypto不是默认工作项。

Node/pnpm/Electron/引擎精确版本及摘要在ci/manifests登记；按13章维护受支持LTS。开发容器可运行Linux工具和服务夹具，不能替代Windows/macOS原生GUI及打印验证。

## 20.5 测试与评审

Vitest、GoogleTest、Playwright分层使用，验收归第12章。新增协议provider必须提供能力探测、正常路径、取消、异常清理与断线场景；不能只有接口mock测试。

Review检查跨主机身份、租约释放、幂等/结果未知、背压、秘密生命周期、迁移兼容和平台限制。提交采用Conventional Commits；发布分支策略由团队确定，避免未经团队规模验证强制复杂Git Flow。

## 20.6 后续章节

第21章X11、第22章RDP/VNC、第23章LPD打印、第24章对标矩阵。源码实现应与这些设计同目录版本化维护，不再预告不存在的“第21章核心源码实现设计”。
