/* Frame-deterministic 100-second motion film. No external runtime or animation dependencies. */
(() => {
  'use strict';
  const RENDER = new URLSearchParams(location.search).has('render');
  if (RENDER) document.body.classList.add('render-mode');
  const stage = document.querySelector('#motion-stage');
  const shell = document.querySelector('#screen-shell');
  const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
  const ease = n => 1 - Math.pow(1 - clamp(n), 4);
  const smooth = n => { n = clamp(n); return n * n * (3 - 2 * n); };
  const nfmt = n => n.toLocaleString('ko-KR');
  const plant = '<svg class="plant" viewBox="0 0 180 240" fill="none" aria-hidden="true"><path d="M63 160h65l-8 61H71z" fill="#e4ef9b" stroke="currentColor" stroke-width="3"/><path d="M96 158V40m0 89-37-31m37 7 42-34M96 73 67 46" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M97 59c-3-28 14-39 25-41 4 23-5 37-25 41ZM69 61C42 58 38 43 37 30c24 0 35 12 32 31ZM58 112c-30 0-42-16-44-32 28-4 44 7 44 32ZM124 91c4-28 22-35 38-31-3 25-16 37-38 31Z" fill="#e4ef9b" stroke="currentColor" stroke-width="3"/></svg>';
  const coffee = '<svg class="coffee" viewBox="0 0 160 190" fill="none" aria-hidden="true"><path d="M27 68h89v75c0 19-14 29-44 29s-45-10-45-29V68Z" fill="#f5f4ee" stroke="currentColor" stroke-width="3"/><path d="M116 81h12c35 0 36 54-12 54M19 179h111M50 46c-15-11 17-17 3-31m27 31c-15-11 17-17 3-31" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><ellipse cx="72" cy="70" rx="44" ry="11" fill="#f5baa0" stroke="currentColor" stroke-width="3"/></svg>';
  const anim = (html, at = 0, from = 'up', rotate = 0, duration = .75, distance = 100) => `data-at="${at}" data-from="${from}" data-angle="${rotate}" data-duration="${duration}" data-distance="${distance}" ${html}`;
  const paper = (classes, inner, opts = {}) => `<div class="paper ${classes}" ${anim('', opts.at ?? .35, opts.from ?? 'up', opts.rotate ?? 0, opts.duration ?? .8, opts.distance ?? 110)}>${inner}</div>`;
  const browserTop = '<div class="browser-top"><i></i><i></i><i></i></div>';
  const basicsRows = [['고객', '우리 가게를 찾는 사람'], ['상품', '드립백 10개입'], ['가격', '15,000원'], ['운영', '평일 10:00–18:00']];
  const scenes = [
    {id:'intro',start:0,end:8,tab:'시작',category:'',code:'',course:'내 사업에 필요한 것을 만들고, 직접 활용하고, 스스로 수정하는 교육',time:'Biadon Edu',title:'내 사업에 필요한 것,<br>이제 <span class="blue">직접 만듭니다.</span>',description:'만들고, 활용하고,<br>스스로 수정하는 교육.',detail:'',className:'intro-scene',visual:`
      ${paper('intro-website',`${browserTop}<div class="paper-body"><div><h3>우리 가게를<br>소개합니다.</h3><p>사업 소개 · 가격 · 문의</p><div class="fake-button">문의하기 ↗</div></div>${plant}</div>`,{from:'right',rotate:-3,at:.3})}
      ${paper('intro-report green-paper','<h3>매출 보고서</h3><p class="label">실습 예시</p><div class="bars"><i style="height:43%"></i><i style="height:70%"></i><i style="height:57%"></i><i style="height:88%"></i></div>',{from:'right',rotate:5,at:.8})}
      ${paper('intro-promo',`<h3>상품을<br>매력적으로.</h3>${coffee}`,{from:'left',rotate:3,at:1.3})}
      ${paper('intro-quote peach-paper','<h3>견적 계산기</h3><div class="data-row"><span>수량</span><b>10개</b></div><div class="data-row"><span>단가</span><b>15,000원</b></div><div class="quote-result">150,000원</div>',{from:'right',rotate:-2,at:1.8})}
      <div class="note-strip intro-flow" ${anim('',2.4,'up',-1,.75,80)}>문의 <span>→</span> 저장 <span>→</span> 알림</div>`},
    {id:'foundation',start:8,end:18,tab:'공통 기초',category:'공통 기초',code:'01',course:'내 사업에 AI 적용하기',time:'2시간 × 1회',title:'먼저,<br>내 사업부터<br><span class="blue">알려주세요.</span>',description:'사업 기본정보 → 업무별 요청문<br>→ 검수 기준표',detail:'사업의 조건이 바뀌어도,<br>요청문을 고쳐 다시 활용합니다.',visual:`
      ${paper('basics-info',`<h3>우리 사업 기본정보</h3><p class="label" style="margin-top:10px">실습 예시 · 하루상점</p><div class="rows">${basicsRows.map((r,i)=>`<div class="data-row" ${anim('',.6+i*.45,'left',0,.5,30)}><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}</div>`,{rotate:-2,at:.25})}
      ${paper('basics-prompt','<h3>업무별 요청문</h3><p>이 상품을 처음 보는 고객에게<br>가격과 문의 방법을 담아 소개해 주세요.</p>',{rotate:2,at:2.8,from:'right'})}
      ${paper('basics-check','<span class="check-box">✓</span> 사실 · 가격 · 표현 검수',{rotate:-2,at:4.1,from:'up'})}`},
    {id:'content',start:18,end:26,tab:'A 홍보 콘텐츠',category:'선택 A',code:'A',course:'사업용 홍보 콘텐츠 만들기',time:'2시간 × 2회 · 총 4시간',title:'한 상품에서,<br><span class="blue">여러 홍보물로.</span>',description:'문구 · 이미지 · 재사용 템플릿',detail:'제목과 본문을 쓰고, 사진·문구·배치를<br>고쳐 다른 상품에도 활용합니다.',visual:`
      ${paper('poster peach-paper',`<p class="label">하루상점 · 실습 예시</p><h3 style="margin-top:18px">오늘의 커피,<br>어디서든.</h3>${coffee}<div class="price-strip"><span>드립백 10개입</span><b>15,000원</b></div>`,{rotate:-3,at:.2,from:'left'})}
      ${paper('social-paper','<p class="label">짧은 게시물로 바꾸기</p><div class="rule"></div><h3>좋은 커피 한 잔,<br>가볍게 챙기세요.</h3><p class="rule-text">상품 소개 + 가격 + 문의<br>채널에 맞게 길이를 조정합니다.</p>',{rotate:3,at:1.4,from:'right'})}
      ${paper('template-paper green-paper','<h3>다른 상품에도</h3><p>상품 정보 → 문구 → 이미지 → 검수</p>',{rotate:-1,at:3.4})}
      <p class="option-note">선택 심화 · 짧은 영상의 대본·촬영 순서·자막·장면 연결</p>`},
    {id:'web',start:26,end:35,tab:'B 웹페이지',category:'선택 B',code:'B',course:'직접 수정하는 사업 소개·문의 웹페이지 만들기',time:'2시간 × 3회 · 총 6시간',title:'소개하고,<br>문의받고,<br><span class="blue">직접 고칩니다.</span>',description:'공개된 페이지 + 문의 연결<br>+ 수정·운영 안내서',detail:'모바일 확인부터 가격·사진·문구 수정,<br>이전 상태 복구까지 실습합니다.',visual:`
      ${paper('web-browser',`${browserTop}<div class="web-nav"><b>하루상점</b><span>소개　상품　문의</span></div><div class="web-content"><div><h3>우리 가게를<br>소개합니다.</h3><p>한 잔의 여유를 전합니다.<br>상품 정보와 문의 방법을 한곳에.</p><div class="fake-button">문의하기 ↗</div></div>${plant}</div><div class="web-price"><span>드립백 10개입</span><b id="web-price-value">15,000원</b></div>`,{rotate:-2,at:.25,from:'right'})}
      ${paper('web-note green-paper','<span>가격을 바꾸면?</span><strong id="web-edit-note">직접 수정하고 다시 확인</strong>',{rotate:1,at:2.2})}
      <p class="option-note">연계 심화 · UTM·채널별 유입 / 버튼 클릭과 실제 접수 구분</p>`},
    {id:'automation',start:35,end:45,tab:'C 고객 업무',category:'선택 C',code:'C',course:'고객 문의 관리·응대·알림 자동화하기',time:'2시간 × 3회 · 총 6시간',title:'문의 한 건이,<br><span class="blue">다음 업무로</span><br>이어집니다.',description:'문의 폼 · 고객 관리표 · 응대 자료<br>· 자동화 1개 · 오류 대응 안내서',detail:'중복·누락·연결 실패를 확인하고,<br>중지하거나 수동으로 처리합니다.',visual:`
      ${paper('form-paper','<h3>새 문의가 도착했습니다</h3><div class="data-row"><span>요청</span><b>드립백 선물 세트 견적</b></div><div class="data-row"><span>상태</span><b>담당자 확인 필요</b></div><p class="label" style="margin-top:12px">실습 예시 · 실제로 전송되지 않습니다</p>',{rotate:-2,at:.2})}
      <div class="flow-chain" ${anim('',1.5,'up',0,.7,80)}><div class="flow-box" data-step="0">문의 접수</div><span class="flow-arrow">→</span><div class="flow-box" data-step="1">저장</div><span class="flow-arrow">→</span><div class="flow-box" data-step="2">담당자 알림</div></div>
      ${paper('duplicate','중복 접수?<br><b>검토함으로</b>',{rotate:5,at:4.1,from:'right'})}
      ${paper('flow-card green-paper','<span class="stamp">수동 처리</span><div><h4>연결이 멈추면 담당자에게</h4><p>승인 · 중지 · 오류 대응을 함께 실습합니다.</p></div>',{rotate:1,at:5.3})}
      <p class="automation-note">선택 심화 · AI 분류·요약 / 답변 초안·담당자 검토 / 카카오 알림톡 연동</p>`},
    {id:'data',start:45,end:54,tab:'D 매출 보고서',category:'선택 D',code:'D',course:'매출 자료를 읽고 반복 보고서 만들기',time:'2시간 × 2회 · 총 4시간',title:'흩어진 숫자에서,<br><span class="blue">필요한 답을</span><br>찾습니다.',description:'분석표 + 검증 기록<br>+ 반복 분석 절차',detail:'중복·취소·누락을 확인하고,<br>분석 결과를 원본과 대조합니다.',visual:`
      ${paper('data-original','<h3>매출 원본</h3><p class="label" style="margin-top:9px">실습 예시</p><table class="mini-table"><thead><tr><th>상품</th><th>금액</th><th>상태</th></tr></thead><tbody><tr><td>드립백</td><td>30,000</td><td>정상</td></tr><tr id="data-cancel-row"><td>원두</td><td>18,000</td><td>취소</td></tr><tr><td>드립백</td><td>15,000</td><td>정상</td></tr></tbody></table>',{rotate:-3,at:.2,from:'left'})}
      ${paper('data-report green-paper','<h3>필요한 질문 3개</h3><div class="bars"><i style="height:46%"></i><i style="height:79%"></i><i style="height:64%"></i></div><p>상품별 · 요일별 집계<br>리뷰 분류와 원본 대조</p>',{rotate:2,at:1.8,from:'right'})}
      <div class="note-strip verify-strip" ${anim('',3.8,'up',-1,.75,65)}>원본 <span>↔</span> 분석표 <span>✓</span> 검증 기록</div>`},
    {id:'tools',start:54,end:63,tab:'E 업무 도구',category:'선택 E',code:'E',course:'나만의 작은 업무 도구 만들기',time:'과제 범위에 따라 편성',title:'매번 하던 계산,<br><span class="blue">내 도구로</span><br>만듭니다.',description:'맞춤 업무 도구 1개<br>+ 테스트 사례 + 수정 안내서',detail:'입력 → 처리 규칙 → 결과<br>기준을 바꾸면, 수정하고 다시 검증합니다.',visual:`
      ${paper('calculator peach-paper','<h3>견적 계산기</h3><p class="label" style="margin-top:9px">실습 예시</p><div class="data-row"><span>수량</span><b class="calc-input" id="calc-quantity">10개</b></div><div class="data-row"><span>단가</span><b class="calc-input" id="calc-unit">15,000원</b></div><div class="calc-total"><span>계산 결과</span><b id="calc-result">150,000원</b></div>',{rotate:-2,at:.2})}
      ${paper('calc-error','빈칸 · 음수 · 누락도 <strong>테스트합니다.</strong>',{rotate:1,at:2.4,from:'left'})}
      <div class="calc-test" ${anim('',4.0,'up',0,.75,60)}><span>빈칸 ✓</span><span>음수 ✓</span><span>기준 수정 ✓</span></div>`},
    {id:'team',start:63,end:79,tab:'심화 AI 업무팀',category:'심화 과정',code:'03',course:'내 사업의 AI 업무팀 만들기',time:'2시간 × 6회 · 총 12시간',title:'하나의 도구에서,<br><span class="blue">함께 일하는 업무 흐름으로.</span>',description:'1~3회차 세팅 · 4~6회차 운영　/　기본 실습: AI 마케팅팀',detail:'',className:'team-scene',visual:`
      <div class="team-setup">${[['역할','누가 어떤 일을 할까'],['자료','공통 자료함'],['권한','접근 범위 정하기'],['승인','사람의 확인 단계']].map((r,i)=>`<div class="setup-part" ${anim('',.3+i*.4,'up',0,.65,50)}><b>${r[0]}</b><span>${r[1]}</span></div>`).join('')}</div>
      <div class="team-chain">${['기획','제작','검수','사람 승인'].map((name,i)=>`${i?'<span class="team-arrow">→</span>':''}<div class="team-node ${i===3?'approval':''}" ${anim('',2.4+i*.45,'up',0,.7,80)}><strong>${name}</strong><span>${i===3?'최종 확인':`역할 ${i+1}`}</span></div>`).join('')}</div>
      <div class="team-slip paper" ${anim('',4.4,'left',0,.6,50)} id="team-slip">작업물 · 목표·기한·형식</div>
      <div class="team-status" id="team-status" ${anim('',5.0,'up',0,.7,30)}>업무 전달 → 진행 확인 → 부분 수정·재작업</div>
      <div class="team-expansion" ${anim('',11.5,'up',0,.7,30)}>확장 주제<br>고객 응대팀 · 운영 보고팀 · 리서치팀</div>`},
    {id:'operations',start:79,end:90,tab:'공통 운영 카드',category:'전 과정 공통',code:'+',course:'비용·계정·보안·오류 관리',time:'각 과정에 포함',title:'만드는 법과 함께,<br><span class="blue">운영하는 법까지.</span>',description:'계정 · 권한 · 비용 · 중지 · 복구<br>한 장의 운영 카드로 정리합니다.',detail:'개인정보·자료 입력 범위와 실행 환경,<br>변경 전 보관·수동 처리도 확인합니다.',visual:`
      ${paper('operation-card green-paper',`<h3>운영 카드 <span>모든 과정에 포함</span></h3><div class="rule"></div>${[['계정','누가 소유하는지'],['권한','누구와 공유하는지'],['비용','구독·API·호스팅'],['중지','실행을 멈추는 방법'],['복구','이전 상태로 돌아가기']].map((r,i)=>`<div class="check-row" ${anim('',.6+i*.55,'left',0,.55,45)}><span><span class="check-box">✓</span>${r[0]}</span><em>${r[1]}</em></div>`).join('')}<p class="operation-small">개인정보·입력 범위 확인<br>변경 전 자료 보관 · 수동 처리</p>`,{rotate:2,at:.2,from:'right'})}
      <div class="operation-button" ${anim('',4.0,'left',-3,.8,80)} id="operation-stop">Ⅱ 실행 중지</div>
      <div class="note-strip recovery-strip" ${anim('',6.0,'up',-1,.8,60)} id="recovery-note">이전 상태 <span>↶</span> 복구 방법 확인</div>`},
    {id:'outro',start:90,end:100,tab:'나의 학습 경로',category:'',code:'',course:'공통 기초 → 목적별 선택 과정 → AI 업무팀 구축·운영',time:'Biadon Edu',title:'필요한 것부터 만들고,<br><span class="blue">내 사업에 계속 씁니다.</span>',description:'자신의 사업 자료와 실제 업무로 시작합니다.<br>완성한 다음에는, 직접 검증하고 수정합니다.',detail:'',className:'outro-scene',visual:''}
  ];
  window.MOTION_DURATION = 100;
  window.MOTION_SCENES = scenes.map(({id,start,end,tab,course,time}) => ({id,start,end,title:tab,course,time}));
  stage.innerHTML = scenes.map((s,i) => `<section class="scene ${s.className||''}" id="scene-${s.id}" aria-label="${s.tab}"><div class="scene-copy ${s.id==='intro'?'intro-copy':''}">${s.category?`<p class="scene-category"><b>${s.code}</b>${s.category}</p>`:''}<h2>${s.title}</h2>${s.id==='intro'?'<div class="intro-underline" id="intro-underline"></div>':''}${s.description?`<p class="scene-description">${s.description}</p>`:''}${s.detail?`<p class="scene-detail">${s.detail}</p>`:''}</div>${s.id==='intro'?'<p class="intro-caption">콘텐츠 · 웹페이지 · 자동화 · 업무 도구</p>':''}<div class="scene-visual ${s.id==='intro'?'intro-visual':''} ${s.id==='team'?'team-visual':''}">${s.visual}</div>${s.id==='outro'?`<div class="outro-route"><div class="route-end" ${anim('',.5,'left',0,.8,70)}><strong>공통 기초</strong><span>2시간 · 내 사업 이해</span></div><span ${anim('',1.1,'none')}>→</span><div class="route-choices" ${anim('',1.4,'up',0,.8,55)}>${['A','B','C','D','E'].map(c=>`<div class="route-choice" data-choice="${c}">${c}</div>`).join('')}</div><span ${anim('',2.8,'none')}>→</span><div class="route-end" ${anim('',3.0,'right',0,.8,70)}><strong>AI 업무팀</strong><span>12시간 · 구축·운영</span></div></div><div class="outro-flow" ${anim('',3.8,'up',0,.8,45)}>${['업무 이해','범위 결정','AI와 제작','결과 검증','직접 수정','반복 활용'].map((v,j)=>`${j?'<i>→</i>':''}<span data-flow="${j}">${v}</span>`).join('')}</div><p class="outro-note" ${anim('',4.3,'none')}>교육 시간은 현재 편성안 기준입니다. 선택 E는 과제 범위에 따라 편성합니다.</p>`:''}</section>`).join('') + `<div class="stage-brand"><b>B</b>Biadon Edu</div><div class="stage-heading" id="stage-heading">교육 커리큘럼　01 / 10</div><div class="stage-rule"></div><div class="stage-bottom-rule"></div><div class="stage-course" id="stage-course"></div><div class="stage-time" id="stage-time"></div><div class="stage-progress">${scenes.map(()=>'<span><i></i></span>').join('')}</div>`;
  const sceneNodes = scenes.map(s => document.getElementById(`scene-${s.id}`));
  const animNodes = sceneNodes.map(el => Array.from(el.querySelectorAll('[data-at]')).map(node => ({node,at:+node.dataset.at,from:node.dataset.from,angle:+node.dataset.angle,duration:+node.dataset.duration,distance:+node.dataset.distance})));
  const progressNodes = [...stage.querySelectorAll('.stage-progress i')];
  const courseNode = document.querySelector('#stage-course');
  const timeNode = document.querySelector('#stage-time');
  const headingNode = document.querySelector('#stage-heading');
  const webPrice = document.querySelector('#web-price-value');
  const webEditNote = document.querySelector('#web-edit-note');
  const flowBoxes = [...stage.querySelectorAll('.flow-box')];
  const cancelRow = document.querySelector('#data-cancel-row');
  const calcQuantity = document.querySelector('#calc-quantity');
  const calcUnit = document.querySelector('#calc-unit');
  const calcResult = document.querySelector('#calc-result');
  const teamSlip = document.querySelector('#team-slip');
  const teamStatus = document.querySelector('#team-status');
  const teamNodes = [...stage.querySelectorAll('.team-node')];
  const routeChoices = [...stage.querySelectorAll('.route-choice')];
  const outroFlow = [...stage.querySelectorAll('[data-flow]')];
  const seek = document.querySelector('#seek');
  const displayTime = document.querySelector('#time');
  const playButton = document.querySelector('#play');
  const soundButton = document.querySelector('#sound');
  const soundtrack = document.querySelector('#soundtrack');
  let activeIndex = -1;
  let current = 0;
  let playing = false;
  let audioEnabled = false;
  let startClock = 0;
  let animationHandle = 0;
  let lastAudioAttempt = -1;
  const formatTime = seconds => `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  const chapters = document.querySelector('#chapters');
  chapters.innerHTML = scenes.map((s,i)=>`<button type="button" data-time="${s.start}" aria-current="${i===0?'true':'false'}"><span>${formatTime(s.start)}</span>${s.tab}</button>`).join('');
  const chapterButtons = [...chapters.querySelectorAll('button')];
  function setText(node, text) { if(node.textContent!==text) node.textContent=text; }
  function animateNode(a, time) {
    const p = ease((time-a.at)/a.duration);
    const remaining = (1-p)*a.distance;
    let x=0,y=0,scale=1;
    if(a.from==='left')x=-remaining;
    if(a.from==='right')x=remaining;
    if(a.from==='up')y=remaining;
    if(a.from==='down')y=-remaining;
    if(a.from==='scale')scale=.85+.15*p;
    a.node.style.opacity=String(clamp((time-a.at)/(a.duration*.55)));
    a.node.style.transform=`translate(${x.toFixed(3)}px,${y.toFixed(3)}px) rotate(${a.angle}deg) scale(${scale.toFixed(4)})`;
  }
  function applySceneMotion(id, t) {
    if(id==='intro')document.querySelector('#intro-underline').style.transform=`scaleX(${ease((t-.35)/1.0)})`;
    if(id==='web'){
      const editing=t>=3.0;
      setText(webPrice,editing?'18,000원':'15,000원');
      webPrice.classList.toggle('edit-price',editing&&t<6.5);
      setText(webEditNote,editing?'15,000원 → 18,000원 수정':'직접 수정하고 다시 확인');
    }
    if(id==='automation')flowBoxes.forEach((node,i)=>node.classList.toggle('active-step',t>=1.8+i*.75));
    if(id==='data')cancelRow.classList.toggle('cancelled',t>=2.8);
    if(id==='tools'){
      const revised=t>=5.2;
      setText(calcQuantity,'10개');setText(calcUnit,revised?'18,000원':'15,000원');setText(calcResult,`${nfmt(revised?180000:150000)}원`);
      calcUnit.style.outline=revised&&t<7.4?'2px solid #2340ff':'';
    }
    if(id==='team'){
      const positions=[0,460,920,1380];
      let p=0;
      if(t>=4.6&&t<6.1)p=ease((t-4.6)/1.3);
      else if(t>=6.1&&t<8.4)p=1+ease((t-6.7)/1.3);
      else if(t>=8.4&&t<10.5)p=2+ease((t-9.0)/1.3);
      else if(t>=10.5&&t<12.0)p=3;
      else if(t>=12.0&&t<13.2)p=3-ease((t-12.0)/1.0)*2;
      else if(t>=13.2)p=1+ease((t-13.3)/1.8)*2;
      const left=positions[0]+p*460;
      teamSlip.style.transform=`translate(${left.toFixed(2)}px,0)`;
      teamNodes.forEach((node,i)=>{node.style.outline=Math.abs(p-i)<.12?'3px solid #2340ff':'';node.style.outlineOffset='5px';});
      setText(teamSlip,t>=12&&t<14.7?'기준 변경 · 부분 재작업':t>=10.5&&t<12?'사람 승인 · 최종 확인':'작업물 · 목표·기한·형식');
      setText(teamStatus,t>=12?'자료 누락·기준 변경·연결 실패·중복 실행에 대응하고, 비용·작업 기록을 확인합니다.':'업무 전달 → 진행 확인 → 부분 수정·재작업');
    }
    if(id==='operations'){
      const stop=document.querySelector('#operation-stop');
      setText(stop,t>=5.1?'Ⅱ 실행 중지됨':'Ⅱ 실행 중지');
      stop.style.background=t>=5.1?'#222820':'#f5baa0';stop.style.color=t>=5.1?'#fffef9':'#222820';
    }
    if(id==='outro'){
      routeChoices.forEach(node=>node.classList.toggle('chosen',t>=2.2&&['A','B','C'].includes(node.dataset.choice)));
      const p=clamp((t-4.1)/2.2);
      outroFlow.forEach((node,i)=>{node.style.color=p>=i/5?'#2340ff':'#222820';node.style.fontWeight=p>=i/5?'650':'430';});
    }
  }
  function renderAt(seconds) {
    const numeric=Number(seconds);
    current=clamp(Number.isFinite(numeric)?numeric:0,0,100);
    const index=current>=100?scenes.length-1:scenes.findIndex(s=>current>=s.start&&current<s.end);
    const s=scenes[index];
    const local=current-s.start;
    if(index!==activeIndex){
      sceneNodes.forEach((node,i)=>node.classList.toggle('active',i===index));
      activeIndex=index;
      setText(courseNode,s.course);setText(timeNode,s.time);
      setText(headingNode,`교육 커리큘럼　${String(index+1).padStart(2,'0')} / 10`);
      chapterButtons.forEach((button,i)=>button.setAttribute('aria-current',i===index?'true':'false'));
    }
    animNodes[index].forEach(a=>animateNode(a,local));
    const exit=index===scenes.length-1?1:1-smooth((local-(s.end-s.start-.28))/.28);
    sceneNodes[index].style.opacity=String(exit);
    applySceneMotion(s.id,local);
    progressNodes.forEach((node,i)=>node.style.transform=`scaleX(${i<index?1:i===index?clamp((current-s.start)/(s.end-s.start)):0})`);
    seek.value=String(current);
    setText(displayTime,`${formatTime(current)} / 01:40`);
    return {time:current,scene:s.id,index,local};
  }
  window.renderAt=renderAt;
  function fitStage(){
    if(RENDER)return;
    const bounds=shell.getBoundingClientRect();
    const fullscreen=document.fullscreenElement===shell;
    const scale=Math.min(bounds.width/1920,bounds.height/1080);
    stage.style.transform=fullscreen?`translate(-50%,-50%) scale(${scale})`:`scale(${scale})`;
  }
  function syncAudio(force=false){
    if(!audioEnabled||!playing){soundtrack.pause();return;}
    if(force||Math.abs(soundtrack.currentTime-current)>.3)soundtrack.currentTime=Math.min(current,Number.isFinite(soundtrack.duration)?Math.max(0,soundtrack.duration-.01):current);
    if(soundtrack.paused&&(force||Math.floor(current)!==lastAudioAttempt)){lastAudioAttempt=Math.floor(current);soundtrack.play().catch(()=>{});}
  }
  function setPlaying(value){
    playing=value;
    playButton.innerHTML=playing?'일시정지 <span aria-hidden="true">Ⅱ</span>':'재생 <span aria-hidden="true">▶</span>';
    playButton.setAttribute('aria-label',playing?'영상 일시정지':'영상 재생');
    cancelAnimationFrame(animationHandle);
    if(playing){if(current>=100)renderAt(0);startClock=performance.now()-current*1000;syncAudio(true);animationHandle=requestAnimationFrame(tick);}
    else {soundtrack.pause();lastAudioAttempt=-1;}
  }
  function tick(now){
    if(!playing)return;
    renderAt((now-startClock)/1000);
    if(current>=100){setPlaying(false);return;}
    syncAudio();animationHandle=requestAnimationFrame(tick);
  }
  function seekTo(value){renderAt(value);if(playing)startClock=performance.now()-current*1000;syncAudio(true);}
  playButton.addEventListener('click',()=>setPlaying(!playing));
  document.querySelector('#replay').addEventListener('click',()=>{seekTo(0);setPlaying(true);});
  seek.addEventListener('input',()=>seekTo(+seek.value));
  chapters.addEventListener('click',event=>{const button=event.target.closest('[data-time]');if(button)seekTo(+button.dataset.time);});
  soundButton.addEventListener('click',()=>{audioEnabled=!audioEnabled;soundButton.textContent=audioEnabled?'소리 켬':'소리 끔';soundButton.setAttribute('aria-pressed',String(audioEnabled));soundtrack.muted=!audioEnabled;syncAudio(true);});
  document.querySelector('#fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(shell.requestFullscreen)await shell.requestFullscreen();}catch{document.querySelector('#fullscreen').textContent='전체 화면을 지원하지 않습니다';}});
  document.addEventListener('fullscreenchange',fitStage);
  document.addEventListener('keydown',event=>{if(RENDER||event.target.matches('input,button,a,textarea,select'))return;if(event.code==='Space'){event.preventDefault();setPlaying(!playing);}if(event.code==='ArrowRight'){event.preventDefault();seekTo(current+5);}if(event.code==='ArrowLeft'){event.preventDefault();seekTo(current-5);}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing)setPlaying(false);});
  window.addEventListener('resize',fitStage);
  new ResizeObserver(fitStage).observe(shell);
  const hashTime=location.hash.match(/^#t=(\d+(?:\.\d+)?)$/);
  renderAt(hashTime?+hashTime[1]:0);fitStage();
  soundtrack.volume=.5;soundtrack.muted=true;
  document.fonts.ready.then(()=>{fitStage();renderAt(current);window.MOTION_READY=true;});
})();
