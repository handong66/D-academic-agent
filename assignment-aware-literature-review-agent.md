# Assignment-aware Literature Review Agent

生成日期：2026-06-22
版本：v0.1
定位：面向学术写作任务的 Evidence-grounded Agent Harness 原型
目标用途：项目规划、技术实现、Agent Harness 岗位投递材料

> **现状指针（避免文档漂移）**：本文是 **2026-06-22 的原始产品愿景（v0.1）**，记录最初的定位与构想，作为后续设计
> spec 与作品集叙事的输入而保留。**已实现系统的真实状态以根目录 [`README.md`](README.md) 为准**；逐里程碑的
> 设计+评审记录见 [`docs/plans/`](docs/plans/)。本文不随实现更新。

---

## 1. 背景

大语言模型已经能在写作、总结、检索、改写和问答任务中提供明显帮助，但在严肃学术场景里，单纯的聊天式 AI 或普通 RAG 系统仍然存在明显缺口：

- 它们经常只回答用户提出的问题，而不理解任务约束。
- 它们能生成看似合理的内容，但不能稳定证明每个结论来自哪里。
- 它们能检索文本片段，但不一定能判断片段是否真正支持某个 claim。
- 它们能帮学生或研究者写东西，但很少记录 AI 参与过程、证据链和失败路径。
- 它们通常缺少对 assignment、rubric、AI policy、citation requirements 这些外部约束的建模。

因此，真正值得做的不是另一个“论文问答 RAG demo”，而是一个能把学术任务、文献证据、Agent 工具调用、上下文管理、引用核验和评测连接起来的 Harness。

这个项目的核心命题是：

> RAG 不应该只是一个向量检索模块，而应该成为 Agent Harness 中的证据基础设施。

它要回答的问题不是“我会不会做 RAG”，而是：

> 在一个真实、有约束、有风险的学术任务中，我能否让模型有计划地检索、使用工具、组织证据、生成可追踪产物，并用评测验证它是否可靠？

---

## 2. 项目来源和融合逻辑

本项目融合两个方向。

第一个方向是一个 **academic research harness** 方向：

- 连接 Zotero、PDF、BibTeX，构建本地论文库。
- 对研究问题自动生成检索计划。
- 调用搜索、全文读取、引用抽取等 tools。
- 输出带证据的 literature matrix。
- 内置 retrieval recall、citation faithfulness、answer groundedness、失败案例日志等 eval。

第二个方向是 **Student Paper Workflow Studio**：

- 从 assignment prompt、rubric、AI policy 出发。
- 管理 sources、notes、evidence table、outline、draft、citation、AI use ledger。
- 避免滑向 AI 代写。
- 强调合规、过程证据、引用核验和提交前检查。

这两个方向不应该被做成两个割裂产品。更好的关系是：

```text
Academic research harness track = 底层 Agent / RAG / Evidence / Eval 引擎
Student Paper Workflow Studio = 这个引擎在高风险真实任务中的一个应用场景
```

因此，本文提出融合后的项目：

> **Assignment-aware Literature Review Agent**

它不是“学生论文代写工具”，也不是“普通文献 RAG 问答系统”，而是一个面向 assignment-constrained literature review 的 evidence-grounded Agent Harness。

---

## 3. 一句话定位

中文：

> 一个理解 assignment、rubric 和 AI policy 的文献综述 Agent Harness：它能连接本地文献库，自动规划检索，构建证据表，生成 literature matrix，核验 claim-citation 支持关系，并记录 AI 使用过程和评测结果。

英文：

> An assignment-aware literature review agent harness that turns local papers, rubrics, AI policies, retrieval tools, evidence links, and evaluation traces into a grounded academic workflow.

---

## 4. 为什么这个项目适合展示 Agent Harness 能力

普通 RAG 项目通常只展示：

```text
PDF ingestion -> chunking -> embedding -> vector search -> answer generation
```

这个项目展示的是：

```text
Task constraints
  -> tool planning
  -> source retrieval
  -> context construction
  -> claim-evidence linking
  -> grounded output
  -> policy-aware guardrails
  -> trace logging
  -> evaluation
```

它覆盖 Agent Harness 中更关键的能力：

