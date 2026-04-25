window.SUPABASE_URL = "https://tobokugrhakxwubvqffb.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_00brCPgc_AQYc8YFtbliKA_Os4EdlrP";

(function () {
  var href = String(window.location.href || "");
  if (!href) return;
  if (/integrated-search\.html/i.test(href)) return;

  var params = new URLSearchParams(window.location.search || "");
  if (params.get("from") !== "integrated-search") return;

  function mountBackButton() {
    if (document.getElementById("integrated-search-back-btn")) return;

    var returnTo = params.get("return_to") || "integrated-search.html";
    var style = document.createElement("style");
    style.textContent = [
      "#integrated-search-back-btn {",
      "position: fixed;",
      "right: 1rem;",
      "bottom: 1rem;",
      "z-index: 9999;",
      "display: inline-flex;",
      "align-items: center;",
      "justify-content: center;",
      "padding: 0.58rem 0.82rem;",
      "border-radius: 999px;",
      "border: 1px solid rgba(82, 61, 103, 0.38);",
      "background: linear-gradient(180deg, #745b93 0%, #5a4678 100%);",
      "color: #fff;",
      "font: 700 0.8rem/1 'Noto Sans KR', system-ui, sans-serif;",
      "text-decoration: none;",
      "box-shadow: 0 8px 18px rgba(58, 48, 76, 0.28);",
      "}",
      "#integrated-search-back-btn:hover, #integrated-search-back-btn:focus-visible {",
      "filter: brightness(1.06);",
      "text-decoration: none;",
      "color: #fff;",
      "}",
      "@media (max-width: 640px) {",
      "#integrated-search-back-btn { right: 0.7rem; bottom: 0.7rem; padding: 0.54rem 0.75rem; }",
      "}"
    ].join("");
    document.head.appendChild(style);

    var btn = document.createElement("a");
    btn.id = "integrated-search-back-btn";
    btn.href = returnTo;
    btn.textContent = "통합검색으로 돌아가기";
    btn.setAttribute("aria-label", "통합검색 페이지로 돌아가기");
    document.body.appendChild(btn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountBackButton);
  } else {
    mountBackButton();
  }
})();
