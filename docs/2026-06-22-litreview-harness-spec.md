# D-academic-agent — 实现设计 Spec

生成日期：2026-06-22
版本：v3.1（v3 + Codex 第三轮复查的 2 个 blocking 项及小修）
状态：Codex 三轮评审确认 READY，待转 writing-plans
项目位置：`/Users/domo/Downloads/job/academic-agent/`

> **现状指针（避免文档漂移）**：本文是 **2026-06-22 的原始设计 spec（v3.1）**，记录最初的核心设计。系统此后又
> 实现了本 spec 之外的能力——本地 **Writing Desk**、完整的**外部研究层**（scite/Consensus 检索 + 三层引用健康 +
> MCP OAuth + 写作台找证据）等。**当前系统的真实状态以根目录 [`README.md`](../README.md) 为准**；逐里程碑的
> 设计+评审记录见 [`plans/`](plans/)。本文不再随实现更新。

权威输入：
- 产品愿景：[`assignment-aware-literature-review-agent.md`](../assignment-aware-literature-review-agent.md)
- 目标岗位 JD：[`../../00_inputs/job-jd-verbatim.md`](../../00_inputs/job-jd-verbatim.md)

---

## 0. v3 变更说明（Codex 第二轮评审的处置 + Claude 判断）

第二轮 Codex 评审聚焦"spec 还不够 implementation-ready"，多数标 fix-before-M1。处置分四类：

**A. 直接采纳（硬修复，已写入对应章节）**
- 补 typed 契约：`Draft / DraftSentence / CitationMention / ClaimCitationPair`（§4）。
- `EvidenceLink.locator` 由裸字符串改为结构化 `source_hash + char_start/end + 可选 page/section + chunker_version`（§4）——文本源无页码时仍稳定。
- 定义版本化 `TraceEvent` JSONL schema（§10）——否则 trace 无法复现 eval。
- claim 核验拆成两个独立字段：`cited_source_support`（引用忠实度）与 `corpus_counterevidence`（反证），不混进同一 verdict（§6）。
- §6 step① 拆出 `ClaimSpan / CitationMention(char span) / atomicity_rule` 并允许人工修正（§6）。
- MCP 工具拆"只读"与"写项目本地工件"两类，消除安全语义矛盾（§11）。
- 新增 **M0** 里程碑：冻结 demo 语料 + `gold_claims.jsonl` + source hashes + `CitationResolver`，作为第一交付门（§14）。
- planner 移出 M1（M1 用脚本化检索 query）；checker 才是 M1 心脏（§7、§14）。
- eval 报 per-class precision/recall + macro-F1 + 混淆矩阵 + 失败样例，不报"总准确率"头条数（§9、§15）。
- section-aware 候选检索（findings/methods/sample/limitations），不只取与 claim 语义相似的块（§5）。
- Electron 补原生特征（拖拽语料、后台 worker 队列、本地项目文件夹、外发片段审计），避免"套壳网页"（§12）。
- 隐私落到具体：per-run network manifest + provider 配置 + 可选本地/离线 embedding（§16）。
- 补 `Skills`（JD 点名）：把核验能力封成可移植的 `CitationAuditSkill`，MCP 与 Electron 共用（§17）。

**B. 采纳但调整时机（列为 M2+，不塞进 M1，保 M1 能做完）**
- co-evolution 真实工件（`failure_cases.jsonl` 导出、prompt/版本 ablation、trace replay）→ M4（Codex 亦标 fix-before-M2）。
- DX 深度（`replay_trace`、context-pack diff、prompt 版本 diff、失败钻取）→ M2+。
- subagent 的 role-specific traces/eval（planner recall、checker accuracy、handoff 工件）→ 随 planner 进 M2。

**C. 下放 writing-plans（属计划层颗粒度，不进 spec）**
- M1 内部三段拆分（retrieval recall → single-claim checker → eval/混淆矩阵）的细任务。
- 可调数值：top-`k`、chunk size、section boost 权重、各项 recall 阈值（阈值在 M0 冻结 gold 后标定）。

