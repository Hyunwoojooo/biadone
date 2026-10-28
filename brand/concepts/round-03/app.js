const palettes=[
{id:"sky",title:"맑은 블루",description:"밝고 또렷한",key:"A"},
{id:"jade",title:"생기 있는 민트",description:"맑고 산뜻한",key:"B"},
{id:"coral",title:"밝은 코랄",description:"따뜻하고 활기찬",key:"C"}
];
const fonts=[
{id:"pretendard",name:"Pretendard",note:"선택한 서체"},
{id:"wanted",name:"Wanted Sans",note:"새 서체 후보"},
{id:"suite",name:"SUITE",note:"제목 중심 후보"}
];
const check='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
document.getElementById("palette-grid").innerHTML=palettes.map(p=>'<article class="palette-card" data-palette="'+p.id+'"><div class="palette-title"><h3>'+p.key+' '+p.title+'</h3><span>'+p.description+'</span></div><div class="site-sample"><div class="mini-nav"><span class="mini-brand">Biadone</span><span>비전　프로젝트</span></div><p class="sample-headline">하고 싶은 일에,<br>또 하나의 나.</p><p>생각과 생활, 작업을 이해하는 나의 분신.<br>Biadone은 그 미래를 향해 제품과 교육을 만듭니다.</p><span class="paint-action">프로젝트 보기</span><span class="mini-signature">Before I ask, Done.</span></div><div class="palette-controls"><div class="palette-swatches" aria-hidden="true"><span></span><span></span><span></span><span></span></div><button class="choose-button" type="button" data-choose-color="'+p.id+'" aria-pressed="false">이 색감으로 비교하기</button></div></article>').join("");
document.getElementById("font-grid").innerHTML=fonts.map(f=>'<article class="font-card" data-font="'+f.id+'"><div class="font-title"><h3>'+f.name+'</h3><span>'+f.note+'</span></div><div class="font-sample"><span class="type-brand">Biadone</span><p class="type-display">하고 싶은 일에,<br>또 하나의 나.</p><p class="type-body">생각과 생활, 작업을 이해하는 나의 분신.<br>Biadone은 그 미래를 향해 제품과 교육을 만듭니다.</p><p class="type-mixed">Biadone Edu, AI, AX, 2026<br>배우고 직접 만드는 경험.</p></div><div class="font-controls"><button class="choose-button" type="button" data-choose-font="'+f.id+'" aria-pressed="false">이 서체로 조합 보기</button></div></article>').join("");
let color="sky",font="pretendard";
function render(){
 document.getElementById("fonts").dataset.activeColor=color;
 const preview=document.getElementById("combination");
 preview.dataset.activeColor=color;preview.dataset.activeFont=font;
 const palette=palettes.find(p=>p.id===color),face=fonts.find(f=>f.id===font);
 document.getElementById("font-context").textContent=palette.title+"를 고정하고, 같은 크기와 굵기로 세 서체를 비교합니다.";
 document.getElementById("combination-label").textContent=palette.title+" + "+face.name;
 document.querySelectorAll("[data-choose-color]").forEach(button=>{const selected=button.dataset.chooseColor===color;button.setAttribute("aria-pressed",String(selected));button.innerHTML=(selected?check:"")+(selected?"이 색감으로 비교 중":"이 색감으로 비교하기");});
 document.querySelectorAll("[data-choose-font]").forEach(button=>{const selected=button.dataset.chooseFont===font;button.setAttribute("aria-pressed",String(selected));button.innerHTML=(selected?check:"")+(selected?"이 서체로 비교 중":"이 서체로 조합 보기");});
 document.getElementById("study-status").textContent=palette.title+"와 "+face.name+" 조합을 표시했습니다.";
}
function readHash(){
 const values=location.hash.slice(1).split("-");
 if(palettes.some(p=>p.id===values[0])&&fonts.some(f=>f.id===values[1])){color=values[0];font=values[1];}
 render();
}
document.querySelectorAll("[data-choose-color]").forEach(button=>button.addEventListener("click",()=>{color=button.dataset.chooseColor;history.replaceState(null,"","#"+color+"-"+font);render();}));
document.querySelectorAll("[data-choose-font]").forEach(button=>button.addEventListener("click",()=>{font=button.dataset.chooseFont;history.replaceState(null,"","#"+color+"-"+font);render();}));
window.addEventListener("hashchange",readHash);
readHash();

