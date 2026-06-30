# D-academic-agent

中文文档 | [English README](README.en.md)

D-academic-agent 是一个用于学术阅读和证据核验的桌面工作区。它帮助研究者、学生、审稿人和编辑回答一个很实际的问题：

**这句话或这条引用，真的符合论文原文吗？**

它是本地优先的工具。你可以先用内置示例语料试用，不需要 API key。只有在你主动连接在线提供方时，部分检索词或证据片段才可能离开本机。

## 下载

最新打包版本发布在 GitHub：

- [下载最新版](https://github.com/handong66/D-academic-agent/releases/latest)
- 自动化 release 会附带按版本命名的 macOS zip 文件：
  - `D-academic-agent-v<version>-mac-arm64.zip`：Apple Silicon Mac。
  - `D-academic-agent-v<version>-mac-x64.zip`：Intel Mac。
  - `D-academic-agent-v<version>-mac-universal.zip`：同时支持 Intel 和 Apple Silicon 的通用包。

较早的 release 可能只有部分附件。

目前 macOS 应用尚未 notarize。若系统提示来自未识别开发者，请右键点击应用，选择“打开”，再确认运行。Windows 和 Linux 用户目前请先从源码运行。

## 你可以用它做什么

- 检查带引用的草稿段落，看每个论断是被支持、弱支持、不支持、反驳，还是证据不明确。
- 单独核对一个研究论点，查看本地证据集合中的支持和反驳材料。
- 导入 PDF，建立本地文献库。
- 用“写作工作台”找出缺少引用、表述过强、证据不清楚的句子，并获得更稳妥表述。
- 从当前语料生成证据表，整理成类似文献矩阵的结构。
- 运行小型质量检查，了解当前检查设置的表现。
- 默认保持离线，也可以按需启用本地模型、Ollama（在本机运行语言模型的工具）、OpenAI 兼容 API、scite 或 Consensus。

D-academic-agent 不是代写论文工具。它是阅读、核对和改写前检查证据的工具。

## 界面截图

### 检查草稿

粘贴带引用的草稿。应用会对照可读取证据，显示证据原文、来源位置、可信度、理由和建议改写。

![检查草稿引用核验](docs/assets/readme/zh-CN/check-draft.png)

### 核对论点

输入一个研究论点。应用会搜索当前语料，把检索到的片段与论点逐条对比，并分开展示支持证据和反驳证据。

![核对论点证据地图](docs/assets/readme/zh-CN/check-claim.png)

### 写作工作台

修改段落前先粘贴到这里。写作工作台会标出需要引用、表述过强、或本地证据不清楚的论断，并在可用时给出更稳妥表述。

![写作工作台论断地图](docs/assets/readme/zh-CN/writing-desk.png)

### 检查范围

查看检查器当前能搜索哪些材料。它代表当前有效证据集合，不一定等于文献库里的全部论文。

![检查范围来源列表](docs/assets/readme/zh-CN/checking-scope.png)

### 我的文献

导入学术 PDF，管理本地来源，并准备检查器可以使用的材料。

![我的文献工作区](docs/assets/readme/zh-CN/my-library.png)

### 证据表

生成类似文献矩阵的表格，集中查看论断、证据原文、结果和来源位置。

![证据表矩阵](docs/assets/readme/zh-CN/evidence-table.png)

### 质量检查

运行内置小测试集，了解当前设置的行为。它是开发 sanity check，不是公开 benchmark 或排行榜分数。

![质量检查种子评测](docs/assets/readme/zh-CN/quality-check.png)

### 设置

选择离线、本地或远程检查方式；配置 PDF 读取；连接可选学术服务；切换语言和主题。

![设置提供方配置](docs/assets/readme/zh-CN/settings.png)

## 快速开始

从源码运行时，你需要先安装 Node.js 和 npm。

```sh
npm install
npm start
```

`npm start` 会构建桌面应用并打开 Reading Room。

使用内置示例语料和快速演示检查器不需要 API key。演示检查器适合试用界面，但不适合直接用于正式引用核验。正式审阅时，请在“设置”里切换到更强的本地检查器、Ollama 兼容本地模型或 OpenAI 兼容检查方式。

## 一个典型流程

1. 运行 `npm start` 打开 Reading Room。
2. 先使用内置示例语料，或在“我的文献”中导入自己的 PDF。
3. 在“设置”里选择证据检索和引用检查方式。
4. 在“检查草稿”或“写作工作台”中粘贴段落。
5. 先读证据原文和来源位置，再决定是否相信结果。
6. 当证据偏弱、存在反驳或不明确时，改写论断或更换引用。

## 如何理解结果

应用比较的是“论断”和“检索到的论文片段”。它不判断科学事实本身是否绝对成立。

- `supports`：片段直接支持该论断。
- `weakly supports`：片段方向一致，但表述应更谨慎。
- `unsupported`：片段不足以支持该论断。
- `contradicts`：片段与该论断相冲突。
- `unclear`：片段信息不足，无法给出有用判断。

请始终查看证据原文和位置。结果是阅读辅助，不是替代你判断的最终结论。

## 隐私与数据

基础使用可以留在本机：

- 内置示例语料不需要 API key。
- 导入的 PDF 和本地文献库 chunk 默认留在你的电脑上。
- 本地/离线检索和本地检查方式不会把草稿发送到远程 API。

在线功能需要你主动启用：

- OpenAI 兼容的 embedding 或 judge provider 可能接收检索文本或证据片段。
- scite 和 Consensus 检索会发送界面中显示的检索词。
- Consensus MCP 登录使用 OAuth；token 通过桌面应用的本地密钥存储路径保存。
- 已保存的 API key 和 token 在界面中只写入，不会回显。

## 选择检查方式

| 需求 | 推荐选择 | 说明 |
| --- | --- | --- |
| 快速试用 | 快速演示检查器 | 不需要 API key；不适合最终审阅。 |
| 尽量留在本机 | 本地支持度检查或 Ollama | Ollama 可以在本机运行语言模型；需要下载或配置本地模型。 |
| 使用远程模型 | OpenAI 兼容检查器 | 会按配置发送片段或检索文本到该 API。 |
| 检索学术服务 | scite 或 Consensus | 需要额外凭证。 |
| 读取 PDF | 内置 PDF 读取器 | 需要章节结构时可使用 GROBID。 |

## 它不做什么

D-academic-agent 不会：

- 代写论文；
- 帮你规避 AI 检测；
- 取代完整文献综述；
- 证明某个论断在现实世界中绝对为真；
- 与 Zotero 同步；
- 静默上传你的 PDF、草稿或本地文献库；
- 把内置质量检查包装成权威 benchmark。

## 高级用法：CLI

桌面端是主要使用入口。CLI 适合自动化或重复运行。

```sh
npm run harness -- eval --mock --out out/eval-mock
npm run harness -- plan --mock --q "social media and adolescent depression"
npm run harness -- mcp
```

使用 provider-backed CLI 时，通过环境变量配置：

```sh
AGENT_BASE_URL=https://...
AGENT_MODEL=...
AGENT_API_KEY=...
```

需要确定性离线行为时使用 `--mock`。

## 高级用法：MCP Server

启动 stdio MCP server：

```sh
npm run harness -- mcp
```

MCP 接口可以让其他 Agent 宿主搜索来源、打开全文、核对论断、提取引用、生成证据矩阵并运行小型评测。只读工具会把 trace 信息作为工具结果返回；写入工具会限制在项目本地输出路径。

## 开发命令

```sh
npm test
npm run typecheck
npm run lint
npm run build:app
npm run acceptance
npm run screenshots:readme
npm run package:mac:arm64
npm run package:mac:x64
npm run package:mac:universal
```

UI 改动后，用 `npm run screenshots:readme` 更新中英文 README 截图。
需要本地 macOS `.app` 目录包时，运行 `npm run package`。匹配 `v*.*.*` 的 tag 会通过 GitHub Actions
自动构建并上传 macOS `arm64`、`x64` 和 `universal` zip 附件。

Release tag 必须和 `package.json` 版本一致。例如 `package.json` 版本为 `0.1.1` 时，tag 应为 `v0.1.1`。