**D. 保留意见（我对 Codex 的微调）**
- §5 的 `rerank`：M1 明确**只用 RRF 最终排名，不引入独立 reranker**；reranker 作为 M2+ 可选项并需定义 I/O。
- 对求职作品控制体量：重工件（ablation、context-pack diff DX）定 M2+ 而非 M1，避免 M1 失焦。

**E. v3.1 修复（Codex 第三轮复查：2 个 blocking + 3 个小修）**
- CitationSpan 折进 `CitationMention.char_start/char_end`（不再单列 CitationSpan）；并写死不变式 `ClaimCitationPair.source_id == CitationMention.resolved_source_id`（§4、§6）。
- `check_claim` 等只读工具改为**返回 TraceEvent、自身不写盘**，持久化由 runner 负责——消除"只读工具却写 trace"的矛盾（§10、§11）。
- `corpus_counterevidence` 补 `locator/relation/reason`，与 `cited_source_support` 对称可审计（§6）。
- M1 验收明确为 **reporting-only，不设 pass/fail 阈值门**（§9、§15）。
- verdict rubric 内联 2 个示例（§6）。

---

## 1. 背景与定位

一句话：**D-academic-agent 是一个 evidence-grounded 的学术 Agent Harness——理解 assignment/rubric/AI policy，连本地文献库，规划检索，核验"引用是否真的支持某句 claim"，并用人工 gold 对自己的判断打分。**

定位为 **Harness 工程能力展示**（使命 "Model + Harness = Agent"），非"帮学生写综述"。对外名称统一 **D-academic-agent**。

技术核心命题（愿景文档 §1）：RAG 是 Harness 里的证据基础设施，检索之后必须接 claim-evidence 判断。**最难也最值钱的不是桌面壳、不是 RAG，而是让 claim-citation 判断可追踪、可复现、可被 gold 打分。**

## 2. 目标 / 非目标

**目标**：纯 TS headless 核心跑通 `ingest → index → RRF hybrid retrieve → check_claim → eval + trace`；MCP server 暴露工具给外部 agent；Electron Mac app（主屏 Draft Citation Audit）；seed gold + eval harness 出可信指标与失败分析。

**非目标**（§18）：完整 Zotero 双向同步、教师端、LMS、一键成文、AI 检测规避、复杂多 agent 编排框架、PDF 作首个必经输入。

## 3. 架构：共享核心 + 两张脸

```
          ┌──────────────────────────────────────┐
          │        Core （纯 TS package，headless） │
          │  ingest · index · retrieve · check     │
          │  · eval · trace · memory(ledger)       │
          └───────────────┬──────────────────────┘
            ┌─────────────┴──────────────┐
            ▼                            ▼
   ┌────────────────────┐     ┌──────────────────────────┐
   │   MCP server(adapter)│     │  Electron Mac app(adapter)│
   └────────────────────┘     └──────────────────────────┘
```

铁律：Core 纯 TS、API 不依赖 Electron；MCP / Electron / CLI 均为 adapter；Electron 的 IPC/renderer/窗口状态绝不进 Core。

## 4. 核心数据模型

SQLite（better-sqlite3）。在愿景文档 §12 基础上补齐 draft 侧与结构化定位：

- `Source`：title, authors, year, type, path_or_url, **source_hash**, citation_metadata, fulltext_status。
- `Chunk`：source_id, section, char_start, char_end, page_start/end?, text, embedding_id, **embedding_model, embedding_dim, chunker_version**。
- `Draft`：id, assignment_id, raw_text, created_at。
- `DraftSentence`：draft_id, index, char_start, char_end, text。
- `CitationMention`：draft_sentence_id, **char_start, char_end**（该引用在草稿中的 span，即原 §6 所称 CitationSpan）, raw_citation, resolved_source_id?(由 CitationResolver 填), resolution_status。
- `Claim`：id, draft_sentence_id?, text, normalized_text, claim_type, **claim_span(char_start/end)**, status。
- `ClaimCitationPair`：claim_id, citation_mention_id, source_id —— 核验的最小单位。**不变式：仅当 `CitationMention.resolution_status = resolved` 时才生成 pair；`source_id` 必须等于该 `CitationMention.resolved_source_id`（resolved_source_id 是唯一权威绑定，pair.source_id 仅为其物化副本）。**
- `EvidenceLink`：claim_citation_pair_id, source_id, chunk_id, **locator{source_hash, char_start, char_end, page?, section?, chunker_version}**, quote, support_relation, support_strength, limitation, human_confirmed。
- `AIUseEvent`、`EvalRun`：同愿景文档 §12。