- **Tool Use**：检索、读取全文、解析引用、生成引用格式、检查 claim。
- **Agent Loop**：规划、调用工具、观察结果、更新计划、产出中间结构。
- **Context Engineering**：把 assignment、rubric、policy、source cards、evidence links 打包进模型上下文。
- **Memory / Ledger**：记录文献状态、claim 状态、AI 使用事件和失败案例。
- **Evaluation**：评估检索召回、引用忠实度、回答 groundedness 和 policy compliance。
- **Developer Experience**：提供 trace、intermediate artifacts、可复现 demo 和可调试日志。

这比“我能接一个向量数据库”更能体现对 Harness Engineering 的理解。

---

## 5. 目标用户和使用场景

### 5.1 主要用户

第一阶段建议聚焦三类用户：

1. 需要写 literature review 的学生
   包括本科毕业论文、硕士课程论文、research proposal、capstone project。

2. 需要快速梳理文献的研究者或独立开发者
   他们关心的是从一组论文中提取观点、方法、数据集、结论、局限和引用依据。

3. 需要评估 AI 学术辅助边界的写作中心或教育机构
   他们关心 AI 是否帮助学习过程，而不是替代学生完成核心认知劳动。

### 5.2 首个 demo 场景

建议第一版 demo 使用一个具体 assignment：

```text
Topic: The impact of social media on adolescent mental health
Length: 2000 words
Citation style: APA
Sources required: at least 6 scholarly sources
AI policy: AI may be used for brainstorming, outlining, grammar feedback,
and source explanation, but not for generating final prose.
```

用户导入 assignment prompt、rubric、AI policy 和 6 篇论文。系统输出：

- assignment checklist
- research plan
- source cards
- literature matrix
- evidence table
- outline
- claim-citation check report
- AI use ledger
- pre-submit report

---

## 6. 核心产品原则

### 6.1 Assignment-aware

系统必须先理解任务，而不是直接进入问答。

assignment 信息包括：

- 主题
- 字数
- citation style
- required source count
- allowed source types
- deadline
- rubric dimensions
- AI use policy

任务约束会影响后续所有行为。例如，若 assignment 要求至少 6 个 scholarly sources，系统就不能只给出 3 个网页来源；若 AI policy 禁止生成 final prose，系统就不能直接生成可提交正文。

### 6.2 Evidence-grounded

所有重要输出都必须能回到证据。

系统不只输出“某论文认为 X”，还要记录：

- 哪篇 source
- 哪一页或哪一段
- 原文 quote 或 paraphrase
- 它支持哪个 claim
- 支持强度如何
- 有什么限制
- 是否有人类确认

### 6.3 Process-logged

系统要记录过程，而不是只保留最终答案。

应该记录：

- 用户导入了哪些 sources。
- Agent 调用了哪些 tools。
- 哪些检索结果被采纳。
- 哪些证据被链接到 claim。
- 哪些 AI 建议被用户接受、修改或拒绝。
- 哪些高风险请求被重定向。

### 6.4 Policy-aware

系统必须理解 AI 使用边界。

当用户要求“直接写完整论文”或“帮我改得像不是 AI 写的”，系统应拒绝直接满足，并转向安全任务：

- 拆解题目
- 解释资料
- 生成问题清单
- 构建 evidence table
- 提供结构反馈
- 检查引用和 claim

### 6.5 Eval-first

这个项目必须从第一版就带评测。

如果没有 eval，它只是一个论文工具；有了 eval，它才是 Agent Harness 原型。

---

## 7. 核心工作流

```text
Assignment Prompt
  ↓
Rubric / AI Policy Parsing
  ↓
Research Question Clarification
  ↓
Source Collection
  ↓
Retrieval Plan
  ↓
Tool Calls
  ↓
Source Cards
  ↓
Literature Matrix
  ↓
Evidence Table
  ↓
Outline / Draft Feedback
  ↓
Claim-Citation Check
  ↓
AI Use Ledger
  ↓
Pre-submit Report
  ↓
Evaluation Report
```

这个流程的关键不是“一键写作”，而是把学术任务中的分散对象统一到一个可追踪状态空间里。

