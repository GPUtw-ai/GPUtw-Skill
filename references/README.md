# references/ — 即時規格入口

`guides/` 告訴 AI **怎麼整合**；`references/` 給 AI **現在的規格在哪裡**。生成程式碼或回答欄位細節前，先查這裡。

| 檔案 | 內容 | 何時讀 |
|---|---|---|
| [`endpoints.md`](./endpoints.md) | 使用者 API 的完整端點總表：方法、路徑、所需 scope、對應指南、傳輸主機標記、僅限瀏覽器的路由 | 任何時候要引用端點路徑或判斷「這個能不能用 API 金鑰做」 |
| [`docs-site.md`](./docs-site.md) | gputw.ai 官方文件 19 個頁面（英文 + 繁中）與可公開呼叫的 URL | 回答參數、限制、費用、最新行為前 web_fetch |

## 規則

1. `endpoints.md` 之外的路徑不得憑記憶補上。找不到 → 告知開發者「此 skill 未收錄」並附上 https://gputw.ai/zh-TW/docs 或支援管道。
2. `guides/` 表格皆為 **SNAPSHOT 2026-09**；與官方頁面衝突時以官方頁面為準，並提醒開發者。
3. 生成的程式碼加註來源，例如：`# Source: https://gputw.ai/en/docs/rest-api-quickstart (2026-09)`。
