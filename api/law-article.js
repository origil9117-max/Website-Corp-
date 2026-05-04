/**
 * 국가법령정보 Open API 프록시 — 법령 조문 원문 + 법령해석(expc) 검색
 * Vercel: 프로젝트 환경 변수 LAW_OC (또는 KOREAN_LAW_API_KEY) 설정 및
 * open.law.go.kr 에 서버 출구 IP 등록 필요.
 *
 * Node fetch()는 일부 클라우드에서 IPv6 경로로 law.go.kr 연결이 실패하는 경우가 있어
 * IPv4 전용 https 요청을 사용합니다.
 *
 * 공동활용에 등록한 "도메인주소"와 동일한 출처를 알리기 위해 Referer·Origin을 보냅니다.
 * 사이트가 www를 쓰면 Vercel 환경 변수 LAW_API_SITE_URL=https://www.daehanminkuk.co.kr 로 맞추세요.
 *
 * Vercel에서 서버리스 실행 리전이 바뀌면 출구 IP가 달라질 수 있어, read ECONNRESET 이 나면
 * /api/egress-ip 로 확인한 뒤 open.law.go.kr 공동활용 ‘API 허용 IP’를 갱신하세요.
 */
const https = require("https");
const dns = require("dns");
const { URL } = require("url");

const BASE = "https://www.law.go.kr/DRF";

function normalizeOrigin(s) {
  return String(s || "")
    .trim()
    .replace(/\/+$/, "");
}

