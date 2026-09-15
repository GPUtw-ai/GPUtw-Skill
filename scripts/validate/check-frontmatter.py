#!/usr/bin/env python3
"""Validate SKILL.md frontmatter against the Agent Skills spec (portable subset)."""
import re, sys, pathlib

ALLOWED = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
REQUIRED = {"name", "description"}
p = pathlib.Path(__file__).resolve().parents[2] / "SKILL.md"
text = p.read_text(encoding="utf-8")
m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
if not m:
    sys.exit("FAIL: SKILL.md has no YAML frontmatter")
block = m.group(1)
keys = [re.match(r"^([A-Za-z][\w-]*):", ln).group(1)
        for ln in block.splitlines() if re.match(r"^([A-Za-z][\w-]*):", ln)]
errs = []
missing = REQUIRED - set(keys)
if missing:
    errs.append(f"missing required key(s): {sorted(missing)}")
extra = set(keys) - ALLOWED
if extra:
    errs.append(f"non-portable top-level key(s) {sorted(extra)} - move them under metadata:")
name = re.search(r"^name:\s*(\S+)", block, re.M)
if name:
    n = name.group(1)
    if not re.fullmatch(r"[a-z0-9-]{1,64}", n):
        errs.append(f"name {n!r} must be <=64 chars of lowercase letters, digits and hyphens")
    if "anthropic" in n or "claude" in n:
        errs.append(f"name {n!r} must not contain reserved words")
desc = re.search(r"^description:\s*(?:>|\|)?\s*\n((?:[ \t]+.*\n)+)|^description:\s*(.+)$", block, re.M)
body = (desc.group(1) or desc.group(2)) if desc else ""
if len(body.strip()) == 0:
    errs.append("description is empty")
if len(body) > 1024:
    errs.append(f"description is {len(body)} chars (max 1024)")
if "<" in body and ">" in body:
    errs.append("description must not contain XML tags")
lines = text.splitlines()
if len(lines) > 500:
    errs.append(f"SKILL.md body is {len(lines)} lines (guidance: keep under 500)")
print("\n".join(f"FAIL: {e}" for e in errs) if errs else f"OK: frontmatter valid, SKILL.md {len(lines)} lines")
sys.exit(1 if errs else 0)
