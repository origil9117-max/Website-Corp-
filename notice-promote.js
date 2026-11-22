(function (global) {
  var LOCAL_NOTICE_KEY = "websiteCorpNotices";
  var DEFAULT_NOTICE_DAYS = 7;
  var UNTIL_RE = /<!--\s*notice-until:([^>]+?)\s*-->/i;

  function clampDays(days) {
    var n = Number(days);
    if (!isFinite(n) || n < 1) return DEFAULT_NOTICE_DAYS;
    return Math.round(n);
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function untilFromDays(days, from) {
    var start = from ? new Date(from) : new Date();
    if (isNaN(start.getTime())) start = new Date();
    return new Date(start.getTime() + clampDays(days) * 24 * 60 * 60 * 1000).toISOString();
  }

  function formatUntil(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function stampContent(content, untilIso) {
    var html = String(content || "").replace(UNTIL_RE, "").trim();
    return "<!--notice-until:" + untilIso + "-->" + html;
  }

  function readUntil(notice) {
    var html = String((notice && notice.content) || "");
    var marked = html.match(UNTIL_RE);
    if (marked && marked[1]) {
      var stamped = new Date(String(marked[1]).trim());
      if (!isNaN(stamped.getTime())) return stamped.toISOString();
    }
    var created = new Date(String((notice && (notice.created_at || notice.createdText)) || ""));
    if (!isNaN(created.getTime())) {
      return new Date(created.getTime() + DEFAULT_NOTICE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    }
    return "";
  }

  function isActive(notice, nowMs) {
    if (!notice || !notice.pinned) return false;
    var until = readUntil(notice);
    if (!until) return false;
    var now = nowMs == null ? Date.now() : nowMs;
    return new Date(until).getTime() > now;
  }

  function periodPhrase(days) {
    var n = clampDays(days);
    var label = formatUntil(untilFromDays(n));
    if (n === DEFAULT_NOTICE_DAYS) return "공지 기간은 1주일(" + label + "까지)입니다.";
    return "공지 기간은 " + n + "일(" + label + "까지)입니다.";
  }

  function storedDays(notice) {
    var until = readUntil(notice);
    var start = new Date(String((notice && (notice.created_at || notice.createdText)) || ""));
    if (!until || isNaN(start.getTime())) return DEFAULT_NOTICE_DAYS;
    var days = Math.round((new Date(until).getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    if (!isFinite(days) || days < 1) return DEFAULT_NOTICE_DAYS;
    return days;
  }

  function loadLocalNotices() {
    try {
      var raw = localStorage.getItem(LOCAL_NOTICE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveLocalNotices(items) {
    localStorage.setItem(LOCAL_NOTICE_KEY, JSON.stringify(items));
  }

  function saveNoticeLocal(title, content) {
    var items = loadLocalNotices().map(function (n) {
      n.pinned = false;
      return n;
    });
    items.unshift({
      id: String(Date.now()),
      title: title,
      content: content,
      pinned: true,
      created_at: new Date().toISOString(),
      createdText: new Date().toISOString().slice(0, 16).replace("T", " ")
    });
    saveLocalNotices(items);
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function extractHref(content) {
    var html = String(content || "");
    try {
      var doc = new DOMParser().parseFromString(html, "text/html");
      var a = doc.querySelector("a[href]");
      if (a) {
        var parsed = String(a.getAttribute("href") || "").trim();
        if (parsed) return parsed;
      }
    } catch (e) {}
    var m = html.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!m || !m[1]) return "";
    return m[1]
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
  }

  function buildContent(areaLine, href, linkLabel) {
    var parts = [];
    if (areaLine) parts.push("<p>" + escapeHtml(areaLine) + "</p>");
    parts.push(
      '<p><a class="from-service-post" href="' +
        escapeHtml(href) +
        '">' +
        escapeHtml(linkLabel || "게시글 보기") +
        "</a></p>"
    );
    return parts.join("");
  }

  async function promote(opts) {
    var title = String((opts && opts.title) || "").trim() || "업무 안내";
    var content = String((opts && opts.content) || "").trim();
    var client = opts && opts.client;
    var skipConfirm = !!(opts && opts.skipConfirm);
    var days = clampDays(opts && opts.days);
    var untilIso = untilFromDays(days);
    var periodLine = periodPhrase(days);
    if (!content) {
      return { ok: false, message: "공지 내용이 비어 있습니다." };
    }
    content = stampContent(content, untilIso);
    if (
      !skipConfirm &&
      !confirm("이 글을 홈 상단 공지로 올리겠습니까?\n" + periodLine + "\n기존 고정 공지는 해제됩니다.")
    ) {
      return { ok: false, cancelled: true };
    }
    try {
      if (client) {
        var unpinRes = await client.from("notices").update({ pinned: false }).eq("pinned", true);
        var insRes = await client.from("notices").insert({
          title: title,
          content: content,
          pinned: true
        });
        if (insRes.error) {
          saveNoticeLocal(title, content);
          return {
            ok: true,
            local: true,
            message: "공지 클라우드 저장 실패로 이 PC에만 올렸습니다: " + insRes.error.message
          };
        }
        if (unpinRes && unpinRes.error) {
          return {
            ok: true,
            message: "공지를 올렸습니다. 기존 고정 해제에 실패했을 수 있습니다: " + unpinRes.error.message
          };
        }
        return { ok: true, message: "홈 상단 공지로 올렸습니다. " + periodLine };
      }
      saveNoticeLocal(title, content);
      return { ok: true, local: true, message: "홈 상단 공지로 올렸습니다. " + periodLine + " (이 PC 로컬 저장)" };
    } catch (err) {
      saveNoticeLocal(title, content);
      return {
        ok: true,
        local: true,
        message:
          "공지 저장 중 오류로 이 PC에만 올렸습니다: " +
          (err && err.message ? String(err.message) : String(err))
      };
    }
  }

  async function activePinned(client, items) {
    var list = Array.isArray(items) ? items : [];
    var expired = [];
    var active = [];
    list.forEach(function (n) {
      if (!n || !n.pinned) return;
      if (isActive(n)) active.push(n);
      else expired.push(n);
    });
    if (!expired.length) return active;
    expired.forEach(function (n) { n.pinned = false; });
    if (client) {
      var ids = expired
        .map(function (n) { return n.id; })
        .filter(function (id) { return id != null && id !== ""; });
      if (ids.length) {
        try {
          await client.from("notices").update({ pinned: false }).in("id", ids);
        } catch (e) {}
      }
    }
    var local = loadLocalNotices();
    var changed = false;
    local.forEach(function (n) {
      if (n && n.pinned && !isActive(n)) {
        n.pinned = false;
        changed = true;
      }
    });
    if (changed) saveLocalNotices(local);
    return active;
  }

  async function listPinned(client) {
    if (client) {
      var res = await client
        .from("notices")
        .select("id, title, content, pinned, created_at")
        .eq("pinned", true);
      if (!res.error) {
        return { items: await activePinned(client, res.data || []), local: false };
      }
      return {
        items: await activePinned(null, loadLocalNotices().filter(function (n) { return !!n.pinned; })),
        local: true,
        message: res.error.message
      };
    }
    return {
      items: await activePinned(null, loadLocalNotices().filter(function (n) { return !!n.pinned; })),
      local: true
    };
  }

  async function clearPinned(opts) {
    opts = opts || {};
    var client = opts.client || null;
    var title = String(opts.title || "").trim();
    var all = !!opts.all || !title;
    var skipConfirm = !!opts.skipConfirm;

    function matches(n) {
      if (!n || !n.pinned) return false;
      if (all) return true;
      return String(n.title || "").trim() === title;
    }

    var listed = await listPinned(client);
    var targets = (listed.items || []).filter(matches);
    if (!targets.length) {
      return {
        ok: false,
        none: true,
        message: all ? "해제할 고정 공지가 없습니다." : "이 글은 현재 홈 상단 공지가 아닙니다."
      };
    }
    if (!skipConfirm) {
      var names = targets
        .map(function (n) { return String(n.title || "").trim(); })
        .filter(Boolean)
        .join(", ");
      var ask = all
        ? "현재 홈 상단 공지를 해제할까요?\n" + names
        : "「" + title + "」 홈 상단 공지를 해제할까요?";
      if (!confirm(ask)) return { ok: false, cancelled: true };
    }

    if (client && !listed.local) {
      var query = client.from("notices").update({ pinned: false }).eq("pinned", true);
      if (!all) query = query.eq("title", title);
      var res = await query;
      if (res.error) {
        return { ok: false, message: "공지 해제 실패: " + res.error.message };
      }
    }

    var items = loadLocalNotices().map(function (n) {
      if (matches(n)) n.pinned = false;
      return n;
    });
    saveLocalNotices(items);
    return { ok: true, message: "홈 상단 공지를 해제했습니다." };
  }

  global.WebsiteCorpNotice = {
    promote: promote,
    clearPinned: clearPinned,
    listPinned: listPinned,
    activePinned: activePinned,
    buildContent: buildContent,
    extractHref: extractHref,
    escapeHtml: escapeHtml,
    stampContent: stampContent,
    readUntil: readUntil,
    isActive: isActive,
    formatUntil: formatUntil,
    periodPhrase: periodPhrase,
    storedDays: storedDays,
    clampDays: clampDays,
    untilFromDays: untilFromDays,
    DEFAULT_NOTICE_DAYS: DEFAULT_NOTICE_DAYS
  };
})(window);