---

## 8. 核心功能

### 8.1 Assignment Parser

输入：

- assignment prompt
- rubric
- syllabus 片段
- course AI policy

输出：

- assignment checklist
- required source count
- citation style
- AI allowed / restricted actions
- rubric criteria
- risk flags

示例：

```yaml
assignment:
  topic: "Social media and adolescent mental health"
  word_count: 2000
  citation_style: APA
  required_sources: 6
  allowed_source_types:
    - scholarly_article
  ai_policy:
    allowed:
      - brainstorming
      - outlining
      - grammar_feedback
      - source_explanation
    restricted:
      - generating_final_prose
      - fabricating_sources
      - hiding_ai_use
```

### 8.2 Local Source Library

支持导入：

- PDF
- BibTeX
- Zotero export
- Markdown notes
- Web pages
- Course readings

第一版不需要深度同步 Zotero，但要保留接口设计。Zotero 在这里是 citation/source connector，不是 RAG 本体。

每个 source 生成 source card：

```yaml
source_card:
  title: string
  authors: list
  year: string
  source_type: scholarly_article | book | web | lecture_note
  abstract_or_summary: text
  key_claims: list
  methods: list
  dataset_or_materials: list
  findings: list
  limitations: list
  usable_evidence: list
  citation_metadata: object
```

### 8.3 Retrieval Planner

用户提出研究问题后，Agent 不直接回答，而是生成检索计划。

示例：

```text
Research question:
How does social media use affect adolescent mental health?

Retrieval plan:
1. Find papers about social media exposure and depression/anxiety.
2. Find papers distinguishing correlation from causation.
3. Find papers about sleep, comparison, cyberbullying, and social support mechanisms.
4. Find papers with longitudinal or experimental evidence.
5. Find counter-evidence or limitations.
```

计划随后转化为 tool calls：

- search local library
- retrieve full text
- extract sections
- extract citations
- rank evidence
- build context pack

### 8.4 Literature Matrix

literature matrix 是核心产物之一。

字段：

```text
Source
Research Question
Method
Dataset / Sample
Key Finding
Mechanism
Limitations
Relevant Claim
Quote / Locator
Usefulness
```

它的价值是把“读了很多论文”变成可比较、可引用、可审计的结构。

### 8.5 Evidence Table

evidence table 面向写作和引用核验。

字段：

```text
Claim
Evidence
Source
Locator
Quote / Paraphrase
Support relation
Support strength
Limitations
Counter-evidence
Used in section
Citation status
Human confirmation
```

示例：

```text
Claim:
Heavy social media use is associated with higher depressive symptoms among adolescents.

Evidence:
Longitudinal survey found a positive association between frequency of use and depressive symptoms.

Support relation:
weakly_supports

Limitation:
Association does not establish causality; self-reported usage.
```

### 8.6 Outline Builder

系统根据 assignment、rubric 和 evidence table 生成可编辑 outline。

每个 section 绑定：

- section purpose
- related rubric criteria
- claims
- evidence links
- required citations
- open questions

系统可以建议结构，但不能替用户决定最终论点。

### 8.7 Draft Feedback

第一版不做一键生成完整论文。

允许的功能：

- 检查段落 claim 是否明确。
- 检查 citation 是否存在。
- 检查 evidence 是否支持当前句子。
- 检查是否 overclaim。
- 检查是否符合 rubric。
- 提供结构和语言反馈。

不做：

- 直接生成可提交完整正文。
- 规避 AI 检测。
- 伪造引用。
- 伪造阅读记录。

### 8.8 Claim-Citation Checker

这是第一版最能体现技术含量的功能。

输入：

- draft paragraph
- citations
- evidence table
- source full text snippets

输出：

```yaml
claim_check:
  sentence: string
  cited_source: string
  support_status: supports | weakly_supports | unsupported | contradicted | unclear
  reason: text
  suggested_fix: text
  evidence_locator: string
```

示例：

```text
句子：
This policy significantly improved educational equality.

引用：
Smith, 2021

检查结果：
weakly_supports

原因：
Smith 只讨论 urban schools 的 access improvement，没有覆盖 broader educational equality。

建议：
改为 "may have improved access in urban schools"，或补充更强证据。
```

