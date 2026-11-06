const concepts = {
  a: {title: "이름이 곧 화면이 되는 타이포그래피", short: "이름이 곧 화면", description: "Before I ask, Done.을 브랜드의 가장 큰 시각 자산으로 씁니다. 하나의 I 옆에 또 하나의 I가 생깁니다.", principle: "큰 영문 조판 하나에 대담함을 집중하고, 한국어 정보와 프로젝트는 차분하게 정돈합니다.", type: "영문: Barlow Condensed ExtraBold / 한글: Pretendard Variable"},
  b: {title: "나와 분신을 나란히 읽는 두 흐름", short: "나란히 읽는 두 흐름", description: "생각하는 나와 함께 실행하는 분신을 두 영역의 같은 리듬으로 보여줍니다. 한국어와 관계의 구조가 주역입니다.", principle: "같은 기준선, 넓은 두 영역, 읽기 편한 한국어 타이포그래피로 신뢰와 유연함을 표현합니다.", type: "한글과 영문: Pretendard Variable / 같은 기준선과 굵기의 리듬"},
  c: {title: "실제 프로젝트가 확장되는 프레임", short: "확장되는 프레임", description: "Blabee와 Biadone Edu가 화면의 큰 면을 차지합니다. 만드는 것들이 한 회사의 공통 프레임 안에서 연결됩니다.", principle: "노랑과 흰색을 넓게 쓰고, 네이비 구조와 큰 프로젝트 이름으로 회사의 실행력을 보여줍니다.", type: "프로젝트 이름: Barlow Condensed ExtraBold / 한글: Pretendard Variable"}
};
const graphics = {
  a: {viewBox: "0 0 160 160", markup: '<path d="M10 42h56v16H48v78h18v16H10v-16h18V58H10z" fill="currentColor"/><path d="M91 10h56v16h-18v78h18v16H91v-16h18V26H91z" fill="none" stroke="currentColor" stroke-width="3"/>'},
  b: {viewBox: "0 0 120 160", markup: '<circle cx="31" cy="22" r="15" fill="currentColor"/><path d="M16 52h30v94H16z" fill="currentColor"/><circle cx="85" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="5"/><path d="M72 40h27v94H72z" fill="none" stroke="currentColor" stroke-width="5"/>'},
  c: {viewBox: "0 0 160 160", markup: '<path d="M10 42h56v16H48v78h18v16H10v-16h18V58H10zM91 10h56v16h-18v78h18v16H91v-16h18V26H91z" fill="currentColor"/>'}
};
const frame = document.getElementById("concept-frame");
const status = document.getElementById("review-status");
let current = frame.getAttribute("src").split("/")[0];
function selectConcept(id) {
  if (!concepts[id]) id = "a";
  const item = concepts[id];
  document.documentElement.dataset.concept = id;
  document.querySelectorAll("[data-select]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.select === id)));
  document.getElementById("concept-title").textContent = item.title;
  document.getElementById("concept-description").textContent = item.description;
  document.getElementById("design-principle").textContent = item.principle;
  document.getElementById("type-description").textContent = item.type;
  document.querySelectorAll(".sample-twin, .social-twin").forEach(symbol => {
    symbol.setAttribute("viewBox", graphics[id].viewBox);
    symbol.innerHTML = graphics[id].markup;
  });
  document.getElementById("open-preview").href = id + "/";
  frame.title = id.toUpperCase() + " " + item.short + " 홈페이지 시안";
  if (current !== id) frame.src = id + "/";
  current = id;
  document.title = "Biadone 시안 " + id.toUpperCase() + " — " + item.short;
  status.textContent = id.toUpperCase() + " " + item.short + " 시안을 표시했습니다.";
}
document.querySelectorAll("[data-select]").forEach(button => button.addEventListener("click", () => { location.hash = button.dataset.select; }));
document.querySelectorAll("[data-size]").forEach(button => button.addEventListener("click", () => {
  const size = button.dataset.size;
  document.documentElement.dataset.preview = size;
  document.querySelectorAll("[data-size]").forEach(control => control.setAttribute("aria-pressed", String(control === button)));
  status.textContent = (size === "mobile" ? "휴대폰" : "데스크톱") + " 크기로 시안을 표시했습니다.";
}));
window.addEventListener("hashchange", () => selectConcept(location.hash.slice(1)));
frame.addEventListener("load", () => { status.textContent = current.toUpperCase() + " 시안이 준비되었습니다."; });
selectConcept(location.hash.slice(1));

