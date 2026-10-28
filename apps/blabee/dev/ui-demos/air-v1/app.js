/* Isolated state machine. No backend, storage or global shortcut registration. Timers only clear temporary UI feedback. */
(() => {
  'use strict';
  const UI = window.BlabeeUI;
  const cases = window.BLABEE_CASES;
  const clone = value => JSON.parse(JSON.stringify(value));
  const defaults = { preview: 'ctrl', selection: 'option' };
  const model = {
    events: clone(window.BLABEE_EVENTS), projects: [...window.BLABEE_PROJECTS],
    savedShortcuts: { ...defaults }, shortcutDraft: { ...defaults },
    suggestion: '스마트', appService: true, autostart: false, sessions: [], resumeSession: '',
    updateState: 'current', updateCheckResult: '', clickMode: 'staged', queueIndex: 0,
    stagedChoice: -1, stagedIdentity: null, previewChoice: 0, selected: '',
    permissionResult: 'approve', shortcutError: '', closed: false, menu: false,
    dialog: null, returnCase: '12', id: '12'
  };
  let previewReturn = null;
  let dialogReturnSelector = null;
  let submissionCount = 0;
  let dismissalCount = 0;
  let updateCheckTimer = null;
  const $ = selector => document.querySelector(selector);
  const currentEvent = () => model.events[model.queueIndex] || window.BLABEE_EVENTS[0];
  function choicesForCurrent() {
    const source = currentEvent().choices.slice(0, model.queue ? 4 : model.count || 4);
    if (!model.long) return source;
    const suffixes = [' — 서로 다른 배경에서도 본문과 경계가 선명하게 구분되는지 확인', ' — 여러 작업 사이를 오가도 정확한 대상이 유지되는지 함께 검토', ' — 누르는 동안 상세를 읽고 보조 키를 놓으면 닫히는 흐름 확인', ' — 긴 한글과 명령문을 같은 폭에서 끝까지 읽을 수 있도록 구성'];
    return source.map((choice, index) => ({ ...choice, title: choice.title + suffixes[index] }));
  }
  function viewModel() { return { ...model, event: currentEvent(), choices: choicesForCurrent() }; }
  function announce(text) {
    const status = $('#interaction-status');
    if (status) status.textContent = text;
  }
  function clearSelection() { model.stagedChoice = -1; model.stagedIdentity = null; }
  function clearUpdateCheckFeedback() {
    clearTimeout(updateCheckTimer);
    updateCheckTimer = null;
    model.updateCheckResult = '';
    const label = $('#product-root [data-action="update-check"] span');
    if (label) label.textContent = '업데이트 확인';
  }
  function checkUpdate() {
    clearUpdateCheckFeedback();
    const available = ['available', 'failure'].includes(model.updateState);
    if (available) model.updateState = 'available';
    model.updateCheckResult = available ? '업데이트 가능' : '최신 버전';
    render('[data-action="update-check"]');
    announce(`${model.updateCheckResult} 예시입니다. GitHub를 조회하지 않았습니다.`);
    updateCheckTimer = setTimeout(clearUpdateCheckFeedback, 3000);
  }
  function targetSelector(target) {
    if (!target) return null;
    if (target.id) return `#${CSS.escape(target.id)}`;
    for (const attr of ['data-action', 'data-choice', 'data-pane', 'data-preview', 'data-setting', 'data-permission', 'data-project-remove']) {
      if (target.hasAttribute(attr)) return `[${attr}="${CSS.escape(target.getAttribute(attr))}"]`;
    }
    return null;
  }
  function render(focusSelector = null) {
    const root = $('#product-root');
    if (!root) return;
    root.innerHTML = UI.render(viewModel());
    const fixture = cases.find(item => item.id === model.id);
    if ($('#case-title')) $('#case-title').textContent = fixture?.title || '화면 예시';
    if ($('#case-note')) $('#case-note').textContent = fixture?.note || '';
    document.querySelectorAll('[data-case]').forEach(button => {
      const active = button.dataset.case === model.id;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'true' : 'false');
    });
    if ($('#mobile-case')) $('#mobile-case').value = model.id;
    if (model.dialog) {
      root.querySelector('#dialog-input, [data-action="dialog-cancel"]')?.focus({ preventScroll: true });
    } else if (focusSelector) {
      (root.querySelector(focusSelector) || root).focus({ preventScroll: true });
    }
    document.dispatchEvent(new CustomEvent('air-demo-render', { detail: { id: model.id, type: model.type } }));
  }
  function navigate(id, options = {}) {
    const fixture = cases.find(item => item.id === String(id));
    if (!fixture) return false;
    clearUpdateCheckFeedback();
    clearSelection();
    previewReturn = null;
    const reset = { queue: false, count: 4, details: false, long: false, expired: false, reminder: false, disabled: false, diagnostic: '', menu: false, pane: 'general', closed: false, dialog: null };
    Object.assign(model, reset, fixture);
    model.queueIndex = 0;
    if (fixture.queue && !model.events.length) {
      model.type = 'ready';
      model.queue = false;
    }
    if (fixture.update) model.updateState = fixture.update;
    if (fixture.type === 'hold-preview') { model.previewChoice = 0; previewReturn = { type: 'decision', id: '12' }; }
    if (fixture.type === 'deferred') model.closed = true;
    if (fixture.type === 'sending') model.selected = currentEvent().choices[0].title;
    if (fixture.type !== 'settings' && fixture.type !== 'hold-preview') model.returnCase = fixture.id;
    if ($('#scenario-result')) $('#scenario-result').value = 'none';
    render();
    if (!options.silent) announce(`${fixture.title} 화면입니다. 실제 작업은 실행하지 않습니다.`);
    return true;
  }
  function showSettings(pane = 'general') {
    clearUpdateCheckFeedback();
    if (model.type !== 'settings') model.returnCase = model.id;
    clearSelection();
    previewReturn = null;
    Object.assign(model, { type: 'settings', id: { general: '02', shortcuts: '03', projects: '06', services: '07' }[pane], pane, closed: false, menu: false, dialog: null });
    render(`[data-pane="${pane}"]`);
    announce('설정 예시를 열었어요. 현재 앱의 설정은 바뀌지 않습니다.');
  }
  function moveQueue(delta) {
    if (!model.queue || model.type !== 'decision' || model.closed || model.dialog) return;
    const next = Math.max(0, Math.min(model.events.length - 1, model.queueIndex + delta));
    if (next === model.queueIndex) return;
    clearSelection();
    previewReturn = null;
    model.queueIndex = next;
    model.details = false;
    render();
    announce(`${currentEvent().project} · ${next + 1}번째 대기 작업. 이전 선택 표시는 지웠어요.`);
  }
  function send(index, identity = null) {
    const choice = choicesForCurrent()[index];
    if (model.type !== 'decision' || model.closed || model.expired || model.dialog || !choice) return false;
    if (identity && (identity.event !== currentEvent().id || identity.option !== choice.id || identity.slot !== index)) {
      clearSelection();
      render();
      announce('대상이 달라져 선택 표시를 지웠어요. 다시 선택해 주세요.');
      return false;
    }
    model.selected = choice.title;
    clearSelection();
    model.type = 'sending';
    submissionCount += 1;
    render();
    announce('전달 중 화면으로 바꿨어요. 실제 전송은 없으며 결과 상태는 스튜디오에서 직접 선택합니다.');
    return true;
  }
  function choose(index) {
    if (model.type !== 'decision' || model.expired || model.closed || model.dialog) return;
    const choice = choicesForCurrent()[index];
    if (!choice) return;
    if (model.clickMode === 'direct') { send(index); return; }
    model.stagedChoice = index;
    model.stagedIdentity = { event: currentEvent().id, option: choice.id, slot: index };
    render(`[data-choice="${index}"]`);
    announce(`${index + 1}번 항목을 선택했어요. 아직 전달하지 않았습니다.`);
  }
  function permission(value) {
    if (model.type !== 'permission' || model.closed || model.dialog) return;
    clearSelection();
    model.permissionResult = value;
    if (value === 'codex') {
      model.type = 'permission-result';
      announce('Codex에서 직접 선택하는 안내 화면입니다. 앱을 열거나 응답을 보내지 않았어요.');
    } else {
      model.type = 'sending';
      model.selected = value === 'reject' ? '현재 명령 요청 거절' : '현재 명령 요청 이번만 승인';
      submissionCount += 1;
      announce('승인 응답을 보내는 화면 예시입니다. 실제 명령 실행이나 승인 응답은 없습니다.');
    }
    render();
  }
  function setResult(result) {
    const kinds = { accepted: 'received', uncertain: 'uncertain', 'permission-result': 'permission-result' };
    if (kinds[result]) {
      clearSelection();
      previewReturn = null;
      model.type = kinds[result];
      model.closed = false;
      model.dialog = null;
      render();
      announce('선택한 결과의 화면 예시입니다. 실제 전달 결과를 확인한 것이 아닙니다.');
    } else if (['update-ready', 'update-failure', 'update-restored'].includes(result)) {
      model.updateState = { 'update-ready': 'review', 'update-failure': 'failure', 'update-restored': 'restored' }[result];
      showSettings('general');
      announce('업데이트 결과 예시를 바꿨어요. 다운로드나 설치는 하지 않습니다.');
    }
  }
  function openDialog(dialog, target) {
    model.dialog = dialog;
    dialogReturnSelector = targetSelector(target);
    render();
  }
  function closeDialog() {
    model.dialog = null;
    render(dialogReturnSelector);
    dialogReturnSelector = null;
  }
  function confirmDialog() {
    const dialog = model.dialog;
    if (!dialog) return;
    if (dialog.kind === 'project-add') {
      const value = $('#dialog-input')?.value.trim();
      if (!value) { $('#dialog-input')?.focus(); announce('프로젝트 이름을 입력해 주세요.'); return; }
      if (model.projects.includes(value)) { announce('같은 이름이 이미 있어요.'); return; }
      model.projects.push(value);
    } else if (dialog.kind === 'project-remove') {
      model.projects.splice(dialog.index, 1);
    } else if (dialog.kind === 'risk') {
      model.selected = '생성 산출물 정리 범위 확인 후 진행';
      model.type = 'sending';
      submissionCount += 1;
    } else if (dialog.kind === 'update') {
      model.updateState = 'review';
    }
    closeDialog();
    announce(dialog.kind === 'update' ? '설치 전 확인 화면을 검토했어요. 앱 종료·설치·세션 복원은 수행하지 않습니다.' : '데모 안에서만 반영했어요. 실제 작업이나 설정은 변경하지 않았습니다.');
  }
  function hide() {
    clearUpdateCheckFeedback();
    clearSelection();
    previewReturn = null;
    model.menu = false;
    model.closed = true;
    render();
    announce('패널 표시만 숨겼어요. 기존 작업 상태는 그대로입니다.');
  }
  function closePreview() {
    if (!previewReturn) return;
    model.type = previewReturn.type;
    model.id = previewReturn.id;
    previewReturn = null;
    render();
    announce('상세를 닫았어요. 선택은 전달하지 않았습니다.');
  }
  function openPreview(index) {
    if (!['decision', 'hold-preview'].includes(model.type) || model.closed || model.dialog || !choicesForCurrent()[index]) return;
    if (!previewReturn) previewReturn = { type: model.type, id: model.id };
    model.previewChoice = index;
    model.type = 'hold-preview';
    render();
    announce(`${index + 1}번 상세입니다. 보조 키를 놓으면 닫힙니다.`);
  }
  function handleAction(action, target) {
    switch (action) {
      case 'settings': showSettings(); return;
      case 'connection': showSettings('services'); return;
      case 'close':
        if (model.type === 'settings') { navigate(model.returnCase || '12'); return; }
        hide(); return;
      case 'defer': hide(); return;
      case 'reopen':
        model.closed = false;
        if (model.type === 'deferred') navigate('12'); else render();
        announce('데모 패널을 다시 열었어요.'); return;
      case 'details': model.details = !model.details; render('[data-action="details"]'); return;
      case 'queue-prev': moveQueue(-1); return;
      case 'queue-next': moveQueue(1); return;
      case 'send-choice': send(model.stagedChoice, model.stagedIdentity); return;
      case 'preview-close': closePreview(); return;
      case 'skip': {
        if (model.type !== 'decision') return;
        const name = currentEvent().project;
        clearSelection();
        dismissalCount += 1;
        if (model.queue) {
          model.events.splice(model.queueIndex, 1);
          model.queueIndex = Math.max(0, Math.min(model.queueIndex, model.events.length - 1));
          if (!model.events.length) { model.type = 'ready'; model.queue = false; }
        } else model.type = 'ready';
        render();
        announce(`${name}의 현재 선택만 건너뛰었어요. 다른 대기 작업과 실제 Codex에는 영향을 주지 않습니다.`); return;
      }
      case 'preview-menu': model.menu = !model.menu; render('[data-action="preview-menu"]'); return;
      case 'shortcut-default': model.shortcutDraft = { ...defaults }; model.shortcutError = ''; render('[data-action="shortcut-default"]'); return;
      case 'shortcut-cancel': model.shortcutDraft = { ...model.savedShortcuts }; model.shortcutError = ''; render('[data-action="shortcut-cancel"]'); return;
      case 'shortcut-save':
        if (model.shortcutDraft.preview === model.shortcutDraft.selection) {
          model.shortcutError = '상세 보기와 선택 실행에 같은 조합을 사용할 수 없어요.';
          render('[data-action="shortcut-save"]'); announce(model.shortcutError); return;
        }
        model.savedShortcuts = { ...model.shortcutDraft }; model.shortcutError = '';
        render(); announce('데모 단축키를 저장했어요. 시스템 전역 단축키는 바꾸지 않았습니다.'); return;
      case 'project-add': openDialog({ kind: 'project-add', input: true, title: '데모 프로젝트 추가', body: '폴더를 열거나 파일을 읽지 않고 예시 목록에 이름만 추가해요.', confirm: '목록에 추가' }, target); return;
      case 'service-toggle': model.appService = !model.appService; render('[data-action="service-toggle"]'); announce('서비스 표시 값만 바꿨어요. 실제 서비스를 시작하거나 종료하지 않습니다.'); return;
      case 'autostart-toggle': model.autostart = !model.autostart; render('[data-action="autostart-toggle"]'); announce('자동 시작 표시 값만 바꿨어요. macOS 설정은 변경하지 않습니다.'); return;
      case 'session-add':
        if (!model.resumeSession.trim()) { $('#resume-session')?.focus(); announce('데모에 표시할 세션 ID를 입력해 주세요.'); return; }
        if (!model.sessions.includes(model.resumeSession.trim())) model.sessions.push(model.resumeSession.trim());
        model.resumeSession = ''; render('[data-action="session-add"]'); announce('세션 ID를 데모 목록에 추가했어요. Codex나 터미널을 실행하지 않았습니다.'); return;
      case 'update-check': checkUpdate(); return;
      case 'update-start': clearUpdateCheckFeedback(); model.updateState = 'downloading'; render(); announce('62% 다운로드 화면 예시입니다. 완료·오류는 스튜디오의 결과 상태에서 직접 선택하세요.'); return;
      case 'update-cancel': model.updateState = 'available'; render(); announce('데모 다운로드 표시를 취소했어요. 실제 다운로드는 없었습니다.'); return;
      case 'update-review': openDialog({ kind: 'update', title: '설치 전 확인', body: '빌드 43 예시 · 관리 세션 2개. 실제 연결 단계에서는 종료 대상과 복원 계획을 확인합니다. 지금은 화면만 검토하며 어떤 앱도 종료하지 않아요.', confirm: '화면 확인 완료' }, target); return;
      case 'risk-confirm': openDialog({ kind: 'risk', danger: true, title: '이 범위로 진행할까요?', body: '/demo/BiaDone/apps/blabee/output/의 생성 산출물을 정리하는 선택입니다. 이 데모에서는 파일을 삭제하거나 요청을 보내지 않아요.', confirm: '진행 화면 보기' }, target); return;
      case 'dialog-cancel': closeDialog(); return;
      case 'dialog-confirm': confirmDialog(); return;
      default: return;
    }
  }
  function matchModifiers(event, combo) {
    const expected = {
      ctrl: [true, false, false], option: [false, true, false],
      'ctrl-option': [true, true, false], 'option-cmd': [false, true, true], 'ctrl-cmd': [true, false, true]
    }[combo];
    return !!expected && !event.shiftKey && event.ctrlKey === expected[0] && event.altKey === expected[1] && event.metaKey === expected[2];
  }
  function isEditing(target) { return target instanceof Element && !!target.closest('input,textarea,select,[contenteditable="true"]'); }
  function keyboard(event) {
    if (event.key === 'Escape') {
      if (model.dialog) { event.preventDefault(); closeDialog(); }
      else if (previewReturn) { event.preventDefault(); closePreview(); }
      else if (model.menu) { event.preventDefault(); model.menu = false; render('[data-action="preview-menu"]'); }
      else if (!isEditing(event.target) && !model.closed) { event.preventDefault(); handleAction('close'); }
      return;
    }
    if (model.dialog) {
      if (event.key === 'Tab') {
        const items = [...document.querySelectorAll('.confirm-sheet button:not(:disabled), .confirm-sheet input')];
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if (isEditing(event.target) || event.repeat || model.closed) return;
    if (event.target instanceof Element && event.target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const panes = ['general', 'shortcuts', 'projects', 'services'];
      const index = panes.indexOf(model.pane);
      model.pane = panes[event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 4) % 4];
      event.preventDefault(); render(`[data-pane="${model.pane}"]`); return;
    }
    if (matchModifiers(event, 'option') && ['ArrowLeft', 'ArrowRight'].includes(event.key) && model.queue && model.type === 'decision') {
      event.preventDefault(); moveQueue(event.key === 'ArrowLeft' ? -1 : 1); return;
    }
    const digit = /^Digit([1-4])$/.exec(event.code);
    if (!digit) return;
    const index = Number(digit[1]) - 1;
    if (model.type === 'permission' && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && index < 3) {
      event.preventDefault(); permission(['approve', 'reject', 'codex'][index]); return;
    }
    if (['decision', 'hold-preview'].includes(model.type) && matchModifiers(event, model.savedShortcuts.preview)) {
      event.preventDefault(); openPreview(index); return;
    }
    if (model.type === 'decision' && matchModifiers(event, model.savedShortcuts.selection)) {
      event.preventDefault(); send(index);
    }
  }
  function setAppearance(name, value) {
    if (name && typeof name === 'object') {
      for (const [key, val] of Object.entries(name)) setAppearance(key === 'clickMode' ? 'click' : key, String(val));
      return;
    }
    const aliases = { theme: 'theme', material: 'material', background: 'background', radius: 'radius', click: 'click' };
    if (!aliases[name]) return;
    if (name === 'click') { model.clickMode = value === 'direct' ? 'direct' : 'staged'; clearSelection(); render(); }
    else {
      document.body.dataset[name] = value;
      document.documentElement.dataset[name] = value;
      if ($('#capture-frame')) $('#capture-frame').dataset[name] = value;
      if (name === 'radius') {
        const radius = `${Number(value) === 20.2 ? 20.2 : 38}px`;
        document.documentElement.style.setProperty('--panel-radius', radius);
        $('#capture-frame')?.style.setProperty('--panel-radius', radius);
      }
    }
    const control = $(`#${name === 'click' ? 'click' : name}-mode`);
    if (control) control.value = value;
  }
  function populateCases(filter = '') {
    const shown = cases.filter(item => `${item.id} ${item.title} ${item.group}`.toLowerCase().includes(filter.toLowerCase()));
    const groups = [...new Set(shown.map(item => item.group))];
    if ($('#case-nav')) $('#case-nav').innerHTML = groups.map(group => `<section class="case-group"><h3>${UI.esc(group)}</h3>${shown.filter(item => item.group === group).map(item => `<button class="case-link${item.id === model.id ? ' active' : ''}" data-case="${item.id}" aria-current="${item.id === model.id}"><span class="case-id">${item.id}</span><span>${UI.esc(item.title)}</span></button>`).join('')}</section>`).join('') || '<p class="case-empty">일치하는 화면이 없어요.</p>';
  }
  function reset() {
    Object.assign(model, { events: clone(window.BLABEE_EVENTS), projects: [...window.BLABEE_PROJECTS], savedShortcuts: { ...defaults }, shortcutDraft: { ...defaults }, suggestion: '스마트', appService: true, autostart: false, sessions: [], resumeSession: '', updateState: 'current', shortcutError: '', selected: '', permissionResult: 'approve' });
    submissionCount = 0; dismissalCount = 0;
    navigate('12');
    announce('데모 데이터와 설정 초안을 처음 상태로 되돌렸어요.');
  }
  function init() {
    if (!$('#product-root')) return;
    if (window.BLABEE_ICONS && !document.querySelector('.symbol-library')) document.body.insertAdjacentHTML('afterbegin', window.BLABEE_ICONS);
    if ($('#mobile-case')) $('#mobile-case').innerHTML = cases.map(item => `<option value="${item.id}">${item.id} · ${UI.esc(item.title)}</option>`).join('');
    populateCases();
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (!target || target.disabled) return;
      if (target.dataset.case) { navigate(target.dataset.case); return; }
      if (!target.closest('#product-root')) return;
      if (model.dialog && !target.closest('.confirm-sheet')) return;
      if (target.dataset.action) handleAction(target.dataset.action, target);
      else if (target.hasAttribute('data-choice')) choose(Number(target.dataset.choice));
      else if (target.dataset.permission) permission(target.dataset.permission);
      else if (target.dataset.pane) { model.pane = target.dataset.pane; model.menu = false; render(`[data-pane="${model.pane}"]`); }
      else if (target.dataset.preview) { model.shortcutDraft.preview = target.dataset.preview; model.shortcutError = ''; model.menu = false; render('[data-action="preview-menu"]'); }
      else if (target.hasAttribute('data-project-remove')) {
        const index = Number(target.dataset.projectRemove);
        openDialog({ kind: 'project-remove', index, title: `${model.projects[index]} 제거`, body: '이 데모의 프로젝트 목록에서만 제거해요. 파일이나 실제 설정은 바뀌지 않아요.', confirm: '목록에서 제거' }, target);
      }
    });
    document.addEventListener('change', event => {
      const target = event.target;
      if (target.matches('[data-setting="selection"]')) { model.shortcutDraft.selection = target.value; model.shortcutError = ''; render('[data-setting="selection"]'); }
      if (target.matches('[data-setting="suggestion"]')) { model.suggestion = target.value; announce('데모의 제안 범위만 바꿨어요.'); }
    });
    document.addEventListener('input', event => { if (event.target.id === 'resume-session') model.resumeSession = event.target.value; });
    document.addEventListener('keydown', keyboard);
    document.addEventListener('keyup', event => { if (previewReturn && !matchModifiers(event, model.savedShortcuts.preview)) closePreview(); });
    window.addEventListener('blur', () => { if (previewReturn) closePreview(); });
    window.addEventListener('pagehide', clearUpdateCheckFeedback);
    document.addEventListener('visibilitychange', () => { if (document.hidden && previewReturn) closePreview(); });
    $('#case-search')?.addEventListener('input', event => populateCases(event.target.value));
    $('#screen-search')?.addEventListener('input', event => populateCases(event.target.value));
    $('#mobile-case')?.addEventListener('change', event => navigate(event.target.value));
    $('#reset-preview')?.addEventListener('click', reset);
    $('#previous-case')?.addEventListener('click', () => navigate(cases[(cases.findIndex(item => item.id === model.id) - 1 + cases.length) % cases.length].id));
    $('#next-case')?.addEventListener('click', () => navigate(cases[(cases.findIndex(item => item.id === model.id) + 1) % cases.length].id));
    $('#scenario-result')?.addEventListener('change', event => setResult(event.target.value));
    for (const name of ['theme', 'material', 'background', 'radius', 'click']) {
      const control = $(`#${name}-mode`);
      control?.addEventListener('change', event => setAppearance(name, event.target.value));
      if (control) setAppearance(name, control.value);
    }
    const query = new URLSearchParams(window.nativeQuery || location.search);
    for (const name of ['theme', 'material', 'background', 'radius', 'click']) {
      if (query.has(name)) setAppearance(name, query.get(name));
    }
    const initial = query.get('case') || query.get('screen');
    navigate(cases.some(item => item.id === initial) ? initial : '12', { silent: true });
    announce('독립 UI 데모입니다. 실제 앱·서비스·파일을 변경하지 않습니다.');
  }
  window.AirDemo = { navigate, render, setResult, setAppearance, reset, getState: () => ({ ...clone(viewModel()), submissionCount, dismissalCount }) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
