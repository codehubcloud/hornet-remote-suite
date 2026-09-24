# Hornet Remote Suite 软件详细设计说明书 V1.0
## 第4章 IPC 通信详细设计

修订日期：2026-09-24。所有模块使用本章契约，废止数字 code 与任意 channel 透传形式。

## 4.1 边界和传输

Renderer → Preload 白名单方法 → Main 校验/授权 → 服务进程。Preload 是渲染进程的隔离上下文，不是独立进程。控制请求使用异步 invoke，禁止 sendSync；终端字节与桌面帧走经授权的 MessagePort/专用桥，文件内容在后台流式传输，不经过 React 状态。

## 4.2 请求、响应和错误

```typescript
interface Request<T> {
  version: 1;
  requestId: string;
  deadlineMs: number; // UTC epoch ms，服务端截断到允许范围
  payload: T;
}
type Result<T> =
  | { ok: true; requestId: string; data: T }
  | { ok: false; requestId: string;
      error: { code: string; message: string; retryable: boolean } };
interface ResourceEvent<T> {
  version: 1;
  resourceId: string;
  generation: number;
  seq: number;
  type: string;
  payload: T;
}
```

错误注册：IPC001 未知方法、IPC002 参数非法、IPC003 超时、IPC004 服务故障、IPC005 无权访问、IPC006 已取消、IPC007 版本不兼容；SSH001—SSH006 保留第5章定义；FILE_CONFLICT、FILE_NO_SPACE、CAPABILITY_UNAVAILABLE、TASK_STATE_CONFLICT 为跨服务领域错误。message 不返回堆栈、秘密或本地敏感路径。

## 4.3 方法注册表

下表类型是接口设计约束；具体 Zod schema 位于 packages/contracts，与 TypeScript 类型共用。profileId 等 ID 不是授权凭证。

| 方法 | 请求 payload | 成功 data | 权限/约束 |
|---|---|---|---|
| profile.save | profile、expectedRevision | profileId、revision | 配置写；拒绝秘密字段 |
| profile.list | cursor、limit、filter | items、nextCursor | 分页，limit ≤200 |
| connection.open | profileId、purpose | connectionId、leaseId、generation | 校验配置所有权和策略 |
| connection.release | leaseId | released | 只能释放本调用方租约 |
| connection.close | connectionId、expectedGeneration | closed | 用户显式整体断开 |
| auth.respond | challengeId、response、remember | accepted | 一次性、绑定窗口与请求，不记录 response |
| trust.resolve | challengeId、decision | accepted | 展示指纹后由可信 UI 决策 |
| terminal.create | connectionId 或 localProfileId、cols、rows | terminalId、streamId | cols/rows 1—1000 |
| terminal.resize | terminalId、cols、rows、generation | applied | 归属校验 |
| terminal.close | terminalId | closed | 只关闭该终端 |
| file.list | connectionId、path、cursor、limit | entries、nextCursor | 后台虚拟分页，非协议分页承诺 |
| transfer.start | source、target、conflictPolicy、idempotencyKey | taskId | 本地路径必须有 pathGrantId |
| task.get | taskId | snapshot | 仅可见所属任务 |
| task.cancel | taskId、expectedRevision | snapshot | 异步取消，不代表已回滚 |
| task.resume | taskId、expectedRevision | snapshot | 先验证检查点和来源版本 |
| tunnel.open | connectionId、config | tunnelId | 绑定范围/目的地受策略限制 |
| tunnel.close | tunnelId | closed | 释放 listener 与租约 |
| x11.launch | profileId、launchProfileId | taskId | 不接收任意本地可执行路径 |
| desktop.open | profileId | viewId、streamId | 引擎能力与证书策略检查 |
| desktop.close | viewId | closed | 释放输入、帧通道和租约 |
| print.queueSave | queue、expectedRevision | queueId、revision | 管理权限与本地服务验证 |
| print.jobs | queueId、cursor | items、nextCursor | 不返回原始文档 |
| print.cancel | taskId | snapshot | 已提交系统打印时尽力取消 |
| print.reprint | taskId、idempotencyKey | newTaskId | 显式重打，保留来源关系 |
| layout.save | workspaceId、layout、expectedRevision | revision | 仅非敏感恢复数据 |
| resource.subscribe | resourceId、generation、afterSeq | subscriptionId、snapshot | 服务端验证所有权 |
| resource.unsubscribe | subscriptionId | removed | 窗口销毁自动清理 |
| request.cancel | requestId | accepted | 尽力取消控制请求 |

