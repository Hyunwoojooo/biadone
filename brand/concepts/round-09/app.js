const doc=document.getElementById('document');
const target=document.getElementById('document-content');
const counter=document.getElementById('content-count');
let content;
let state={demo:'text',quantity:'long',motif:true};
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function renderMotif(){
 document.getElementById('motif-toggle').setAttribute('aria-pressed',String(state.motif));document.getElementById('motif-toggle').textContent=state.motif?'접합 표시 켜짐':'접합 표시 꺼짐';doc.classList.toggle('motif-hidden',!state.motif);
}
function render(){
 document.querySelectorAll('[data-demo]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.demo===state.demo)));
 document.querySelectorAll('[data-quantity]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.quantity===state.quantity)));
 renderMotif();
 if(!content)return;
 const data=content[state.demo],long=state.quantity==='long';
 let body='';
 if(state.demo==='text'){
  const paragraphs=data.paragraphs.slice(0,long?6:2);body='<div class="long-copy">'+paragraphs.map(text=>'<p>'+escape(text)+'</p>').join('')+'</div>';counter.textContent=paragraphs.length+'개 문단. 문서의 높이는 내용에 따라 늘어납니다.';
 }else if(state.demo==='table'){
  const rows=data.rows.slice(0,long?7:3);body='<div class="table-scroll" tabindex="0" role="region" aria-label="보고서 자동화 비교표"><table class="data-table"><thead><tr>'+data.headers.map(text=>'<th scope="col">'+escape(text)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map((text,index)=>index===0?'<th scope="row">'+escape(text)+'</th>':'<td>'+escape(text)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div><p class="scroll-hint">좁은 화면에서는 표를 좌우로 이동해 읽을 수 있습니다.</p>';counter.textContent=rows.length+'행, '+data.headers.length+'열. 행이 늘어나면 아래로 이어집니다.';
 }else{
  const steps=data.steps.slice(0,long?6:3);body='<ol class="step-list">'+steps.map((step,index)=>'<li><span class="step-number" aria-hidden="true">'+(index+1)+'</span><div><h3>'+escape(step.title)+'</h3><p>'+escape(step.description)+'</p></div></li>').join('')+'</ol>';counter.textContent=steps.length+'개 단계. 단계 수와 설명 길이에 따라 문서가 늘어납니다.';
 }
 target.innerHTML='<h2>'+escape(data.title).replace(/\n/g,'<br> ')+'</h2>'+body;
 doc.setAttribute('aria-busy','false');
 const hash=state.demo+'/'+state.quantity;if(location.hash.slice(1)!==hash)history.replaceState(null,'','#'+hash);
}
document.querySelectorAll('[data-demo]').forEach(button=>button.addEventListener('click',()=>{state.demo=button.dataset.demo;render();}));
document.querySelectorAll('[data-quantity]').forEach(button=>button.addEventListener('click',()=>{state.quantity=button.dataset.quantity;render();}));
document.getElementById('motif-toggle').addEventListener('click',()=>{state.motif=!state.motif;renderMotif();});
function readHash(){const [demo,quantity]=location.hash.slice(1).split('/');state.demo=['text','table','process'].includes(demo)?demo:'text';state.quantity=quantity==='normal'?'normal':'long';render();}
addEventListener('hashchange',readHash);readHash();
(async()=>{const response=await fetch('content.json');if(!response.ok)throw new Error('예시 내용을 불러오지 못했습니다.');content=await response.json();render();})().catch(error=>{doc.setAttribute('aria-busy','false');target.textContent=error.message;console.error(error);});