## 5. 检索层（Hybrid Retrieval）

`section-aware chunking → lexical(FTS5/bm25) + vector(sqlite-vec) 双索引 → RRF 融合 → 候选证据`。

- **M1 只用 RRF 最终排名**，不引独立 reranker（reranker 为 M2+ 可选，需定义 I/O）。
- **不分数直加**：用 RRF；trace 记 `bm25_rank / vector_distance / rrf_score / final_rank`。
- **provenance**：Chunk/索引记 `embedding_model / embedding_dim / chunker_version`；换模型/chunker 旧向量不得混入 eval。`sqlite-vec` 锁版本。
- **section-aware 候选**：overclaim 判定常需 methods / sample / limitations 段，而非只取与 claim 语义最相似的块；为 findings/methods/sample/limitations 分别建候选集。
- **同步 DB 隔离**：better-sqlite3 同步 API，重活跑 worker/独立进程，不进 Electron 热路径。
- 可调数值（`k`、chunk size、section boost）→ writing-plans 标定。

## 6. Claim-Citation 核验流水线（技术心脏）

做成**可评测系统**，非"LLM 直接打标签"。

```
draft 段落
 → ① 抽取:DraftSentence → ClaimSpan + CitationMention(含 char span) → ClaimCitationPair(仅 resolved 引用成 pair;允许人工修正)
 → ② 证据检索:
      (a) 按被引 source 过滤 + hybrid 取 top-k snippet  → 用于 cited_source_support
      (b) cross-source 候选                            → 用于 corpus_counterevidence(独立任务)
 → ③ 判断:checker 仅基于检索到的 snippet 判断,禁用脑内知识
 → ④ 输出(两字段分开):
      cited_source_support: {verdict, locator, quote, reason, suggested_rewrite, confidence}
      corpus_counterevidence: {found: bool, items:[{source_id, locator, snippet, relation, reason}]}
 → ⑤ 对 gold 跑 per-class P/R + 混淆矩阵 + 失败分析
```

- `verdict ∈ {supports, weakly_supports, unsupported, contradicts, unclear}`。
- **抽取拆细**：`ClaimSpan / CitationMention(char span) / atomicity_rule`(一句多引、句末引、一句多 claim 都要处理)，并允许人工修正 ClaimCitationPair。
- **rubric**(写入 §9 gold 标注指南)：按 causality / scope / sample / mentions-only 四维区分 weak vs unsupported vs unclear。内联示例：(scope) 草稿"显著促进教育公平"，source 仅证"城市学校入学率上升" → **weakly_supports**(范围越界)；(causality) 草稿"X 导致 Y"，source 仅报"X 与 Y 正相关" → **unsupported**(相关≠因果)；(mentions-only) source 只提及主题、未给支持证据 → **unsupported**。
- **铁律保留**：checker 只看 snippet —— 这是对 grounding 的真实检验。

## 7. Subagents（planner / checker）

- `checker`：执行 §6，**M1 即做**。
- `planner`：把研究问题拆成检索计划，**移出 M1**——M1 用脚本化/确定性检索 query；planner 进 **M2**，届时补 role-specific traces/eval(planner recall、checker accuracy、handoff 工件)。
两者均为 typed、可独立单测的角色模块，不搭复杂编排框架。

## 8. Memory / Evidence Ledger

做真用得上的 ledger（不堆 buzzword）：working memory（任务内 source cards/claims/evidence，被后续检索与核验复用）+ long-term（SQLite 持久化，跨会话续用）。不参与检索/决策的 memory 一律删除。

## 9. Eval Harness

