const proposals=window.BIADONE_SYMBOLS;
const sizes=[16,24,32,48];
document.getElementById("symbol-grid").innerHTML=proposals.map(p=>'<article class="symbol-card" data-symbol="'+p.id+'" aria-labelledby="title-'+p.id+'"><header class="card-title"><h3 id="title-'+p.id+'">'+p.id.toUpperCase()+' '+p.title+'</h3><p>'+p.description+'</p></header><div class="main-lockup"><img data-logo-main="'+p.id+'" src="assets/symbol-'+p.id+'.svg" width="64" height="64" alt="'+p.title+' 심벌"><span class="wordmark">Biadone</span></div><div class="variants"><div class="variant"><figure><div class="variant-tile"><img src="assets/symbol-'+p.id+'.svg" width="64" height="64" alt="'+p.title+' 블루 심벌"></div><figcaption>심벌만</figcaption></figure></div><div class="variant"><figure><div class="variant-tile on-blue"><img src="assets/symbol-'+p.id+'-white.svg" width="64" height="64" alt="'+p.title+' 흰색 심벌"></div><figcaption>블루 위에</figcaption></figure></div><div class="variant"><figure><div class="variant-tile"><img src="assets/symbol-'+p.id+'-ink.svg" width="64" height="64" alt="'+p.title+' 단색 심벌"></div><figcaption>단색으로</figcaption></figure></div></div><div class="small-sizes"><h4>작은 크기에서</h4><ul class="size-list">'+sizes.map(n=>'<li><img src="assets/symbol-'+p.id+'.svg" width="'+n+'" height="'+n+'" alt="'+p.title+' '+n+'픽셀"><span>'+n+'px</span></li>').join("")+'</ul></div><div class="asset-links"><a href="assets/symbol-'+p.id+'.svg" target="_blank" rel="noopener">블루 SVG 원본 보기</a><a href="assets/symbol-'+p.id+'-ink.svg" target="_blank" rel="noopener">단색 SVG 보기</a></div></article>').join("");
const descriptions={light:"밝은 바탕의 블루 심벌과 이름",blue:"블루 바탕의 흰 심벌과 이름",mono:"밝은 바탕의 단색 심벌과 이름"};
function setTone(tone){
 if(!descriptions[tone])tone="light";
 document.documentElement.dataset.tone=tone;
 document.querySelectorAll("[data-tone-choice]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.toneChoice===tone)));
 const suffix=tone==="blue"?"-white":tone==="mono"?"-ink":"";
 document.querySelectorAll("[data-logo-main]").forEach(img=>img.src="assets/symbol-"+img.dataset.logoMain+suffix+".svg");
 document.getElementById("tone-status").textContent=descriptions[tone]+"을 표시했습니다.";
}
document.querySelectorAll("[data-tone-choice]").forEach(button=>button.addEventListener("click",()=>setTone(button.dataset.toneChoice)));
setTone("light");

