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
  var STRICT_CLOUD_SYNC_WHEN_AVAILABLE = true;
  /** v3: v1/v2 로컬 캐시 무시(예전 문구가 계속 보이는 문제 방지) */
  var LOCAL_KEY_PREFIX = "platformPageLocal:v3:";
  var LOCAL_SCHEMA_VERSION = 3;

  var initialLead = "";
  var initialBodyHtml = "";
  var currentPersistedRecord = null;
  var ENTRY_TEMPLATE_TEXT = "";
  var selectedEntryIndex = -1;

  var client = null;
  var currentSession = null;
  var localAdmin = false;
  var adminRootOpen = false;
  var adminToggleBtn = null;
  var ADMIN_OFF_FLAG_KEY = "platform-admin-force-off";
  var lastCloudLoadError = "";
  var cloudBodyColumn = "body_html";
  var CLOUD_BODY_CANDIDATE_COLUMNS = ["body_html", "body", "content", "contents"];

  var INJECT_HTML =
    '<section class="platform-panel platform-auth" aria-label="관리자 인증">' +
    "<h2>관리자 인증</h2>" +
    '<p id="platform-auth-mode" class="platform-auth-mode" data-mode="view" role="status">현재: 일반 보기</p>' +
    '<div id="platform-auth-panel-logged-out">' +
    '<div id="platform-auth-supabase-block" class="platform-auth-supabase-block">' +
    '<p class="platform-auth-block-title">일반 관리자 (Supabase)</p>' +
    '<div class="platform-auth-row" id="platform-auth-supabase-row">' +
    '<input id="platform-admin-pass-supabase" type="password" autocomplete="current-password" placeholder="Supabase 관리자 비밀번호" />' +
    '<button type="button" class="btn btn-primary" id="platform-btn-login-supabase">일반 로그인</button>' +
    '<button type="button" class="btn btn-ghost" id="platform-btn-test">연결 테스트</button>' +
    "</div>" +
    '<p class="platform-hint" id="platform-auth-supabase-hint" style="margin-top:0.45rem"></p>' +
    "</div>" +
    '<div id="platform-auth-local-block" class="platform-auth-local-block">' +
    '<p class="platform-auth-block-title">비상 모드</p>' +
    '<div class="platform-auth-row" id="platform-auth-local-row">' +
    '<input id="platform-admin-pass-local" type="password" autocomplete="off" placeholder="비상 모드 비밀번호" />' +
    '<button type="button" class="btn btn-ghost" id="platform-btn-login-local">로컬 비상 모드 로그인</button>' +
    "</div></div></div>" +
    '<div id="platform-auth-panel-admin" class="platform-auth-panel-admin" style="display:none">' +
    '<button type="button" class="btn btn-primary" id="platform-btn-logout">관리자 모드 끄기</button>' +
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
      return {
        lead: String(o.lead || ""),
        body_html: String(o.body_html || ""),
        saved_at: String(o.saved_at || "")
      };
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
    var rendered = buildStructuredBodyHtml(lead, bodyHtml);
    if (rendered) {
      leadEl.textContent = "";
      leadEl.style.display = "none";
    } else {
      leadEl.textContent = String(lead || "");
      leadEl.style.display = "";
    }
    bodyEl.innerHTML = rendered;
  }

  function syncEditors(editLead, editBody) {
    var a = document.getElementById("platform-edit-lead");
    var b = document.getElementById("platform-edit-body");
    var rich = document.getElementById("platform-edit-body-editor");
    if (a) a.value = editLead;
    if (b) b.value = editBody;
    if (rich) rich.innerHTML = String(editBody || "");
  }

  function readEditors() {
    var a = document.getElementById("platform-edit-lead");
    var b = document.getElementById("platform-edit-body");
    var rawBody = b ? String(b.value || "").trim() : "";
    return {
      lead: a ? String(a.value || "").trim() : "",
      body_html: rawBody,
      editor_text: rawBody
    };
  }

  function clearEditors() {
    syncEditors("", ENTRY_TEMPLATE_TEXT);
  }

  function forceTextareaNewlineOnEnter(textarea) {
    if (!textarea || textarea.__platformEnterBound) return;
    textarea.__platformEnterBound = true;
    textarea.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.isComposing) return;
      var start = typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length;
      var end = typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : start;
      var v = String(textarea.value || "");
      textarea.value = v.slice(0, start) + "\n" + v.slice(end);
      textarea.selectionStart = textarea.selectionEnd = start + 1;
      e.preventDefault();
      e.stopPropagation();
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function parseEntriesFromInput(input) {
    var html = String(input || "").trim();
    if (!html) return [];
    var box = document.createElement("div");
    box.innerHTML = html;
    var fromBlocks = box.querySelectorAll(".platform-entry");
    var entries = [];
    function pushCompletedEntry(target, title, desc) {
      var t = String(title || "").trim();
      var d = String(desc || "").trim();
      if (!t || !d) return;
      if (t === "자료명칭" && d === "세부설명") return;
      target.push({ title: t, desc: d });
    }
    if (fromBlocks.length) {
      Array.prototype.forEach.call(fromBlocks, function (node) {
        var titleNode =
          node.querySelector(".platform-entry-title-text") ||
          node.querySelector(".platform-entry-heading") ||
          node.querySelector(".platform-entry-title");
        var descNode =
          node.querySelector(".platform-entry-body") ||
          node.querySelector(".platform-entry-desc-body") ||
          node.querySelector(".platform-entry-desc");
        var title = String(titleNode ? titleNode.textContent : "")
          .replace(/^\(\d+\)\s*/, "")
          .replace(/^자료명:\s*/i, "")
          .trim();
        var desc = String(descNode ? descNode.innerHTML : "")
          .replace(/^\s*<strong>\s*설명:\s*<\/strong>\s*/i, "")
          .replace(/^\s*설명:\s*/i, "")
          .trim();
        pushCompletedEntry(entries, title, desc);
      });
      return entries;
    }
    var text = String(box.textContent || "").replace(/\r/g, "");
    var lines = text
      .split("\n")
      .map(function (line) { return line.trim(); })
      .filter(function (line) { return !!line; });
    if (!lines.length) return [];
    var curTitle = "";
    var curDesc = "";
    var hasLabel = lines.some(function (line) {
      return /^자료명\s*:/i.test(line) || /^설명\s*:/i.test(line);
    });
    if (hasLabel) {
      lines.forEach(function (line) {
        if (/^자료명\s*:/i.test(line)) {
          pushCompletedEntry(entries, curTitle, curDesc);
          curTitle = "";
          curDesc = "";
          curTitle = line.replace(/^자료명\s*:/i, "").trim();
        } else if (/^설명\s*:/i.test(line)) {
          curDesc = line.replace(/^설명\s*:/i, "").trim();
          pushCompletedEntry(entries, curTitle, curDesc);
          curTitle = "";
          curDesc = "";
        } else if (!curTitle) {
          curTitle = line;
        } else {
          curDesc = line;
          pushCompletedEntry(entries, curTitle, curDesc);
          curTitle = "";
          curDesc = "";
        }
      });
      pushCompletedEntry(entries, curTitle, curDesc);
    } else {
      for (var i = 0; i < lines.length; i += 2) {
        pushCompletedEntry(entries, lines[i] || "", lines[i + 1] || "");
      }
    }
    return entries;
  }

  function buildStructuredBodyHtml(lead, bodyHtml) {
    var rawLead = String(lead || "").trim();
    var rawBody = String(bodyHtml || "").trim();
    var entries = [];
    if (/class\s*=\s*["'][^"']*platform-entry/i.test(rawBody)) {
      entries = parseEntriesFromInput(rawBody);
    } else if (rawLead || rawBody) {
      entries = [{ title: rawLead, desc: rawBody }];
    }
    if (!entries.length) return "";
    return entries
      .map(function (one, idx) {
        return (
          '<div class="platform-entry">' +
          '<p class="platform-entry-heading">' +
          '<span class="platform-entry-title-text">' + escapeHtmlText(one.title || "") + "</span>" +
          '<span class="platform-entry-actions">' +
          '<button type="button" class="btn btn-ghost" data-entry-act="edit" data-entry-idx="' + idx + '">수정</button>' +
          '<button type="button" class="btn btn-ghost" data-entry-act="delete" data-entry-idx="' + idx + '">삭제</button>' +
          '<button type="button" class="btn btn-ghost" data-entry-act="save" data-entry-idx="' + idx + '">저장</button>' +
          "</span>" +
          "</p>" +
          '<div class="platform-entry-body">' + (one.desc ? linkifyHtmlUrls(one.desc) : "&nbsp;") + "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function buildStructuredBodyHtmlFromEntries(entries) {
    var list = Array.isArray(entries) ? entries : [];
    if (!list.length) return "";
    return list
      .map(function (one, idx) {
        return (
          '<div class="platform-entry">' +
          '<p class="platform-entry-heading">' +
          '<span class="platform-entry-title-text">' + escapeHtmlText(one.title || "") + "</span>" +
          '<span class="platform-entry-actions">' +
          '<button type="button" class="btn btn-ghost" data-entry-act="edit" data-entry-idx="' + idx + '">수정</button>' +
          '<button type="button" class="btn btn-ghost" data-entry-act="delete" data-entry-idx="' + idx + '">삭제</button>' +
          '<button type="button" class="btn btn-ghost" data-entry-act="save" data-entry-idx="' + idx + '">저장</button>' +
          "</span>" +
          "</p>" +
          '<div class="platform-entry-body">' + (one.desc ? linkifyHtmlUrls(one.desc) : "&nbsp;") + "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function dedupeEntries(entries) {
    var list = Array.isArray(entries) ? entries : [];
    var seen = Object.create(null);
    var out = [];
    list.forEach(function (one) {
      var t = String(one && one.title ? one.title : "").trim();
      var d = String(one && one.desc ? one.desc : "").trim();
      if (!t || !d) return;
      var key = t + "\u241f" + d;
      if (seen[key]) return;
      seen[key] = true;
      out.push({ title: t, desc: d });
    });
    return out;
  }

  async function persistEntries(lead, entries) {
    var mergedBodyHtml = buildStructuredBodyHtmlFromEntries(entries);
    if (!client) {
      if (STRICT_CLOUD_SYNC_WHEN_AVAILABLE) {
        return {
          ok: false,
          source: "cloud",
          message: "Supabase가 연결되지 않아 저장할 수 없습니다. supabase-config.js와 배포 주소(HTTPS)를 확인하세요."
        };
      }
      saveLocal(lead, mergedBodyHtml);
      applyToPage(lead, mergedBodyHtml);
      currentPersistedRecord = {
        source: "local",
        lead: lead,
        body_html: mergedBodyHtml,
        saved_at: new Date().toISOString()
      };
      renderSavedManager();
      return { ok: true, source: "local" };
    }
    var resolvedCol = await resolveCloudBodyColumn();
    if (!resolvedCol) {
      return {
        ok: false,
        source: "cloud",
        message:
          "platform_pages 본문 컬럼을 찾지 못했습니다. Supabase SQL Editor에서 platform_pages.sql을 실행해 body_html 컬럼을 생성해 주세요."
      };
    }
    var payload = {
      slug: slug,
      lead: lead,
      title: lead,
      updated_at: new Date().toISOString()
    };
    payload[resolvedCol] = mergedBodyHtml;
    var upsertRes = await client.from("platform_pages").upsert(payload, { onConflict: "slug" });
    if (upsertRes.error) {
      return { ok: false, source: "cloud", message: String(upsertRes.error.message || "") };
    }
    applyToPage(lead, mergedBodyHtml);
    try {
      saveLocal(lead, mergedBodyHtml);
    } catch (e) {}
    currentPersistedRecord = {
      source: "cloud",
      lead: lead,
      body_html: mergedBodyHtml,
      saved_at: new Date().toISOString()
    };
    renderSavedManager();
    return { ok: true, source: "cloud" };
  }

  async function resolveCloudBodyColumn() {
    if (!client) return null;
    var cols = [cloudBodyColumn].concat(
      CLOUD_BODY_CANDIDATE_COLUMNS.filter(function (c) {
        return c !== cloudBodyColumn;
      })
    );
    for (var i = 0; i < cols.length; i += 1) {
      var col = cols[i];
      var probe = await client.from("platform_pages").select("slug,lead," + col).limit(1);
      if (!probe.error) {
        cloudBodyColumn = col;
        return col;
      }
    }
    return null;
  }

  function extractBodyEditorContent(renderedHtml) {
    var html = String(renderedHtml || "").trim();
    if (!html) return "";
    var box = document.createElement("div");
    box.innerHTML = html;
    var bodies = box.querySelectorAll(".platform-entry-desc-body");
    if (bodies.length) {
      var out = [];
      Array.prototype.forEach.call(bodies, function (one) {
        var seg = String(one.innerHTML || "").trim();
        if (seg) out.push(seg);
      });
      return out.join("<p><br></p>");
    }
    return html;
  }

  function escapeHtmlText(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function linkifyHtmlUrls(html) {
    var raw = String(html || "").trim();
    if (!raw) return "";
    var box = document.createElement("div");
    box.innerHTML = raw;
    var walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, null);
    var textNodes = [];
    while (walker.nextNode()) {
      var node = walker.currentNode;
      if (!node || !node.nodeValue) continue;
      if (!String(node.nodeValue || "").trim()) continue;
      var parent = node.parentNode;
      if (parent && parent.nodeName && String(parent.nodeName).toLowerCase() === "a") continue;
      textNodes.push(node);
    }
    var urlRe = /(https?:\/\/[^\s<>"']+)/gi;
    textNodes.forEach(function (node) {
      var text = String(node.nodeValue || "");
      if (!urlRe.test(text)) return;
      urlRe.lastIndex = 0;
      var frag = document.createDocumentFragment();
      var last = 0;
      var m;
      while ((m = urlRe.exec(text)) !== null) {
        var start = m.index;
        var url = m[1];
        if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
        var a = document.createElement("a");
        a.href = url;
        a.textContent = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        frag.appendChild(a);
        last = start + url.length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    return box.innerHTML.trim();
  }

  function buildEntriesHtml(entries) {
    var list = Array.isArray(entries) ? entries : [];
    if (!list.length) return "";
    return list
      .map(function (one) {
        return (
          '<div class="platform-entry">' +
          '<p class="platform-entry-title"><strong>자료명:</strong> ' + escapeHtmlText(one.title || "") + "</p>" +
          '<p class="platform-entry-desc"><strong>설명:</strong> ' + escapeHtmlText(one.desc || "") + "</p>" +
          "</div>"
        );
      })
      .join("");
  }

  function buildEditorText(entries, withTemplateTail) {
    var list = Array.isArray(entries) ? entries : [];
    var body = list
      .map(function (one) {
        return "자료명: " + String(one.title || "") + "\n설명: " + String(one.desc || "");
      })
      .join("\n\n")
      .trim();
    if (!withTemplateTail) return body;
    if (!ENTRY_TEMPLATE_TEXT) return body;
    if (!body) return ENTRY_TEMPLATE_TEXT;
    return body + "\n\n" + ENTRY_TEMPLATE_TEXT;
  }

  function stripHtmlForPreview(html) {
    var text = String(html || "").replace(/<[^>]*>/g, " ");
    return text.replace(/\s+/g, " ").trim();
  }

  function getSavedManagerElements() {
    return {
      host: document.getElementById("platform-saved-manager"),
      meta: document.getElementById("platform-saved-meta"),
      preview: document.getElementById("platform-saved-preview"),
      btnLoad: document.getElementById("platform-btn-load-saved"),
      btnDelete: document.getElementById("platform-btn-delete-saved")
    };
  }

  function ensureSavedManagerUi() {
    if (!editorPanel) return;
    if (document.getElementById("platform-saved-manager")) return;
    var html =
      '<section id="platform-saved-manager" class="platform-saved-manager" aria-label="등록본 관리">' +
      "<h3>등록본 관리</h3>" +
      '<p id="platform-saved-meta" class="platform-hint" style="margin-top:0.25rem">등록된 저장본이 없습니다.</p>' +
      '<p id="platform-saved-preview" class="platform-saved-preview"></p>' +
      '<div class="cta-row" style="margin-top:0.55rem">' +
      '<button type="button" class="btn btn-ghost" id="platform-btn-load-saved">등록본 불러오기</button>' +
      '<button type="button" class="btn btn-ghost" id="platform-btn-delete-saved">등록본 삭제</button>' +
      "</div>" +
      "</section>";
    editorPanel.insertAdjacentHTML("afterbegin", html);
  }

  function renderSavedManager() {
    var els = getSavedManagerElements();
    if (!els.host || !els.meta || !els.preview || !els.btnLoad || !els.btnDelete) return;
    var on = isAdmin();
    if (!on) {
      els.host.style.display = "none";
      return;
    }
    els.host.style.display = "";
    var rec = currentPersistedRecord;
    if (!rec) {
      els.meta.textContent = "등록된 저장본이 없습니다. 아래 편집창에서 입력 후 저장해 주세요.";
      els.preview.textContent = "";
      els.btnLoad.disabled = true;
      els.btnDelete.disabled = true;
      return;
    }
    var srcLabel = rec.source === "cloud" ? "Supabase" : "로컬";
    var dateLabel = rec.saved_at ? " (" + String(rec.saved_at).slice(0, 16).replace("T", " ") + ")" : "";
    var plain = stripHtmlForPreview(rec.body_html);
    var preview = plain || String(rec.lead || "").trim();
    if (preview.length > 120) preview = preview.slice(0, 120) + "...";
    els.meta.textContent = srcLabel + " 저장본이 등록되어 있습니다" + dateLabel + ".";
    els.preview.textContent = preview ? "미리보기: " + preview : "";
    els.btnLoad.disabled = false;
    els.btnDelete.disabled = false;
  }

  function loadEditorsFromPage() {
    var leadText = String(leadEl.textContent || "").trim();
    if (!leadText) {
      var entries = parseEntriesFromInput(bodyEl.innerHTML.trim());
      if (entries.length) leadText = String(entries[0].title || "").trim();
    }
    syncEditors(leadText, extractBodyEditorContent(bodyEl.innerHTML.trim()));
  }

  function insertImageIntoBodyEditor(src, altText) {
    var editor = document.getElementById("platform-edit-body-editor");
    if (!editor || !src) return;
    editor.focus();
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      editor.innerHTML += '<p><img src="' + src + '" alt="' + (altText || "") + '" style="max-width:100%;height:auto;" /></p>';
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    var range = sel.getRangeAt(0);
    var img = document.createElement("img");
    img.src = src;
    img.alt = altText || "";
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    range.deleteContents();
    range.insertNode(img);
    range.setStartAfter(img);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function ensureBodyRichEditor(textarea) {
    if (!textarea || document.getElementById("platform-edit-body-editor")) return;
    var toolbar = document.createElement("div");
    toolbar.id = "platform-edit-toolbar";
    toolbar.className = "platform-edit-toolbar";
    toolbar.innerHTML =
      '<button type="button" class="btn btn-ghost" data-cmd="bold">진하게</button>' +
      '<button type="button" class="btn btn-ghost" data-cmd="underline">밑줄</button>' +
      '<button type="button" class="btn btn-ghost" data-cmd="justifyLeft">왼쪽</button>' +
      '<button type="button" class="btn btn-ghost" data-cmd="justifyCenter">가운데</button>' +
      '<button type="button" class="btn btn-ghost" data-cmd="justifyRight">오른쪽</button>' +
      '<input id="platform-edit-file-input" type="file" accept="image/*" multiple />';
    var editor = document.createElement("div");
    editor.id = "platform-edit-body-editor";
    editor.className = "platform-edit-body-editor";
    editor.contentEditable = "true";
    editor.innerHTML = textarea.value || "";
    textarea.style.display = "none";
    textarea.parentNode.insertBefore(toolbar, textarea);
    textarea.parentNode.insertBefore(editor, textarea);

    toolbar.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var cmd = t.getAttribute("data-cmd");
      if (!cmd) return;
      e.preventDefault();
      editor.focus();
      try {
        document.execCommand(cmd, false, null);
      } catch (err) {}
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });

    var fileInput = document.getElementById("platform-edit-file-input");
    if (fileInput) {
      fileInput.addEventListener("change", function () {
        var files = fileInput.files || [];
        Array.prototype.forEach.call(files, function (file) {
          if (!file || !/^image\//i.test(String(file.type || ""))) return;
          var reader = new FileReader();
          reader.onload = function () {
            insertImageIntoBodyEditor(String(reader.result || ""), file.name || "");
          };
          reader.readAsDataURL(file);
        });
        fileInput.value = "";
      });
    }

    editor.addEventListener("input", function () {
      textarea.value = editor.innerHTML.trim();
    });
    editor.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) {
        editor.innerHTML = linkifyHtmlUrls(editor.innerHTML) + "<br><br>";
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      var range = sel.getRangeAt(0);
      range.deleteContents();
      var br1 = document.createElement("br");
      var br2 = document.createElement("br");
      var caret = document.createElement("span");
      caret.setAttribute("data-platform-caret", "1");
      caret.style.display = "inline-block";
      caret.style.width = "0";
      range.insertNode(br2);
      range.insertNode(br1);
      range.insertNode(caret);
      editor.innerHTML = linkifyHtmlUrls(editor.innerHTML);
      var after = editor.querySelector("span[data-platform-caret='1']");
      if (after) {
        var nextRange = document.createRange();
        nextRange.setStartAfter(after);
        nextRange.collapse(true);
        after.parentNode.removeChild(after);
        sel.removeAllRanges();
        sel.addRange(nextRange);
      }
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  try {
    if (!slug) return;

    if (!root) {
      return;
    }

    if (!document.getElementById("platform-btn-login-supabase")) {
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

    var adminPassSupabase = document.getElementById("platform-admin-pass-supabase");
    var adminPassLocal = document.getElementById("platform-admin-pass-local");
    var btnLoginSupabase = document.getElementById("platform-btn-login-supabase");
    var btnLoginLocal = document.getElementById("platform-btn-login-local");
    var btnLogout = document.getElementById("platform-btn-logout");
    var btnTest = document.getElementById("platform-btn-test");
    var authStatus = document.getElementById("platform-auth-status");
    var authMode = document.getElementById("platform-auth-mode");
    var authSupabaseHint = document.getElementById("platform-auth-supabase-hint");
    var authPanelLoggedOut = document.getElementById("platform-auth-panel-logged-out");
    var authPanelAdmin = document.getElementById("platform-auth-panel-admin");
    var editorPanel = document.getElementById("platform-editor-panel");
    var formStatus = document.getElementById("platform-form-status");
    var btnSave = document.getElementById("platform-btn-save");
    var btnRevert = document.getElementById("platform-btn-revert");
    var editorLead = document.getElementById("platform-edit-lead");
    var editorBody = document.getElementById("platform-edit-body");
    var leadLabel = document.querySelector('label[for="platform-edit-lead"]');
    var bodyLabel = document.querySelector('label[for="platform-edit-body"]');

    if (!btnLoginSupabase || !btnLoginLocal || !btnLogout || !btnSave) {
      root.insertAdjacentHTML(
        "afterbegin",
        '<p class="platform-panel" style="border-color:#b02135;">관리자 UI 버튼을 찾을 수 없습니다. platform-admin.js 배포 여부를 확인하세요.</p>'
      );
      return;
    }

    forceTextareaNewlineOnEnter(editorLead);
    forceTextareaNewlineOnEnter(editorBody);
    ensureBodyRichEditor(editorBody);
    if (leadLabel) leadLabel.textContent = "자료명";
    if (bodyLabel) bodyLabel.textContent = "세부 내용 및 사용방법";
    if (editorLead) editorLead.rows = 2;
    if (editorBody) editorBody.rows = 7;

    function syncAdminRootVisibility() {
      if (!root) return;
      root.style.display = adminRootOpen ? "" : "none";
      if (adminToggleBtn) {
        adminToggleBtn.textContent = adminRootOpen ? "관리자 모드 닫기" : "관리자 모드";
        adminToggleBtn.setAttribute("aria-expanded", adminRootOpen ? "true" : "false");
      }
    }

    function ensureAdminToggleButton() {
      if (adminToggleBtn) return;
      var topLinks = document.querySelector(".topbar .links");
      var heading = document.querySelector("article h1");
      var mountHost = topLinks || (heading && heading.parentNode ? heading.parentNode : null);
      if (!mountHost) return;

      var btn = document.createElement("button");
      btn.type = "button";
      btn.id = "platform-admin-toggle-btn";
      btn.className = "btn btn-ghost";
      btn.style.margin = "0";
      btn.textContent = "관리자 모드";
      btn.setAttribute("aria-expanded", "false");
      btn.addEventListener("click", async function () {
        var nextOpen = !adminRootOpen;
        if (!nextOpen && isAdmin()) {
          await deactivateAdminMode({ silent: false });
          adminRootOpen = false;
          syncAdminRootVisibility();
          return;
        }
        adminRootOpen = nextOpen;
        if (adminRootOpen && !isAdmin()) {
          setStatus(authStatus, "", "일반 로그인 또는 로컬 비상 모드 로그인을 선택해 주세요.");
        }
        updateAdminUi();
      });
      mountHost.appendChild(btn);
      adminToggleBtn = btn;
      syncAdminRootVisibility();
    }

    function applyAuthModeIndicator() {
      if (!authMode) return;
      if (isAdmin()) {
        authMode.setAttribute("data-mode", "admin");
        authMode.textContent = localAdmin
          ? "현재: 로컬 비상 관리자 (브라우저 저장)"
          : "현재: 일반 관리자 (Supabase)";
      } else {
        authMode.setAttribute("data-mode", "view");
        authMode.textContent = "현재: 일반 보기";
      }
    }

    function updateAdminUi() {
      var on = isAdmin();
      if (on) adminRootOpen = true;
      document.body.classList.toggle("platform-admin-on", !!on);
      if (editorPanel) editorPanel.style.display = on ? "block" : "none";
      if (authPanelLoggedOut) authPanelLoggedOut.style.display = on ? "none" : "block";
      if (authPanelAdmin) authPanelAdmin.style.display = on ? "block" : "none";
      if (adminPassSupabase) adminPassSupabase.disabled = on || !client;
      if (btnLoginSupabase) btnLoginSupabase.disabled = on || !client;
      if (adminPassLocal) adminPassLocal.disabled = on || STRICT_CLOUD_SYNC_WHEN_AVAILABLE;
      if (btnLoginLocal) btnLoginLocal.disabled = on || STRICT_CLOUD_SYNC_WHEN_AVAILABLE;
      if (btnTest) btnTest.disabled = on;
      if (authSupabaseHint) {
        if (!client) {
          authSupabaseHint.style.display = "";
          authSupabaseHint.textContent = STRICT_CLOUD_SYNC_WHEN_AVAILABLE
            ? "현재는 클라우드 전용 모드입니다. Supabase URL/키(supabase-config.js)를 설정해야 저장됩니다."
            : "Supabase URL/키(supabase-config.js)가 없어 일반 로그인을 사용할 수 없습니다. 아래 로컬 비상 모드만 이용할 수 있습니다.";
        } else {
          authSupabaseHint.style.display = "none";
          authSupabaseHint.textContent = "";
        }
      }
      applyAuthModeIndicator();
      if (localAdmin) {
        setStatus(authStatus, "ok", "로컬 비상 관리자 모드가 켜졌습니다.");
      } else if (on) {
        setStatus(authStatus, "ok", "일반 관리자(Supabase) 모드가 켜졌습니다.");
      } else {
        setStatus(authStatus, "", "관리자 모드가 꺼져 있습니다.");
      }
      syncAdminRootVisibility();
      renderSavedManager();
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
      adminRootOpen = false;
      if (adminPassSupabase) adminPassSupabase.value = "";
      if (adminPassLocal) adminPassLocal.value = "";
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
      adminRootOpen = false;
    }

    async function loadFromCloud() {
      if (!client) return null;
      var res = await client.from("platform_pages").select("*").eq("slug", slug).maybeSingle();
      if (res.error) {
        lastCloudLoadError = String(res.error.message || "unknown");
        console.warn("platform_pages:", lastCloudLoadError);
        return null;
      }
      lastCloudLoadError = "";
      var row = res.data || null;
      if (!row) return null;
      var bodyValue = "";
      for (var i = 0; i < CLOUD_BODY_CANDIDATE_COLUMNS.length; i += 1) {
        var oneCol = CLOUD_BODY_CANDIDATE_COLUMNS[i];
        if (row[oneCol] !== undefined) {
          bodyValue = row[oneCol];
          cloudBodyColumn = oneCol;
          break;
        }
      }
      return {
        lead: row.lead !== undefined ? row.lead : row.title,
        body_html: bodyValue,
        updated_at: row.updated_at
      };
    }

    async function refreshPersistedRecord() {
      var cloud = await loadFromCloud();
      if (cloud && (cloud.lead !== undefined || cloud.body_html !== undefined)) {
        currentPersistedRecord = {
          source: "cloud",
          lead: String(cloud.lead || ""),
          body_html: String(cloud.body_html || ""),
          saved_at: String(cloud.updated_at || "")
        };
        return currentPersistedRecord;
      }
      if (STRICT_CLOUD_SYNC_WHEN_AVAILABLE) {
        currentPersistedRecord = null;
        return null;
      }
      var loc = loadLocal();
      if (loc) {
        currentPersistedRecord = {
          source: "local",
          lead: String(loc.lead || ""),
          body_html: String(loc.body_html || ""),
          saved_at: String(loc.saved_at || "")
        };
        return currentPersistedRecord;
      }
      currentPersistedRecord = null;
      return null;
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
        var saved = await refreshPersistedRecord();
        if (saved) {
          applyToPage(saved.lead, saved.body_html);
          applied = true;
        }
      }

      updateAdminUi();

      var persistHint = document.getElementById("platform-persist-hint");
      if (persistHint && persistHint.parentNode) {
        persistHint.parentNode.removeChild(persistHint);
      }
    }

    init()
      .then(function () {
        clearEditors();
        ensureAdminToggleButton();
        ensureSavedManagerUi();
        renderSavedManager();
        syncAdminRootVisibility();
      })
      .catch(function () {
        clearEditors();
        ensureAdminToggleButton();
        ensureSavedManagerUi();
        renderSavedManager();
        syncAdminRootVisibility();
      });

    var forcedOffByNavigation = false;
    try {
      forcedOffByNavigation = sessionStorage.getItem(ADMIN_OFF_FLAG_KEY) === "1";
      sessionStorage.removeItem(ADMIN_OFF_FLAG_KEY);
    } catch (e) {}
    if (forcedOffByNavigation) {
      deactivateAdminMode({ silent: true });
    }

    window.addEventListener("beforeunload", function () {
      clearAdminStateOnLeave();
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

    document.addEventListener("click", async function (e) {
      var t = e.target;
      if (!t) return;
      if (t.id === "platform-btn-load-saved") {
        if (!isAdmin()) {
          setStatus(formStatus, "err", "관리자 모드에서만 불러올 수 있습니다.");
          return;
        }
        if (!currentPersistedRecord) {
          setStatus(formStatus, "err", "불러올 등록본이 없습니다.");
          return;
        }
        syncEditors(
          currentPersistedRecord.lead,
          extractBodyEditorContent(currentPersistedRecord.body_html)
        );
        setStatus(formStatus, "ok", "등록본을 편집창으로 불러왔습니다. 수정 후 저장하세요.");
      }
      if (t.id === "platform-btn-delete-saved") {
        if (!isAdmin()) {
          setStatus(formStatus, "err", "관리자만 삭제할 수 있습니다.");
          return;
        }
        var clearBtn = document.getElementById("platform-btn-clear-persisted");
        if (clearBtn) clearBtn.click();
      }
    });

    bodyEl.addEventListener("click", async function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-entry-act]") : null;
      if (!btn || !isAdmin()) return;
      var act = String(btn.getAttribute("data-entry-act") || "");
      var idx = Number(btn.getAttribute("data-entry-idx"));
      if (Number.isNaN(idx)) return;
      var entries = parseEntriesFromInput(bodyEl.innerHTML);
      if (idx < 0 || idx >= entries.length) return;

      if (act === "edit") {
        selectedEntryIndex = idx;
        syncEditors(entries[idx].title || "", entries[idx].desc || "");
        setStatus(formStatus, "ok", "항목 (" + (idx + 1) + ")을 편집창으로 불러왔습니다.");
        return;
      }
      if (act === "delete") {
        var okDel = window.confirm("항목 (" + (idx + 1) + ")을 삭제할까요?");
        if (!okDel) return;
        var nextEntries = entries.filter(function (_, i) { return i !== idx; });
        var leadKeep = nextEntries.length ? String(nextEntries[0].title || "").trim() : "";
        try {
          await persistEntries(leadKeep, nextEntries);
          selectedEntryIndex = -1;
          setStatus(formStatus, "ok", "항목을 삭제했습니다.");
        } catch (errDel) {
          setStatus(formStatus, "err", "삭제 중 오류: " + (errDel && errDel.message ? errDel.message : String(errDel)));
        }
        return;
      }
      if (act === "save") {
        var current = readEditors();
        var tTitle = String(current.lead || "").trim();
        var tDesc = String(current.body_html || "").trim();
        if (!tTitle || !tDesc) {
          setStatus(formStatus, "err", "자료명과 세부 내용 및 사용방법을 모두 입력해 주세요.");
          return;
        }
        entries[idx] = { title: tTitle, desc: tDesc };
        var leadKeep2 = entries.length ? String(entries[0].title || "").trim() : "";
        try {
          var saveRowRes = await persistEntries(leadKeep2, entries);
          selectedEntryIndex = idx;
          if (!saveRowRes.ok) {
            setStatus(formStatus, "err", "클라우드 저장 실패: " + String(saveRowRes.message || ""));
          } else {
            setStatus(formStatus, "ok", "항목 (" + (idx + 1) + ")을 저장했습니다.");
          }
        } catch (errSaveRow) {
          setStatus(formStatus, "err", "저장 중 오류: " + (errSaveRow && errSaveRow.message ? errSaveRow.message : String(errSaveRow)));
        }
      }
    });

    btnLoginSupabase.addEventListener("click", async function () {
      var val = (adminPassSupabase && adminPassSupabase.value ? adminPassSupabase.value : "").trim();
      if (!val) {
        setStatus(authStatus, "err", "Supabase 관리자 비밀번호를 입력해 주세요.");
        return;
      }
      if (!client) {
        setStatus(authStatus, "err", "Supabase가 연결되지 않았습니다. 설정을 확인하거나 로컬 비상 모드를 이용하세요.");
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
        if (adminPassSupabase) adminPassSupabase.value = "";
        if (adminPassLocal) adminPassLocal.value = "";
        updateAdminUi();
      } catch (err) {
        setStatus(authStatus, "err", "로그인 연결 실패. 네트워크·HTTPS 배포 주소를 확인하세요.");
      }
    });

    btnLoginLocal.addEventListener("click", function () {
      if (STRICT_CLOUD_SYNC_WHEN_AVAILABLE) {
        setStatus(authStatus, "err", "클라우드 전용 모드에서는 로컬 비상 모드를 사용할 수 없습니다.");
        return;
      }
      var val = (adminPassLocal && adminPassLocal.value ? adminPassLocal.value : "").trim();
      if (!val) {
        setStatus(authStatus, "err", "비상 모드 비밀번호를 입력해 주세요.");
        return;
      }
      if (val !== "admin1234") {
        setStatus(authStatus, "err", "비상 모드 비밀번호가 올바르지 않습니다.");
        return;
      }
      localAdmin = true;
      currentSession = null;
      if (adminPassLocal) adminPassLocal.value = "";
      if (adminPassSupabase) adminPassSupabase.value = "";
      updateAdminUi();
    });

    btnLogout.addEventListener("click", async function () {
      if (!isAdmin()) {
        if (adminPassSupabase) adminPassSupabase.value = "";
        if (adminPassLocal) adminPassLocal.value = "";
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
      syncEditors(initialLead, extractBodyEditorContent(initialBodyHtml));
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
          currentPersistedRecord = null;
          renderSavedManager();
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
      var newEntryTitle = String(v.lead || "").trim();
      var newEntryDesc = String(v.body_html || "").trim();
      if (!newEntryTitle || !newEntryDesc) {
        setStatus(formStatus, "err", "자료명과 세부 내용 및 사용방법을 모두 입력해 주세요.");
        return;
      }
      try {
        await refreshPersistedRecord();
      } catch (e0) {}
      var existingSourceHtml =
        currentPersistedRecord && currentPersistedRecord.body_html
          ? currentPersistedRecord.body_html
          : bodyEl.innerHTML;
      var existingEntries = parseEntriesFromInput(existingSourceHtml);
      if (!existingEntries.length && currentPersistedRecord) {
        var legacyTitle = String(currentPersistedRecord.lead || "").trim();
        var legacyDesc = String(currentPersistedRecord.body_html || "").trim();
        if (legacyTitle && legacyDesc) {
          existingEntries = [{ title: legacyTitle, desc: legacyDesc }];
        }
      }
      var mergedEntries = [];
      if (selectedEntryIndex >= 0 && selectedEntryIndex < existingEntries.length) {
        // 수정 모드: 기존 항목을 교체(신규 추가 금지)
        mergedEntries = existingEntries.slice();
        mergedEntries[selectedEntryIndex] = { title: newEntryTitle, desc: newEntryDesc };
      } else {
        // 신규 모드: 최신 항목을 상단에 추가
        mergedEntries = [{ title: newEntryTitle, desc: newEntryDesc }].concat(
          existingEntries.filter(function (one) {
            return !(
              String(one.title || "").trim() === newEntryTitle &&
              String(one.desc || "").trim() === newEntryDesc
            );
          })
        );
      }
      mergedEntries = dedupeEntries(mergedEntries);
      setStatus(formStatus, "", "저장 중...");
      btnSave.disabled = true;
      btnSave.textContent = "저장 중...";

      try {
        var persistRes = await persistEntries(v.lead, mergedEntries);
        if (!persistRes.ok) {
          var msg2 = String(persistRes.message || "");
          setStatus(formStatus, "err", "클라우드 저장 실패: " + msg2);
        } else if (persistRes.source === "local") {
          setStatus(formStatus, "ok", "브라우저(로컬)에 저장했습니다. Supabase를 연결하면 다른 기기에서도 동일하게 볼 수 있습니다.");
          selectedEntryIndex = -1;
          clearEditors();
        } else {
          setStatus(formStatus, "ok", "저장되었습니다(Supabase).");
          selectedEntryIndex = -1;
          clearEditors();
        }
      } catch (e) {
        setStatus(formStatus, "err", "저장 중 오류: " + (e && e.message ? e.message : String(e)));
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