- **Gold**：愿景文档 §15 场景（青少年社媒与心理健康、6 篇开放获取论文、APA、AI policy），人工标 20–30 条 `ClaimCitationPair`。
- **`gold_claims.jsonl` schema**：`{claim_text, cited_source, snippet, locator, label, rationale, annotator, label_schema_version}` + 配套标注指南（§6 rubric）。
- **M1 指标（reporting-only）**：retrieval recall@k；citation faithfulness 报 **per-class precision/recall + macro-F1 + 混淆矩阵 + 失败样例**，**不报头条总准确率**。**M1 不设 pass/fail 阈值门**——验收 = "指标被正确产出且可复现"，非"指标 ≥ 某数"；阈值仅在 M0 冻结 gold 后设定、用于后续回归追踪，不作 M1 验收门。`answer_groundedness / policy_compliance` 推到后续里程碑（M1 不构建）。
- **诚信**：声明 seed eval；gold 人工标注；**不让同一模型既生成 claim 又判定 gold**；输出混淆矩阵 + 具体失败样例。

## 10. Trace（版本化 TraceEvent）

每步写 JSONL，schema 版本化：
`{schema_version, event_type, step, ts, model_id, prompt_version, temperature, context_pack_hash, source_hashes[], retrieval{bm25_rank, vector_distance, rrf_score, final_rank}, input_hash, output_hash, cost, outbound_snippets[]}`。
`outbound_snippets` 记录本步外发给 embedding/LLM API 的片段（隐私审计，§16）。**职责边界：工具（§11）是纯函数，把 TraceEvent 作为返回值返回；落 JSONL 由 Core 的 run loop / CLI / eval runner 持久化——工具本身不写盘。** `replay_trace` 等 DX 深度 → M2+。

## 11. MCP server（面 1，工具语义分两类）

用 `@modelcontextprotocol/sdk`，与 Core 共用实现：
- **只读工具（无副作用）**：`search_sources`、`get_fulltext`、`extract_citations`、`check_claim`。**这些工具把 TraceEvent 作为返回值返回、自身不写盘**（trace 持久化由调用方/runner 负责，见 §10），故对 MCP host 而言确为只读、无外部副作用。
- **写项目本地工件工具**：`build_matrix`、`run_eval`（写 `EvalRun` / 本地报告 / trace）——只写**项目本地工件**，绝不写外部系统；在工具描述里显式标注副作用。
目标：在 Claude 桌面端等外部 host 直接调用 → 证明 MCP / Tool Use / 可组合性。

## 12. Electron Mac app（面 2）

- **Hero 主屏 = Draft Citation Audit**：粘贴草稿 + 引用 → 展示**实时审计诊断**（逐句 verdict、证据 trace、quote/locator、建议改写、confidence）。**注意：用户草稿无 gold，主屏不展示 eval 指标**；gold eval 指标只在 `Eval & Trace` tab（仅对 seed 集有意义）。
- 次级 tab：Sources、Evidence & Matrix、Eval & Trace。
- **桌面原生特征**（避免"套壳网页"）：本地语料拖拽导入、后台 worker 任务队列、本地项目文件夹、外发片段审计视图。核心在 worker/utility 进程跑。

## 13. 技术选型

TS + Node；Vercel AI SDK（OpenAI-compatible LLM+embedding）；better-sqlite3 + FTS5 + sqlite-vec(锁版本) + RRF；unpdf(M4)；bibtex-parser、citation-js；Vitest；@modelcontextprotocol/sdk；Electron + React。
**Electron native 模块成本**：better-sqlite3 / sqlite-vec 需按 Electron ABI electron-rebuild，asar 需 unpack native——M3 预留工时。

## 14. 里程碑

> Electron 是确定交付物，建在核心之上。

