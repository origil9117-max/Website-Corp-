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
  /** v3: v1/v2 로컬 캐시 무시(예전 문구가 계속 보이는 문제 방지) */
  var LOCAL_KEY_PREFIX = "platformPageLocal:v3:";
  var LOCAL_SCHEMA_VERSION = 3;

  var initialLead = "";
  var initialBodyHtml = "";

  var client = null;
  var currentSession = null;
  var localAdmin = false;
  var showLoginForm = false;
  var ADMIN_OFF_FLAG_KEY = "platform-admin-force-off";

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
    '<p class="platform-hint">편집을 시작할 때 아래 버튼으로 화면에 보이는 안내를 불러올 수 있습니다.</p>' +
    '<p class="platform-hint"><button type="button" class="btn btn-ghost" id="platform-btn-load-from-page">현재 화면 안내 불러오기</button></p>' +
    '<p class="platform-hint">저장 시 방문자에게 바로 보입니다. 잘못된 HTML은 레이아웃이 깨질 수 있으니 확인 후 저장하세요.</p>' +
    '<div class="cta-row">' +
    '<button type="button" class="btn btn-primary" id="platform-btn-save">저장</button>' +
    '<button type="button" class="btn btn-ghost" id="platform-btn-revert">이 페이지 기본 문구로 되돌리기</button>' +
    '<button type="button" class="btn btn-ghost" id="platform-btn-clear-persisted">저장본 삭제 (클라우드·브라우저)</button>' +
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
      if (Number(o.schemaVersion) !== LOCAL_SCHEMA_VERSION) return null;
      return { lead: String(o.lead || ""), body_html: String(o.body_html || "") };
    } catch (e) {
      return null;
    }
  }

  function saveLocal(lead, bodyHtml) {
    localStorage.setItem(
      LOCAL_KEY_PREFIX + slug,
      JSON.stringify({
        schemaVersion: LOCAL_SCHEMA_VERSION,
        lead: lead,
        body_html: bodyHtml,
        saved_at: new Date().toISOString()
      })
    );
  }

  function stripResetPlatformParam() {
    try {
      var u = new URL(window.location.href);
      if (u.searchParams.get("resetplatform") !== "1") return;
      u.searchParams.delete("resetplatform");
      var next = u.pathname + (u.search ? u.search : "") + (u.hash || "");
      window.history.replaceState({}, "", next);
    } catch (e) {}
  }

  function shouldSkipPersistedContent() {
    try {
      return new URLSearchParams(window.location.search).get("resetplatform") === "1";
    } catch (e) {
      return false;
    }
  }

  function removeLegacyLocalKeys() {
    try {
      localStorage.removeItem("platformPageLocal:v1:" + slug);
      localStorage.removeItem("platformPageLocal:v2:" + slug);
    } catch (e) {}
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

  function clearEditors() {
    syncEditors("", "");
  }

  function loadEditorsFromPage() {
    syncEditors(leadEl.textContent.trim(), bodyEl.innerHTML.trim());
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
    removeLegacyLocalKeys();

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
    }

    async function deactivateAdminMode(opts) {
      var silent = !!(opts && opts.silent);
      if (client && currentSession) {
        try {
          await client.auth.signOut();
        } catch (e) {}
      }
      currentSession = null;
      localAdmin = false;
      showLoginForm = false;
      if (adminPass) adminPass.value = "";
      updateAdminUi();
      clearEditors();
      if (!silent) {
        setStatus(authStatus, "", "관리자 모드가 꺼져 있습니다.");
      }
    }

    function clearAdminStateOnLeave() {
      try {
        sessionStorage.setItem(ADMIN_OFF_FLAG_KEY, "1");
      } catch (e) {}
      if (client && currentSession) {
        client.auth.signOut();
      }
      currentSession = null;
      localAdmin = false;
      showLoginForm = false;
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
      var supaUrl = String(window.SUPABASE_URL || "").trim();
      var supaKey = String(window.SUPABASE_ANON_KEY || "").trim();
      if (window.supabase && supaUrl && supaKey) {
        client = window.supabase.createClient(supaUrl, supaKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
          }
        });
        var sessionRes = await client.auth.getSession();
        currentSession = sessionRes.data.session;
        if (currentSession) {
          await client.auth.signOut();
          currentSession = null;
        }
      }

      var skip = shouldSkipPersistedContent();
      if (skip) {
        stripResetPlatformParam();
      }

      var applied = false;
      if (!skip) {
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
      }

      updateAdminUi();

      var persistHint = document.getElementById("platform-persist-hint");
      if (!persistHint && root) {
        persistHint = document.createElement("p");
        persistHint.id = "platform-persist-hint";
        persistHint.className = "platform-hint";
        persistHint.style.fontSize = "0.76rem";
        persistHint.style.color = "var(--muted, #667086)";
        persistHint.innerHTML =
          "예전에 저장한 안내 문구가 그대로 보이면, 주소 끝에 <strong>?resetplatform=1</strong>을 붙여 한 번 열면 HTML 기본 문구로 돌아갑니다. Supabase에 옛 데이터가 남아 있으면 대시보드에서 해당 행을 삭제하거나 저장으로 덮어쓰면 됩니다.";
        root.insertBefore(persistHint, root.firstChild);
      }
    }

    init()
      .then(function () {
        clearEditors();
      })
      .catch(function () {
        clearEditors();
      });

    var forcedOffByNavigation = false;
    try {
      forcedOffByNavigation = sessionStorage.getItem(ADMIN_OFF_FLAG_KEY) === "1";
      sessionStorage.removeItem(ADMIN_OFF_FLAG_KEY);
    } catch (e) {}
    if (forcedOffByNavigation) {
      deactivateAdminMode({ silent: true });
    }

    window.addEventListener("pagehide", function () {
      clearAdminStateOnLeave();
    });
    window.addEventListener("beforeunload", function () {
      clearAdminStateOnLeave();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        clearAdminStateOnLeave();
      }
    });
    window.addEventListener("pageshow", function (e) {
      var persisted = !!(e && e.persisted);
      var forceOff = false;
      try {
        forceOff = sessionStorage.getItem(ADMIN_OFF_FLAG_KEY) === "1";
        if (forceOff) sessionStorage.removeItem(ADMIN_OFF_FLAG_KEY);
      } catch (err) {}
      if (persisted || forceOff || isAdmin()) {
        deactivateAdminMode({ silent: true });
      }
    });

    var btnLoadFromPage = document.getElementById("platform-btn-load-from-page");
    if (btnLoadFromPage) {
      btnLoadFromPage.addEventListener("click", function () {
        if (!isAdmin()) {
          setStatus(formStatus, "err", "관리자 모드에서만 불러올 수 있습니다.");
          return;
        }
        loadEditorsFromPage();
        setStatus(formStatus, "ok", "현재 화면에 보이는 안내를 편집창에 넣었습니다. 수정 후 저장하세요.");
      });
    }

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
        clearEditors();
        setStatus(authStatus, "", "관리자 모드가 꺼져 있습니다.");
        return;
      }
      await deactivateAdminMode({ silent: false });
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

    var btnClearPersisted = document.getElementById("platform-btn-clear-persisted");
    if (btnClearPersisted) {
      btnClearPersisted.addEventListener("click", async function (evt) {
        evt.preventDefault();
        evt.stopPropagation();
        if (!isAdmin()) {
          setStatus(formStatus, "err", "관리자만 삭제할 수 있습니다.");
          return;
        }
        var ok = window.confirm(
          "Supabase·브라우저에 저장된 이 페이지 안내를 모두 지우고, 지금 사이트 HTML에 들어 있는 기본 문구로 돌아갑니다. 계속할까요?"
        );
        if (!ok) return;

        btnClearPersisted.disabled = true;
        setStatus(formStatus, "", "저장본 삭제 중...");

        try {
          try {
            localStorage.removeItem(LOCAL_KEY_PREFIX + slug);
          } catch (e) {}
          removeLegacyLocalKeys();

          if (client) {
            var del = await client.from("platform_pages").delete().eq("slug", slug);
            if (del.error) {
              setStatus(formStatus, "err", "클라우드 삭제 실패: " + del.error.message + " — 로컬만 지웠습니다. 화면은 기본 문구로 맞춥니다.");
            } else {
              setStatus(formStatus, "ok", "클라우드·브라우저 저장본을 지웠습니다. 아래는 HTML 기본 문구입니다.");
            }
          } else {
            setStatus(formStatus, "ok", "브라우저 저장본을 지웠습니다(Supabase 미연결). 아래는 HTML 기본 문구입니다.");
          }

          applyToPage(initialLead, initialBodyHtml);
          clearEditors();
        } catch (e) {
          setStatus(formStatus, "err", "삭제 중 오류: " + (e && e.message ? e.message : String(e)));
        } finally {
          btnClearPersisted.disabled = false;
        }
      });
    }

    btnSave.addEventListener("click", async function (evt) {
      evt.preventDefault();
      evt.stopPropagation();
      if (!isAdmin()) {
        setStatus(formStatus, "err", "관리자만 저장할 수 있습니다.");
        return;
      }
      var v = readEditors();
      setStatus(formStatus, "", "저장 중...");
      btnSave.disabled = true;
      btnSave.textContent = "저장 중...";

      try {
        if (!client) {
          try {
            saveLocal(v.lead, v.body_html);
          } catch (le) {
            setStatus(formStatus, "err", "로컬 저장 실패: " + (le && le.message ? le.message : String(le)));
            return;
          }
          applyToPage(v.lead, v.body_html);
          setStatus(formStatus, "ok", "브라우저(로컬)에 저장했습니다. Supabase를 연결하면 다른 기기에서도 동일하게 볼 수 있습니다.");
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
          try {
            saveLocal(v.lead, v.body_html);
            applyToPage(v.lead, v.body_html);
          } catch (le) {
            setStatus(formStatus, "err", "저장 실패: " + msg);
            return;
          }
          if (/relation|does not exist|schema cache/i.test(msg)) {
            setStatus(
              formStatus,
              "ok",
              "클라우드 테이블이 없어 로컬에 저장하고 화면에 반영했습니다. Supabase에서 platform_pages.sql을 실행하세요."
            );
          } else {
            setStatus(formStatus, "err", "클라우드 저장 실패: " + msg + " — 로컬에만 반영했습니다.");
          }
          return;
        }

        applyToPage(v.lead, v.body_html);
        try {
          saveLocal(v.lead, v.body_html);
        } catch (e2) {}
        setStatus(formStatus, "ok", "저장되었습니다(Supabase).");
      } catch (e) {
        try {
          var vv = readEditors();
          saveLocal(vv.lead, vv.body_html);
          applyToPage(vv.lead, vv.body_html);
        } catch (e2) {
          setStatus(formStatus, "err", "저장 중 오류: " + (e && e.message ? e.message : String(e)));
          return;
        }
        setStatus(formStatus, "err", "저장 중 오류가 났습니다. 로컬에만 반영했습니다.");
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
