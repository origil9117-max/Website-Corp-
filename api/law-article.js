/**
 * 국가법령정보 Open API 프록시 — 법령 조문 원문 + 법령해석(expc) 검색
 * Vercel: 프로젝트 환경 변수 LAW_OC (또는 KOREAN_LAW_API_KEY) 설정 및
 * open.law.go.kr 에 서버 출구 IP 등록 필요.
 */
const BASE = "https://www.law.go.kr/DRF";

function arr(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function parseArticleQuery(q) {
  const s = String(q || "")
    .trim()
    .replace(/\s+/g, "");
  const m = s.match(/^(.+?)제(\d+)조(?:의(\d+))?$/);
  if (!m) return null;
  const lawName = m[1];
  const main = m[2];
  const branch = m[3] || null;
  const label = branch ? "제" + main + "조의" + branch : "제" + main + "조";
  return { lawName, main, branch, label };
}

function parseArticleParams(req) {
  const law = String(req.query.law || "").trim();
  const jo = String(req.query.jo || "").trim();
  const branch = String(req.query.branch || "").trim();
  if (law && /^\d+$/.test(jo)) {
    return {
      lawName: law,
      main: jo,
      branch: branch && /^\d+$/.test(branch) ? branch : null,
      label: branch && /^\d+$/.test(branch) ? "제" + jo + "조의" + branch : "제" + jo + "조",
    };
  }
  const q = req.query.q || req.query.query;
  return parseArticleQuery(q);
}

function getLawsFromSearch(json) {
  if (!json || typeof json !== "object") return [];
  const ls = json.LawSearch || json.lawSearch;
  if (ls && ls.law != null) return arr(ls.law);
  return [];
}

function scoreLawRow(row, target) {
  const t = String(target || "").trim();
  const names = [row.법령명한글, row.법령명, row.법령명_한글].filter(Boolean).map(String);
  let best = 0;
  for (const n of names) {
    if (n === t) return 100;
    if (n.startsWith(t) || t.startsWith(n)) best = Math.max(best, 90);
    else if (n.includes(t) || t.includes(n)) best = Math.max(best, 70);
  }
  return best;
}

function pickLawRow(laws, lawName) {
  if (!laws.length) return null;
  let best = laws[0];
  let sc = scoreLawRow(best, lawName);
  for (let i = 1; i < laws.length; i++) {
    const s = scoreLawRow(laws[i], lawName);
    if (s > sc) {
      sc = s;
      best = laws[i];
    }
  }
  return best;
}

function getMst(row) {
  if (!row) return null;
  return (
    row.법령일련번호 ||
    row.법령마스터번호 ||
    row.MST ||
    row.mst ||
    null
  );
}

function extractJoUnits(lawJson) {
  const root = lawJson && typeof lawJson === "object" ? lawJson : {};
  const law = root.법령 || root.Law || root;
  const jo = law && law.조문;
  if (!jo) return [];
  return arr(jo.조문단위);
}

function normalizeJoNum(s) {
  return String(s || "").replace(/\s/g, "");
}

function findJoUnit(units, main, branch) {
  const full = branch ? "제" + main + "조의" + branch : "제" + main + "조";
  const short = "제" + main + "조";
  for (const u of units) {
    const num = normalizeJoNum(u.조문번호);
    if (!num) continue;
    if (num === full) return u;
    if (!branch && num === short) return u;
  }
  for (const u of units) {
    const num = normalizeJoNum(u.조문번호);
    if (!num) continue;
    if (branch && num.indexOf("제" + main + "조의" + branch) !== -1) return u;
    if (!branch && num.indexOf(short) === 0 && num.indexOf("의") === -1) return u;
  }
  return null;
}

function lightSanitizeHtml(html) {
  return String(html || "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function getExpcList(json) {
  if (!json || typeof json !== "object") return [];
  const ls = json.LawSearch || json.lawSearch || json.ExpcSearch || json;
  if (ls && ls.law != null) return arr(ls.law);
  if (ls && ls.행정해석 != null) return arr(ls.행정해석);
  if (ls && ls.expc != null) return arr(ls.expc);
  return [];
}

function mapExpcRow(row) {
  const title =
    row.안건명 ||
    row.해석례명 ||
    row.제목 ||
    row.사건명 ||
    row.법령명 ||
    "";
  const dept = row.담당부서 || row.소관부처 || row.처리기관 || "";
  const date = row.회신일자 || row.공포일자 || row.신청일자 || "";
  const id = row.행정해석일련번호 || row.해석례일련번호 || row.ID || row.id || "";
  return { title: String(title), dept: String(dept), date: String(date), id: String(id) };
}

module.exports = async function lawArticleHandler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "METHOD", message: "GET only" });
  }

  const oc = process.env.LAW_OC || process.env.KOREAN_LAW_API_KEY || process.env.LAW_GO_KR_OC;
  if (!oc) {
    return res.status(503).json({
      ok: false,
      error: "NO_OC",
      message:
        "서버에 LAW_OC(또는 KOREAN_LAW_API_KEY)가 설정되지 않았습니다. Vercel 환경 변수에 공동활용 인증키를 넣고 배포하세요.",
    });
  }

  const parsed = parseArticleParams(req);
  if (!parsed) {
    return res.status(400).json({
      ok: false,
      error: "PARSE",
      message:
        "법령명+조문 형식이 아닙니다. 예: 민법제32조, 상법 제300조, 근로기준법제2조의1 또는 쿼리 law·jo·branch",
    });
  }

  const { lawName, main, branch, label } = parsed;

  try {
    const searchUrl =
      BASE +
      "/lawSearch.do?OC=" +
      encodeURIComponent(oc) +
      "&target=law&type=JSON&display=15&query=" +
      encodeURIComponent(lawName);

    const searchRes = await fetch(searchUrl);
    const searchText = await searchRes.text();
    let searchJson;
    try {
      searchJson = JSON.parse(searchText);
    } catch (e) {
      return res.status(502).json({
        ok: false,
        error: "SEARCH_PARSE",
        message: "법령 검색 응답이 JSON이 아닙니다.",
      });
    }

    const laws = getLawsFromSearch(searchJson);
    if (!laws.length) {
      const msg = searchJson.msg || searchJson.message || searchJson.MSG || "";
      if (msg) {
        return res.status(502).json({
          ok: false,
          error: "SEARCH_API",
          message: String(msg),
        });
      }
      return res.status(404).json({
        ok: false,
        error: "NO_LAW",
        message: "해당 키워드로 법령 검색 결과가 없습니다.",
        lawName,
        label,
      });
    }

    const row = pickLawRow(laws, lawName);
    const mst = getMst(row);
    if (!mst) {
      return res.status(404).json({
        ok: false,
        error: "NO_MST",
        message: "검색 결과에서 법령 일련번호를 찾지 못했습니다. 법령명을 정확히 입력해 보세요.",
        lawName,
        label,
      });
    }

    const lawNmDisplay =
      (row && (row.법령명한글 || row.법령명 || row.법령명_한글)) || lawName;

    const svcUrl =
      BASE +
      "/lawService.do?OC=" +
      encodeURIComponent(oc) +
      "&target=law&MST=" +
      encodeURIComponent(mst) +
      "&type=JSON";

    const svcRes = await fetch(svcUrl);
    const svcText = await svcRes.text();
    let svcJson;
    try {
      svcJson = JSON.parse(svcText);
    } catch (e) {
      return res.status(502).json({
        ok: false,
        error: "SERVICE_PARSE",
        message: "법령 본문 응답이 JSON이 아닙니다.",
      });
    }

    const units = extractJoUnits(svcJson);
    const unit = findJoUnit(units, main, branch);
    const basic =
      (svcJson.법령 && svcJson.법령.기본정보) ||
      (svcJson.Law && svcJson.Law.기본정보) ||
      {};

    let interpretations = [];
    try {
      const expq = lawName + " " + label;
      const expUrl =
        BASE +
        "/lawSearch.do?OC=" +
        encodeURIComponent(oc) +
        "&target=expc&type=JSON&display=8&query=" +
        encodeURIComponent(expq);
      const expRes = await fetch(expUrl);
      const expText = await expRes.text();
      const expJson = JSON.parse(expText);
      interpretations = getExpcList(expJson).slice(0, 8).map(mapExpcRow);
    } catch (e) {
      interpretations = [];
    }

    if (!unit) {
      return res.status(200).json({
        ok: true,
        partial: true,
        lawName: lawNmDisplay,
        label,
        mst: String(mst),
        articleTitle: "",
        articleHtml: "",
        message: "법령은 찾았으나 해당 조문번호 단위를 응답에서 찾지 못했습니다. 국가법령정보센터에서 연혁·조문 구조를 확인해 주세요.",
        시행일자: basic.시행일자 || "",
        공포일자: basic.공포일자 || "",
        interpretations,
      });
    }

    const articleTitle = unit.조문제목 ? String(unit.조문제목) : "";
    const rawHtml = unit.조문내용 != null ? String(unit.조문내용) : "";
    const articleHtml = lightSanitizeHtml(rawHtml);

    return res.status(200).json({
      ok: true,
      lawName: lawNmDisplay,
      label,
      mst: String(mst),
      articleTitle,
      articleHtml,
      조문번호: unit.조문번호 ? String(unit.조문번호) : label,
      시행일자: basic.시행일자 || unit.조문시행일자 || "",
      공포일자: basic.공포일자 || "",
      interpretations,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "INTERNAL",
      message: err && err.message ? String(err.message) : "서버 오류",
    });
  }
};