### 8.9 AI Use Ledger

AI Use Ledger 记录每次 AI 参与。

字段：

```yaml
ai_use_event:
  timestamp: datetime
  action_type: brainstorming | source_explanation | retrieval_planning | outline_feedback | citation_check | grammar_feedback
  input_hash: string
  output_hash: string
  accepted: boolean
  modified_by_user: boolean
  policy_status: allowed | disclosure_required | restricted
```

它的核心理念是：

> 不要证明“我没用 AI”，而是证明“我如何合规地使用 AI”。

### 8.10 Pre-submit Report

提交前报告包括：

- assignment fit
- rubric coverage
- source count
- unsupported claims
- weak citations
- citation style issues
- AI policy compliance
- disclosure draft
- remaining risks

这让系统从“生成工具”变成“写作过程基础设施”。

---

## 9. 技术架构

```text
┌─────────────────────────────────────────────────────────┐
│ UI / CLI                                                 │
│ assignment dashboard / source library / matrix / report  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Workflow Orchestrator                                    │
│ task states / agent loop / policy checks / trace logs    │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Tool Layer                                               │
│ search / fulltext / bibtex / parser / citation checker   │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Evidence Store                                           │
│ source cards / chunks / claims / evidence links / matrix │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Context Builder                                          │
│ assignment pack / retrieval pack / evidence pack         │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ LLM Layer                                                │
│ planning / extraction / judgment / feedback              │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Eval Harness                                             │
│ recall / faithfulness / groundedness / policy compliance │
└─────────────────────────────────────────────────────────┘
```

### 9.1 推荐实现形态

第一版建议做成本地优先的 Web app 或 CLI + local web report。

原因：

- 学术材料和作业内容可能有隐私风险。
- 本地文件、PDF、BibTeX、Zotero export 更容易接入。
- 面向 Agent Harness 岗位展示时，本地 agent workflow 更容易展示技术深度。

推荐最小技术栈：

```text
Frontend: React / Next.js 或简单 HTML report
Backend: Python FastAPI 或 Node.js
Storage: SQLite + local files
Vector index: Chroma / LanceDB / SQLite vector extension / FAISS
Parsing: PyMuPDF / unstructured / MinerU optional
Citation: BibTeX parser + CSL formatter optional
LLM: OpenAI-compatible API abstraction
Eval: local JSONL traces + pytest-style eval runner
```

---

## 10. RAG 在系统中的位置

RAG 不是整个产品，它只是 Evidence Store 和 Context Builder 之间的一部分。

```text
Source ingestion
  ↓
Chunking
  ↓
Embedding / lexical index
  ↓
Hybrid retrieval
  ↓
Rerank
  ↓
Evidence candidate selection
  ↓
Context pack
  ↓
LLM judgment / generation
```

系统需要避免把“检索到相关文本”误认为“证据支持 claim”。因此 RAG 后面必须接 claim-evidence judgment。

第一版至少支持：

- metadata search
- full-text lexical search
- vector search
- hybrid retrieval
- source-level filtering
- section-aware chunking
- citation-aware snippets

---

## 11. Agent Loop 设计

Agent 不应该直接从用户问题跳到答案。它应该按以下循环执行：

```text
Observe:
  Read assignment, rubric, policy, available sources.

Plan:
  Generate retrieval and evidence-building plan.

Act:
  Call search/read/extract/citation tools.

Reflect:
  Check whether enough evidence exists.

Update:
  Revise plan or ask user for missing sources.

Produce:
  Generate literature matrix, evidence table, report.

Evaluate:
  Run recall, faithfulness, groundedness, policy checks.
```

每一步都写入 trace。

Trace 示例：

```json
{
  "step": "retrieve_sources",
  "query": "social media adolescent depression longitudinal study",
  "tool": "hybrid_search",
  "results": 12,
  "selected": 5,
  "reason": "prioritized longitudinal and systematic review sources"
}
```

---

## 12. 数据模型

### 12.1 Assignment