/** Vercel 기본 플레이스홀더·로컬 등은 법제처 검증에 쓰이면 안 됩니다. */
function isPlausibleLawSiteUrl(s) {
  var t = normalizeOrigin(s);
  if (!t) return false;
  if (!/^https:\/\//i.test(t)) return false;
  if (/example\.com|api\.example|localhost|127\.0\.0\.1|placeholder|mydomain\.com/i.test(t)) return false;
  return true;
}

function toggleWwwOrigin(t) {
  var n = normalizeOrigin(t);
  if (/\/\/www\./i.test(n)) return n.replace(/^(https?:\/\/)www\./i, "$1");
  return n.replace(/^(https:\/\/)([^/]+)$/i, "$1www.$2");
}

/**
 * 공동활용에 적은 도메인과 맞출 때까지 순서대로 시도합니다.
 * (환경 변수가 플레이스홀더면 무시하고 daehanminkuk.co.kr / www 변형을 시도)
 */
function getSiteOriginCandidates() {
  var out = [];
  function add(x) {
    var n = normalizeOrigin(x);
    if (!isPlausibleLawSiteUrl(n)) return;
    if (out.indexOf(n) === -1) out.push(n);
  }
  var env = String(process.env.LAW_API_SITE_URL || process.env.LAW_REGISTERED_SITE_URL || "").trim();
  if (env) {
    add(env);
    add(toggleWwwOrigin(env));
  }
  add("https://daehanminkuk.co.kr");
  add("https://www.daehanminkuk.co.kr");
  /* 일부 환경에서 등록 도메인 외에 포털 자체 Referer로만 통과하는 사례가 있어 마지막 후보로 시도 */
  add("https://www.law.go.kr");
  return out;
}

function siteHeadersForOrigin(originBase) {
  var base = normalizeOrigin(originBase || "https://daehanminkuk.co.kr");
  return {
    Referer: base + "/",
    Origin: base,
  };
}

/**
 * @param {string} urlStr
 * @param {string} [siteOriginBase] https://host 형태(끝 슬래시 없음)
 * @returns {Promise<string>}
 */
function httpsGetTextOnce(urlStr, siteOriginBase) {
  const u = new URL(urlStr);
  const site = siteHeadersForOrigin(siteOriginBase);
  return new Promise(function (resolve, reject) {
    dns.lookup(u.hostname, { family: 4, all: false }, function (lookupErr, address) {
      if (lookupErr) return reject(lookupErr);
      const opts = {
        host: address,
        port: 443,
        servername: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        headers: Object.assign(
          {
            Host: u.hostname,
            Connection: "close",
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          },
          site
        ),
        rejectUnauthorized: true,
      };
      const req = https.request(opts, function (res) {
        var body = "";
        res.setEncoding("utf8");
        res.on("data", function (chunk) {
          body += chunk;
        });
        res.on("end", function () {
          if (res.statusCode && res.statusCode >= 400) {
            var e = new Error("HTTP " + res.statusCode);
            e.statusCode = res.statusCode;
            e.body = body.slice(0, 500);
            return reject(e);
          }
          resolve(body);
        });
      });
      req.on("error", reject);
      req.setTimeout(25000, function () {
        req.destroy();
        reject(new Error("요청 시간 초과(25s)"));
      });
      req.end();
    });
  });
}

function httpsGetTextRetriable(err) {
  var msg = err && err.message ? String(err.message) : "";
  return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|TLS|SSL|reset/i.test(msg);
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/** law.go.kr 호출: 일시적 끊김(ECONNRESET 등)에 짧게 재시도 */
async function httpsGetText(urlStr, siteOriginBase) {
  var maxAttempts = 3;
  var baseDelayMs = 400;
  var lastErr = null;
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await httpsGetTextOnce(urlStr, siteOriginBase);
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts && httpsGetTextRetriable(e)) {
        await sleep(baseDelayMs * attempt);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

function arr(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function articlePartsToLabel(main, branch) {
  return branch ? "제" + main + "조의" + branch : "제" + main + "조";
}

/** 흔한 오타·근접 입력(버↔법 등) */
function normalizeLawQueryTypos(str) {
  return String(str || "")
    .replace(/민버/g, "민법")
    .replace(/상버/g, "상법")
    .replace(/형버/g, "형법")
    .replace(/헌버/g, "헌법")
    .replace(/공버/g, "공법")
    .replace(/근로기준버/g, "근로기준법")
    .replace(/건설기준버/g, "건설기준법");
}

/** 자연어 안의 부연·요청어 제거(법령명 본문은 건드리지 않음) */
function stripLawQueryNoise(str) {
  var t = String(str || "").trim();
  t = t.replace(/[\s·‧•※]+/g, " ");
  t = t.replace(
    /(?:^|\s)(?:관련|원문|조문|해석|판례|사례|내용|검색|찾기|좀|부탁|부탁드립니다|알려|알려줘|알려주세요|해줘|주세요|대해서|대한|에\s*대해|참고|설명|정리|요약)(?=\s|$)/gi,
    " "
  );
  t = t.replace(/^(?:관련|원문|조문|해석|판례|사례|내용|검색|알려|알려줘|알려주세요|해줘|주세요)\s+/gi, "");
  return t.trim();
}

/** 법령명 전체: 한글 음절 + …법·…령·시행령·시행규칙·규칙 (전체 문자열이 이 형태일 때만) */
const LAW_NAME_ONLY = new RegExp(
  "^[\\uAC00-\\uD7A3]{1,22}(?:법|령|시행령|시행규칙|규칙)$",
  "u"
);

/** 2~3글자로도 자주 쓰이는 기본법 — '…민법'처럼 짧게 끊을 때 우선 */
const SHORT_LAW_NAMES = {
  민법: 1,
  상법: 1,
  형법: 1,
  헌법: 1,
  공법: 1,
  국법: 1,
};

/** '2 의 1' → '2의1' 등 조·의 주변 공백 정리 후 전체 공백 제거 */
function compactLawArticleWhitespace(s) {
  return String(s || "")
    .replace(/(\d)\s*조\s*의\s*(\d)/g, "$1조의$2")
    .replace(/(\d)\s*의\s*(\d)/g, "$1의$2")
    .replace(/\s+/g, "");
}

/**
 * before의 접미 중 법령명 패턴과 맞는 후보를 모은 뒤,
 * - 화이트리스트 짧은 법(민법 등)이 있으면 그중 **시작 인덱스가 가장 큰 것**(제 앞 최단)
 * - 없으면 **가장 긴** 접미(공정거래위원회법 등 복합 명칭)
 */
function lawNameSuffixTouchingEnd(before) {
  const b = String(before || "");
  if (!b) return null;
  const cands = [];
  for (let i = 0; i < b.length; i++) {
    const suf = b.slice(i);
    if (!LAW_NAME_ONLY.test(suf)) continue;
    cands.push({ suf: suf, i: i, len: suf.length });
  }
  if (!cands.length) return null;
  const shortHits = cands.filter(function (c) {
    return SHORT_LAW_NAMES[c.suf];
  });
  if (shortHits.length) {
    shortHits.sort(function (a, x) {
      return x.i - a.i;
    });
    return shortHits[0].suf;
  }
  cands.sort(function (a, x) {
    return x.len - a.len;
  });
  return cands[0].suf;
}

/**
 * 공백 제거 후 엄격 매칭.
 * 순서: 제N조 → N조 → 제N의M → 제N(조생략) → N의M → N
 */
function parseArticleQueryStrict(s) {
  const str = String(s || "").trim();
  if (!str) return null;

  let m = str.match(/^(.+)제(\d{1,5})조(?:의(\d{1,3}))?$/);
  if (m) {
    const lawName = lawNameSuffixTouchingEnd(m[1]);
    if (!lawName) return null;
    return {
      lawName,
      main: m[2],
      branch: m[3] || null,
      label: articlePartsToLabel(m[2], m[3] || null),
    };
  }
  m = str.match(/^(.+?)(?<![제])(\d{1,5})조(?:의(\d{1,3}))?$/);
  if (m) {
    const lawName = lawNameSuffixTouchingEnd(m[1]);
    if (!lawName) return null;
    return {
      lawName,
      main: m[2],
      branch: m[3] || null,
      label: articlePartsToLabel(m[2], m[3] || null),
    };
  }
  m = str.match(/^(.+)제(\d{1,5})의(\d{1,3})$/);
  if (m) {
    const lawName = lawNameSuffixTouchingEnd(m[1]);
    if (!lawName) return null;
    return {
      lawName,
      main: m[2],
      branch: m[3],
      label: articlePartsToLabel(m[2], m[3]),
    };
  }
  m = str.match(/^(.+)제(\d{1,5})$/);
  if (m) {
    const lawName = lawNameSuffixTouchingEnd(m[1]);
    if (!lawName) return null;
    return {
      lawName,
      main: m[2],
      branch: null,
      label: articlePartsToLabel(m[2], null),
    };
  }
  m = str.match(/^(.+?)(?<![제])(\d{1,5})(?:의(\d{1,3}))?$/);
  if (m) {
    const lawName = lawNameSuffixTouchingEnd(m[1]);
    if (!lawName) return null;
    return {
      lawName,
      main: m[2],
      branch: m[3] || null,
      label: articlePartsToLabel(m[2], m[3] || null),
    };
  }
  return null;
}

/** 문장 속 '…민법 제32조'처럼 앞뒤 수식이 있을 때 마지막 법령명+조문 꼬리만 추출 */
function parseArticleQueryLooseFromContext(s) {
  const str = String(s || "");
  if (str.length < 5) return null;
  const tailRes = [
    /(제\d{1,5}조(?:의\d{1,3})?)$/,
    /((?<![제\d])(?<![제])\d{1,5}조(?:의\d{1,3})?)$/,
    /(제\d{1,5}의\d{1,3})$/,
    /(제\d{1,5})$/,
    /((?<![제\d])(?<![제])\d{1,5}(?:의\d{1,3})?)$/,
  ];
  for (let ti = 0; ti < tailRes.length; ti++) {
    const tm = str.match(tailRes[ti]);
    if (!tm || !tm[1]) continue;
    const tail = tm[1];
    const rest = str.slice(0, str.length - tail.length);
    if (!rest) continue;
    const lawName = lawNameSuffixTouchingEnd(rest);
    if (lawName) {
      const p = parseArticleQueryStrict(lawName + tail);
      if (p) return p;
    }
  }
  return null;
}

function parseArticleQuery(q) {
  const raw = String(q || "").trim();
  if (!raw) return null;
  let pre = stripLawQueryNoise(raw);
  pre = normalizeLawQueryTypos(pre);
  const collapsed = compactLawArticleWhitespace(pre);
  let p = parseArticleQueryStrict(collapsed);
  if (p) return p;
  return parseArticleQueryLooseFromContext(collapsed);
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

/** DRF JSON에서는 조문번호가 "32"처럼 숫자만 오는 경우가 대부분입니다. */
function normalizeArticleMetaNum(v) {
  if (v == null) return "";
  return String(v).replace(/\s/g, "");
}

function branchKeyFromUnit(u) {
  const g = normalizeArticleMetaNum(u.조문가지번호);
  if (!g || g === "0") return "";
  return g;
}

function findJoUnit(units, main, branch) {
  const mainS = normalizeArticleMetaNum(main);
  const branchS = branch ? normalizeArticleMetaNum(branch) : "";
  const full = branch ? "제" + main + "조의" + branch : "제" + main + "조";
  const short = "제" + main + "조";

  function mainMatches(num) {
    if (!num) return false;
    if (/^\d+$/.test(num)) return num === mainS;
    if (num === full) return true;
    if (!branch && num === short) return true;
    return false;
  }

  function branchMatches(u) {
    const g = branchKeyFromUnit(u);
    if (branchS) return g === branchS;
    return !g;
  }

  const candidates = [];
  for (const u of units) {
    const num = normalizeJoNum(u.조문번호);
    if (!mainMatches(num)) continue;
    if (!branchMatches(u)) continue;
    candidates.push(u);
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    const real = candidates.filter(function (u) {
      return u.조문여부 === "조문";
    });
    if (real.length) return real[0];
    return candidates[0];
  }

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
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /(<a\b[^>]*\shref=["'])(?:https?:)?\/\/open\.law\.go\.kr[^"']*(["'])/gi,
      "$1https://www.law.go.kr/main.html$2"
    )
    .replace(
      /(<a\b[^>]*\shref=["'])https?:\/\/www\.law\.go\.kr\/DRF[^"']*(["'])/gi,
      "$1https://www.law.go.kr/main.html$2"
    )
    .replace(/(<a\b[^>]*\shref=["'])\/DRF[^"']*(["'])/gi, "$1https://www.law.go.kr/main.html$2")
    .replace(/(<a\b[^>]*\shref=["'])\/(?=LSW\/|admRul\/|lsSc|lsAst|INF\/|joOn)/gi, "$1https://www.law.go.kr/");
}

function getExpcList(json) {
  if (!json || typeof json !== "object") return [];
  if (json.Expc && json.Expc.expc != null) return arr(json.Expc.expc);
  const ls = json.LawSearch || json.lawSearch || json.ExpcSearch || json;
  if (ls && ls.law != null) return arr(ls.law);
  if (ls && ls.행정해석 != null) return arr(ls.행정해석);
  if (ls && ls.expc != null) return arr(ls.expc);
  return [];
}

function getAdmRulList(json) {
  if (!json || typeof json !== "object") return [];
  const ar = json.AdmRulSearch || json.admRulSearch;
  if (ar && ar.admrul != null) return arr(ar.admrul);
  return [];
}

function getPrecList(json) {
  if (!json || typeof json !== "object") return [];
  const ps = json.PrecSearch || json.precSearch;
  if (ps && ps.prec != null) return arr(ps.prec);
  return [];
}

function uniqStrings(list) {
  const out = [];
  const seen = {};
  for (let i = 0; i < list.length; i++) {
    const s = String(list[i] || "").trim();
    if (!s || seen[s]) continue;
    seen[s] = 1;
    out.push(s);
  }
  return out;
}

/**
 * 공동활용·LSO 관리 경로는 일반 브라우저에서 "페이지 접속에 실패"가 나는 경우가 많아
 * 이용자용 포털 메인으로 보냅니다.
 */
function finalizeLawGoKrPublicBrowseUrl(urlStr) {
  try {
    const u = new URL(String(urlStr || ""));
    const host = (u.hostname || "").toLowerCase();
    /* 공동활용 호스트·경로는 일반 브라우저 세션에서 실패 화면이 잦음 */
    if (host === "open.law.go.kr") return "https://www.law.go.kr/main.html";
    const p = u.pathname || "";
    if (/^\/LSO(\/|$)/i.test(p)) return "https://www.law.go.kr/main.html";
    /* Open API(JSON)용 /DRF/… 는 브라우저에서 열면 실패·원시응답만 나오는 경우가 많음 → 직링크 비활성 */
    if (/^\/DRF(\/|$)/i.test(p)) return "";
  } catch (e) {
    /* ignore */
  }
  return String(urlStr || "");
}

/**
 * 상세링크가 `/경로`, `http(s)://(www.)law.go.kr/...`, `//law.go.kr/...` 등으로 올 수 있음.
 * 브라우저에서 국가법령정보센터(www) 기준으로 열리도록 https + 호스트 정리(이중 베이스 제거).
 */
function normalizeLawGoKrDetailUrl(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  while (/^https:\/\/www\.law\.go\.krhttps:\/\//i.test(s)) {
    s = s.replace(/^https:\/\/www\.law\.go\.kr/i, "");
  }
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s.replace(/^http:\/\//i, "https://"));
      const host = u.hostname.toLowerCase();
      if (!/(\.)?law\.go\.kr$/i.test(host)) {
        return s.replace(/^http:\/\//i, "https://");
      }
      if (host === "open.law.go.kr") return "https://www.law.go.kr/main.html";
      const rest = u.pathname + u.search + u.hash;
      if (!rest || rest === "/") return finalizeLawGoKrPublicBrowseUrl("https://www.law.go.kr/main.html");
      return finalizeLawGoKrPublicBrowseUrl("https://www.law.go.kr" + rest);
    } catch (e) {
      return "";
    }
  }
  if (s.startsWith("//")) {
    try {
      const u = new URL("https:" + s);
      const host = u.hostname.toLowerCase();
      if (!/(\.)?law\.go\.kr$/i.test(host)) return "https:" + s;
      if (host === "open.law.go.kr") return "https://www.law.go.kr/main.html";
      const rest = u.pathname + u.search + u.hash;
      if (!rest || rest === "/") return finalizeLawGoKrPublicBrowseUrl("https://www.law.go.kr/main.html");
      return finalizeLawGoKrPublicBrowseUrl("https://www.law.go.kr" + rest);
    } catch (e2) {
      return "";
    }
  }
  const path = s.startsWith("/") ? s : "/" + s.replace(/^\/+/, "");
  if (/^\/LSO(\/|$)/i.test(path)) return "https://www.law.go.kr/main.html";
  if (/^\/DRF(\/|$)/i.test(path)) return "";
  return finalizeLawGoKrPublicBrowseUrl("https://www.law.go.kr" + path);
}

function mapExpcRow(row) {
  const title =
    row.안건명 ||
    row.해석례명 ||
    row.제목 ||
    row.사건명 ||
    row.법령명 ||
    "";
  const dept =
    row.질의기관명 || row.담당부서 || row.소관부처 || row.회신기관명 || row.처리기관 || "";
  const date = row.회신일자 || row.공포일자 || row.신청일자 || "";
  const id = row.법령해석례일련번호 || row.행정해석일련번호 || row.해석례일련번호 || row.ID || row.id || "";
  const rawLink =
    row.법령해석례상세링크 || row.법령해석상세링크 || row.법령해석례링크 || row.상세링크 || "";
  const link = normalizeLawGoKrDetailUrl(rawLink);
  return { kind: "expc", title: String(title), dept: String(dept), date: String(date), id: String(id), link };
}

function mapAdmRulRow(row) {
  const title = row.행정규칙명 || row.행정규칙명한글 || "";
  const dept = row.소관부처명 || row.소관부처 || row.제개정구분명 || "";
  const date = String(row.발령일자 || row.시행일자 || row.공포일자 || "");
  const id = String(row.행정규칙일련번호 || row.행정규칙ID || row.id || "");
  const rawLink = row.행정규칙상세링크 || row.행정규칙본문링크 || row.상세링크 || "";
  const link = normalizeLawGoKrDetailUrl(rawLink);
  return { kind: "admrul", title: String(title), dept: String(dept), date: date, id: id, link };
}

function mapPrecRow(row) {
  const rawLink = row.판례상세링크 || row.상세링크 || "";
  const link = normalizeLawGoKrDetailUrl(rawLink);
  return {
    kind: "prec",
    title: String(row.사건명 || ""),
    caseNo: String(row.사건번호 || ""),
    court: String(row.법원명 || row.데이터출처명 || ""),
    date: String(row.선고일자 || ""),
    id: String(row.판례일련번호 || row.id || ""),
    link,
  };
}

/**
 * 법령해석(expc) 다중 쿼리 + 행정규칙(admrul) 병합
 */
async function fetchInterpretationRows(oc, origin, lawName, label, articleTitle) {
  const merged = [];
  const seen = new Set();
  function pushRow(m) {
    const key = m.kind + ":" + (m.id || m.title);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(m);
  }

  const expQueries = uniqStrings([
    lawName + " " + label,
    articleTitle ? lawName + " " + String(articleTitle).trim() : "",
    articleTitle ? String(articleTitle).trim() : "",
  ]);
  for (let qi = 0; qi < expQueries.length && merged.length < 20; qi++) {
    var expq = expQueries[qi];
    if (!expq) continue;
    var expUrl =
      BASE +
      "/lawSearch.do?OC=" +
      encodeURIComponent(oc) +
      "&target=expc&type=JSON&display=15&query=" +
      encodeURIComponent(expq);
    try {
      var expText = await httpsGetText(expUrl, origin);
      var expJson = JSON.parse(expText);
      var expRows = getExpcList(expJson);
      for (var ei = 0; ei < expRows.length; ei++) {
        pushRow(mapExpcRow(expRows[ei]));
        if (merged.length >= 18) break;
      }
    } catch (e1) {
      /* ignore */
    }
  }

  var admUrl =
    BASE +
    "/lawSearch.do?OC=" +
    encodeURIComponent(oc) +
    "&target=admrul&type=JSON&display=12&query=" +
    encodeURIComponent(lawName + " " + label);
  try {
    var admText = await httpsGetText(admUrl, origin);
    var admJson = JSON.parse(admText);
    var admRows = getAdmRulList(admJson);
    for (var ai = 0; ai < admRows.length && merged.length < 22; ai++) {
      pushRow(mapAdmRulRow(admRows[ai]));
    }
  } catch (e2) {
    /* ignore */
  }

  return merged.slice(0, 20);
}

/**
 * 판례(prec): 조문제목·법령+조문 등 순차 검색 후 중복 제거
 */
async function fetchPrecedentRows(oc, origin, lawName, label, articleTitle) {
  const queries = uniqStrings([
    articleTitle ? String(articleTitle).trim() : "",
    articleTitle
      ? String(articleTitle)
          .trim()
          .replace(/\([^)]*\)/g, "")
          .trim()
      : "",
    lawName + " " + label,
    lawName,
  ]);
  const out = [];
  const seenId = {};
  for (let pi = 0; pi < queries.length && out.length < 12; pi++) {
    var pq = queries[pi];
    if (!pq) continue;
    var pUrl =
      BASE +
      "/lawSearch.do?OC=" +
      encodeURIComponent(oc) +
      "&target=prec&type=JSON&display=12&query=" +
      encodeURIComponent(pq);
    try {
      var pText = await httpsGetText(pUrl, origin);
      var pJson = JSON.parse(pText);
      var plist = getPrecList(pJson);
      for (var pj = 0; pj < plist.length; pj++) {
        var pr = mapPrecRow(plist[pj]);
        if (!pr.id || seenId[pr.id]) continue;
        seenId[pr.id] = 1;
        out.push(pr);
        if (out.length >= 10) return out;
      }
    } catch (e3) {
      /* ignore */
    }
  }
  return out;
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

  const oc = String(
    process.env.LAW_OC || process.env.KOREAN_LAW_API_KEY || process.env.LAW_GO_KR_OC || ""
  ).trim();
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
        "법령명+조문 형식이 아닙니다. 예: 민법 제32조, 민법제32, 민법 32조, 민법32, 민버32, 상법 제300조, 근로기준법 2 의 1 또는 쿼리 law·jo·branch",
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

    var siteCandidates = getSiteOriginCandidates();
    var searchJson = null;
    var usedSiteOrigin = siteCandidates[0] || "https://daehanminkuk.co.kr";
    var lastApiMsg = "";
    var tried = [];

    for (var si = 0; si < siteCandidates.length; si++) {
      var originTry = siteCandidates[si];
      tried.push(originTry);
      var searchText;
      try {
        searchText = await httpsGetText(searchUrl, originTry);
      } catch (netErr) {
        lastApiMsg = netErr && netErr.message ? String(netErr.message) : "network";
        continue;
      }
      var parsedOnce = null;
      try {
        parsedOnce = JSON.parse(searchText);
      } catch (pe) {
        return res.status(502).json({
          ok: false,
          error: "SEARCH_PARSE",
          message: "법령 검색 응답이 JSON이 아닙니다.",
        });
      }
      var lawsOnce = getLawsFromSearch(parsedOnce);
      if (lawsOnce.length) {
        searchJson = parsedOnce;
        usedSiteOrigin = originTry;
        break;
      }
      var msgOnce =
        parsedOnce.msg || parsedOnce.message || parsedOnce.MSG || parsedOnce.result || "";
      lastApiMsg = String(msgOnce || "");
      if (!/IP주소|도메인|검증|OPEN API/i.test(lastApiMsg)) {
        searchJson = parsedOnce;
        usedSiteOrigin = originTry;
        break;
      }
    }

    if (!searchJson) {
      var transportFail = httpsGetTextRetriable({ message: lastApiMsg || "" });
      var transportHint = transportFail
        ? " 연결이 중간에 끊긴 경우(ECONNRESET 등): Vercel 서버리스 **실행 리전이 바뀌면 출구 IP가 달라질** 수 있어, 공동활용 ‘API 허용 IP’와 어긋나면 상대가 연결을 끊습니다. 사이트의 /api/egress-ip 를 여러 번 호출해 나온 IP를 모두 등록하고, LAW_API_SITE_URL·등록 도메인이 신청 건과 일치하는지 확인하세요."
        : "";
      return res.status(502).json({
        ok: false,
        error: "SEARCH_API",
        message:
          (lastApiMsg || "법령 검색 실패") +
          " — Referer 출처를 순서대로 시도했습니다: " +
          tried.join(", ") +
          ". Vercel의 LAW_API_SITE_URL이 플레이스홀더(api.example.com)가 아닌지 확인하고, 공동활용 IP·도메인·OC 신청 건이 승인·반영되었는지 확인하세요." +
          (transportHint ? " " + transportHint : ""),
      });
    }

    const laws = getLawsFromSearch(searchJson);
    if (!laws.length) {
      const msg = searchJson.msg || searchJson.message || searchJson.MSG || "";
      if (msg) {
        var fullMsg = String(msg);
        if (/IP주소|도메인|검증|OPEN API/i.test(fullMsg)) {
          fullMsg +=
            " — 시도한 Referer: " +
            tried.join(", ") +
            ". Vercel의 LAW_API_SITE_URL·LAW_OC가 이 신청 건과 같은지, /api/egress-ip로 나온 출구 IP를 모두 등록했는지 확인하세요. 위를 모두 맞춰도 동일하면 국가법령정보 공동활용(https://open.law.go.kr/LSO/main.do) 고객지원에 문의하세요(등록 도메인·허용 IP·OC 식별 정보).";
        }
        return res.status(502).json({
          ok: false,
          error: "SEARCH_API",
          message: fullMsg,
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

    const svcText = await httpsGetText(svcUrl, usedSiteOrigin);
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

    const articleTitleForMeta =
      unit && unit.조문제목 ? String(unit.조문제목).trim() : "";

    let interpretations = [];
    let precedents = [];
    try {
      var interpPrec = await Promise.all([
        fetchInterpretationRows(oc, usedSiteOrigin, lawName, label, articleTitleForMeta),
        fetchPrecedentRows(oc, usedSiteOrigin, lawName, label, articleTitleForMeta),
      ]);
      interpretations = interpPrec[0];
      precedents = interpPrec[1];
    } catch (interpErr) {
      interpretations = [];
      precedents = [];
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
        precedents,
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
      precedents,
    });
  } catch (err) {
    var msg = err && err.message ? String(err.message) : "서버 오류";
    if (msg === "fetch failed" || /ECONNRESET|ETIMEDOUT|ENOTFOUND|certificate/i.test(msg)) {
      msg +=
        " — law.go.kr 연결 실패입니다. /api/egress-ip 로 출구 IP를 확인해 공동활용 ‘API 허용 IP’에 반영하세요. 리전·플랜 변경 직후에는 등록 IP와 불일치해 끊김이 날 수 있습니다.";
    }
    return res.status(500).json({
      ok: false,
      error: "INTERNAL",
      message: msg,
    });
  }
};
