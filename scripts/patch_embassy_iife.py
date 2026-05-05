# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "platform-faq.html"
text = p.read_text(encoding="utf-8")
start_marker = (
    "    (function () {\n"
    "      /** 발췌 목록 — 최신·전체는 외교부 재외공관 주소록(https://www.mofa.go.kr/www/pgm/m_4179/uss/emblgbd/emblgbdAdres.do) 우선 */\n"
)
start = text.index(start_marker)
end_marker = '      rebuildMissionOptions("");\n    })();\n'
end = text.index(end_marker, start) + len(end_marker)

new_block = r"""    (function () {
      var GROUPS = Array.isArray(window.EMBASSY_GROUPS) ? window.EMBASSY_GROUPS.slice() : [];
      GROUPS.sort(function (a, b) {
        return String(a.label).localeCompare(String(b.label), "ko");
      });

      var countrySel = document.getElementById("embassy-country-select");
      var missionSel = document.getElementById("embassy-mission-select");
      var detailEl = document.getElementById("embassy-mofa-detail");
      var dName = document.getElementById("embassy-mofa-detail-name");
      var dPhone = document.getElementById("embassy-mofa-detail-phone");
      var dAddr = document.getElementById("embassy-mofa-detail-address");
      var homeLink = document.getElementById("embassy-mofa-detail-home");
      var resetBtn = document.getElementById("embassy-mofa-reset-btn");

      if (
        !countrySel ||
        !missionSel ||
        !detailEl ||
        !dName ||
        !dPhone ||
        !dAddr ||
        !homeLink ||
        !resetBtn
      ) {
        return;
      }

      if (!GROUPS.length) {
        console.warn("EMBASSY_GROUPS: data/embassy-data.js 로드를 확인하세요.");
      }

      function groupByIndex(val) {
        var i = parseInt(val, 10);
        if (isNaN(i) || i < 0 || i >= GROUPS.length) return null;
        return GROUPS[i];
      }

      function fillCountryOptions() {
        countrySel.innerHTML = "";
        var ph = document.createElement("option");
        ph.value = "";
        ph.textContent = "주재국을 선택하세요";
        countrySel.appendChild(ph);
        GROUPS.forEach(function (g, idx) {
          var opt = document.createElement("option");
          opt.value = String(idx);
          opt.textContent = g.label;
          countrySel.appendChild(opt);
        });
      }

      function clearMissionDetail() {
        detailEl.hidden = true;
      }

      function rebuildMissionOptions(countryIdxVal) {
        missionSel.innerHTML = "";
        var group = groupByIndex(countryIdxVal);
        if (!countryIdxVal || !group) {
          missionSel.disabled = true;
          missionSel.setAttribute("aria-disabled", "true");
          var o0 = document.createElement("option");
          o0.value = "";
          o0.textContent = "먼저 주재국을 선택하세요";
          missionSel.appendChild(o0);
          clearMissionDetail();
          return;
        }
        var list = group.missions || [];
        missionSel.disabled = false;
        missionSel.removeAttribute("aria-disabled");
        var ph = document.createElement("option");
        ph.value = "";
        ph.textContent = "공관을 선택하세요";
        missionSel.appendChild(ph);
        list.forEach(function (row, idx) {
          var opt = document.createElement("option");
          opt.value = String(idx);
          opt.textContent = row.name;
          missionSel.appendChild(opt);
        });
        clearMissionDetail();
      }

      function showMissionDetail(countryIdxVal) {
        var idx = missionSel.value;
        var group = groupByIndex(countryIdxVal);
        if (!group) {
          clearMissionDetail();
          return;
        }
        var list = group.missions || [];
        if (!idx || !list[idx]) {
          clearMissionDetail();
          return;
        }
        var row = list[idx];
        dName.textContent = row.name;
        dPhone.textContent = row.phone || "—";
        dAddr.textContent = row.address || "—";
        homeLink.href =
          row.homepage ||
          "https://www.mofa.go.kr/www/pgm/m_4179/uss/emblgbd/emblgbdAdres.do";
        homeLink.hidden = false;
        detailEl.hidden = false;
      }

      function resetEmbassyPanel() {
        countrySel.value = "";
        rebuildMissionOptions("");
        dName.textContent = "";
        dPhone.textContent = "";
        dAddr.textContent = "";
        homeLink.href = "https://www.mofa.go.kr/www/pgm/m_4179/uss/emblgbd/emblgbdAdres.do";
        clearMissionDetail();
      }

      countrySel.addEventListener("change", function () {
        rebuildMissionOptions(countrySel.value);
      });

      missionSel.addEventListener("change", function () {
        if (missionSel.disabled) return;
        if (!missionSel.value) {
          clearMissionDetail();
          return;
        }
        showMissionDetail(countrySel.value);
      });

      resetBtn.addEventListener("click", resetEmbassyPanel);

      fillCountryOptions();
      rebuildMissionOptions("");
    })();
"""

p.write_text(text[:start] + new_block + text[end:], encoding="utf-8")
print("patched", start, end)
