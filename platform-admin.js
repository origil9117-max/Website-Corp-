/**
 * 지능형 행정 플랫폼 하위 페이지 — 관리자 인증·본문 저장
 * HTML에 #platform-admin-root 마크업이 있으면 그대로 사용하고, 없으면 여기서 주입합니다.
 */
(function () {
  var slug = document.body && document.body.getAttribute("data-platform-slug");
  var root = document.getElementById("platform-admin-root");
  var leadEl =
    document.getElementById("platform-lead") ||
    (document.querySelector && document.querySelector("article .lead"));
  var bodyEl =
    document.getElementById("platform-sub-body") ||
    (document.querySelector && document.querySelector("article .platform-sub-body"));

  var ADMIN_EMAIL = "lkc@daum.net";
  var LOCAL_KEY_PREFIX = "platformPageLocal:v1:";

  var initialLead = "";
  var initialBodyHtml = "";

  var client = null;
  var currentSession = null;
  var localAdmin = false;
  var showLoginForm = false;

  var INJECT_HTML =
    '<section class="platform-panel platform-auth" aria-label="관리자 인증">' +
    "<h2>관리자 인증</h2>" +
    '<p class="platform-hint" style="margin-top:0">관리자로 로그인한 경우에만 아래 안내 본문을 편집·저장할 수 있습니다. 자료실·공지와 동일한 방식입니다.</p>' +
    '<details class="platform-auth-details">' +
    "<summary>비상 모드(로컬 저장) 안내 — 펼치기</summary>" +
    '<div class="platform-auth-details-body">' +
    "<p>Supabase에 연결되지 않거나 <code>platform_pages</code> 테이블이 없을 때는 브라우저에만 저장됩니다. 다른 PC와 공유하려면 SQL로 테이블을 만든 뒤 클라우드에 저장하세요.</p>" +
    "</div></details>" +
    '<p id="platform-auth-mode" class="platform-auth-mode" data-mode="view" role="status">현재: 일반 보기</p>' +
    '<div class="platform-auth-row" id="platform-auth-login-row">' +
    '<input id="platform-admin-pass" type="password" autocomplete="current-password" placeholder="관리자 비밀번호" />' +
    '<button type="button" class="btn btn-ghost" id="platform-btn-login">관리자 모드 켜기</button>' +
    '<button type="button" class="btn btn-primary" id="platform-btn-logout">관리자 모드 끄기</button>' +
    '<button type="button" class="btn btn-ghost" id="platform-btn-test">연결 테스트</button>' +
    "</div>" +
    '<p id="platform-auth-status" class="platform-status" role="status"></p>' +
    "</section>" +
    '<section class="platform-panel platform-editor" id="platform-editor-panel" style="display:none" aria-label="본문 편집">' +
    "<h2>안내 본문 편집 (관리자 전용)</h2>" +
    '<label for="platform-edit-lead">요약 문단 (리드, 일반 텍스트)</label>' +
    '<textarea id="platform-edit-lead" rows="3"></textarea>' +
    '<label for="platform-edit-body">본문 (HTML 가능)</label>' +
    '<textarea id="platform-edit-body" rows="14" placeholder="예: &lt;p&gt;문단&lt;/p&gt;&lt;p&gt;&lt;a href=&quot;...&quot;&gt;링크&lt;/a&gt;&lt;/p&gt;"></textarea>' +
    '<p class="platform-hint">저장 시 방문자에게 바로 보입니다. 잘못된 HTML은 레이아웃이 깨질 수 있으니 확인 후 저장하세요.</p>' +
    '<div class="cta-row">' +
    '<button type="button" class="btn btn-primary" id="platform-btn-save">저장</button>' +
    '<button type="button" class="btn btn-ghost" id="platform-btn-revert">이 페이지 기본 문구로 되돌리기</button>' +
    "</div>" +
    '<p id="platform-form-status" class="platform-status" role="status"></p>' +
    "</section>";

  function isAdmin() {
    return !!(localAdmin || (currentSession && currentSession.user));
  }

  function setStatus(el, type, msg) {
    if (!el) return;
    el.classList.remove("ok", "err");
    if (type) el.classList.add(type);
    el.textContent = msg || "";
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY_PREFIX + slug);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o !== "object") return null;
      return { lead: String(o.lead || ""), body_html: String(o.body_html || "") };
    } catch (e) {
      return null;
    }
  }

  function saveLocal(lead, bodyHtml) {
    localStorage.setItem(
      LOCAL_KEY_PREFIX + slug,
      JSON.stringify({ lead: lead, body_html: bodyHtml, saved_at: new Date().toISOString() })
    );
  }

  function applyToPage(lead, bodyHtml) {
    leadEl.textContent = lead;
    bodyEl.innerHTML = bodyHtml;
  }

  function syncEditors(editLead, editBody) {
    var a = document.getElementById("platform-edit-lead");
    var b = document.getElementById("platform-edit-body");
    if (a) a.value = editLead;
    if (b) b.value = editBody;
  }

  function readEditors() {
    var a = document.getElementById("platform-edit-lead");
    var b = document.getElementById("platform-edit-body");
    return {
      lead: a ? String(a.value || "").trim() : "",
      body_html: b ? String(b.value || "").trim() : ""
    };
  }

  try {
    if (!slug) return;

    if (!root) {
      return;
    }

    if (!document.getElementById("platform-btn-login")) {
      root.innerHTML = INJECT_HTML;
    }

    if (!leadEl || !bodyEl) {
      root.insertAdjacentHTML(
        "afterbegin",
        '<p class="platform-panel" style="border-color:#b02135;color:#b02135;font-weight:700;">관리자 기능: 본문 영역(#platform-lead, #platform-sub-body)을 찾을 수 없습니다.</p>'
      );
      return;
    }

    initialLead = leadEl.textContent.trim();
    initialBodyHtml = bodyEl.innerHTML.trim();

    var adminPass = document.getElementById("platform-admin-pass");
    var btnLogin = document.getElementById("platform-btn-login");
    var btnLogout = document.getElementById("platform-btn-logout");
    var btnTest = document.getElementById("platform-btn-test");
    var authStatus = document.getElementById("platform-auth-status");
    var authMode = document.getElementById("platform-auth-mode");
    var editorPanel = document.getElementById("platform-editor-panel");
    var formStatus = document.getElementById("platform-form-status");
    var btnSave = document.getElementById("platform-btn-save");
    var btnRevert = document.getElementById("platform-btn-revert");

    if (!btnLogin || !btnLogout || !btnSave) {
      root.insertAdjacentHTML(
        "afterbegin",
        '<p class="platform-panel" style="border-color:#b02135;">관리자 UI 버튼을 찾을 수 없습니다. platform-admin.js 배포 여부를 확인하세요.</p>'
      );
      return;
    }

    function applyAuthModeIndicator() {
      if (!authMode) return;
      if (isAdmin()) {
        authMode.setAttribute("data-mode", "admin");
        authMode.textContent = "현재: 관리자 모드 (로그인됨)";
      } else if (showLoginForm) {
        authMode.setAttribute("data-mode", "login");
        authMode.textContent = "현재: 로그인 입력 중 — 비밀번호 입력 후 「관리자 모드 켜기」";
      } else {
        authMode.setAttribute("data-mode", "view");
        authMode.textContent = "현재: 일반 보기 — 「관리자 모드 켜기」로 로그인";
      }
    }

    function updateAdminUi() {
      var on = isAdmin();
      document.body.classList.toggle("platform-admin-on", !!on);
      if (editorPanel) editorPanel.style.display = on ? "block" : "none";
      if (adminPass) {
        adminPass.disabled = !!on;
        if (!on && showLoginForm) {
          adminPass.style.display = "";
        } else if (on) {
          adminPass.style.display = "none";
        } else {
          adminPass.style.display = "none";
        }
      }
      if (btnTest) {
        if (!on && showLoginForm) btnTest.style.display = "";
        else if (on) btnTest.style.display = "";
        else btnTest.style.display = "none";
      }
      applyAuthModeIndicator();
      if (localAdmin) {
        setStatus(authStatus, "ok", "로컬 비상 관리자 모드가 켜졌습니다.");
      } else if (on) {
        setStatus(authStatus, "ok", "관리자 모드가 켜졌습니다.");
      } else if (!showLoginForm) {
        setStatus(authStatus, "", "관리자 모드가 꺼져 있습니다.");
      }
      syncEditors(leadEl.textContent.trim(), bodyEl.innerHTML.trim());
    }

    async function loadFromCloud() {
      if (!client) return null;
      var res = await client.from("platform_pages").select("lead, body_html").eq("slug", slug).maybeSingle();
      if (res.error) {
        console.warn("platform_pages:", res.error.message);
        return null;
      }
      return res.data;
    }

    async function init() {
      if (window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
        client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
        var sessionRes = await client.auth.getSession();
        currentSession = sessionRes.data.session;
      }

      var applied = false;
      var cloud = await loadFromCloud();
      if (cloud && (cloud.lead !== undefined || cloud.body_html !== undefined)) {
        applyToPage(String(cloud.lead || ""), String(cloud.body_html || ""));
        applied = true;
      }
      if (!applied) {
        var loc = loadLocal();
        if (loc) {
          applyToPage(loc.lead, loc.body_html);
          applied = true;
        }
      }

      updateAdminUi();
    }

    init();

    btnLogin.addEventListener("click", async function () {
      if (!isAdmin() && !showLoginForm) {
        showLoginForm = true;
        if (adminPass) adminPass.value = "";
        updateAdminUi();
        setStatus(authStatus, "", "비밀번호를 입력한 뒤 「관리자 모드 켜기」를 다시 눌러 로그인하세요.");
        return;
      }
      var val = (adminPass && adminPass.value ? adminPass.value : "").trim();
      if (!val) {
        setStatus(authStatus, "err", "비밀번호를 입력해 주세요.");
        return;
      }
      if (val === "admin1234") {
        localAdmin = true;
        currentSession = null;
        if (adminPass) adminPass.value = "";
        updateAdminUi();
        return;
      }
      if (!client) {
        setStatus(authStatus, "err", "Supabase가 연결되지 않았습니다. 비상 모드( admin1234 ) 또는 설정을 확인하세요.");
        return;
      }
      try {
        var loginRes = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: val });
        if (loginRes.error) {
          var m = String(loginRes.error.message || "");
          if (/Invalid login credentials/i.test(m)) {
            setStatus(authStatus, "err", "로그인 실패: 비밀번호가 다릅니다.");
          } else {
            setStatus(authStatus, "err", "로그인 실패: " + m);
          }
          return;
        }
        currentSession = loginRes.data.session;
        localAdmin = false;
        if (adminPass) adminPass.value = "";
        updateAdminUi();
      } catch (err) {
        setStatus(authStatus, "err", "로그인 연결 실패. 네트워크·HTTPS 배포 주소를 확인하세요.");
      }
    });

    btnLogout.addEventListener("click", async function () {
      if (!isAdmin()) {
        showLoginForm = false;
        if (adminPass) adminPass.value = "";
        updateAdminUi();
        setStatus(authStatus, "", "관리자 모드가 꺼져 있습니다.");
        return;
      }
      if (client && currentSession) {
        await client.auth.signOut();
      }
      currentSession = null;
      localAdmin = false;
      showLoginForm = false;
      updateAdminUi();
    });

    btnTest.addEventListener("click", async function () {
      if (!client) {
        setStatus(authStatus, "err", "Supabase 미연결입니다.");
        return;
      }
      setStatus(authStatus, "", "연결 테스트 중...");
      try {
        var ping = await client.from("platform_pages").select("slug", { count: "exact", head: true });
        if (ping.error) {
          setStatus(authStatus, "err", "연결 실패: " + ping.error.message + " — platform_pages.sql 실행 여부를 확인하세요.");
          return;
        }
        setStatus(authStatus, "ok", "연결 성공: platform_pages 테이블과 통신 가능합니다.");
      } catch (e) {
        setStatus(authStatus, "err", "연결 실패(Failed to fetch).");
      }
    });

    btnRevert.addEventListener("click", function () {
      if (!isAdmin()) {
        setStatus(formStatus, "err", "관리자만 되돌릴 수 있습니다.");
        return;
      }
      applyToPage(initialLead, initialBodyHtml);
      syncEditors(initialLead, initialBodyHtml);
      setStatus(formStatus, "ok", "편집창을 이 파일에 넣은 기본 문구로 되돌렸습니다. 저장하면 반영됩니다.");
    });

    btnSave.addEventListener("click", async function () {
      if (!isAdmin()) {
        setStatus(formStatus, "err", "관리자만 저장할 수 있습니다.");
        return;
      }
      var v = readEditors();
      setStatus(formStatus, "", "저장 중...");
      btnSave.disabled = true;
      btnSave.textContent = "저장 중...";

      try {
        applyToPage(v.lead, v.body_html);

        if (!client) {
          saveLocal(v.lead, v.body_html);
          setStatus(formStatus, "ok", "Supabase 설정이 없어 브라우저(로컬)에 저장했습니다.");
          return;
        }

        var payload = {
          slug: slug,
          lead: v.lead,
          body_html: v.body_html,
          updated_at: new Date().toISOString()
        };
        var res = await client.from("platform_pages").upsert(payload, { onConflict: "slug" });
        if (res.error) {
          var msg = String(res.error.message || "");
          saveLocal(v.lead, v.body_html);
          if (/relation|does not exist|schema cache/i.test(msg)) {
            setStatus(
              formStatus,
              "ok",
              "클라우드 테이블이 없어 로컬에 저장했습니다. Supabase에서 platform_pages.sql을 실행하면 전체에 반영됩니다."
            );
          } else {
            setStatus(formStatus, "err", "클라우드 저장 실패: " + msg + " — 로컬에 백업했습니다.");
          }
        } else {
          setStatus(formStatus, "ok", "저장되었습니다(Supabase).");
        }
      } catch (e) {
        try {
          var vv = readEditors();
          saveLocal(vv.lead, vv.body_html);
        } catch (e2) {}
        setStatus(formStatus, "err", "저장 중 오류가 났습니다. 로컬 백업을 시도했습니다.");
      } finally {
        btnSave.disabled = false;
        btnSave.textContent = "저장";
      }
    });
  } catch (err) {
    console.error("platform-admin:", err);
    if (root) {
      root.insertAdjacentHTML(
        "afterbegin",
        '<p class="platform-panel" style="border-color:#b02135;color:#b02135;">관리자 스크립트 오류: ' +
          String(err && err.message ? err.message : err) +
          "</p>"
      );
    }
  }
})();
