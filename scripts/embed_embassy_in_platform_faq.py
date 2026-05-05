# -*- coding: utf-8 -*-
"""Inline embassy-groups JSON into platform-faq.html (UTF-8 base64 + TextDecoder)."""
import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    groups_path = ROOT / "data" / "embassy-groups.json"
    groups = json.loads(groups_path.read_text(encoding="utf-8"))
    raw = json.dumps(groups, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    b64 = base64.b64encode(raw).decode("ascii")

    inline = (
        "<script>\n"
        "(function(){try{\n"
        "var _b64=" + json.dumps(b64) + ";\n"
        "var _bin=atob(_b64);\n"
        "var _u8=new Uint8Array(_bin.length);\n"
        "for(var _i=0;_i<_bin.length;_i++){_u8[_i]=_bin.charCodeAt(_i);}\n"
        'window.EMBASSY_GROUPS=JSON.parse(new TextDecoder("utf-8").decode(_u8));\n'
        "}catch(_e){window.EMBASSY_GROUPS=[];console.error(_e);}\n"
        "})();\n"
        "</script>"
    )

    faq_path = ROOT / "platform-faq.html"
    text = faq_path.read_text(encoding="utf-8")
    pattern = r'<script\s+src="data/embassy-data\.js\?v=[^"]*"\s*>\s*</script>'
    if not re.search(pattern, text):
        raise SystemExit("platform-faq.html: embassy-data.js script tag not found; check path")
    text = re.sub(pattern, inline, text, count=1)
    faq_path.write_text(text, encoding="utf-8")
    meta = {"groups": len(groups), "missions": sum(len(g["missions"]) for g in groups), "b64_chars": len(b64)}
    print(json.dumps(meta, ensure_ascii=False))


if __name__ == "__main__":
    main()
