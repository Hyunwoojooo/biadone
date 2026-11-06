const studies=document.getElementById('studies');
const studyStatus=document.getElementById('study-status');
let separated=false;
let resources;
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function lines(items,x,y){return items.map((item,index)=>'<text class="work-copy" x="'+x+'" y="'+(y+index*34)+'">'+escape(item)+'</text>').join('');}
function art(){
 const {copy,paths}=resources;
 document.getElementById('planes-art').innerHTML='<svg viewBox="0 0 800 720" role="img" aria-describedby="work-description" aria-label="'+escape(copy.task)+'의 요청과 초안이 심벌의 두 면처럼 맞물립니다."><desc id="work-description">'+escape(copy.criteriaHeading+' '+copy.criteria.join(' ')+' '+copy.resultHeading+' '+copy.result.join(', '))+'</desc><text class="task-label" x="32" y="38">'+escape(copy.task)+'</text><g class="work-plane-group plane-one"><path class="work-plane" d="'+paths[0].d+'" transform="translate(0 -20) scale(12.5)"/><text class="work-label" x="160" y="152">'+escape(copy.criteriaHeading)+'</text>'+lines(copy.criteria,160,204)+'</g><g class="work-plane-group plane-two"><path class="work-plane" d="'+paths[1].d+'" transform="translate(0 -20) scale(12.5) '+paths[1].transform+'"/><text class="work-label" x="404" y="480">'+escape(copy.resultHeading)+'</text>'+lines(copy.result,404,534)+'</g></svg>';
 document.querySelector('[data-transcript]').innerHTML='<section><h3>'+escape(copy.criteriaHeading)+'</h3>'+copy.criteria.map(item=>'<p>'+escape(item)+'</p>').join('')+'</section><section><h3>'+escape(copy.resultHeading)+'</h3>'+copy.result.map(item=>'<p>'+escape(item)+'</p>').join('')+'</section>';
}
function render(){
 document.getElementById('planes-art').classList.toggle('is-separated',separated);
 document.getElementById('plane-toggle').setAttribute('aria-pressed',String(separated));
 document.getElementById('plane-toggle').textContent=separated?'한 작업으로 맞물리기':'두 역할 나눠 보기';
 document.getElementById('plane-state').textContent=separated?'나뉜 두 역할':'맞물린 상태';
 if(!resources)return;
 studyStatus.textContent=separated?'요청과 초안을 두 역할로 나누어 표시합니다.':'요청과 그 조건을 반영한 초안을 한 작업으로 표시합니다.';
 const hash=separated?'split':'joined';if(location.hash.slice(1)!==hash)history.replaceState(null,'','#'+hash);
}
function readHash(){separated=location.hash==='#split';render();}
addEventListener('hashchange',readHash);readHash();
document.getElementById('plane-toggle').addEventListener('click',()=>{separated=!separated;render();});
(async()=>{
 const responses=await Promise.all([fetch('content.json'),fetch('../../design-system/assets/logo/biadone-symbol.svg')]);
 if(responses.some(response=>!response.ok))throw new Error('그래픽 자료를 불러오지 못했습니다.');
 const [copy,svg]=await Promise.all([responses[0].json(),responses[1].text()]);
 const source=new DOMParser().parseFromString(svg,'image/svg+xml');const paths=[...source.querySelectorAll('path')].map(path=>({d:path.getAttribute('d'),transform:path.getAttribute('transform')??''}));
 if(paths.length!==2)throw new Error('확정된 심벌 원본을 확인하지 못했습니다.');
 resources={copy,paths};art();studies.setAttribute('aria-busy','false');render();
})().catch(error=>{studies.setAttribute('aria-busy','false');studyStatus.textContent=error.message;console.error(error);});
