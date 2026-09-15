# 貢獻指南

歡迎回報文件落差、端點變更與錯誤。本專案是**公開**的知識套件，請先閱讀下面兩條規則。

## 兩條硬規則

1. **只收錄公開內容。** 本 repo 的資料來源只有兩個：https://gputw.ai/docs 的公開頁面，以及 GPUtw 公開的 API 文件。請勿提交任何內部實作、基礎設施、原始碼路徑、環境變數名稱或非正式環境主機名。CI 的 `scripts/validate/check-public-only.sh` 會擋下這類內容。
2. **不要貼 API 金鑰。** issue、PR、log 貼上前請先把 `gputw_live_…` 遮掉。若不慎外洩，請立刻到控制台 → API 金鑰輪換或撤銷。

## 我想回報「文件跟實際行為不一樣」

開一個 issue（`API 規格有誤` 範本），附上：呼叫的方法 + 路徑、完整回應（含狀態碼，金鑰遮掉）、以及本 repo 哪一份檔案寫錯了。

## 我想新增／修改端點

1. 先改 `references/endpoints.md`——它是本 skill **唯一可引用的端點清單**，助理不得引用不在其中的路徑。
2. 再改對應的 `guides/NN-*.md`，並更新開頭的 `SNAPSHOT` 日期與來源 URL。
3. 若該頁面是新的官方文件，加進 `references/docs-site.md`（英文與繁中兩個 URL）。

## 我想改入口檔

`SKILL.md`、`AGENTS.md`、`GEMINI.md` 三者的「決策樹 / 關鍵規則 / 快速參考」必須同步；`AGENTS.md` 與 `GEMINI.md` 的共用區段必須逐字一致（CI 檢查）。

## 送 PR 前在本機跑一次

```bash
python3 scripts/validate/check-frontmatter.py
scripts/validate/check-links.sh
scripts/validate/check-version-sync.sh
scripts/validate/check-agents-parity.sh
scripts/validate/check-public-only.sh
python3 -m py_compile scripts/gputw_client.py
for f in scripts/examples/*.sh scripts/validate/*.sh; do bash -n "$f"; done
```

改到版本號時，`SKILL.md` 的 `metadata.version` 要與 `README.md`、`CHANGELOG.md`、`AGENTS.md`、`GEMINI.md` 一致。

## 風格

- 內容以繁體中文撰寫；API 欄位、端點、狀態值、scope 名稱與程式碼識別符保持原文。
- 每份 guide 開頭標 `SNAPSHOT <年-月> ｜ 來源：<公開 URL>`，結尾放「相關文件」。
- 範例程式碼一律帶 `User-Agent`、從環境變數讀金鑰、結尾關機。