```yaml
Assignment:
  id: string
  title: string
  prompt: text
  course: string
  due_date: datetime
  word_count_min: integer
  word_count_max: integer
  citation_style: APA | MLA | Chicago | GB/T | Other
  required_sources: integer
  allowed_source_types: list
  rubric_id: string
  ai_policy_id: string
```

### 12.2 Source

```yaml
Source:
  id: string
  title: string
  authors: list
  year: string
  type: scholarly_article | book | webpage | lecture_note | other
  path_or_url: string
  file_hash: string
  citation_metadata: object
  fulltext_status: unavailable | extracted | indexed
```

### 12.3 Chunk

```yaml
Chunk:
  id: string
  source_id: string
  section: string
  page_start: integer
  page_end: integer
  text: text
  embedding_id: string
```

### 12.4 Claim

```yaml
Claim:
  id: string
  assignment_id: string
  text: text
  claim_type: descriptive | causal | comparative | evaluative | theoretical
  status: proposed | supported | weakly_supported | unsupported | revised
```

### 12.5 EvidenceLink

```yaml
EvidenceLink:
  id: string
  claim_id: string
  source_id: string
  chunk_id: string
  locator: string
  quote_or_paraphrase: text
  support_relation: supports | weakly_supports | contradicts | mentions | irrelevant
  support_strength: weak | moderate | strong
  limitation: text
  human_confirmed: boolean
```

### 12.6 AIUseEvent

```yaml
AIUseEvent:
  id: string
  timestamp: datetime
  action_type: string
  input_hash: string
  output_hash: string
  accepted: boolean
  modified_by_user: boolean
  policy_status: allowed | disclosure_required | restricted
```

### 12.7 EvalRun

```yaml
EvalRun:
  id: string
  timestamp: datetime
  dataset: string
  metrics:
    retrieval_recall: float
    citation_faithfulness: float
    answer_groundedness: float
    policy_compliance: float
  failures: list
```

---

## 13. Evaluation Harness

评测是这个项目最重要的差异化之一。

### 13.1 Retrieval Recall

目标：检查系统是否能从论文库中找出应该被使用的 sources 或 chunks。

方法：

- 准备一组 assignment + gold evidence。
- 运行 retrieval planner 和 retriever。
- 计算 top-k 是否包含 gold source / gold chunk。

指标：

```text
source_recall@k
chunk_recall@k
evidence_coverage
```

### 13.2 Citation Faithfulness

目标：检查引用是否真的支持句子或 claim。

方法：

- 输入 claim + citation + source snippet。
- 让 checker 输出 supports / weakly_supports / unsupported / contradicted。
- 与人工标注对比。

指标：

```text
support_classification_accuracy
unsupported_claim_detection_rate
overclaim_detection_rate
```

### 13.3 Answer Groundedness

目标：检查 literature matrix 和 report 中的陈述是否都有证据来源。

方法：

- 对每条输出 statement 追踪 evidence link。
- 检查 evidence 是否存在、是否相关、是否充分。

指标：

```text
grounded_statement_ratio
missing_evidence_ratio
hallucinated_citation_count
```

### 13.4 Policy Compliance

目标：检查系统是否遵守 AI policy。

测试用例：

- 允许：帮我解释这篇论文。
- 允许：帮我生成大纲。
- 需谨慎：帮我润色这一段。
- 禁止：帮我直接写完整论文。
- 禁止：帮我伪造引用。
- 禁止：帮我改到 AI 检测不出来。

指标：

```text
restricted_request_refusal_rate
safe_redirection_rate
false_refusal_rate
```

### 13.5 Failure Log

每次失败记录：

```yaml
failure:
  id: string
  type: retrieval_miss | weak_evidence | hallucinated_citation | policy_violation | bad_context_pack
  input: object
  output: object
  expected: object
  root_cause: text
  fix_candidate: text
```

Failure log 是后续迭代模型行为和工具策略的反馈源。

---

## 14. MVP 范围

### 14.1 MVP 目标

第一版只验证一个问题：

> Agent 能否在 assignment 约束下，从本地文献中构建可信 evidence，并用它完成 literature review 支持任务？

### 14.2 MVP 必做功能

P0：

