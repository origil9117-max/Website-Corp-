import concurrent.futures
import html
import json
import re
import time
from pathlib import Path

import requests


DATA_PATH = Path("data/ksic11-codes.json")
DETAIL_URL = "https://kssc.mods.go.kr:8443/ksscNew_web/kssc/common/ClassificationContentMainTreeListView.do"
MAX_WORKERS = 6
REQUEST_TIMEOUT = 20


def clean_html_to_text(raw: str) -> str:
    if not raw:
        return ""
    # Preserve pseudo labels before generic tag stripping.
    text = raw
    text = re.sub(r"<\s*예\s*시\s*>", "\n[[EXAMPLE_LABEL]]\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<\s*제\s*외\s*>", "\n[[EXCLUDE_LABEL]]\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<\s*참\s*고\s*>", "\n[[NOTE_LABEL]]\n", text, flags=re.IGNORECASE)
    text = re.sub(r"(?i)<br\\s*/?>", "\n", text)
    text = re.sub(r"(?is)<!--.*?-->", "", text)
    text = re.sub(r"(?is)<script.*?>.*?</script>", "", text)
    text = re.sub(r"(?is)<style.*?>.*?</style>", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\s*-->\s*", "", text)
    text = re.sub(r"\n?·", "\n·", text)

    # Remove duplicated blocks that sometimes appear in source markup.
    parts = [p.strip() for p in text.split("\n\n") if p.strip()]
    dedup_parts = []
    seen = set()
    for p in parts:
        if p in seen:
            continue
        seen.add(p)
        dedup_parts.append(p)
    text = "\n\n".join(dedup_parts)
    text = text.replace("[[EXAMPLE_LABEL]]", "<예시>")
    text = text.replace("[[EXCLUDE_LABEL]]", "<제외>")
    text = text.replace("[[NOTE_LABEL]]", "<참고>")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_detail_field(html_text: str, label: str) -> str:
    pattern = (
        rf"<th[^>]*>\s*{label}\s*</th>\s*<td[^>]*>(.*?)</td>"
    )
    m = re.search(pattern, html_text, re.IGNORECASE | re.DOTALL)
    return clean_html_to_text(m.group(1)) if m else ""


def fetch_one(code: str, session: requests.Session):
    payload = {
        "strCategoryNameCode": "001",
        "strCategoryCode": code,
        "strCategoryDegree": "11",
        "pageIndex": "1",
        "categoryMenu": "",
    }
    last_exc = None
    html_text = ""
    for _ in range(3):
        try:
            r = session.post(
                DETAIL_URL,
                data=payload,
                timeout=REQUEST_TIMEOUT,
                verify=False,
            )
            r.raise_for_status()
            html_text = r.content.decode("utf-8", errors="ignore")
            break
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            time.sleep(0.35)
    if not html_text:
        raise RuntimeError(f"fetch failed for {code}: {last_exc}")
    description = extract_detail_field(html_text, "설명")
    index_terms = extract_detail_field(html_text, "색인어")
    return code, description, index_terms


def main():
    requests.packages.urllib3.disable_warnings()  # type: ignore[attr-defined]
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    items = data.get("items", [])
    by_code = {str(x.get("code", "")).strip(): x for x in items}
    codes = [c for c in by_code.keys() if c]

    updates = 0
    enriched = 0
    failures = []

    session = requests.Session()
    start = time.time()

    def task(code: str):
        try:
            return fetch_one(code, session)
        except Exception as exc:  # noqa: BLE001
            return code, "", f"ERROR: {exc}"

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = [ex.submit(task, code) for code in codes]
        for idx, fut in enumerate(concurrent.futures.as_completed(futures), start=1):
            code, desc, index_terms = fut.result()
            row = by_code.get(code)
            if not row:
                continue
            if index_terms.startswith("ERROR:"):
                failures.append((code, index_terms))
                continue

            prev_desc = str(row.get("description", "")).strip()
            if desc and desc != prev_desc:
                row["description"] = desc
                updates += 1
                if prev_desc in ("", row.get("name", "")):
                    enriched += 1

            if idx % 200 == 0:
                print(f"[progress] {idx}/{len(codes)} processed")

    data["items"] = [by_code[str(x.get("code", "")).strip()] for x in items if str(x.get("code", "")).strip() in by_code]
    DATA_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    elapsed = round(time.time() - start, 1)
    print(f"[done] processed={len(codes)} updated={updates} enriched={enriched} failed={len(failures)} elapsed_s={elapsed}")
    if failures:
        print("[failures sample]")
        for code, err in failures[:20]:
            print(code, err)


if __name__ == "__main__":
    main()