- **M0 语料与契约门（新增，第一交付）**：冻结 demo 语料 + `gold_claims.jsonl`(≥20–30 标注) + 标注指南 + 各 source 的 `source_hash`；实现 `CitationResolver`（BibTeX key / author-year → `Source.id`）。**eval 与 check_claim 依赖此门。**
- **M1 headless 核验核心**：`ingest(text/BibTeX) → index → RRF hybrid retrieve → check_claim(单条,snippet-only,输出 cited_source_support + corpus_counterevidence) → eval(per-class P/R + 混淆矩阵, reporting gate) + TraceEvent JSONL`。脚本化检索 query（无 planner）。内部三段拆分 → writing-plans。
- **M2 MCP + planner + DX**：MCP server（读/写工具分类）；planner subagent + role traces/eval；DX(replay_trace、失败钻取)。
- **M3 Electron app**：Draft Citation Audit 主屏 + 原生特征 + tabs；核心进 worker；native 模块打包。
- **M4 补强**：PDF 解析(unpdf)、literature matrix 视图、pre-submit 简版报告、co-evolution 工件(`failure_cases.jsonl`、prompt/版本 ablation)、打磨。

## 15. 验收标准

**M0**：语料/gold/source_hash 冻结；`gold_claims.jsonl` 含 ≥20–30 标注 + 指南；`CitationResolver` 能解析 demo 全部引用。

**M1（技术）**
1. retrieval：产出 `recall@k`（k 在 M0 后标定并记入 `EvalRun`）；**M1 验收 = 指标被产出且可复现，不设 pass/fail 阈值门**（阈值仅供后续回归追踪，不作 M1 验收）。
2. `check_claim`：输出 `verdict + cited_source_support{locator(结构化), quote, reason, suggested_rewrite} + corpus_counterevidence`，全程 snippet-only。
3. eval：对冻结 seed 集输出**混淆矩阵 + per-class P/R + macro-F1 + unsupported/overclaim recall + 失败样例**（"能区分"不算验收，须有矩阵与召回数）。
4. trace：`TraceEvent` 能复现一次完整调用（含检索分数与外发片段）。

**产品（M3）**
5. Draft Citation Audit 主屏：粘贴草稿+引用 → 实时逐句诊断（非 gold 指标）。

## 16. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 范围过大 | M0+M1+M2(核心+MCP) 即完整可演示；Electron 增量 |
| eval 可信度 | seed 声明、人工 gold、禁同模型出题+判卷、per-class + 失败样例 |
| claim/citation 边界脆弱 | ClaimSpan/CitationMention(char span)/atomicity_rule + 人工修正 + 结构化 locator |
| "学生写作工具"观感 | 命名 Harness、主打核验/评测、默认输出证据非成文 |
| 隐私(片段外发) | per-run **network manifest** + provider 配置 + 可选**本地/离线 embedding**；trace 记 outbound_snippets |
| Electron native 打包 | electron-rebuild + asar unpack，M3 预留工时 |
| sqlite-vec pre-v1 | 锁版本+schema；向量层与检索接口解耦便于替换 |

## 17. JD 命中映射

Tool Use（§11）· Agent Loop（plan→retrieve→judge→report）· Planning（§7 planner，M2）· **MCP**（§11）· **Subagent/Multi-Agent**（§7，含 role traces/eval）· **Memory**（§8）· Context Engineering（§6 snippet-only + context pack）· **Skills**（`CitationAuditSkill`：核验能力封成可移植 prompt/tool policy，MCP 与 Electron 共用）· **Evaluation**（§9）· **Trace/DX**（§10 + replay/钻取）· **桌面端 Agent 产品**（§12 Electron + 原生特征，补 fit-matrix 头号 gap）· **Model+Harness 共同进化**（§14 M4：`failure_cases.jsonl`、prompt/版本 ablation、trace replay 作真实反馈工件）。

## 18. 非目标 / MVP 暂不做

完整 Zotero 双向同步、教师端、LMS、一键成文、AI 检测规避、伪造引用、复杂多 agent 编排框架、PDF 作首个必经输入。

## 19. 参考

- 愿景：[`assignment-aware-literature-review-agent.md`](../assignment-aware-literature-review-agent.md)
- JD：[`../../00_inputs/job-jd-verbatim.md`](../../00_inputs/job-jd-verbatim.md)
- 设计评审：Codex 三轮 + 确认（设计评审 → spec 评审(5 点) → v3 复查(2 blockers) → v3.1 确认 READY；详见 §0 处置）。"推迟 Electron"一处依 fit-matrix 头号 gap 被否决，Electron 保留为交付物。
