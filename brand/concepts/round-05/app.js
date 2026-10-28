const assetRoot="../../design-system/assets/logo/";
const status=document.getElementById("tone-status");
const choices=document.getElementById("choices");
const tones={light:"밝은 바탕",blue:"블루 바탕",mono:"단색"};
function mark(){return '<span class="symbol-crop"><img src="'+assetRoot+'biadone-symbol.svg" width="64" height="64" alt=""></span><span class="wordmark">Biadone</span>';}
async function start(){
 const response=await fetch("lockups.json");
 if(!response.ok)throw new Error("조합 데이터를 불러오지 못했습니다.");
 const proposals=await response.json();
 choices.innerHTML=proposals.map(p=>'<article class="choice" data-choice="'+p.id+'" style="--symbol-ratio:'+p.symbolRatio+';--gap-ratio:'+p.gapRatio+'" aria-labelledby="choice-'+p.id+'"><header class="choice-heading"><h2 id="choice-'+p.id+'">'+p.id.toUpperCase()+' '+p.title+'</h2><p>'+p.description+'</p></header><div class="hero-logo"><div class="brand-lockup" role="img" aria-label="'+p.title+' Biadone 로고">'+mark()+'</div></div><section class="usage"><h3>홈페이지 메뉴에 들어가면</h3><div class="mini-header"><div class="brand-lockup" role="img" aria-label="'+p.title+' 작은 Biadone 로고">'+mark()+'</div><span class="mini-links" aria-hidden="true"><span>소개</span><span>서비스</span></span></div></section></article>').join("");
 choices.setAttribute("aria-busy","false");
 document.querySelectorAll("button[data-tone]").forEach(button=>button.addEventListener("click",()=>{
  const tone=button.dataset.tone;
  document.documentElement.dataset.tone=tone;
  document.querySelectorAll("button[data-tone]").forEach(control=>control.setAttribute("aria-pressed",String(control===button)));
  const suffix=tone==="blue"?"-white":tone==="mono"?"-ink":"";
  document.querySelectorAll(".hero-logo img").forEach(img=>img.src=assetRoot+"biadone-symbol"+suffix+".svg");
  status.textContent=tones[tone]+"으로 큰 로고 세 조합을 표시합니다.";
 }));
}
start().catch(error=>{choices.setAttribute("aria-busy","false");choices.textContent=error.message;status.textContent=error.message;console.error(error);});
