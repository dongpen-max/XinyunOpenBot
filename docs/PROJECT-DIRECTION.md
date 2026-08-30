# XinyunOpen Bot 项目定位与阶段路线图

> **文档状态：** 当前产品与工程的唯一方向基线`n> **版本：** 1.0`n> **更新日期：** 2026-08-30`n> **当前应用版本：** 0.1.40`n> **适用范围：** 产品设计、架构演进、功能开发、上游移植、测试、发布与后续对话

## 1. 一句话定位

**XinyunOpen Bot 是一个本地优先、模型无关、跨设备的多 Agent 执行工作台。**

它统一接入不同厂商的模型、MCP/连接器、云服务器、云电脑和用户设备，根据任务需求选择合适的 Agent 与执行目标，并通过工作流、审批、追踪、同步和恢复机制完成真实工作。

工程上的简称是：

> **Agent Runtime + Computer Execution Fabric + Desktop Control Plane**

## 2. 我们在做什么，不在做什么

### 2.1 核心方向

1. **Agent Runtime：** 能力清单、智能路由、健康度、故障转移、会话恢复和多 Agent 协作。
2. **Computer Execution Fabric：** 用统一接口接入本机、Box、VPS、远程桌面、浏览器容器和自建 Worker。
3. **Desktop Control Plane：** 在一个简体中文桌面工作台中查看任务、设备、审批、文件、Trace 和运行状态。

### 2.2 明确不作为长期主航道

- “Grok Bot 平替”或单一厂商客户端；
- 只增加模型厂商数量的兼容性清单；
- 纯聊天窗口或又一个多模型聊天客户端；
- 纯远程桌面软件；
- 只聚合各家云厂商控制台的管理面板；
- 在基础可靠性尚未完成前建设复杂的企业 SaaS、RBAC、计费体系。

兼容更多厂商是实现手段，不是产品价值本身。价值在于：**同一个任务可以被可靠地交给最合适的模型和设备执行。**

## 3. 目标用户与典型场景

### 3.1 第一目标用户

- 中文开发者和技术型个人用户；
- 自动化、技术运营和内容生产人员；
- 需要同时管理多个 AI、浏览器和电脑环境的小团队。

### 3.2 必须支持的场景

1. 用户在本机发起任务，Agent 自动选择模型并使用 MCP、浏览器或代码工具完成工作。
2. 用户在家中查看任务，让 AI 在公司的 Windows/macOS/Linux 电脑上工作。
3. 将耗时或隔离任务派发到 VPS、容器、浏览器环境或云电脑。
4. 多个 Agent 并行推理，但共享桌面上的鼠标、键盘和浏览器操作始终串行。
5. 家庭设备与公司设备之间同步任务状态、审批、文件成果和运行 Trace。
6. 断线、重启或单个模型失效后，任务能够从安全检查点继续，而不是重复产生外部副作用。

## 4. 产品原则（所有后续改动必须满足）

1. **任务优先：** 先理解任务需求和执行目标，再选择 Agent；不能让用户为每个任务手工拼装底层连接。
2. **能力优先于品牌：** 路由只依据声明且可验证的能力、实时健康度和策略，不编造价格、上下文长度或模型能力。
3. **本地优先、远端可扩展：** 本地数据和控制面板开箱可用，远端通过主动出站连接扩展，不要求公司电脑开放公网入站端口。
4. **共享桌面绝不并发操作：** Box 的 lease 必须按 `boxId` 串行；人工接管期间服务端拒绝 Bot 电脑输入。
5. **安全可恢复：** 任何可能产生副作用的调用都必须有执行意图、幂等键或人工确认，不能因为故障转移而盲目重放。
6. **可观测而不泄密：** Trace 要足够定位问题，但绝不记录或广播凭据、请求敏感原文、Box Token、joinUrl 或 Authorization。
7. **兼容现有行为：** 用户未启用自动路由时，固定模型、队列、Box、MCP、设置和数据目录行为保持不变。
8. **小步交付：** 每个阶段都要有真实调用链、测试和可发布结果，不交付只有接口的空壳。

## 5. 当前基线（0.1.40）

以下能力已经存在，后续工作应在其上增量改进，不得重写成互相冲突的第二套实现：

