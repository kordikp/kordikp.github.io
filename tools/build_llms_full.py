#!/usr/bin/env python3
"""Build llms-full.txt: llms.txt followed by the eras, milestones, papers and theses from data/timeline.json.

    python3 -I tools/build_llms_full.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    d = json.loads((ROOT / "data/timeline.json").read_text(encoding="utf-8"))
    items = d["items"]
    themes = {t["id"]: t["short"] for t in d["themes"]}
    out = [(ROOT / "llms.txt").read_text(encoding="utf-8").rstrip(), ""]

    out += ["## Research themes", ""]
    out += [f"- {t['label']}: {t['text']}" for t in d["themes"]]
    out += ["", "## Eras", ""]
    out += [f"- {e['from']}–{e['to']}, {e['title']}: {e['text']}" for e in d["eras"]]

    out += ["", "## Milestones", ""]
    for m in sorted((x for x in items if x["type"] == "milestone"), key=lambda x: -x["y"]):
        out.append(f"- {m['y']} {m['title']}" + (f": {m['text']}" if m.get("text") else ""))

    papers = sorted((x for x in items if x["type"] == "paper"), key=lambda x: (-x["y"], x["title"]))
    out += ["", f"## Papers ({len(papers)}, since {min(p['y'] for p in papers)})", ""]
    for p in papers:
        link = f"https://doi.org/{p['doi']}" if p.get("doi") else p.get("url", "")
        line = f"- {p['y']}. {p['authors']}: {p['title']}. {p.get('venue', '')}".rstrip(". ") + "."
        tags = ", ".join(themes[t] for t in p.get("themes", []) if t in themes)
        out.append(line + (f" [{tags}]" if tags else "") + (f" {link}" if link else ""))

    theses = sorted((x for x in items if x["type"] == "thesis"), key=lambda x: (-x["y"], x["sub"], x["title"]))
    out += ["", f"## Theses supervised by Pavel Kordík ({len(theses)} defended)", ""]
    for t in theses:
        role = " (co-supervised)" if t.get("role") else ""
        out.append(f"- {t['y']} {t['sub']}{role}, {t['student']}: {t['title']}" + (f" {t['url']}" if t.get("url") else ""))

    (ROOT / "llms-full.txt").write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"llms-full.txt: {len(papers)} papers, {len(theses)} theses")


if __name__ == "__main__":
    main()
