# SETUP — OpenAI Codex CLI、Google Gemini CLI、Cursor、GitHub Copilot

Claude Code 的安裝見 [README](./README.md#安裝)。以下平台以 `AGENTS.md` / `GEMINI.md` / 專案指令檔作為入口。

## OpenAI Codex CLI

```bash
npm install -g @openai/codex

# 專案層級（建議）
git clone https://github.com/GPUtw-ai/GPUtw-Skill.git .gputw-skill
# 或全域
git clone https://github.com/GPUtw-ai/GPUtw-Skill.git ~/.codex/gputw-skill
# 或 submodule
git submodule add https://github.com/GPUtw-ai/GPUtw-Skill.git .gputw-skill
```

在專案根目錄的 `AGENTS.md` 加入：

```markdown
## GPUtw Skill
遇到 GPUtw / gputw.ai / `/vault` / `gputw_live_` 相關需求時，讀取 `.gputw-skill/AGENTS.md`（入口）與 `.gputw-skill/SKILL.md`（完整知識庫）。
指南在 `.gputw-skill/guides/`，端點清單在 `.gputw-skill/references/endpoints.md`，官方文件 URL 在 `.gputw-skill/references/docs-site.md`。
```

Codex 也支援原生 skills 目錄：把整個資料夾放到 `.agents/skills/gputw/`（專案）或 `~/.agents/skills/gputw/`（使用者），即可用 `$gputw` 明確呼叫。

驗證：`codex "GPUtw API key 的前綴是什麼？"` → 回答 `gputw_live_`。

## Google Gemini CLI

```bash
npm install -g @google/gemini-cli
git clone https://github.com/GPUtw-ai/GPUtw-Skill.git .gputw-skill      # 或 ~/.gemini/gputw-skill
```

在專案 `GEMINI.md` 加入：

```markdown
## GPUtw Skill
遇到 GPUtw 相關需求時，讀取 `.gputw-skill/GEMINI.md`（入口）與 `.gputw-skill/SKILL.md`。
```

驗證：`gemini "GPUtw API key 的前綴是什麼？"` → `gputw_live_`。

## Cursor

```bash
git clone https://github.com/GPUtw-ai/GPUtw-Skill.git .gputw-skill
```

在專案 `AGENTS.md`（或 Cursor Rules）加入與 Codex 相同的指引區塊。Cursor 會自動讀取 `.gputw-skill/SKILL.md`；查官方頁面時使用 `@web`。

## GitHub Copilot（VS Code Copilot Chat / Copilot CLI / Visual Studio）

```bash
git clone https://github.com/GPUtw-ai/GPUtw-Skill.git .gputw-skill
```

建立專案根目錄的 `.github/copilot-instructions.md`：

```markdown
# GPUtw Skill — Copilot 自訂指令

本專案使用 GPUtw Skill 作為 GPUtw API 的整合知識庫（`.gputw-skill/`）。

## 使用方式
遇到 GPUtw / gputw.ai / `/vault` / `gputw_live_` 相關問題時：
1. 先讀 `.gputw-skill/SKILL.md`（決策樹、注意事項、快速參考）
2. 依決策樹讀對應的 `.gputw-skill/guides/NN-*.md`
3. 引用端點前查 `.gputw-skill/references/endpoints.md`；欄位細節用 #fetch 讀 `.gputw-skill/references/docs-site.md` 內的官方頁面
4. 可執行範例以 `.gputw-skill/scripts/gputw_client.py` 為基底

## 固定事實
- API base `https://api.gputw.ai/api`；金鑰 `Authorization: Bearer gputw_live_…`；每個請求帶 `User-Agent`
- 回應信封 `{ "success", "data", "error" }`
- 流程結尾必定 `POST /instances/stop` 或 `/delete`
```

## 版本固定

```bash
cd .gputw-skill && git tag -l && git checkout v1.0.0
```

## 其他框架

任何支援 [Agent Skills](https://agentskills.io) 格式（`SKILL.md` + `references/` + `scripts/`）的代理程式：把本資料夾放進其 skills 目錄即可。
