/**
 * Vercel 서버리스가 외부로 나갈 때 사용하는 공인 IP(대표값)를 확인합니다.
 * 국가법령정보 공동활용 "API 허용 IP" 등록 시 참고하세요.
 * 참고: 무료 플랜은 호출마다 IP가 바뀔 수 있어, 막히면 고정 egress 또는 별도 서버를 검토하세요.
 */
module.exports = async function egressIpHandler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  function fetchWithTimeout(url, ms) {
    var ac = new AbortController();
    var id = setTimeout(function () {
      ac.abort();
    }, ms);
    return fetch(url, { signal: ac.signal }).finally(function () {
      clearTimeout(id);
    });
  }

  var endpoints = [
    "https://api.ipify.org?format=json",
    "https://ifconfig.me/ip",
  ];

  try {
    var r0 = await fetchWithTimeout(endpoints[0], 8000);
    if (r0.ok) {
      var j = await r0.json();
      if (j && j.ip) {
        return res.status(200).json({
          ip: j.ip,
          source: "ipify",
          hint:
            "이 IP(또는 Vercel 안내 범위)를 open.law.go.kr 공동활용 사이트의 API 허용 IP에 등록하세요. 여러 번 호출해 값이 바뀌면 동적 IP입니다.",
        });
      }
    }
  } catch (e) {
    /* fall through */
  }

  try {
    var r1 = await fetchWithTimeout(endpoints[1], 8000);
    if (r1.ok) {
      var text = (await r1.text()).trim();
      if (/^[\d.]+$/.test(text)) {
        return res.status(200).json({
          ip: text,
          source: "ifconfig.me",
          hint:
            "이 IP를 open.law.go.kr 공동활용 사이트의 API 허용 IP에 등록하세요. 값이 바뀌면 동적 egress일 수 있습니다.",
        });
      }
    }
  } catch (e2) {
    return res.status(502).json({
      error: "FETCH_FAILED",
      message: e2 && e2.message ? String(e2.message) : "IP 확인 서비스 호출 실패",
    });
  }

  return res.status(502).json({ error: "NO_IP", message: "IP를 가져오지 못했습니다." });
};