- Provider/Model Registry、统一 `AgentCapabilities`、模型发现；
- `manual / balanced / quality / speed / cost` 路由策略；
- 图片、Agent/MCP 工具、本地/云电脑、浏览器等能力约束路由；
- Provider/model 健康度、错误分类、熔断、半开探测和恢复；
- 自动故障转移、候选去重、hop 限制与循环检测；
- 单 Bot 队列、多 Bot 并行、handoff 协作链；
- 共享 Box 的按 `boxId` lease、人工接管互斥和任务恢复；
- Task Trace、工具/电脑耗时、Token/成本字段、脱敏导出和 safe replay；
- Workflow DAG：并行、串行、条件分支、审批、暂停、恢复、取消和节点重跑；
- 结构化共享任务空间：目标、事实、假设、决策、成果和来源；
- Windows/macOS/Linux 桌面应用、语音、MCP、Composio、图片附件和 Windows 打包安装。

当前重点不是重复造这些模块，而是补齐可靠性、执行目标抽象和跨设备运行闭环。

## 6. 目标架构

```text
┌──────────────────────────────────────────────────────────────┐
│ Desktop Control Plane                                        │
│ 聊天 · 任务看板 · 设备 · 审批 · 文件成果 · Trace · 设置       │
└───────────────┬──────────────────────────────┬───────────────┘
                │                              │
        Agent Runtime                    Sync/Event Layer
        能力清单 · 路由                   事件日志 · 游标续传
        健康度 · 故障转移                 checkpoint · 脱敏 Trace
                │                              │
        ┌───────┴────────┐              ┌──────┴─────────┐
        │ Provider/Model │              │ Execution      │
        │ Registry       │              │ Target Fabric  │
        └────────────────┘              └──────┬─────────┘
                                               │
             local · box · vps · remote-desktop · browser
             container · xinyun-worker
```

### 6.1 统一执行目标

后续所有电脑、服务器和浏览器接入都应归一到以下概念，不为每个厂商新增一套调度协议：

```ts
type ExecutionTargetKind =
  | "local" | "box" | "vps" | "remote-desktop"
  | "browser" | "container" | "xinyun-worker";

interface ExecutionTarget {
  id: string;
  kind: ExecutionTargetKind;
  name: string;
  platform: "windows" | "linux" | "macos" | "unknown";
  capabilities: {
    shell: boolean;
    browser: boolean;
    screenshot: boolean;
    mouseKeyboard: boolean;
    fileAccess: boolean;
    codeExecution: boolean;
  };
  connectionState: "online" | "offline" | "busy" | "unavailable";
  leaseKey: string;
}
```

```ts
interface ComputerBackend {
  kind: string;
  discover(): Promise<ExecutionTarget[]>;
  connect(targetId: string): Promise<void>;
  disconnect(targetId: string): Promise<void>;
  screenshot(targetId: string): Promise<Uint8Array>;
  execute(targetId: string, command: string): Promise<unknown>;
  browserAction(targetId: string, action: unknown): Promise<unknown>;
  acquireLease(targetId: string): Promise<() => void>;
  health(targetId: string): Promise<unknown>;
}
```

Box 适配必须保持 `leaseKey = boxId`，仍然是单 Box、单 X11 screen、`DISPLAY=:0` 的共享桌面模型。

### 6.2 Agent 与执行目标分离

路由结果必须同时回答两个问题：**哪个 Agent 推理**，以及**在哪个执行目标上操作**。

```ts
interface DispatchPlan {
  agent: { instanceId: string; model: string };
  target?: { targetId: string; backend: string };
  requirements: {
    browser?: boolean;
    shell?: boolean;
    screenshot?: boolean;
    fileAccess?: boolean;
  };
  leaseKey?: string;
}
```

不需要电脑的任务不得进入 Box 队列；需要电脑的任务只能通过目标的 lease 进入现有串行通道。

## 7. 分阶段路线图

### 阶段 0：基线冻结与工程护栏（已完成）

**目标：** 保证 0.1.40 的路由、Trace、Workflow 和 Box 行为可回归。

**完成项：** 类型检查、测试、构建、Windows 安装验证；保留现有未跟踪素材和 Box `bx_82y83nhj` 的 `archived` 状态。

**出口条件：** 后续阶段不得破坏固定模型模式、单 Bot 队列、Box lease 和人工接管互斥。

### 阶段 1：运行可靠性（下一优先级，P0）