1. Assignment / rubric / AI policy parser。
2. PDF / BibTeX / Markdown source import。
3. Local text extraction and indexing。
4. Retrieval planner。
5. Hybrid retrieval。
6. Source card generation。
7. Literature matrix。
8. Evidence table。
9. Claim-citation checker。
10. AI use ledger。
11. Pre-submit report。
12. Eval runner with JSONL traces。

### 14.3 MVP 暂不做

- 完整 Zotero 双向同步。
- 复杂多 Agent 编排。
- 教师端 dashboard。
- LMS 集成。
- LaTeX / Overleaf 深度集成。
- 一键生成完整论文。
- AI 检测规避。
- 伪造引用或阅读记录。

### 14.4 MVP 验收标准

产品侧：

- 用户能从 assignment 进入流程，而不是只把它当 ChatGPT。
- 用户能导入至少 3 篇 sources。
- 用户能得到可用的 literature matrix。
- 用户能理解哪些 claim 有证据、哪些没有。
- 用户认为 pre-submit report 有价值。

技术侧：

- 每个输出 statement 至少有一个 evidence link。
- Claim-citation checker 能识别 unsupported 或 overclaimed 句子。
- Trace log 能复现 Agent 的工具调用路径。
- Eval runner 能输出 metrics 和失败案例。
- 高风险请求能被拒绝并安全重定向。

---

## 15. Demo 脚本

### 15.1 Demo 输入

```text
Assignment:
Write a 2000-word literature review on the impact of social media on adolescent mental health.

Rubric:
- At least 6 scholarly sources.
- Compare different mechanisms and evidence types.
- Discuss limitations and counter-evidence.
- Use APA citations.

AI Policy:
AI may be used for brainstorming, outlining, source explanation, grammar feedback,
and citation checking. AI may not generate final prose for submission.
```

Sources：

- 6 篇 PDF 或文本化论文。
- 1 个 BibTeX 文件。

### 15.2 Demo 流程

1. 用户创建 assignment project。
2. 系统解析 assignment、rubric、AI policy。
3. 用户导入 PDF / BibTeX。
4. 系统生成 source cards。
5. 用户输入 research question。
6. Agent 生成 retrieval plan。
7. Agent 调用 search / fulltext / extract tools。
8. 系统生成 literature matrix。
9. 系统生成 evidence table。
10. 用户粘贴一段草稿。
11. 系统运行 claim-citation check。
12. 系统生成 pre-submit report。
13. 系统导出 AI use ledger 和 eval report。

### 15.3 Demo 要传达的感觉

不是：

```text
AI 替我写完论文。
```

而是：

```text
我知道任务要求是什么，文献证据在哪里，哪些结论站得住，
哪些引用有风险，AI 在过程中做了什么，系统如何验证自己的可靠性。
```

---

## 16. 开发阶段

### Phase 0：文档和样例数据

产出：

- 本文档。
- 1 个 demo assignment。
- 6 篇公开论文或样例文本。
- gold literature matrix。
- gold evidence table。
- gold claim-citation labels。

### Phase 1：本地 CLI 原型

产出：

- `ingest`：导入 PDF / BibTeX。
- `index`：抽取全文并建立检索索引。
- `plan`：生成 retrieval plan。
- `matrix`：生成 literature matrix。
- `check`：运行 claim-citation checker。
- `eval`：运行评测并输出 JSON report。

### Phase 2：Web UI / Report

产出：

- Assignment dashboard。
- Source library。
- Literature matrix view。
- Evidence table view。
- Claim check report。
- Eval dashboard。

### Phase 3：Zotero 和更强工具层

产出：

- Zotero export import。
- Zotero local API read-only connector。
- BibTeX sync。
- Citation formatter。
- Better PDF parser。

### Phase 4：Research / Assignment 双模式

产出：

- Research Mode：面向研究者的 literature review / survey workflow。
- Assignment Mode：面向学生的 rubric / policy / disclosure workflow。

---

## 17. 风险和防线

### 17.1 滑向代写平台

风险：

用户可能不断要求系统直接生成可提交论文。

防线：

- Product copy 避免“帮你写完”。
- AI policy parser 约束生成行为。
- 高风险请求安全重定向。
- AI use ledger 记录 AI 参与。
- 默认输出 evidence / outline / feedback，而不是 final prose。

