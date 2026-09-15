# Node.js / TypeScript 規範（GPUtw API）

## 版本與依賴
- Node 18+（內建 `fetch`）。`axios` 亦可。兩者預設 UA 皆不受 Cloudflare 阻擋，但仍建議明確設定 `User-Agent`。
- 大檔上傳：以 `fs.createReadStream(path, { start, end })` 逐段串流，`Content-Type: application/octet-stream`。

## 客戶端骨架
```ts
const API = process.env.GPUTW_API ?? "https://api.gputw.ai/api";
const KEY = process.env.GPUTW_API_KEY!;

type Envelope<T> = { success: boolean; data: T; error: string | null };

export class GputwError extends Error { constructor(public status: number, msg: string) { super(`${status}: ${msg}`); } }

export async function call<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init, method,
    headers: { Authorization: `Bearer ${KEY}`, "User-Agent": "my-automation/1.0",
               ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    body: body !== undefined ? JSON.stringify(body) : init.body,
  });
  let env: Envelope<T>;
  try { env = await res.json(); } catch { throw new GputwError(res.status, (await res.text()).slice(0, 200)); }
  if (!res.ok || !env.success) throw new GputwError(res.status, env.error ?? "unknown");
  return env.data;
}
```

## 型別
```ts
export type InstanceStatus = "DEPLOYING" | "RUNNING" | "STOPPED" | "FAILED" | "TERMINATED" | "INSUFFICIENT_FUNDS";
export type DeployPhase = "SCHEDULING" | "PULLING_IMAGE" | "STARTING" | "RUNNING";
export interface Usage { cpuPct: number | null; ramPct: number | null; gpuPct: number | null; vramPct: number | null;
                         source: "prometheus" | "fallback" | "none"; sampledAt: string | null; }
```
指標是 `number | null`——**`null` 不是 0**，先看 `source`。

## 輪詢與關機
```ts
export async function waitRunning(id: string, timeoutMs = 20 * 60_000) {
  const t0 = Date.now();
  for (;;) {
    const st = await call<{ status: InstanceStatus; failureReason: string | null }>("GET", `/instances/${id}/status`);
    if (st.status === "RUNNING") return st;
    if (["FAILED", "INSUFFICIENT_FUNDS", "STOPPED", "TERMINATED"].includes(st.status)) throw new Error(`${st.status} ${st.failureReason ?? ""}`);
    if (Date.now() - t0 > timeoutMs) throw new Error("timeout");
    await new Promise(r => setTimeout(r, 5000));
  }
}
// 一定要在 finally 裡 stop：
// try { await waitRunning(id); … } finally { await call("POST", "/instances/stop", { instanceId: id }); }
```

## 錯誤處理
`401`/`403` 不重試；`429` 依 `RateLimit-Reset` 退避；`5xx` 指數退避 ≤ 3 次；`402` 直接提示儲值。

## 安全
金鑰只從環境變數讀；不要 `console.log` headers；`exec` 輸出視為敏感資料。