**目标：** 防止 Provider 卡死、取消失效、重启后任务状态不明。

**交付：**

- 移植并适配 `server/turn-watchdog.ts`：按最后活动时间监控 turn，审批等待不计入超时；
- Workflow cancel 真正联动 Provider `interruptTurn`；释放 Box lease、停止屏幕轮询；
- 拒绝迟到 Provider 事件覆盖 `cancelled`/`failed` 状态；
- 增加 `unknown_after_restart` / `needs_review` 状态；
- 有副作用或电脑动作的节点重启后必须人工确认；
- 引入执行意图、幂等键和副作用边界；
- 覆盖 watchdog、取消、迟到事件、重启恢复和 lease 释放测试。

**出口条件：** 任何取消、超时、崩溃路径都不会留下永久 busy、锁或不可解释的 running 节点。

### 阶段 2：智能能力路由与自动故障转移（P0）

**目标：** 让系统根据任务需求、能力和实时健康状态自动选 Agent，同时兼容手动模式。

**交付：**

- 统一能力清单：文本、推理、编程、Agent/MCP、图片输入/生成、本地/云电脑、浏览器、上下文、会话恢复、流式和可用性；
- 错误分类：429/配额、超时、暂时不可用、连接中断、上下文溢出、认证配置、用户取消、不可恢复任务错误；
- `manual`、`balanced`、`quality`、`speed`、`cost` 五种策略；无可靠价格数据时 cost 不排序或明确标记未知；
- 硬能力过滤优先于质量/速度排序；
- 429、超时、上下文溢出只对可恢复错误切换，限制次数并防止候选循环；
- 同任务竞速仅允许无副作用、无电脑操作的候选；
- 电脑任务失败不得在另一个 Agent 上重复点击或提交；
- UI 展示当前路由、健康/限额/熔断和最近切换原因。

**出口条件：** 手动模式行为与旧版本一致；所有候选失败返回结构化错误；服务端而非仅前端执行能力约束。

### 阶段 3：全链路 Trace、诊断与安全重放（P0）

**目标：** 每次任务都能回答“谁在何时用什么做了什么，为什么成功或失败”。

**交付：**

- 统一 Trace ID 覆盖 Agent、模型、工具、handoff、排队、Box lease、Token、成本、错误和重试；
- 从失败节点继续、换模型重放、两次运行对比；
- 一键导出脱敏诊断包，复用 `server/redact.ts` 和现有 Trace；
- 诊断包默认排除凭据、请求头、敏感原文、Box Token 与 joinUrl；
- 为重放标记“无副作用 / 需确认 / 禁止重放”。

**出口条件：** 能用一个 Trace 定位一次自动切换或电脑执行失败，且导出内容通过敏感字段扫描。

### 阶段 4：执行目标抽象与多厂商接入（P0/P1）

**目标：** 在不改变 Box 语义的前提下，接入更多云端和本地执行环境。

**顺序：**

1. `ExecutionTarget`、`ComputerBackend`、`ExecutionTargetRegistry`；
2. 将现有 Box 包装为第一个 Backend，保留 `boxId` 串行 lease；
3. 将本地电脑包装为 Backend；
4. 通用 SSH VPS；
5. Docker/headless Chromium 与 CDP 浏览器；
6. 自建 Linux/Windows/macOS Worker；
7. 最后再做阿里云、腾讯云、AWS、Azure 等生命周期 API。

**出口条件：** 新增一个 Backend 不需要修改 Agent 路由核心；每个目标都有能力、健康、连接状态和 lease；电脑操作仍然单目标串行。

### 阶段 5：跨设备 Worker 与远程办公闭环（P1）

**目标：** 实现“在家通过本平台让 AI 在公司电脑上工作”。

**设计：** 公司电脑运行轻量 `xinyun-worker`，主动通过 WebSocket/QUIC 连接控制平面，不要求公网入站端口。Worker 提供设备注册/配对、心跳、能力清单、远程屏幕、Shell、浏览器、文件成果、checkpoint 和人工审批暂停/继续。

**出口条件：** 断线可重连和续传；任务、设备、审批、文件、Trace 在家庭端可见；公司端可随时撤销设备或暂停 Bot 输入。

### 阶段 6：任务图、共享空间与长期任务（P1）

