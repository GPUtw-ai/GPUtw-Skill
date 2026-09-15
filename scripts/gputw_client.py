#!/usr/bin/env python3
"""Minimal, dependency-free GPUtw API client (stdlib only).

Read it as a reference implementation of the public API contract, or run it:

  export GPUTW_API_KEY=gputw_live_...
  python3 gputw_client.py catalog
  python3 gputw_client.py nodes --gpu "RTX 4090"
  python3 gputw_client.py deploy --gpu "RTX 4090" --template "PyTorch" --wait
  python3 gputw_client.py status <instance-id>
  python3 gputw_client.py resources <instance-id>
  python3 gputw_client.py exec <instance-id> -- nvidia-smi --query-gpu=utilization.gpu --format=csv
  python3 gputw_client.py logs <instance-id> --previous
  python3 gputw_client.py stop <instance-id>
  python3 gputw_client.py delete <instance-id>
  python3 gputw_client.py upload ./model.safetensors --dest models/model.safetensors
  python3 gputw_client.py download hf:Comfy-Org/z_image:split_files/vae/z_image_vae.safetensors --dest models/vae
  python3 gputw_client.py ls models

Environment: GPUTW_API_KEY (required), GPUTW_API (default https://api.gputw.ai/api),
             GPUTW_TRANSFER (default: probe https://upload.gputw.ai, fall back to GPUTW_API).
Source: https://gputw.ai/zh-TW/docs (2026-09). Every request sets a User-Agent — required behind Cloudflare.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

USER_AGENT = "gputw-skill-client/1.0"
DEFAULT_API = "https://api.gputw.ai/api"
DEFAULT_TRANSFER = "https://upload.gputw.ai"
TERMINAL = {"FAILED", "INSUFFICIENT_FUNDS", "STOPPED", "TERMINATED"}


class GputwError(RuntimeError):
    def __init__(self, status: int, message: str, enveloped: bool = True):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.message = message
        # False when the response was not the GPUtw JSON envelope, i.e. the request never
        # reached the API (typically Cloudflare blocking a client signature with 403/1010).
        self.enveloped = enveloped


class Client:
    def __init__(self, key: str | None = None, api: str | None = None):
        self.key = key or os.environ.get("GPUTW_API_KEY")
        self.api = (api or os.environ.get("GPUTW_API") or DEFAULT_API).rstrip("/")
        self._transfer: str | None = os.environ.get("GPUTW_TRANSFER")

    # ---- transport -------------------------------------------------------
    def request(self, method: str, path: str, body=None, raw: bytes | None = None,
                content_type: str | None = None, base: str | None = None,
                timeout: int = 60, auth: bool = True):
        url = f"{base or self.api}{path}"
        data = raw
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        if auth:
            if not self.key:
                raise SystemExit("GPUTW_API_KEY is not set")
            headers["Authorization"] = f"Bearer {self.key}"
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        elif content_type:
            headers["Content-Type"] = content_type
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                text = resp.read().decode()
                status = resp.status
        except urllib.error.HTTPError as e:
            text, status = e.read().decode(errors="replace"), e.code
        try:
            env = json.loads(text)
        except ValueError:
            # Not the GPUtw envelope: the request never reached the API (e.g. Cloudflare 1010).
            raise GputwError(status, text[:300], enveloped=False)
        if status >= 400 or not env.get("success", False):
            raise GputwError(status, env.get("error") or text[:300])
        return env["data"]

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self.request("POST", path, body=body, **kw)

    @property
    def transfer(self) -> str:
        """Transfer host for bulk vault I/O: probe upload.<domain>/health, else fall back to the API host."""
        if self._transfer is None:
            try:
                req = urllib.request.Request(f"{DEFAULT_TRANSFER}/health", headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=5) as r:
                    self._transfer = f"{DEFAULT_TRANSFER}/api" if r.status == 200 else self.api
            except Exception:
                self._transfer = self.api
        return self._transfer.rstrip("/")

    # ---- catalog / capacity ---------------------------------------------
    def catalog(self):
        return self.get("/gpus/active", auth=False)

    def templates(self):
        return self.get("/templates", auth=False)

    def find_catalog(self, name_substr: str):
        hits = [g for g in self.catalog() if name_substr.lower() in g["name"].lower()]
        if not hits:
            raise SystemExit(f"no GPU matching {name_substr!r}; run `catalog`")
        return hits[0]

    def available_nodes(self, catalog_id: str):
        return self.get(f"/nodes/available?catalogId={urllib.parse.quote(catalog_id)}")

    def find_template(self, name_substr: str, arch: str | None = None):
        for t in self.templates():
            if name_substr.lower() in t["name"].lower() and (arch is None or arch in t.get("architectures", [])):
                return t
        raise SystemExit(f"no template matching {name_substr!r} for arch {arch}; run `templates`")

    # ---- instances --------------------------------------------------------
    def create_instance(self, node_id: str, template_id: str | None = None, ports=None,
                        bandwidth: int | None = None, custom_image: dict | None = None):
        body = {"nodeId": node_id}
        if template_id:
            body["templateId"] = template_id
        if custom_image:
            body["customImage"] = custom_image
        if ports:
            body["ports"] = ports
        if bandwidth:
            body["bandwidthMbps"] = bandwidth
        return self.post("/instances/create", body)

    def status(self, iid):
        return self.get(f"/instances/{iid}/status")

    def wait_running(self, iid, timeout=1200, every=5, log=print):
        t0 = time.time()
        last = None
        while True:
            st = self.status(iid)
            sig = (st["status"], st.get("deployPhase"), st.get("waitingReason"))
            if sig != last and log:
                log(f"  {st['status']}  phase={st.get('deployPhase')}  pod={st.get('podPhase')}  {st.get('waitingReason') or ''}")
                last = sig
            if st["status"] == "RUNNING":
                return st
            if st["status"] in TERMINAL:
                raise RuntimeError(f"instance {iid} ended in {st['status']} ({st.get('failureReason')})")
            if time.time() - t0 > timeout:
                raise TimeoutError(f"instance {iid} not RUNNING after {timeout}s: {st}")
            time.sleep(every)

    def resources(self, iid):
        return self.get(f"/instances/{iid}/resources")

    def logs(self, iid, tail=200, previous=False):
        q = f"?tail={tail}" + ("&previous=1" if previous else "")
        return self.get(f"/instances/{iid}/logs{q}")

    def events(self, iid, limit=20):
        return self.get(f"/instances/{iid}/events?limit={limit}")

    def exec(self, iid, argv: list[str], timeout_ms=30000):
        # argv is passed through verbatim - there is no shell. Use ["sh","-c","..."] for pipes/globs.
        return self.post(f"/instances/{iid}/exec", {"command": argv, "timeoutMs": timeout_ms},
                         timeout=timeout_ms // 1000 + 30)

    def stop(self, iid):
        return self.post("/instances/stop", {"instanceId": iid})

    def delete(self, iid):
        return self.post("/instances/delete", {"instanceId": iid})

    # ---- vault ------------------------------------------------------------
    def vault_list(self, path=""):
        return self.get(f"/vault/list?path={urllib.parse.quote(path)}")

    def upload_file(self, local: str, dest: str, parallel: int = 4, log=print):
        """Chunked, resumable upload via the transfer host. Server-chosen chunk size is authoritative."""
        size = os.path.getsize(local)
        h = hashlib.sha256()
        with open(local, "rb") as f:
            for blk in iter(lambda: f.read(1 << 20), b""):
                h.update(blk)
        base = self.transfer
        s = self.request("POST", "/vault/uploads", {"path": dest, "size": size, "sha256": h.hexdigest()}, base=base)
        uid, chunk, parts = s["uploadId"], s["chunkSize"], s["partCount"]
        done = set(self.request("GET", f"/vault/uploads/{uid}", base=base)["receivedParts"])
        log(f"upload {uid}: {parts} parts x {chunk} bytes via {base} ({len(done)} already received)")

        def put(n):
            with open(local, "rb") as f:
                f.seek(n * chunk)
                data = f.read(chunk)
            self.request("PUT", f"/vault/uploads/{uid}/parts/{n}", raw=data,
                         content_type="application/octet-stream", base=base, timeout=600)
            log(f"  part {n + 1}/{parts}")

        with ThreadPoolExecutor(max_workers=parallel) as ex:
            list(ex.map(put, [n for n in range(parts) if n not in done]))
        self.request("POST", f"/vault/uploads/{uid}/complete", base=base)
        while True:
            st = self.request("GET", f"/vault/uploads/{uid}", base=base)
            if st["status"] == "completed":
                return st
            if st["status"] in ("failed", "aborted"):
                raise RuntimeError(f"upload {uid} {st['status']}: {st.get('error')}")
            time.sleep(2)

    def download_model(self, source: str, dest: str, hf_token: str | None = None, log=print):
        """Server-side fetch (URL / HF) straight into /vault. API host only - not the transfer host."""
        body = {"source": source, "targetPath": dest}
        if hf_token:
            body["hfToken"] = hf_token
        d = self.post("/vault/downloads", body)
        did = d["id"]
        while True:
            d = self.get(f"/vault/downloads/{did}")
            total = d.get("totalBytes")
            log(f"  {d['status']}  {d.get('bytesDownloaded', 0)}/{total if total else '?'} bytes")
            if d["status"] == "completed":
                return d
            if d["status"] in ("failed", "canceled"):
                raise RuntimeError(f"download {did} {d['status']}: {d.get('error')}")
            time.sleep(3)


# ---- CLI -------------------------------------------------------------------
def _pp(x):
    print(json.dumps(x, ensure_ascii=False, indent=2))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("catalog")
    sub.add_parser("templates")
    a = sub.add_parser("nodes"); a.add_argument("--gpu", required=True)
    a = sub.add_parser("deploy")
    a.add_argument("--gpu", required=True, help="substring of a catalog name, e.g. 'RTX 4090'")
    a.add_argument("--template", default="PyTorch", help="substring of a template name")
    a.add_argument("--ports", default="8080", help="comma-separated HTTP ports")
    a.add_argument("--bandwidth", type=int)
    a.add_argument("--wait", action="store_true")
    for name in ("status", "resources", "events", "stop", "delete"):
        sub.add_parser(name).add_argument("id")
    a = sub.add_parser("logs"); a.add_argument("id"); a.add_argument("--tail", type=int, default=200); a.add_argument("--previous", action="store_true")
    a = sub.add_parser("exec"); a.add_argument("id"); a.add_argument("--timeout-ms", type=int, default=30000); a.add_argument("argv", nargs=argparse.REMAINDER)
    a = sub.add_parser("upload"); a.add_argument("local"); a.add_argument("--dest", required=True); a.add_argument("--parallel", type=int, default=4)
    a = sub.add_parser("download"); a.add_argument("source"); a.add_argument("--dest", required=True); a.add_argument("--hf-token", default=os.environ.get("HF_TOKEN"))
    a = sub.add_parser("ls"); a.add_argument("path", nargs="?", default="")
    args = p.parse_args(argv)
    c = Client()

    try:
        if args.cmd == "catalog":
            for g in c.catalog():
                print(f"{g['name']:<28} {g['vramGb']:>4} GB  ${g['hourlyPrice']:<6}/hr  live={g.get('liveRentablePrice')}  {g.get('demandStatus')}  {g['id']}")
        elif args.cmd == "templates":
            for t in c.templates():
                print(f"{t['name']:<36} {t['dockerImage']:<34} {','.join(t.get('architectures', []))}  webui={t.get('webUiEnabled')}  {t['id']}")
        elif args.cmd == "nodes":
            g = c.find_catalog(args.gpu)
            for n in c.available_nodes(g["id"]):
                print(f"{n['id']}  {n.get('hostname')}  {n.get('arch')}  gpus={n.get('availableGpus')}/{n.get('totalGpus')}  ${n.get('hourlyRate')}/hr  queue={n.get('queueDepth')}")
        elif args.cmd == "deploy":
            g = c.find_catalog(args.gpu)
            nodes = [n for n in c.available_nodes(g["id"]) if (n.get("availableGpus") or 0) > 0]
            if not nodes:
                raise SystemExit(f"no free machine for {g['name']} right now (demandStatus={g.get('demandStatus')})")
            node = nodes[0]
            t = c.find_template(args.template, arch=node.get("arch"))
            ports = [int(x) for x in args.ports.split(",") if x]
            inst = c.create_instance(node["id"], template_id=t["id"], ports=ports, bandwidth=args.bandwidth)
            print(f"created {inst['id']} on {node.get('hostname')} with {t['name']} @ ${inst.get('hourlyRate')}/hr")
            if args.wait:
                c.wait_running(inst["id"])
                print(f"RUNNING: ssh pod-{inst['id']}@ssh.gputw.ai -p 2222")
            else:
                print(f"poll: python3 {sys.argv[0]} status {inst['id']}")
        elif args.cmd == "status":
            _pp(c.status(args.id))
        elif args.cmd == "resources":
            _pp(c.resources(args.id))
        elif args.cmd == "events":
            _pp(c.events(args.id))
        elif args.cmd == "logs":
            print(c.logs(args.id, args.tail, args.previous).get("log") or "(no log)")
        elif args.cmd == "exec":
            argv_ = args.argv[1:] if args.argv[:1] == ["--"] else args.argv
            r = c.exec(args.id, argv_, args.timeout_ms)
            sys.stdout.write(r["stdout"]); sys.stderr.write(r["stderr"])
            sys.exit(r["exitCode"])
        elif args.cmd == "stop":
            _pp(c.stop(args.id))
        elif args.cmd == "delete":
            _pp(c.delete(args.id))
        elif args.cmd == "upload":
            _pp(c.upload_file(args.local, args.dest, args.parallel))
        elif args.cmd == "download":
            _pp(c.download_model(args.source, args.dest, args.hf_token))
        elif args.cmd == "ls":
            for f in c.vault_list(args.path)["files"]:
                print(f"{f['type']:<9} {str(f.get('size') or ''):>14}  {f['name']}")
    except GputwError as e:
        print(f"error: {e}", file=sys.stderr)
        msg = e.message or ""
        if not e.enveloped:
            print("hint: the response was not the GPUtw envelope, so the request never reached the API. "
                  "Check GPUTW_API (should be https://api.gputw.ai/api) and the User-Agent header - "
                  "Cloudflare blocks some client signatures with 403 / error code 1010.", file=sys.stderr)
        elif "missing required scope" in msg:
            print("hint: update the key's scopes in Dashboard -> API Keys, or issue a new key", file=sys.stderr)
        elif "not available to API keys" in msg:
            print("hint: this route is browser-session only - do it in the dashboard", file=sys.stderr)
        elif e.status == 402:
            print("hint: top up in the dashboard - deploying needs one hour of credit for every running instance",
                  file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
