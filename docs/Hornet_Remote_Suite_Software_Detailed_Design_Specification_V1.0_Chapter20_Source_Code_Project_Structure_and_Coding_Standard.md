# Hornet Remote Suite 软件详细说明设计书 V1.0

# 第20章 源码工程目录设计与代码规范

---

# 20.1 设计目标

本章节定义 Hornet Remote Suite 源码工程组织方式、模块边界、代码规范和开发模板。

目标：

- 支持多人并行开发
- 保证代码可维护性
- 支持持续集成
- 支持插件扩展
- 支持长期商业版本演进


---

# 20.2 总体仓库设计


推荐采用 Monorepo 架构。


```
hornet-remote-suite

├── apps

├── packages

├── services

├── native

├── plugins

├── tools

├── docs

├── tests

└── ci

```


---

# 20.3 顶层目录说明


## apps


存放客户端应用。


```
apps

└── desktop

    ├── main

    ├── renderer

    └── preload

```


---

# 20.4 Electron目录设计


```
desktop


├── electron


│   ├── main


│   │   ├── main.ts


│   │   ├── window


│   │   ├── ipc


│   │   └── services


│   │


│   ├── preload


│   │   └── index.ts


│   │


│   └── config


└── renderer

    ├── components

    ├── pages

    ├── hooks

    ├── store

    └── styles

```


---

# 20.5 Main Process规范


目录：

```
main

├── bootstrap

├── window

├── ipc

├── service

├── database

└── security

```


职责：

- 窗口管理
- IPC注册
- 服务启动
- 系统资源管理


---

# 20.6 Renderer工程设计


采用：

React + TypeScript。


目录：


```
renderer


├── components

├── layouts

├── pages

├── hooks

├── store

├── api

├── assets

└── utils

```


---

# 20.7 UI组件规范


组件：

```
PascalCase

```


例如：


```typescript
TerminalPanel.tsx

FileExplorer.tsx

SessionTree.tsx

```


---

# 20.8 Service层设计


目录：


```
services


├── ssh

├── sftp

├── terminal

├── ide

├── ai

└── plugin

```


每个服务包含：


```
service

├── interface

├── model

├── impl

├── test

└── index.ts

```


---

# 20.9 SSH模块代码结构


```
ssh


├── SSHService.ts

├── SSHClient.ts

├── SSHConnection.ts

├── AuthManager.ts

├── HostVerifier.ts

└── test

```


---

# 20.10 IPC代码规范


目录：

```
ipc

├── channels.ts

├── IPCManager.ts

├── ssh.ipc.ts

├── file.ipc.ts

└── terminal.ipc.ts

```


Channel命名：

```
module.action

```


例如：

```
ssh.connect

file.upload

terminal.create

```


---

# 20.11 TypeScript编码规范


## 命名规则


类：

```
PascalCase

```


函数：

```
camelCase

```


常量：

```
UPPER_CASE

```


接口：

```
IXXX

```


示例：


```typescript
interface ISSHService

class SSHManager

const MAX_TIMEOUT

```


---

# 20.12 TypeScript代码模板


Service：


```typescript
export class SSHService {


async connect(config:SSHConfig)
{

}


}

```


---

# 20.13 React代码规范


组件：

- 单一职责
- Hooks管理状态
- 禁止业务逻辑进入UI


示例：

```
TerminalView

|

useTerminal()

|

TerminalService

```


---

# 20.14 状态管理设计


推荐：

Zustand。


目录：

```
store

├── sessionStore.ts

├── terminalStore.ts

├── fileStore.ts

└── aiStore.ts

```


---

# 20.15 Native模块设计


用于：

- 高性能IO
- PTY扩展
- 系统能力


目录：

```
native


├── terminal

├── crypto

└── system

```


采用：

- C++
- CMake


---

# 20.16 Plugin工程模板


```
hornet-plugin-demo


├── package.json

├── src

│   ├── index.ts

│   ├── commands

│   └── panels

└── README.md

```


---

# 20.17 测试目录设计


```
tests


├── unit

├── integration

├── e2e

└── performance

```


---

# 20.18 CI目录设计


```
ci


├── docker

├── scripts

├── pipeline

└── release

```


---

# 20.19 Git提交规范


采用 Conventional Commits。


格式：


```
type(scope): message

```


示例：


```
feat(ssh): add private key auth

fix(sftp): fix upload retry

docs(api): update plugin api

```


---

# 20.20 Code Review规范


检查：

- 功能正确性
- 安全问题
- 性能影响
- 测试覆盖
- 文档更新


---

# 20.21 开发环境规范


推荐：

Node:

```
20 LTS

```


Package:

```
pnpm

```


IDE:

```
VSCode

```


---

# 20.22 Docker开发环境


提供：


```
Dockerfile

docker-compose.yml

```


包含：

- Node
- CMake
- GCC
- Clang
- Python


---

# 20.23 开发任务拆分


## HORNET-CODE-001

工程初始化

周期：

5天


## HORNET-CODE-002

基础框架

周期：

15天


## HORNET-CODE-003

模块模板

周期：

10天


---

# 下一章节


# 第21章 核心源码实现设计

内容：

- Electron启动代码
- IPC实现代码
- SSH Service代码
- Terminal实现代码
- SFTP实现代码
- Plugin Loader代码
- AI Agent代码框架
