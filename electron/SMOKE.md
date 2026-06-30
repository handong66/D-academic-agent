# D-academic-agent Reading Room Manual Smoke

Use this checklist when validating the Electron adapter manually. The automated counterpart is:

```sh
npm run acceptance
```

## Run

```sh
npm install
npm start
```

Expected: the Electron app opens without credentials and shows the D-academic-agent Reading Room workspace. Offline paths use the
seed corpus in `fixtures/corpus/`.

## Check Draft

Paste this draft into **Check Draft**:

```text
Social media use is associated with adolescent depression (Twenge, 2018). Sleep is unrelated here (Orben, 2019).
```

Expected:

- Sentence-level diagnosis appears after the debounce interval.
- The result shows 2 sentences.
- The Twenge citation resolves and displays a verdict, quote, locator, suggested rewrite, and confidence.
- Unresolved or ambiguous citations render as muted badges.
- Gold/eval metrics do not appear in this workflow.

## Check Claim

Open **Check Claim** and submit:

```text
Social media use causes adolescent depression.
```

Expected:

- The app decomposes or retrieves evidence from the local corpus.
- The report separates supporting and contradicting evidence.
- The consensus verdict is framed as local-library evidence, not global truth.

## Writing Desk

Open **Writing Desk** and paste a short paragraph with one causal claim and one uncited claim.

Expected:

- Claims are split and typed.
- Missing-citation, unsupported, or overclaimed states are visible when triggered.
- Safer wording appears for risky claims.
- If external research is disabled, external-evidence controls show a disabled or not-connected state rather than
  making a network call.

## Checking Scope

Open **Checking Scope**.

Expected:

- The source table lists the currently loaded checking corpus.
- Each row includes source identity, title, year, and type where available.

## My Library

Open **My Library**.

Expected:

- The imported-paper table loads, even when it is empty.
- PDF import controls are present.
- External search and reference-health actions clearly require connected providers when credentials are absent.

## Evidence Table

Open **Evidence Table** and build a matrix.

Expected:

- The matrix renders rows for the toy sources.
- Rows include source identity, claim/title, verdict/status, quote, and locator where available.

## Quality Check

Open **Quality Check** and run the seed eval.

Expected:

- Macro-F1, per-class metrics, seed confusion matrix, trace counts, and failure cases appear here.
- Seed metrics are presented as reporting-only, not an authoritative benchmark.

## Settings

Open **Settings**.

Expected:

- Language can switch between English and Chinese.
- Embedder, judge, PDF, corpus/library path, and external research settings are visible.
- scite client credentials, Consensus REST API key, and Consensus MCP OAuth controls store secrets by key
  reference; raw secrets are not displayed after save.
