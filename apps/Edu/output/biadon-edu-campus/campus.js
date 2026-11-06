/* Native HTML course information around a small illustrated walking world. */
(() => {
  'use strict';
  const $=selector=>document.querySelector(selector);
  const $$=selector=>[...document.querySelectorAll(selector)];
  const courses=window.CAMPUS_COURSES;
  const byId=Object.fromEntries(courses.map(course=>[course.id,course]));
  const roomIds=['F','A','B','C','D','E','T'];
  const map=window.CAMPUS_MAP;
  const viewport=$('#map-viewport'),world=$('#world'),player=$('#player'),sprite=$('#sprite');
  const dialog=$('#campus-dialog'),dialogContent=$('#dialog-content');
  const mobileHeading=document.createElement('header');
  mobileHeading.className='mobile-map-heading';mobileHeading.hidden=true;
  viewport.parentElement.insertBefore(mobileHeading,viewport);
  const brand=$('.map-brand'),intro=$('.map-intro'),mapTools=$('.map-tools');
  const visited=new Set();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const narrow=matchMedia('(max-width: 1100px)');
  const escapeHTML=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const check='<svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="m4 10 4 4 8-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const roomStyle=course=>'--room-color:'+course.color+';--room-ink:'+course.ink;
  const labelTitles={F:'내 사업에 AI 적용하기',A:'홍보 콘텐츠',B:'소개·문의 웹페이지',C:'고객 문의 자동화',D:'매출 분석·보고서',E:'나만의 업무 도구',T:'AI 업무팀'};
  let engine=null,activeDialog=null,pendingRoom=null,lastNear=null,engaged=false;
  let cameraScale=null,overview=false,cameraState={scale:1,tx:0,ty:0};
  let lastPosition={...map.start},lastState=null,routeSignature='';
  const actorWidth=96,actorHeight=128,actorAnchor=actorHeight*.97;
  const feet=[
    [{x:221,y:500},{x:192.3,y:500},{x:193.3,y:500},{x:181.6,y:498}],
    [{x:211.6,y:470},{x:159.9,y:466},{x:220.5,y:465},{x:167.3,y:469}]
  ];

  $('#room-list').innerHTML=roomIds.map(id=>{
    const c=byId[id];
    return '<button type="button" class="room-row" data-room="'+id+'" style="'+roomStyle(c)+'" aria-label="'+escapeHTML(c.short+', 걸어서 찾아가기')+'"><span class="row-badge">'+c.badge+'</span><span class="row-text"><strong>'+escapeHTML(c.short)+'</strong></span><span class="row-arrow" aria-hidden="true">›</span></button>';
  }).join('');
  $('#room-markers').innerHTML=roomIds.map(id=>{
    const c=byId[id],[x,y]=map.labels[id];
    return '<button type="button" class="room-marker" data-room="'+id+'" style="left:'+x+'px;top:'+y+'px;'+roomStyle(c)+'" aria-label="'+escapeHTML(c.short+' 방으로 걸어가기')+'"><span class="marker-code">'+c.badge+'</span><span class="marker-copy"><span class="marker-title">'+labelTitles[id]+'</span></span></button>';
  }).join('');
  $('#door-markers').innerHTML=map.portals.map(portal=>'<span class="door-dot" data-door="'+portal.id+'" style="left:'+portal.x+'px;top:'+portal.y+'px;'+roomStyle(byId[portal.id])+'"></span>').join('');
  $('#route-overlay').innerHTML='<polyline id="route-line" points=""></polyline>';

  function fitCamera(position=lastPosition){
    const width=viewport.clientWidth,height=viewport.clientHeight;
    if(!width||!height)return;
    const fit=Math.min(width/map.width,height/map.height);
    const scale=overview?fit:(cameraScale??(narrow.matches?Math.max(fit,.76):fit));
    const actual=Math.max(fit,Math.min(1.5,scale));
    let tx,ty;
    if(actual<=fit+.002){tx=(width-map.width*actual)/2;ty=(height-map.height*actual)/2;}
    else{
      tx=Math.min(0,Math.max(width-map.width*actual,width*.5-position.x*actual));
      ty=Math.min(0,Math.max(height-map.height*actual,height*.64-position.y*actual));
    }
    cameraState={scale:actual,tx,ty};
    world.style.transform='translate('+tx.toFixed(2)+'px,'+ty.toFixed(2)+'px) scale('+actual.toFixed(5)+')';
    world.style.setProperty('--label-scale',String(Math.min(2.8,1/actual)));
    viewport.dataset.overview=String(actual<.5);
    viewport.dataset.engaged=String(engaged&&(narrow.matches||actual>fit*1.08));
    $('#map-overview').textContent=overview&&narrow.matches?'나 따라가기':'전체 지도';
    $('#map-overview').setAttribute('aria-pressed',String(overview));
    $('#zoom-out').disabled=actual<=fit+.01;
    $('#zoom-in').disabled=actual>=1.48;
  }
  function responsiveHeading(){
    if(narrow.matches){mobileHeading.append(brand,intro,mapTools);mobileHeading.hidden=false;}
    else{viewport.append(brand,intro,mapTools);mobileHeading.hidden=true;}
  }
  function drawActor(state){
    lastPosition={x:state.x,y:state.y};lastState=state;
    player.style.left=state.x.toFixed(2)+'px';player.style.top=state.y.toFixed(2)+'px';
    const col={down:0,left:1,right:2,up:3}[state.facing]??0;
    const row=state.moving&&!reduced.matches?Math.floor(performance.now()/180)%2:0;
    const foot=feet[row][col];
    sprite.style.backgroundPosition=(col/3*100)+'% '+row*100+'%';
    sprite.style.transform='translate('+(actorWidth/2-foot.x/384*actorWidth).toFixed(2)+'px,'+(actorAnchor-foot.y/512*actorHeight).toFixed(2)+'px)';
    player.dataset.facing=state.facing;player.classList.toggle('is-walking',state.moving);
    if(state.moving){engaged=true;if(narrow.matches&&overview)overview=false;}
    fitCamera(lastPosition);
    const signature=state.destinationId+'|'+state.path.map(p=>Math.round(p.x)+','+Math.round(p.y)).join(' ');
    if(signature!==routeSignature){
      routeSignature=signature;
      $('#route-line').setAttribute('points',state.destinationId?[[state.x,state.y],...state.path.map(p=>[p.x,p.y])].map(p=>p.join(',')).join(' '):'');
    }
    if(state.lastError){$('#near-hint').textContent='잠깐, 이쪽은 벽이에요. 입구로 돌아가 다시 찾아갈 수 있습니다.';}
  }
  function refreshVisited(){
    $('#visited-count').textContent=String(visited.size);
    $$('[data-room]').forEach(node=>{
      const done=visited.has(node.dataset.room);node.classList.toggle('is-visited',done);
      const arrow=node.querySelector('.row-arrow');
      if(arrow){arrow.innerHTML=done?check:'›';arrow.classList.toggle('visited-check',done);}
    });
  }
  function updateNear(portal){
    lastNear=portal?.id??null;
    $$('[data-room]').forEach(node=>node.classList.toggle('is-near',node.dataset.room===lastNear));
    $$('[data-door]').forEach(node=>node.classList.toggle('is-near',node.dataset.door===lastNear));
    $('#enter-room').disabled=!portal;
    $('#enter-room').setAttribute('aria-label',portal?byId[portal.id].short+' 방에 입장':'방 문 근처에서 입장할 수 있습니다');
    if(portal)$('#near-hint').textContent=byId[portal.id].short+' · Enter를 누르거나 문 안으로 걸어가세요.';
    else if(lastState?.destinationId)$('#near-hint').textContent=byId[lastState.destinationId].short+' 방으로 걷는 중 · 방향키를 누르면 직접 움직일 수 있어요.';
    else $('#near-hint').textContent='방향키로 이동하거나, 방 이름을 눌러 찾아가세요.';
  }
  function onMode(mode,state){
    $$('[data-room]').forEach(node=>node.classList.toggle('is-routing',mode==='route'&&node.dataset.room===state.destinationId));
    if(mode==='route'&&state.destinationId)$('#near-hint').textContent=byId[state.destinationId].short+' 방으로 걷는 중 · 방향키로 직접 움직일 수도 있어요.';
    else if(mode==='idle')updateNear(lastNear?map.portals.find(p=>p.id===lastNear):null);
  }
  function closeButton(text='방에서 나오기'){
    return '<button type="button" class="dialog-close" data-close-dialog>'+text+' <span aria-hidden="true">×</span></button>';
  }
  function courseHTML(c){
    const next=roomIds[(roomIds.indexOf(c.id)+1)%roomIds.length];
    return '<header class="dialog-head"><p class="dialog-kicker"><span class="row-badge">'+c.badge+'</span>'+escapeHTML(c.group)+'</p>'+closeButton(c.id==='S'?'안내 닫기':'방에서 나오기')+'</header>'+
      '<div class="detail-layout"><section class="detail-intro"><h2 id="dialog-title">'+escapeHTML(c.title)+'</h2><div class="result-block"><h3>완성하는 결과물</h3><strong>'+escapeHTML(c.result)+'</strong></div><p class="detail-summary">'+escapeHTML(c.summary)+'</p><p class="detail-takeaway">'+escapeHTML(c.takeaway)+'</p></section>'+
      '<section class="learn-section" aria-labelledby="learn-heading"><h3 id="learn-heading">'+(c.id==='S'?'모든 방에서 함께 배우는 것':'이 방에서 배우는 것')+'</h3><ol class="learn-list">'+c.learn.map((text,i)=>'<li><span class="step-number">'+String(i+1).padStart(2,'0')+'</span><span class="step-text">'+escapeHTML(text)+'</span></li>').join('')+'</ol>'+
      (c.note?'<p class="course-note">'+escapeHTML(c.note)+'</p>':'')+
      '<p class="tool-note">'+escapeHTML(window.CAMPUS_NOTES[1])+'</p></section></div>'+
      '<footer class="dialog-footer"><button type="button" class="button" data-close-dialog><kbd>Esc</kbd> 지도 돌아가기</button>'+(c.id==='S'?'<button type="button" class="button button-primary" data-route="F">기초 방으로 걸어가기 →</button>':'<button type="button" class="button button-primary" data-route="'+next+'">다음 방으로 걸어가기 →</button>')+'</footer>';
  }
  function showDialog(kind,html,courseId=null,entered=false){
    if(dialog.open)return;
    activeDialog={kind,courseId,entered};
    engine?.pause(entered?'room':'information');
    dialog.dataset.kind=kind;
    dialog.dataset.course=courseId||'';
    const c=courseId?byId[courseId]:null;
    dialog.style.setProperty('--room-color',c?.color??'#3437ee');dialog.style.setProperty('--room-ink',c?.ink??'#3437ee');
    dialogContent.innerHTML=html;dialogContent.scrollTop=0;
    dialog.setAttribute('aria-labelledby','dialog-title');
    dialog.showModal();
    dialogContent.querySelector('[data-close-dialog]')?.focus({preventScroll:true});
  }
  function openCourse(id,entered=false){
    if(!byId[id])return;
    if(id!=='S'){visited.add(id);refreshVisited();}
    showDialog('course',courseHTML(byId[id]),id,entered);
  }
  function routeTo(id){
    if(!roomIds.includes(id))return;
    engaged=true;overview=false;viewport.focus({preventScroll:true});
    if(!engine.goTo(id))$('#near-hint').textContent='이 방으로 가는 길을 찾지 못했어요. ‘입구로’를 누르면 다시 출발할 수 있습니다.';
  }
  function showCatalog(){
    const rows=courses.map(c=>'<div class="catalog-row" style="'+roomStyle(c)+'"><div class="catalog-course"><small>'+escapeHTML(c.group)+'</small><strong>'+escapeHTML(c.title)+'</strong></div><span class="catalog-result">'+escapeHTML(c.result)+'</span><span class="catalog-actions"><button class="button" type="button" data-read-course="'+c.id+'">내용 보기</button></span></div>').join('');
    const html='<header class="dialog-head"><h2 id="dialog-title">전체 커리큘럼</h2>'+closeButton('닫기')+'</header><div class="catalog-list">'+rows+'</div><div class="course-note">'+window.CAMPUS_NOTES.map(escapeHTML).join('<br>')+'</div><footer class="dialog-footer"><span class="key-hint">기초 → 필요한 선택 과정 → AI 업무팀</span><button class="button" type="button" data-close-dialog>지도 돌아가기</button></footer>';
    showDialog('catalog',html);
  }
  function showHelp(){
    const html='<header class="dialog-head"><h2 id="dialog-title">천천히, 방마다 둘러보세요.</h2>'+closeButton('닫기')+'</header><div class="help-grid">'+[
      ['<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> 걷기','지도를 클릭한 뒤 방향키로 움직여보세요. 화면의 방향과 같은 쪽으로 걷습니다. WASD도 사용할 수 있어요.'],
      ['<kbd>Enter</kbd> 방에 들어가기','문 앞의 작은 원에 가까워지면 안내가 나타납니다. Enter를 누르거나 문 안으로 계속 걸으면 수업 안내가 열립니다.'],
      ['<kbd>Esc</kbd> 지도 돌아가기','방에서 배울 내용과 결과물을 보고 Esc를 누르면 문 앞에 돌아옵니다. 상세 안내를 읽는 동안 캐릭터는 멈춥니다.'],
      ['표지판으로 찾아가기','지도 위의 방 이름이나 오른쪽 수업 목록을 누르면 캐릭터가 복도를 따라 그 방으로 걸어갑니다.'],
      ['작은 화면에서도','아래 방향 버튼을 누르고 있으면 걷습니다. 지도는 캐릭터를 따라가며, 전체 지도 버튼으로 한눈에 볼 수도 있습니다.'],
      ['전체 커리큘럼 · 운영 안내','걷지 않고도 전체 과정 목록에서 내용을 바로 열 수 있습니다. 비용·보안·복구 내용은 모든 과정에 포함됩니다.']
    ].map(([key,text])=>'<section><div class="help-key">'+key+'</div><p class="help-copy">'+text+'</p></section>').join('')+'</div><footer class="dialog-footer"><span class="key-hint">둘러본 방은 현재 페이지에서만 표시합니다.</span><button class="button button-primary" type="button" data-close-dialog>이제 둘러볼게요 →</button></footer>';
    showDialog('help',html);
  }
  dialog.addEventListener('close',()=>{
    const previous=activeDialog;activeDialog=null;
    if(previous?.entered&&previous.courseId!=='S')engine.leaveRoom(previous.courseId);
    else engine.pause(false);
    viewport.focus({preventScroll:true});
    const pending=pendingRoom;pendingRoom=null;
    if(pending?.type==='read')openCourse(pending.id,false);
    else if(pending?.type==='walk')routeTo(pending.id);
  });
  dialog.addEventListener('click',event=>{
    const close=event.target.closest('[data-close-dialog]');if(close){dialog.close();return;}
    const route=event.target.closest('[data-route]');if(route){pendingRoom={type:'walk',id:route.dataset.route};dialog.close();return;}
    const read=event.target.closest('[data-read-course]');if(read){pendingRoom={type:'read',id:read.dataset.readCourse};dialog.close();return;}
    if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();}
  });
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const focusables=[...dialog.querySelectorAll('button:not([disabled]),[href],[tabindex="0"]')].filter(n=>n.getClientRects().length);
    const first=focusables[0],last=focusables.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  document.addEventListener('click',event=>{
    const room=event.target.closest('[data-room]');if(room&&!dialog.open)routeTo(room.dataset.room);
  });
  $('#open-catalog').addEventListener('click',showCatalog);
  $('#open-help').addEventListener('click',showHelp);
  $('#open-operations').addEventListener('click',()=>openCourse('S'));
  $('#enter-room').addEventListener('click',()=>{engine.enter();});
  $('#reset-walk').addEventListener('click',()=>{engaged=false;cameraScale=null;overview=false;engine.reset();fitCamera();});
  $('#zoom-in').addEventListener('click',()=>{overview=false;cameraScale=Math.min(1.5,cameraState.scale+.18);engaged=true;fitCamera();});
  $('#zoom-out').addEventListener('click',()=>{overview=false;cameraScale=Math.max(Math.min(viewport.clientWidth/map.width,viewport.clientHeight/map.height),cameraState.scale-.18);fitCamera();});
  $('#map-overview').addEventListener('click',()=>{overview=!overview;cameraScale=null;fitCamera();});
  $$('[data-direction]').forEach(button=>{
    const direction=button.dataset.direction;
    const release=()=>{button.classList.remove('is-pressed');engine?.setDirection(direction,false);};
    button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);button.classList.add('is-pressed');engine.setDirection(direction,true);});
    button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
    button.addEventListener('click',event=>{if(event.detail!==0)return;engine.setDirection(direction,true);setTimeout(release,160);});
  });
  window.addEventListener('blur',()=>$$('[data-direction]').forEach(button=>button.classList.remove('is-pressed')));
  responsiveHeading();
  engine=window.CampusMovement.create({
    element:viewport,start:map.start,walkable:map.walkable,nodes:map.nodes,portals:map.portals,speed:185,
    onMove:drawActor,onNear:updateNear,onMode,onEnter:(id)=>openCourse(id,true)
  });
  new ResizeObserver(()=>fitCamera()).observe(viewport);
  narrow.addEventListener('change',()=>{responsiveHeading();cameraScale=null;overview=false;fitCamera();});
  reduced.addEventListener('change',()=>drawActor(engine.getState()));
  window.addEventListener('pagehide',()=>engine.pause('page-hidden'));
  window.addEventListener('pageshow',()=>{if(!dialog.open&&engine.getState().roomId===null)engine.pause(false);});
  window.CAMPUS_APP=Object.freeze({
    getState:()=>Object.freeze({...engine.getState(),visited:Object.freeze([...visited]),activeDialog:activeDialog?Object.freeze({...activeDialog}):null,camera:Object.freeze({...cameraState})}),
    version:'campus-2026-10-27'
  });
  const art=$('#campus-art');
  const imageReady=art.complete&&art.naturalWidth?Promise.resolve():new Promise((resolve,reject)=>{art.addEventListener('load',resolve,{once:true});art.addEventListener('error',reject,{once:true});});
  Promise.all([document.fonts.ready,imageReady]).then(()=>{fitCamera();window.CAMPUS_READY=true;}).catch(()=>{$('#near-hint').textContent='지도 이미지를 읽지 못했어요. 전체 커리큘럼에서 수업 내용을 확인할 수 있습니다.';window.CAMPUS_READY=false;});
})();
