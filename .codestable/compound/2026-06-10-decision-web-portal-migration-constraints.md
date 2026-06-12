---
doc_type: decision
category: architecture
date: "2026-06-10"
slug: web-portal-migration-constraints
status: superseded
superseded-by: 2026-06-10-decision-local-web-portal-first.md
area: web-portal
tags:
  - web
  - portal
  - sqlite
  - vercel-sandbox
  - ipc
  - github-sync
  - audit
---

**[已取代]** 见 `2026-06-10-decision-local-web-portal-first.md`。首版方向已从 “Web cloud + Vercel Sandbox” 调整为 “本机 HTTP server + LocalRuntimeProvider”。

## 背景

Dyad 当前是 Electron 桌面应用，renderer 通过 IPC 调用主进程能力。迁移到 Web portal 时，需要决定首版后端存储、云运行时 provider、desktop 兼容路径、agent tool 审批模型，以及 desktop/web 代码同步方式。

这些选择会直接影响迁移切片：是先抽 client transport，还是把 desktop 改成本地 HTTP server；是先做完整多 provider runtime，还是先让一个 provider 跑通；是先上 PostgreSQL 多租户，还是用 per-user/tenant SQLite 降低首版复杂度。

## 决定

1. Web backend 首版使用 SQLite-per-user/tenant。
2. Cloud runtime 保留 provider adapter，但首个 provider 只实现 Vercel Sandbox。
3. Desktop 继续使用 IPC，不改成“Electron shell + local HTTP server”；只在 client 层抽 transport adapter。
4. Web 的 agent tools 使用 operation-level approval timeline；现有工具 consent 语义保留为默认策略/快捷偏好来源。
5. Desktop local 与 Web cloud 的代码同步只支持 GitHub，不做 proprietary snapshot sync。

## 理由

SQLite-per-user/tenant 能最大化复用现有 Drizzle schema 和本地数据模型，同时避免首版直接承担 PostgreSQL 多租户查询隔离、连接池、迁移和运营复杂度。

Vercel Sandbox 先单 provider 可以更快打通 Web preview/runtime 闭环；保留 provider adapter 避免把 Vercel 细节泄漏进产品层，为后续 E2B、Fly Machines 或其他 runtime 留接口。

Desktop 继续 IPC 能降低对稳定桌面产品的扰动。只抽 client transport adapter，可以让 React/contract 调用在 desktop IPC 和 web HTTP/SSE 之间切换，而不强迫 desktop 先引入本地 HTTP server。

Web 远端执行需要比桌面本地 consent 更强的审计性。operation-level approval timeline 能记录 actor、scope、host、operation、approval、result 和 correlation id；现有 tool consent 仍可作为默认策略，避免用户每次都重复确认低风险工具。

GitHub-only sync 避免首版同时建设 proprietary snapshot sync、冲突解决、跨设备文件合并和长期存储一致性。生成代码本身也符合 Dyad “Bridge, Don't Replace” 的产品原则：代码继续落在用户能带走的标准仓库里。

## 考虑过的替代方案

- PostgreSQL multi-tenant：长期可扩展，但首版会放大 auth/tenant isolation/connection/migration 成本。
- 直接绑定 Vercel Sandbox 而不做 adapter：最快，但后续切换 provider 成本高。
- Desktop 改成 local HTTP server：能统一 Web/Desktop transport，但会大幅改变当前桌面运行边界和安全面。
- 只沿用当前 agent tool consent：桌面足够，但 Web 多租户远端执行缺少面向 operation 的审计时间线。
- proprietary snapshot sync：能减少 GitHub 依赖，但会引入复杂同步、冲突和存储责任。

## 后果

- Web MVP 的数据层要围绕 per-user/tenant SQLite 设计租户隔离、备份、迁移和导出策略。
- Runtime 层必须先定义 provider adapter，即使 v1 只有 Vercel provider。
- Contract/client 抽象优先级高于改造 desktop server runtime。
- Agent tool 执行模型需要产生 operation records，UI 需要能展示 approval timeline。
- Desktop/Web 互通能力以 GitHub import/export/sync 为边界；聊天记录、设置和 metadata 是否同步需要另行设计，但不承担代码 snapshot sync。

## 相关文档

- `.codestable/compound/2026-06-10-explore-web-portal-migration.md`
- `docs/adrs/0001-host-capability-interface.md`
- `docs/adrs/0002-cloud-runtime-topology.md`
- `docs/adrs/0003-authentication-authorization-model.md`
- `plans/desktop-mobile-web-unification.md`
- `plans/multi-platform-web-and-mobile.md`
- `plans/sandbox-engine-implementation-plan.md`