source/target 为带类型的 FileLocation：local(pathGrantId, relativePath) 或 remote(profileId, connectionId, path)。所有协议设置采用可辨识联合 schema；unknown 字段拒绝。不允许 Renderer 自行指定可执行二进制、凭据库索引或服务进程 PID。

终端输入通过授权streamId上的 `terminal.write` 桥发送：terminalId、generation、seq及UTF-8字节；后台校验归属与输入长度（单块≤32KiB），流断开即拒绝，不作为任意invoke方法开放。桌面输入与帧协议见第22章。

## 4.4 超时、幂等和取消

控制请求默认30秒；握手/MFA 最多120秒并展示取消入口。长任务在持久化后立即返回 taskId，由事件更新结果。超时只表示调用方未获结果，不能推断操作未发生。

requestId 用于关联，idempotencyKey 用于任务创建去重，二者不得混用。持久化唯一键为 owner + operation + idempotencyKey；同键不同参数拒绝，保留7天。写文件、执行命令、打印和脚本不能因 IPC 超时自动重试；先查询已有任务。只读查询可有限重试，连接重试交由5章。

取消进入 cancelling，服务关闭流/句柄后才确认 cancelled；已发生的写入或打印不会被取消自动撤销。服务端处理结束后若已超过请求期限，不再向销毁的窗口回传敏感数据。

## 4.5 事件与背压

事件包括 connection.state、terminal.closed、task.progress、task.state、x11.state、desktop.state、print.state、credential.locked。每资源的 seq 单调递增；重连 generation 变化时丢弃旧数据。订阅建立返回原子快照及其 seq，检测缺口后重新取快照，不盲目拼接。

终端数据为二进制分块（目标32KiB/块），按字节 credit 限流，每终端未消费队列最多1MiB。credit 耗尽暂停上游读，消费回调返还额度；不得丢弃任意转义序列。历史 scrollback 可按配置截断。任务进度每任务最高10Hz，终态立即送达；桌面只丢弃可独立替换的完整帧，不能任意丢弃增量帧。

## 4.6 安全检查顺序

1. 检查 senderFrame 为应用主 frame、origin 为固定 app scheme、窗口仍有效。
2. 方法白名单、schema、长度限制（普通控制消息最多256KiB）。
3. 从可信窗口上下文获取 owner；不能相信 payload 中的 userId/tenantId。
4. 检查资源归属、权限、generation、revision。
5. 执行并脱敏错误；订阅使用相同检查，不向所有窗口广播。

Preload 不暴露通用 invoke/send 或 Electron event 对象。文件对话框由 Main 产生短期 pathGrantId；本地校验 realpath、符号链接及 Windows reparse point，防止越过授权目录。远端路径由远端账号权限与应用范围控制，不能简单禁止所有含“..”字符串的合法远程浏览。

安全原则依据 [Electron 安全文档](https://www.electronjs.org/docs/latest/tutorial/security)。本章的阈值和 API 是 Hornet 设计决策。

## 4.7 验收

T-SEC-01 覆盖跨窗口冒用、子 frame、过期租约、未知 channel、大消息；T-REC-01 覆盖超时结果未知、重订阅缺口、取消竞争、幂等重启；T-PERF-02 覆盖背压和内存上限。
