const variants={a:{title:'A 정돈된 구조'},b:{title:'B 부드러운 연결'},c:{title:'C 선명한 강조'}};
let reviewState={view:'detail',choice:'a',medium:'both',device:'desktop'};
const overview=document.getElementById('overview');
const detail=document.getElementById('detail');
const reviewStatus=document.getElementById('review-status');
function shell(source,title,width,height){return '<div class="frame-shell" data-frame-width="'+width+'" data-frame-height="'+height+'"><iframe class="preview-frame" src="'+source+'" title="'+title+'" tabindex="-1" inert loading="eager"></iframe></div>';}
overview.innerHTML=Object.entries(variants).map(([id,item])=>'<article class="overview-column"><h3>'+item.title+'</h3><p class="surface-label">회사 홈페이지</p>'+shell(id+'/index.html',item.title+' 홈페이지 비교',1280,800)+'<p class="surface-label">Biadone Edu</p>'+shell(id+'/slide.html',item.title+' Edu 비교',1600,900)+'<button class="overview-open" type="button" data-open="'+id+'">'+item.title+' 크게 보기</button></article>').join('');
// Fit fixed-size concept artboards; each embedded website still runs at its stated viewport.
function fitFrame(node){const width=Number(node.dataset.frameWidth),height=Number(node.dataset.frameHeight),available=node.clientWidth;if(!available)return;const scale=Math.min(available,width)/width;const frame=node.querySelector('iframe');frame.style.width=width+'px';frame.style.height=height+'px';frame.style.transform='scale('+scale+')';node.style.height=height*scale+'px';}
const resizeObserver=new ResizeObserver(entries=>entries.forEach(entry=>fitFrame(entry.target)));
document.querySelectorAll('.frame-shell').forEach(node=>resizeObserver.observe(node));
function pressed(selector,value,key){document.querySelectorAll(selector).forEach(button=>button.setAttribute('aria-pressed',String(button.dataset[key]===value)));}
function source(frame,path){if(frame.getAttribute('src')!==path)frame.src=path;}
function render(){
 const {view,choice,medium,device}=reviewState;
 overview.hidden=view!=='overview';detail.hidden=view!=='detail';
 pressed('[data-view]',view,'view');pressed('[data-choice]',view==='detail'?choice:'','choice');pressed('[data-medium]',medium,'medium');pressed('[data-device]',device,'device');
 document.getElementById('review-title').textContent=view==='overview'?'홈페이지와 Edu 자료 비교 기록':choice==='a'?'확정한 A 정돈된 구조':variants[choice].title+' 비교 기록';
 if(view==='detail'){
  source(document.getElementById('web-frame'),choice+'/index.html');source(document.getElementById('edu-frame'),choice+'/slide.html');
  document.getElementById('web-link').href=choice+'/index.html';document.getElementById('edu-link').href=choice+'/slide.html';
  document.getElementById('web-frame').title=variants[choice].title+' 홈페이지';document.getElementById('edu-frame').title=variants[choice].title+' Edu 슬라이드';
  document.getElementById('detail-web').hidden=medium==='edu';document.getElementById('detail-edu').hidden=medium==='web';
  document.querySelector('.device-controls').hidden=medium==='edu';
  const webShell=document.getElementById('web-shell');webShell.dataset.device=device;webShell.dataset.frameWidth=device==='mobile'?'375':'1280';webShell.dataset.frameHeight=device==='mobile'?'812':'800';
 }
 requestAnimationFrame(()=>document.querySelectorAll('.frame-shell').forEach(fitFrame));
 reviewStatus.textContent=view==='overview'?'세 방향을 나란히 비교합니다.':variants[choice].title+'의 '+(medium==='both'?'홈페이지와 Edu 자료':medium==='web'?'홈페이지':'Edu 자료')+'를 크게 표시합니다.';
 const hash=view==='overview'?'overview':[choice,medium,device].join('/');if(location.hash.slice(1)!==hash)history.replaceState(null,'','#'+hash);
}
function choose(choice){reviewState={...reviewState,choice,view:'detail'};render();}
document.querySelectorAll('[data-choice]').forEach(button=>{button.addEventListener('click',()=>choose(button.dataset.choice));button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const keys=Object.keys(variants),index=keys.indexOf(button.dataset.choice),next=keys[(index+(event.key==='ArrowRight'?1:2))%keys.length];document.querySelector('[data-choice="'+next+'"]').focus();choose(next);});});
document.querySelectorAll('[data-open]').forEach(button=>button.addEventListener('click',()=>{choose(button.dataset.open);document.getElementById('review').scrollIntoView({block:'start'});}));
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{reviewState.view=button.dataset.view;render();}));
document.querySelectorAll('[data-medium]').forEach(button=>button.addEventListener('click',()=>{reviewState.medium=button.dataset.medium;render();}));
document.querySelectorAll('[data-device]').forEach(button=>button.addEventListener('click',()=>{reviewState.device=button.dataset.device;render();}));
function readHash(){const [choice,medium,device]=location.hash.slice(1).split('/');if(variants[choice])reviewState={view:'detail',choice,medium:['both','web','edu'].includes(medium)?medium:'both',device:device==='mobile'?'mobile':'desktop'};else if(choice==='overview')reviewState.view='overview';else reviewState={view:'detail',choice:'a',medium:'both',device:'desktop'};render();}
addEventListener('hashchange',readHash);readHash();
