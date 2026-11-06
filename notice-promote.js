(function (global) {
  var LOCAL_NOTICE_KEY = "websiteCorpNotices";

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
    if (!content) {
      return { ok: false, message: "공지 내용이 비어 있습니다." };
    }
    if (
      !skipConfirm &&
      !confirm("이 글을 홈 상단 공지로 올리겠습니까?\n기존 고정 공지는 해제됩니다.")
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
        return { ok: true, message: "홈 상단 공지로 올렸습니다. (기존 고정 공지는 해제)" };
      }
      saveNoticeLocal(title, content);
      return { ok: true, local: true, message: "홈 상단 공지로 올렸습니다. (이 PC 로컬 저장)" };
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

  global.WebsiteCorpNotice = {
    promote: promote,
    buildContent: buildContent,
    escapeHtml: escapeHtml
  };
})(window);
