# Hornet Remote Suite 软件详细设计说明书 V1.0
## 第23章 LPD 远程打印详细设计

修订日期：2026-09-24。需求 HRS-PRINT。用途：远端 lpr 客户端提交作业，由本机队列送往本地打印机；不是普通 PDF 下载或 RDP 打印机重定向。

## 23.1 服务结构

PrintCenter UI → Main PrintServiceClient → 本地 PrintHelper → LPD Receiver / SpoolStore / QueueManager / OS PrintAdapter。

Windows 首发对接系统打印队列；PrintHelper 可作为当前用户进程运行，需“退出 UI 后继续接收”时使用明确安装的服务模式。服务不以交互桌面用户身份处理所有任务；打印机访问权限与服务账户单独配置。其他平台后续适配系统打印服务。

协议依据 [RFC 1179](https://www.rfc-editor.org/rfc/rfc1179)，产品用途参见 [Xlpd 官方说明](https://www.xshell.com/en/xlpd/)。标准监听 TCP 515；非标准端口必须由客户端明确配置。默认关闭网络接收，启用时选择监听接口与来源白名单。协议不提供强身份认证，不把提交的用户名视作可信主体。

## 23.2 配置与模型

```typescript
interface PrintQueue {
  queueId: string;
  name: string; // [A-Za-z0-9_-]{1,64}
  printerId: string;
  enabled: boolean;
  allowedSources: string[];
  mode: "raw" | "text";
  maxJobBytes: number; // 默认100MiB
  retentionHours: number; // 默认成功24小时、失败按策略最长7天
  revision: number;
}
interface PrintJob {
  taskId: string;
  queueId: string;
  sourceAddress: string;
  claimedUser?: string; // 不可信元数据
  spoolObjectId: string;
  bytes: number;
  osJobId?: string;
  state: "receiving" | "queued" | "held" | "submitting" | "submitted"
    | "completed" | "failed" | "cancelled" | "unknown";
  reprintOf?: string;
}
```

默认总暂存配额2GiB、队列最多1000个作业、单连接空闲超时30秒。队列名不能创建文件路径；暂存名由服务生成 UUID。平台服务账户和桌面用户之间通过 ACL 保护的命名管道控制，不暴露无认证 HTTP 管理端口。

## 23.3 接收状态机

按 RFC 处理接收作业、查询短/长队列、删除请求及控制/数据文件子命令。解析器处理分片、粘包、ASCII 字节计数、结束 NUL 与逐步 ACK；先收到数据或控制文件均可暂存，只有引用与长度全部验证后入队。

网络用户名/root 标志不能获得管理员能力；远程删除默认关闭，若启用仅接受配置的可信来源及限定队列；UI 管理通过 OS 身份授权。RFC 的源端口要求与现代客户端行为分别登记 strict/compat 模式，不把低源端口当成身份认证。

数据落盘并持久化状态后才确认相应接收阶段成功；中断、超配额、非法名字或控制文件引用缺失清理未完成对象。禁止把提交者文件名作为路径或执行控制文件中的命令。

## 23.4 本地打印

Raw 模式仅用于打印机明确支持的原始格式；Text 模式经过确定的编码、纸张、方向、边距、字体和换行策略转换。PDF/PostScript 不能直接当作所有打印机通用格式；解释器/渲染后端作为 M3 单独选型、隔离与兼容测试项，未安装时明确拒绝不支持格式。

系统接受作业后状态 submitted，只有可验证的系统完成事件才标 completed；“已进入 spooler”不等于物理纸张已输出。打印机离线/缺纸进入 held 或保留系统状态，UI 展示原因。

## 23.5 崩溃恢复与重复打印

提交前将 submitting 持久化，并为 OS 作业设置可检索的 Hornet taskId 标记。重启查询系统队列匹配 osJobId/标记；若崩溃发生在提交与登记之间且无法确定结果，置 unknown，要求用户核实，禁止自动重打。

LPD 客户端重试无法保证 exactly-once；短时间同来源/队列/内容摘要可提示疑似重复，但不能静默丢弃合法多份打印。重打创建新 taskId 和 reprintOf，并在 UI 明确份数。取消未提交任务删除暂存；已提交任务调用系统取消并显示尽力取消结果。

## 23.6 安全与运维

暂存目录只允许服务账户/授权用户访问；不保存原始文档到普通日志。过期清理按明确保留策略执行，活动作业不能删除。监听失败显示 PRINT_PORT_BUSY，配额超限 PRINT_QUOTA_EXCEEDED，打印机不可用 PRINT_PRINTER_UNAVAILABLE；诊断导出不包含文档内容。

## 23.7 验收与工作项

T-PRINT-01：远端提交文本与 Raw 测试页，队列映射、查询、暂停、取消、显式重打及中文编码。
T-PRINT-02：分片、错误长度、伪造路径、来源拒绝、磁盘满、端口占用和配额。
T-PRINT-03：提交边界进程崩溃，unknown 不自动重复打印；关闭 UI 的服务模式行为符合配置。

HORNET-PRINT-001 LPD 解析器；002 暂存与持久化；003 OS 打印适配；004 统一打印中心；005 服务安装与恢复验证。

## 23.8 当前源码实现及明确差异

`src/services/print/lpd.ts` 在协议服务内实现单队列接收、短/长队列查询和中断清理；远程删除、自动打印触发、多个数据文件及多份引用拒绝。控制/数据文件可任意顺序到达，处理分片、字节长度和NUL结束符，落盘fsync后ACK；最终引用验证并保存作业状态后进入held。文件名由服务生成，不以远端文件名构造路径。

当前限额低于目标设计：单任务10MiB、总暂存100MiB、最多1000条记录、4个接收连接、30秒空闲超时。仅支持精确来源IP白名单，兼容任意源端口，不实现源端口strict模式；默认不监听，配置不自动恢复。接收任务必须由UI手动提交，避免远端请求直接触发纸张输出。

Windows `NativeHost.exe` 提供RAW WritePrinter和UTF-8文本PrintDocument适配，文本使用Consolas 10pt、50/100英寸边距及打印机默认纸张。系统返回后标submitted，不标completed；中途异常或恢复时的submitting标unknown且拒绝自动重打。可以取消held作业并清理对应暂存，不提供已提交系统作业取消、重打、服务安装和定时保留清理。

协议测试通过两种文件顺序、逐字节分片、越界长度、路径拒绝、禁用远程删除、持久化、手动提交适配及unknown恢复。已验证本机打印机枚举，但提交测试使用适配器夹具，未向实体/虚拟打印机发送测试文档。因此实际纸张、字体分页、缺纸及打印机驱动互通仍未验收。没有自动去重或exactly-once承诺；未知提交结果须在系统队列核对。

### 多队列实现更新（2026-10-10）

LPD 同一监听端口按接收命令中的队列名路由至最多32个 PrintQueue。每个队列保存打印机、raw/text 和 enabled；监听地址、端口、白名单共用。queues.json 通过临时文件、fsync、rename 保存，恢复时不启动监听。启动兼容原 PrintConfig，并创建或启用启动队列。接收时冻结队列映射，已暂存作业不受后续配置修改影响。接收计数及 held/submitting 作业阻止删除，历史作业独立保留。暂停仅拒绝新接收，查询与已暂存作业处理继续可用。

作业增加控制文件 H/P 元数据用于主机/所有者展示，去除控制字符并限长；它们是发送方声明，不作为认证依据。PrintPanel 提供队列筛选、状态和关键词筛选、手动提交和取消；沿用不确定提交结果不自动重打的语义。
