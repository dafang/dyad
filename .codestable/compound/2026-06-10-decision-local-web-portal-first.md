---
doc_type: decision
category: architecture
date: "2026-06-10"
slug: local-web-portal-first
status: active
area: web-portal
tags:
  - web
  - portal
  - localhost-api
  - local-runtime
  - sqlite
  - ipc
  - github-sync
  - audit
supersedes: 2026-06-10-decision-web-portal-migration-constraints.md
---

## 背景

Dyad 当前 Electron renderer 通过 IPC 调用主进程能力。迁移到 Web portal 时，最小可行路径可以不先上云：先把当前主进程里的业务能力拆到一个本机 Node HTTP server，浏览器通过 localhost API 调用，由本机 runtime 执行文件、进程、git、preview 和日志能力。

这个方向仍然服务 Web portal 化，但首版目标从 “云端 Web + Vercel Sandbox runtime” 收敛为 “本机 Web portal + LocalRuntimeProvider”。云端 runtime 和 Vercel Sandbox 保留为后续 provider。

## 决定

1. Web portal 首版按本机方案实现：浏览器访问本机托管的 HTTP server，不依赖 Electron IPC。
2. 后端 API server 只监听 localhost/loopback，并通过随机 token、CORS/Origin 校验保护本机文件和命令能力。
3. Runtime provider 首版实现 `LocalRuntimeProvider`，复用本机 filesystem、child_process、git、SQLite、preview proxy、日志和 terminal 能力。
4. 保留 runtime provider adapter 边界；Vercel Sandbox provider 延后作为 cloud runtime provider，不作为首版默认。
5. Desktop app 继续使用 IPC，不改成 “Electron shell + local HTTP server”；本机 Web portal 和 Electron desktop 可以共享 service/runtime 抽象，但 transport 分别是 HTTP 与 IPC。
6. 数据层继续优先复用 SQLite；本机 Web portal 可先使用本机 userData/server data dir，后续云化时再按 SQLite-per-user/tenant 拆分。
7. Web 的 agent tools 使用 operation-level approval timeline；现有工具 consent 语义保留为默认策略/快捷偏好来源。
8. Desktop local 与未来 Web cloud 的代码同步只支持 GitHub，不做 proprietary snapshot sync；本机 Web portal 首版直接操作本机项目路径。

## 理由

本机 HTTP server 能显著降低第一阶段复杂度。它把 “从 Electron IPC 迁移到 Web transport” 和 “从本机 runtime 迁移到 cloud runtime” 两件事拆开，先验证浏览器 + HTTP API + shared service 的架构，不同时承担云沙箱、远程文件持久化、租户隔离和配额系统。

`LocalRuntimeProvider` 仍然必要：它把文件、进程、git、preview、日志、terminal 等执行能力从 API transport 中分离出来。这样本机 Web portal、Electron desktop、后续 cloud portal 都可以共用同一组 service 接口，只替换 runtime provider。

Desktop 继续 IPC 能保护现有桌面产品稳定性；本机 Web portal 是新入口，不强迫 desktop 先变成本地 HTTP shell。

localhost API 必须默认按高权限本机服务处理。它可以读写用户文件、启动命令、访问本地 SQLite 和项目目录，因此需要 loopback 绑定、随机 token 和严格 Origin/CORS 校验，不能让任意网页调用。

## 考虑过的替代方案

- 直接做 cloud Web + Vercel Sandbox：长期方向仍可行，但首版会同时引入云 runtime、远程存储、租户隔离、配额、安全审计和运维复杂度。
- 把 Electron desktop 改成本地 HTTP server shell：能统一 transport，但会扰动稳定桌面路径。
- 不抽 runtime provider，只写 localhost API：短期更快，但会把本机执行细节泄漏到 API/service 层，后续接 Vercel Sandbox 时需要二次大改。
- PostgreSQL multi-tenant：不适合当前本机首版；云化后可重新评估。

## 后果

- 第一阶段 roadmap 应以 `HttpTransport`、localhost API server、service extraction、`LocalRuntimeProvider` 为主。
- Cloud/Vercel Sandbox 相关工作降级为后续 provider，不阻塞本机 Web portal MVP。
- API security 成为本机方案的首要非功能需求：loopback、token、Origin/CORS、请求审计都要从一开始设计。
- 现有 Electron IPC handler 不应直接复制成 HTTP handler；应抽 service，再分别接 IPC wrapper 和 HTTP route。
- 后续云化时，`LocalRuntimeProvider` 与 `VercelSandboxRuntimeProvider` 必须实现同一 capability contract。

## 相关文档

- `.codestable/compound/2026-06-10-explore-web-portal-migration.md`
- `.codestable/compound/2026-06-10-decision-web-portal-migration-constraints.md`
- `docs/adrs/0001-host-capability-interface.md`
- `plans/multi-platform-web-and-mobile.md`
- `plans/sandbox-engine-implementation-plan.md`