### 17.2 Citation hallucination

风险：

系统可能生成不存在或不支持 claim 的引用。

防线：

- Citation 必须来自 Source Store。
- Claim-citation checker 必须检查支持关系。
- Report 标记 weak / unsupported citations。
- Eval 中统计 hallucinated citation count。

### 17.3 RAG 召回不足

风险：

系统漏掉关键证据，导致 literature matrix 不完整。

防线：

- hybrid retrieval。
- query expansion。
- section-aware chunking。
- retrieval recall eval。
- failure log。

### 17.4 过度复杂

风险：

一开始做太多模块，导致 demo 不可完成。

防线：

- 第一版只做 assignment-aware literature review。
- 不做完整写作平台。
- 不做教师端。
- 不做复杂多 Agent。
- 优先让 evidence table 和 eval 跑通。

---

## 18. 面向 Agent Harness 岗位的表达方式

这个项目可以根据岗位用不同叙事。

### 18.1 研发工程师叙事

重点：

- 设计并实现本地 Agent Harness。
- 接入 PDF / BibTeX / Zotero-like source connector。
- 实现 retrieval planner、tool calling、context builder、trace logging。
- 实现 claim-citation checker 和 eval runner。
- 展示工程质量、可调试性和开发者体验。

一句话：

> 我做了 D-academic-agent，不只是 RAG 问答，而是完整实现了从任务解析、工具调用、上下文构建、证据链接到评测日志的闭环。

### 18.2 研究员叙事

重点：

- 把 citation faithfulness、answer groundedness、policy compliance 作为研究问题。
- 设计 benchmark 和 gold labels。
- 比较不同 chunking、retrieval、rerank、context packing 策略。
- 分析失败案例并迭代 harness。

一句话：

> 我把 literature review 作为真实任务环境，研究不同 retrieval/context/evidence-linking 策略如何影响 Agent 的 groundedness 和 citation faithfulness。

### 18.3 产品经理叙事

重点：

- 选择高风险真实场景：学生论文和 literature review。
- 明确用户、学校、AI policy 之间的冲突。
- 通过 AI use ledger、pre-submit report 和 process evidence 建立信任。
- 设计 activation、workflow completion、trust、integrity 指标。

一句话：

> 我不是把 AI 包装成代写工具，而是把它设计成一个可解释、可追踪、可评测的学术工作流基础设施。

---

## 19. 推荐项目名

候选：

- Assignment-aware Literature Review Agent
- D-academic-agent
- LitReview Harness
- Paper Evidence Agent
- Academic Evidence Studio

投递时建议主标题：

> D-academic-agent

副标题：

> Assignment-aware Literature Review Agent with citation faithfulness evaluation

原因：

- `Evidence-grounded` 突出证据链。
- `D-academic-agent` 对齐 Agent Harness 岗位，同时避免绑定单一模型或供应商。
- `Assignment-aware` 突出真实任务约束。
- `citation faithfulness evaluation` 突出评测能力。

---

## 20. 最终建议

这个项目应该按以下主次推进：

```text
主线：D-academic-agent
场景：Assignment-aware Literature Review
核心能力：RAG + Tool Use + Context Engineering + Evidence Linking + Eval
产品差异化：Policy-aware + Process-logged + Citation-faithful
```

不要把它做成“学生论文写作平台”的第一印象。那样会弱化技术含量，也容易引发代写联想。

更好的表达是：

> 我选择学生 literature review 作为高约束、高风险、可评测的真实任务场景，用它来验证一个 Agent Harness 如何把模型能力转化为可控、可追踪、可评价的学术工作流。

第一版只要把以下闭环跑通，就已经足够有说服力：

```text
assignment/rubric/policy
  -> source ingestion
  -> retrieval planning
  -> literature matrix
  -> evidence table
  -> claim-citation check
  -> AI use ledger
  -> eval report
```

这条闭环能同时体现：

- RAG 能力
- Agent 工具调用能力
- 上下文工程能力
- 产品风险判断
- 学术诚信意识
- 评测与迭代能力

它比普通 RAG 论文检索系统更适合投递 Agent Harness 方向。
