const sets={a:{name:'A 라인형'},b:{name:'B 면 강조형'},c:{name:'C 주석형'}};
const kinds={statement:'핵심 문장',comparison:'비교',process:'과정'};
const grid=document.getElementById('comparison');
const reviewStatus=document.getElementById('review-status');
let state={set:'all',kind:'all'};
let content;
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function graphic(set,kind){
 const start='<div class="graphic graphic-'+set+' graphic-'+kind+'" data-graphic="'+set+'-'+kind+'">';
 if(kind==='statement')return start+'<p class="statement-title">'+escape(content.statement.title)+'</p><p class="statement-copy">'+escape(content.statement.description)+'</p></div>';
 if(kind==='comparison')return start+'<table class="compare-table"><thead><tr><th scope="col">구분</th><th scope="col">'+escape(content.comparison.leftTitle)+'</th><th scope="col">'+escape(content.comparison.rightTitle)+'</th></tr></thead><tbody>'+content.comparison.rows.map(row=>'<tr><th scope="row">'+escape(row.label)+'</th><td>'+escape(row.left)+'</td><td>'+escape(row.right)+'</td></tr>').join('')+'</tbody></table><p class="compare-caption">'+escape(content.comparison.caption)+'</p></div>';
 return start+'<ol class="process-list">'+content.process.map((step,index)=>'<li class="process-step"><div class="step-head" aria-hidden="true"><span class="step-marker"></span><span class="step-number">'+(index+1)+'</span></div><h3>'+escape(step.title)+'</h3><p>'+escape(step.description)+'</p></li>').join('')+'</ol></div>';
}
function render(){
 document.querySelectorAll('[data-set]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.set===state.set)));
 document.querySelectorAll('[data-kind]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.kind===state.kind)));
 if(!content){reviewStatus.textContent='그래픽 예시를 불러오고 있습니다.';return;}
 const activeSets=state.set==='all'?Object.keys(sets):[state.set];
 const activeKinds=state.kind==='all'?Object.keys(kinds):[state.kind];
 grid.classList.toggle('single-set',state.set!=='all');
 grid.innerHTML=activeKinds.flatMap(kind=>activeSets.map(set=>'<article class="specimen" data-specimen="'+set+'-'+kind+'"><h2>'+sets[set].name+'</h2><p class="kind-name">'+kinds[kind]+'</p><div class="sample-field" data-surface="'+kind+'">'+graphic(set,kind)+'</div></article>')).join('');
 grid.setAttribute('aria-busy','false');
 reviewStatus.textContent=(state.set==='all'?'세 그래픽 세트':sets[state.set].name)+'의 '+(state.kind==='all'?'핵심 문장·비교·과정':kinds[state.kind])+'을 표시합니다.';
 const hash=state.set+'/'+state.kind;if(location.hash.slice(1)!==hash)history.replaceState(null,'','#'+hash);
}
function readHash(){const [set,kind]=location.hash.slice(1).split('/');state={set:sets[set]?set:'all',kind:kinds[kind]?kind:'all'};if(content)render();}
document.querySelectorAll('[data-set]').forEach(button=>button.addEventListener('click',()=>{state.set=button.dataset.set;render();}));
document.querySelectorAll('[data-kind]').forEach(button=>button.addEventListener('click',()=>{state.kind=button.dataset.kind;render();}));
document.querySelectorAll('.set-controls [data-set]').forEach(button=>button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const keys=Object.keys(sets),next=keys[(keys.indexOf(button.dataset.set)+(event.key==='ArrowRight'?1:2))%3];document.querySelector('.set-controls [data-set="'+next+'"]').focus();state.set=next;render();}));
addEventListener('hashchange',readHash);
readHash();
(async()=>{const response=await fetch('content.json');if(!response.ok)throw new Error('그래픽 문구를 불러오지 못했습니다.');content=await response.json();render();})().catch(error=>{grid.setAttribute('aria-busy','false');grid.textContent=error.message;console.error(error);});
