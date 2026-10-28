(() => {
  'use strict';
  const courses = window.EDU_DATA || [];
  const byId = Object.fromEntries(courses.map(course => [course.id, course]));
  const optionalIds = ['A', 'B', 'C', 'D', 'E', 'T'];
  const storageKey = 'biadon-edu-curriculum-path-v1';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const format = number => new Intl.NumberFormat('ko-KR').format(number);
  let selected = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(saved)) selected = new Set(saved.filter(id => optionalIds.includes(id)));
  } catch (_) { /* Private browsing and file URLs can restrict storage. */ }
  let activeView = 'overview';
  let activeCourse = null;
  let detailTab = 'learn';
  let courseOpener = null;
  let finderOpener = null;
  const dialog = $('#course-dialog');
  const finder = $('#finder-dialog');

  const announce = text => { $('#live-message').textContent = text; };
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify([...selected])); } catch (_) {}
  }
  function timeShort(course) {
    return course.id === 'S' ? '각 과정에 포함' : course.hours === null ? '과제별 편성' : `${course.hours}시간`;
  }
  function courseCode(course) {
    return ['F', 'T', 'S'].includes(course.id) ? {F:'공통 기초', T:'심화 과정', S:'전 과정 공통'}[course.id] : course.id;
  }
  function codeClass(course) { return ['F', 'T', 'S'].includes(course.id) ? ' word' : ''; }

  function showView(view, focus = false) {
    if (!['overview', 'courses', 'path'].includes(view)) return;
    activeView = view;
    $$('.main-nav [role=tab]').forEach(tab => {
      const active = tab.dataset.view === view;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $$('.view').forEach(panel => { panel.hidden = panel.id !== `view-${view}`; });
    try { history.replaceState(null, '', view === 'overview' ? location.pathname + location.search : `#${view}`); } catch (_) {}
    window.scrollTo({top: 0, behavior: 'instant'});
    if (focus) $('#main-content').focus({preventScroll:true});
  }

  function renderCourseList() {
    $('#course-list').innerHTML = courses.map(course => `
      <button class="course-row" data-course="${course.id}" aria-label="${escape(course.group + ' ' + course.title + ', ' + course.time + ', 상세 보기')}">
        <span class="course-code${codeClass(course)}">${courseCode(course)}</span>
        <span class="course-row-content"><strong>${escape(course.title)}${selected.has(course.id) ? '<span class="selected-marker">경로에 담음 ✓</span>' : ''}</strong><span>${escape(course.summary)}</span></span>
        <span class="course-time">${escape(timeShort(course))}</span><span class="course-arrow" aria-hidden="true">↗</span>
      </button>`).join('');
  }

  function renderPath() {
    const sequence = [byId.F, ...optionalIds.filter(id => selected.has(id)).map(id => byId[id])];
    const hours = sequence.reduce((sum, course) => sum + (course.hours || 0), 0);
    $('#total-hours').textContent = String(hours);
    $('#variable-hours').hidden = !selected.has('E');
    $('#path-summary').textContent = `공통 기초 + ${selected.size ? `선택한 과정 ${selected.size}개` : '선택 과정 미정'}`;
    $('.path-count').textContent = String(selected.size);
    $('.path-count').hidden = selected.size === 0;
    $('#reset-path').disabled = selected.size === 0;
    $('#path-sequence').innerHTML = sequence.map((course, index) => `
      <div class="path-item ${course.id === 'F' ? 'fixed' : ''}">
        <span class="path-code${codeClass(course)}">${course.id === 'F' ? '기초' : course.id === 'T' ? '심화' : course.id}</span>
        <div class="path-item-content"><button data-course="${course.id}">${escape(course.title)}</button><span>${escape(course.time)}</span></div>
        ${course.id === 'F' ? '<span class="tiny">기본 포함</span>' : `<button class="remove-course" data-remove="${course.id}" aria-label="${escape(course.title)} 경로에서 빼기">빼기 ×</button>`}
        ${index < sequence.length - 1 ? '<span class="path-connector" aria-hidden="true">↓</span>' : ''}
      </div>`).join('') + (selected.size === 0 ? '<div class="path-empty"><h2>다음에는 무엇을<br>만들어 볼까요?</h2><p>아래에서 필요한 과정을 골라보세요.</p><button class="text-button" data-view="courses">전체 과정 살펴보기 ↗</button></div>' : '') + '<p class="path-common">함께 배우는 운영 기준<br><button data-course="S">계정 · 권한 · 비용 · 중지 · 복구 ↗</button></p>';
    $('#path-options').innerHTML = optionalIds.map(id => `<button class="path-option" data-toggle="${id}" aria-pressed="${selected.has(id)}"><b>${id === 'T' ? '심화' : id}</b><span>${escape(byId[id].short)}</span><span aria-hidden="true">${selected.has(id) ? '✓' : '+'}</span></button>`).join('');
  }

  function refreshSelection() {
    persist();
    renderCourseList();
    renderPath();
    if (activeCourse) renderDialogFooter();
  }

  function toggleSelection(id) {
    if (!optionalIds.includes(id)) return;
    const adding = !selected.has(id);
    if (adding) selected.add(id); else selected.delete(id);
    refreshSelection();
    announce(`${byId[id].short} 과정을 학습 경로${adding ? '에 담았습니다.' : '에서 뺐습니다.'}`);
  }

  function openCourse(id, opener = document.activeElement) {
    if (!byId[id]) return;
    courseOpener = opener;
    activeCourse = byId[id];
    detailTab = 'learn';
    $('#dialog-group').textContent = activeCourse.group;
    $('#dialog-title').textContent = activeCourse.title;
    $('#dialog-time').textContent = activeCourse.time;
    setDetailTab('learn');
    renderDialogFooter();
    if (!dialog.open) dialog.showModal();
    $('#close-dialog').focus({preventScroll:true});
  }

  function closeCourse() { if (dialog.open) dialog.close(); }

  function renderDialogFooter() {
    const fixed = !optionalIds.includes(activeCourse.id);
    $('#dialog-footer-note').textContent = activeCourse.id === 'F' ? '모든 학습 경로는 공통 기초에서 시작합니다.' : activeCourse.id === 'S' ? '추가 교육 시간 없이, 각 과정에서 함께 다룹니다.' : activeCourse.id === 'E' ? '선택 E의 교육 시간은 과제 범위에 따라 별도로 편성합니다.' : '내가 필요한 과정을 골라 학습 경로를 구성하세요.';
    const button = $('#toggle-course');
    button.className = `button primary${fixed ? ' is-fixed' : selected.has(activeCourse.id) ? ' is-added' : ''}`;
    button.disabled = fixed;
    button.textContent = fixed ? activeCourse.id === 'F' ? '공통 기초 · 경로에 기본 포함' : '전 과정에 포함되는 내용' : selected.has(activeCourse.id) ? '✓ 경로에 담았어요 · 빼기' : '+ 나의 경로에 담기';
  }

  function renderLearn(course) {
    return (course.sections ? course.sections.map(section => `<section class="${course.sections.indexOf(section) ? 'detail-subsection' : ''}"><h3 class="${course.sections.indexOf(section) ? '' : 'detail-label'}">${escape(section.title)}</h3><p class="detail-description">${escape(section.body)}</p></section>`).join('') : `<p class="detail-description">${escape(course.description)}</p>`) +
      `<ol class="detail-steps">${course.steps.map((step, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span>${escape(step)}</li>`).join('')}</ol>` +
      `<p class="detail-example-line">${escape(course.example)}</p>` +
      (course.basic ? `<section class="detail-subsection"><h3>기본 실습</h3><p>${escape(course.basic)}</p></section>` : '') +
      (course.extra ? `<section class="detail-subsection"><h3>${escape(course.extraLabel)}</h3><p>${escape(course.extra)}</p></section>` : '') +
      (course.examples ? `<section class="detail-subsection"><h3>${escape(course.exampleLabel)}</h3><ul class="detail-example-list">${course.examples.map(example => `<li>${escape(example)}</li>`).join('')}</ul></section>` : '');
  }

  function setDetailTab(name) {
    if (!['learn', 'outputs'].includes(name)) return;
    detailTab = name;
    $$('.detail-tabs [role=tab]').forEach(tab => {
      const active = tab.dataset.detail === name;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    const panel = $('#detail-panel');
    panel.setAttribute('aria-labelledby', `detail-tab-${name}`);
    panel.scrollTop = 0;
    if (name === 'learn') panel.innerHTML = renderLearn(activeCourse);
    if (name === 'outputs') panel.innerHTML = `<p class="output-intro">수업에서 만들고, 내 사업에 가져가 계속 활용합니다.</p>${activeCourse.outputs.map((output, index) => `<div class="detail-output"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escape(output)}</strong></div>`).join('')}<p class="detail-footnote">결과물을 검증하고 직접 수정하는 과정까지 실습합니다.</p>`;
  }


  document.addEventListener('click', event => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) showView(viewButton.dataset.view);
    const courseButton = event.target.closest('[data-course]');
    if (courseButton) openCourse(courseButton.dataset.course, courseButton);
    const toggleButton = event.target.closest('[data-toggle]');
    if (toggleButton) {
      const id = toggleButton.dataset.toggle;
      toggleSelection(id);
      $(`#path-options [data-toggle="${id}"]`)?.focus({preventScroll:true});
    }
    const removeButton = event.target.closest('[data-remove]');
    if (removeButton) {
      const id = removeButton.dataset.remove;
      selected.delete(id); refreshSelection();
      announce(`${byId[id].short} 과정을 경로에서 뺐습니다.`);
      $('#tab-path').focus({preventScroll:true});
    }
  });

  function bindTabKeys(container, attribute, callback) {
    container.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      const tabs = [...container.querySelectorAll('[role=tab]')];
      const current = tabs.indexOf(document.activeElement);
      if (current < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      callback(tabs[next].dataset[attribute]); tabs[next].focus({preventScroll:true});
    });
  }
  bindTabKeys($('.main-nav'), 'view', showView);
  bindTabKeys($('.detail-tabs'), 'detail', setDetailTab);
  $$('.detail-tabs button').forEach(button => button.addEventListener('click', () => setDetailTab(button.dataset.detail)));
  $('#toggle-course').addEventListener('click', () => toggleSelection(activeCourse.id));
  $('#close-dialog').addEventListener('click', closeCourse);
  dialog.addEventListener('close', () => {
    const closedCourseId = activeCourse?.id;
    activeCourse = null;
    if (courseOpener && courseOpener.isConnected) courseOpener.focus({preventScroll:true});
    else {
      const replacement = closedCourseId ? $(`#view-${activeView} [data-course="${closedCourseId}"]`) : null;
      (replacement || $(`#tab-${activeView}`)).focus({preventScroll:true});
    }
  });
  dialog.addEventListener('click', event => { if (event.target === dialog && event.clientX < dialog.getBoundingClientRect().left) closeCourse(); });
  // Native dialog makes the background inert. Keep tab focus in the visible sheet as well.
  function trapFocus(event) {
    if (event.key !== 'Tab') return;
    const focusables = [...event.currentTarget.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex="0"]')].filter(element => element.getClientRects().length);
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  dialog.addEventListener('keydown', trapFocus);
  finder.addEventListener('keydown', trapFocus);

  const goals = [
    ['A','상품을 더 잘 알리고 싶어요','홍보 콘텐츠'],
    ['B','내 사업을 소개하고 문의받고 싶어요','웹페이지'],
    ['C','문의 관리와 전달을 줄이고 싶어요','고객 자동화'],
    ['D','매출 자료에서 답을 찾고 싶어요','분석·보고서'],
    ['E','반복하는 계산과 정리를 줄이고 싶어요','업무 도구'],
    ['T','여러 역할이 이어지는 흐름을 만들고 싶어요','AI 업무팀']
  ];
  $('#finder-options').innerHTML = goals.map(([id, question, label]) => `<button class="finder-option" data-find="${id}"><span>${escape(question)}</span><span>${escape(label)} ↗</span></button>`).join('');
  $('[data-action=find-course]').addEventListener('click', event => { finderOpener = event.currentTarget; finder.showModal(); $('#close-finder').focus(); });
  $('#close-finder').addEventListener('click', () => finder.close());
  finder.addEventListener('close', () => { if (!dialog.open && finderOpener?.isConnected) finderOpener.focus({preventScroll:true}); });
  $('#finder-options').addEventListener('click', event => {
    const button = event.target.closest('[data-find]');
    if (!button) return;
    finder.close(); showView('courses');
    const id = button.dataset.find;
    openCourse(id, $(`#course-list [data-course="${id}"]`));
  });
  $('#reset-path').addEventListener('click', () => { selected.clear(); refreshSelection(); announce('선택한 과정을 비웠습니다. 공통 기초는 기본으로 포함됩니다.'); });
  $('#download-path').addEventListener('click', () => {
    const chosen = [byId.F, ...optionalIds.filter(id => selected.has(id)).map(id => byId[id])];
    const hours = chosen.reduce((sum, course) => sum + (course.hours || 0), 0);
    const lines = ['Biadon Edu | 나의 학습 경로', '', ...chosen.flatMap(course => [`${course.group} | ${course.title}`, course.time, `결과물: ${course.outputs.join(', ')}`, '']), `합계: ${hours}시간${selected.has('E') ? ' + 선택 E 별도 편성' : ''}`, '', '전 과정 공통 | 비용·계정·보안·오류 관리', byId.S.description, '', '공통 학습 흐름', window.EDU_FLOW.join(' → '), '', '교육 시간은 현재 편성안 기준입니다.'];
    const blob = new Blob(['\uFEFF' + lines.join('\n')], {type:'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'Biadon-Edu-나의-학습-경로.txt';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    announce('나의 학습 경로를 텍스트 파일로 저장합니다.');
  });

  $('#intro-copy').textContent = window.EDU_INTRO;
  $('#flow-list').innerHTML = window.EDU_FLOW.map(step => `<li>${escape(step)}</li>`).join('');
  renderCourseList(); renderPath();
  const initialView = location.hash.slice(1);
  if (['courses','path'].includes(initialView)) showView(initialView);
})();
