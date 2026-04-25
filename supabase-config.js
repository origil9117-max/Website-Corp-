window.SUPABASE_URL = "https://tobokugrhakxwubvqffb.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_00brCPgc_AQYc8YFtbliKA_Os4EdlrP";

(function () {
  var href = String(window.location.href || "");
  if (!href) return;
  var isIntegratedSearchPage = /integrated-search\.html/i.test(href);

  var params = new URLSearchParams(window.location.search || "");

  function mountGlobalIntegratedSearchButton() {
    if (isIntegratedSearchPage) return;
    if (/\/(?:index\.html)?(?:\?|#|$)/i.test(window.location.pathname + window.location.search + window.location.hash)) return;
    if (document.getElementById("global-integrated-search-btn")) return;

    var style = document.createElement("style");
    style.textContent = [
      "#global-integrated-search-btn {",
      "display: inline-flex;",
      "align-items: center;",
      "justify-content: center;",
      "padding: 0.44rem 0.7rem;",
      "margin-left: 0.4rem;",
      "border-radius: 4px;",
      "border: 1px solid rgba(74, 58, 98, 0.5);",
      "background: linear-gradient(180deg, #6f568c 0%, #4f3e71 100%);",
      "color: #fff;",
      "font: 800 0.7rem/1 'Noto Sans KR', system-ui, sans-serif;",
      "text-decoration: none;",
      "box-shadow: 0 4px 10px rgba(58, 48, 76, 0.22);",
      "}",
      "#global-integrated-search-btn:hover, #global-integrated-search-btn:focus-visible {",
      "filter: brightness(1.04);",
      "text-decoration: none;",
      "color: #fff;",
      "}",
      "@media (max-width: 640px) {",
      "#global-integrated-search-btn { padding: 0.4rem 0.64rem; margin-left: 0.3rem; font-size: 0.66rem; }",
      "}"
    ].join("");
    document.head.appendChild(style);

    var btn = document.createElement("a");
    btn.id = "global-integrated-search-btn";
    btn.href = "integrated-search.html";
    btn.textContent = "통합검색";
    btn.setAttribute("aria-label", "통합검색 페이지로 이동");
    var anchor =
      document.querySelector("#btn-auth-toggle") ||
      document.querySelector("#platform-btn-auth-toggle") ||
      document.querySelector(".admin-shortcut");
    if (anchor && anchor.parentElement) {
      anchor.insertAdjacentElement("afterend", btn);
      return;
    }

    var fallbackHost =
      document.querySelector(".page-head-top") ||
      document.querySelector(".head-top") ||
      document.querySelector(".section-head") ||
      document.querySelector(".top-links") ||
      document.querySelector("main header") ||
      document.querySelector("header");
    if (fallbackHost) {
      fallbackHost.appendChild(btn);
      return;
    }
    document.body.appendChild(btn);
  }

  function mountBackButton() {
    if (params.get("from") !== "integrated-search") return;
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
      "border: 1px solid rgba(74, 58, 98, 0.5);",
      "background: linear-gradient(180deg, #6f568c 0%, #4f3e71 100%);",
      "color: #fff;",
      "font: 700 0.74rem/1 'Noto Sans KR', system-ui, sans-serif;",
      "text-decoration: none;",
      "box-shadow: 0 8px 18px rgba(58, 48, 76, 0.28);",
      "}",
      "#integrated-search-back-btn:hover, #integrated-search-back-btn:focus-visible {",
      "filter: brightness(1.06);",
      "text-decoration: none;",
      "color: #fff;",
      "}",
      "@media (max-width: 640px) {",
      "#integrated-search-back-btn { right: 0.7rem; bottom: 0.7rem; padding: 0.54rem 0.75rem; font-size: 0.7rem; }",
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
    document.addEventListener("DOMContentLoaded", function () {
      mountGlobalIntegratedSearchButton();
      mountBackButton();
    });
  } else {
    mountGlobalIntegratedSearchButton();
    mountBackButton();
  }
})();
