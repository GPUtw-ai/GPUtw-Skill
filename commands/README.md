# commands/ — Claude Code 斜線指令（選用）

把這些檔案複製到 `.claude/commands/`（專案）或 `~/.claude/commands/`（全域）後，即可用 `/gputw-deploy` 等指令直接進入對應流程。不複製也可以——Skill 本身會依關鍵字自動啟動。

```bash
cp ~/.claude/skills/gputw/commands/gputw-*.md ~/.claude/commands/
```

| 指令 | 用途 |
|---|---|
| `/gputw-deploy` | 選 GPU、選機器、選範本或自訂映像、部署並等到 `RUNNING` |
| `/gputw-monitor` | 讀用量、事件、日誌、執行指令、閒置自動關機 |
| `/gputw-vault` | 上傳（分段 / 傳輸主機）、URL / Hugging Face 下載、列表、ComfyUI 模型擺放 |
| `/gputw-debug` | 401 / 403 / 402 / 409 / 429 / Cloudflare 403、部署卡住、crash loop |
