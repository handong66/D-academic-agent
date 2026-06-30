# GOAL — M0 Autonomous Overnight Build

日期：2026-06-22（夜间无人值守）
Owner：Han Dong（睡眠中）。执行：Claude（编排 + 验证）+ Codex（实现，仓库完整读写）。

## 目标

严格按已批准的计划 [`plans/2026-06-22-M0-corpus-and-resolver.md`](plans/2026-06-22-M0-corpus-and-resolver.md)（v2）实现里程碑 **M0**，直到全绿并提交。

## Definition of Done（完成判据）

- `npm test` 全绿（每个任务的测试通过）。
- `npm run typecheck` 干净（strict + `noUncheckedIndexedAccess`）。
- `npm run lint` exit 0（无 `HARNESS-§` error）。
- 12 个任务全部实现，每个按计划的 conventional message 提交在分支 `feat/litreview-harness-spec`。
- 满足计划末尾的 M0 验收清单：`sources.lock.json`（6 篇 toy 源）、`gold_claims.jsonl`（≥20 条、覆盖全 5 verdict + overclaim）、CitationResolver 能解析每条 gold `raw_citation`、`makeClaimCitationPair` + `runLint` 强制不变式、`AGENTS.md` + `CLAIM_CHECK_CONSTITUTION.md` 就位、语料显式标注 toy。
- **Claude↔Codex 互评通过**：每段实现都经过 Claude 审 Codex、必要时 Codex 审 Claude 的修订，双方 + 测试三者一致 —— **绿测试 ≠ Done**。

## Scope & Guardrails（硬约束）

- 只在 `/Users/domo/Downloads/job/academic-agent/` 内工作。
- **不**修改 spec、申请材料（CV / README / 证据包）、或 academic-agent/ 以外任何东西；不碰其它仓库或全局配置。
- **不 `git push`**；只在本地分支 `feat/litreview-harness-spec` 提交。
- 语料是 **toy seed**；绝不把 M1 指标宣称为权威 benchmark。
- TDD：测试先行、最小实现、每任务一提交。
- 沿用 v2 计划原样（已经 Codex 三轮 + M0 两轮评审）；用同步 `new Cite(raw).data`（不要回退到 `Cite.async`）；`fileURLToPath` 守卫已在。

## If blocked（受阻处理）

停下。提交已绿部分。留清楚的说明（停在哪、为什么、需要什么）。**不硬撑、不假装完成。** 若 npm install 无网络，直接如实报为 blocker。

## 协作模型 —— Claude ↔ Codex 互评（用户明确要求）

不是"Codex 写、Claude 只跑测试"的单向验证，而是**双向互评**：

1. **Codex 实现**一段（TDD + 每任务提交）后，**Claude 批判性 review**：读 diff/代码、跑 `npm test`/`typecheck`/`lint`、对照 spec 与计划查 fidelity，并主动找 Codex 自己评审计划时关心的那类 bug（索引安全、citation-js 用法、resolver 边界、locator/hash 一致、snippet-only、不变式 guard 是否真生效、gold 覆盖）。
2. Claude 把 review 发现**回喂给 Codex** 修复；若 Claude 自己动手改，则**让 Codex review Claude 的修订**。
3. 一来一回，直到**双方 + 测试三者一致**才算该段过关；**绿测试 ≠ Done**，必经一轮互评。
4. 每回合 Claude 验证 + 编排，直到全部 Done 或受阻。早间留状态报告 + 证据（测试/lint 输出、commit 列表、**互评结论**、残留风险）。

> 经验复盘已写入 SOP：续接 Codex 线程做复查会上下文漂移、虚构细节（M0 v2 复查即如此）。**互评中的复查一律开新线程（fresh read），并对 Codex 的每条结论用 grep/读码核实，再决定采纳。**

## Out of scope

M1–M4。M1 计划另出，不在本次夜间运行范围。