**目标：** 将 handoff 升级为可恢复的任务系统，而不是机器人互相转发消息。

**交付：**

- 串行、并行、条件分支、审批、重试、备用 Agent；
- 结构化黑板：目标、事实、假设、决策、成果、子任务状态、来源；
- 最大轮数、共识阈值、重复检测、停止条件和最终裁决 Agent；
- 跨重启 checkpoint、错过任务补跑、会话失效后摘要注入；
- 事件日志 + 游标续传：`device.event`、`task.event`、`workflow.event`、`trace.event`、`artifact.event`、`approval.event`；
- 任务看板支持暂停、恢复、取消和子任务单独重跑。

**出口条件：** 失败节点可以安全恢复；人工审批和副作用节点有明确状态；不会出现无限 Agent 对话循环。

### 阶段 7：成果中心、评测与成本（P1/P2）

**目标：** 让系统可衡量、可优化、可团队复用。

- 项目级文件与成果中心：版本、差异、预览、引用、导出、冲突检测；
- 真实任务集评测：正确率、工具成功率、耗时、成本、中断恢复率、电脑任务成功率、幻觉和循环率；
- Agent/任务/群聊成本统计、预算、超限降级、本地模型优先、重复结果缓存；
- 插件/连接器清单、权限范围、健康检查、版本兼容和私有仓库。

这些能力在可靠性、路由、Trace、执行目标和 Worker 稳定后再建设，避免过早平台化。

## 8. 路由与执行硬约束

每次 dispatch 必须按以下顺序执行：

1. 解析任务需求和副作用等级；
2. 过滤不满足图片、工具、浏览器、Shell、截图或电脑要求的候选；
3. 过滤不可用、熔断、限额或连接离线候选；
4. 按用户策略和健康指标排序；
5. 需要电脑时先选择 `ExecutionTarget`，再按 `leaseKey` 获取串行 lease；
6. 执行期间记录 Trace 和健康指标；
7. 仅对可恢复且未产生副作用的失败进行有限故障转移；
8. 用户取消、认证配置错误和不可恢复任务错误不得自动重放；
9. 所有候选失败时返回脱敏、结构化最终错误。

## 9. 每次开发对话的强制执行流程

本文件是后续对话的共同上下文。每次涉及项目的对话都必须：

1. 先阅读本文件并确认当前阶段；
2. 检查 `git status`、工作区差异和最近提交，绝不覆盖既有未提交修改；
3. 优先完成当前阶段的最小真实闭环，不停留在方案或空接口；
4. 复用现有 Registry、Capabilities、Health、Trace、Workflow、Lease 和脱敏逻辑；
5. 为服务端约束、失败路径和 UI 状态补测试；
6. 完成 `pnpm typecheck`、`pnpm test`、`pnpm build` 和 `git diff --check`（涉及 UI 时做宽/窄窗口及明暗主题验收）；
7. 发布前递增补丁版本，精确选择相关文件提交，禁止 `git add -A`；
8. 不读取、输出或提交任何凭据，不创建新的 Box，不删除按 `boxId` 的串行保护。

## 10. 发布与成功指标

### 10.1 每阶段发布门槛

- 关键路径有自动化测试和至少一次真实调用链验证；
- 失败、取消、重启、断线和权限拒绝均有可解释状态；
- UI 文案为简体中文，内部异常栈和凭据不出现在前端；
- 对现有手动模型、队列、Box 和设置行为无回归。

### 10.2 产品指标（用于后续评测）

- 自动路由任务成功率、故障转移成功率；
- 429/超时后的平均恢复时间；
- 电脑任务一次成功率与误重放次数（目标为 0）；
- 断线恢复率、重启后可恢复任务比例；
- 单任务平均等待、执行耗时和 Token/成本；
- 用户手动介入次数与最终完成率。

## 11. 当前下一步

立即进入**阶段 1：运行可靠性**，首个可交付切片是：

1. 移植 Turn Watchdog；
2. 将 Workflow cancel 接入 Provider interrupt；
3. 增加迟到事件保护、lease/轮询清理；
4. 补齐取消、超时、重启恢复和 Box 串行回归测试。

完成该切片后再推进 `ExecutionTarget` 抽象。任何“新增厂商模型”的工作都应排在上述可靠性闭环之后，除非它是验证统一接口所必需的最小适配。
