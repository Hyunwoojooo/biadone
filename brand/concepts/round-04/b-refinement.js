const tones={light:"밝은 바탕",blue:"블루 바탕",mono:"단색"};
document.querySelectorAll("[data-tone-choice]").forEach(button=>button.addEventListener("click",()=>{
 const tone=button.dataset.toneChoice;
 document.documentElement.dataset.tone=tone;
 document.querySelectorAll("[data-tone-choice]").forEach(control=>control.setAttribute("aria-pressed",String(control===button)));
 const suffix=tone==="blue"?"-white":tone==="mono"?"-ink":"";
 document.querySelectorAll("[data-logo-base]").forEach(img=>img.src="assets/"+img.dataset.logoBase+suffix+".svg");
 document.getElementById("refinement-status").textContent=tones[tone]+"으로 두 버전을 비교합니다.";
}));

