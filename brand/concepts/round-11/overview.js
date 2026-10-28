/* Prevent a fallback face from being mistaken for a candidate in the sheet. */
(() => {
  "use strict";
  const rows = [...document.querySelectorAll(".font-row")];
  function status(row, failed) {
    row.dataset.load = failed ? "failed" : "ready";
    const message = row.querySelector("[data-overview-status]");
    message.hidden = !failed;
    message.textContent = failed ? "원본 서체 파일을 불러오지 못했습니다. 새로고침해 주세요." : "";
  }
  fetch("font-manifest.json")
    .then(response => {
      if (!response.ok) throw new Error("서체 정보 로드 실패");
      return response.json();
    })
    .then(fonts => Promise.all(rows.map(async row => {
      try {
        const font = fonts[row.dataset.font];
        const sample = row.querySelector(".specimen-title").textContent;
        const query = `${font.headingWeight} 52px "${font.face}"`;
        const faces = await document.fonts.load(query, sample);
        if (!faces.length || !document.fonts.check(query, sample)) throw new Error("서체 로드 실패");
        status(row, false);
      } catch { status(row, true); }
    })))
    .catch(() => rows.forEach(row => status(row, true)));
})();
