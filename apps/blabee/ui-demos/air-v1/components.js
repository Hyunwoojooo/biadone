/* Pure HTML rendering for the isolated Air demo. All dynamic text is escaped. */
window.BlabeeUI = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const paths = {
    arrow: 'M5 12h14M13 6l6 6-6 6', close: 'M6 6l12 12M18 6 6 18',
    back: 'm15 5-7 7 7 7', down: 'm6 9 6 6 6-6', up: 'm6 15 6-6 6 6',
    plus: 'M12 5v14M5 12h14', refresh: 'M20 8a8 8 0 1 0 0 8M20 3v5h-5',
    shield: 'M12 3 4 6v6c0 4 4 7 8 9 4-2 8-5 8-9V6zM9 12l2 2 4-4',
    clock: 'M12 7v5l3 2', skip: 'm5 5 10 7-10 7zM19 5v14',
    undo: 'M8 5 3 10l5 5M3 10h10a6 6 0 0 1 0 12', external: 'M14 3h7v7M21 3 10 14M11 4H4v16h16v-7'
  };
  function i(name, cls = 'icon') {
    return `<svg class="${esc(cls)}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] ? `${name === 'clock' ? '<circle cx="12" cy="12" r="9"/>' : ''}<path d="${paths[name]}"/>` : `<use href="#${esc(name)}"/>`}</svg>`;
  }
  const btn = (label, action, cls = '', disabled = false) => `<button class="ui-button ${esc(cls)}" data-action="${esc(action)}"${disabled ? ' disabled' : ''}>${label}</button>`;
  const status = (label, tone = 'muted') => `<span class="status ${esc(tone)}"><span class="status-dot" aria-hidden="true"></span>${esc(label)}</span>`;
  const titles = { general: '일반', shortcuts: '단축키', projects: '프로젝트', services: '연결' };
  const previewLabels = { ctrl: '⌃ + 1–4', 'ctrl-option': '⌃⌥ + 1–4', 'option-cmd': '⌥⌘ + 1–4', 'ctrl-cmd': '⌃⌘ + 1–4', off: '사용 안 함' };
  const keyLabels = { option: '⌥', 'ctrl-option': '⌃⌥', 'option-cmd': '⌥⌘' };
  const digits = {
    0: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010']
  };
  function dotted(value) {
    let dots = '';
    String(value).split('').forEach((digit, index) => (digits[digit] || digits[0]).forEach((row, y) => [...row].forEach((v, x) => { if (v === '1') dots += `<circle cx="${index * 36 + x * 6 + 3}" cy="${y * 6 + 3}" r="1.65"/>`; })));
    return `<svg class="dot-matrix" viewBox="0 0 ${String(value).length * 36 - 6} 42" aria-hidden="true">${dots}</svg>`;
  }
  function dottedBee() {
    const rows = ['0000100010000', '0000010100000', '0000001000000', '0111001001110', '1000111110001', '1001111111001', '0110111110110', '0001011101000', '0000111110000', '0000100010000', '0000011100000', '0000001000000'];
    return `<svg class="dot-matrix dot-bee" viewBox="0 0 78 72" aria-hidden="true">${rows.map((row, y) => [...row].map((v, x) => v === '1' ? `<circle cx="${x * 6 + 3}" cy="${y * 6 + 3}" r="1.65"/>` : '').join('')).join('')}</svg>`;
  }
  function clockTicks() {
    // Match the reference dial: 12 long hour marks and 48 short minute marks.
    return `<svg class="meter-ticks" viewBox="0 0 130 130" aria-hidden="true">${Array.from({ length: 60 }, (_, index) => `<line x1="65" y1="${index % 5 === 0 ? 7 : 10}" x2="65" y2="${index % 5 === 0 ? 14 : 13}" transform="rotate(${index * 6} 65 65)"${index === 8 ? ' class="accent-tick"' : ''}/>`).join('')}</svg>`;
  }
  function chrome(label, tone = 'muted') {
    return `<header class="panel-chrome"><span class="panel-brand">${i('bee', 'bee')}<span>blabee</span></span>${status(label, tone)}<div class="chrome-actions"><button class="icon-button" data-action="settings" aria-label="설정 열기">${i('sliders')}</button><button class="icon-button" data-action="close" aria-label="패널 닫기">${i('close')}</button></div></header>`;
  }
  const bottom = (label = '선택은 원래 작업의 대화로 이어집니다.') => `<div class="panel-bottom">${i('return')}<span>${esc(label)}</span></div>`;
  const metadata = rows => `<dl class="metadata">${rows.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
  const row = (title, control, help = '') => `<div class="setting-row"><div class="row-copy"><strong>${esc(title)}</strong>${help ? `<small>${esc(help)}</small>` : ''}</div>${control}</div>`;
  function queue(m) {
    if (!m.queue) return '';
    return `<nav class="queue-bar" aria-label="대기 작업 이동">${i('list')}<span><strong>${esc(m.event.project)}</strong> · ${m.queueIndex + 1} / ${m.events.length}</span><span class="queue-shortcut">⌥ ← →</span><button class="icon-button" data-action="queue-prev" aria-label="이전 대기 작업"${m.queueIndex === 0 ? ' disabled' : ''}>${i('back')}</button><button class="icon-button" data-action="queue-next" aria-label="다음 대기 작업"${m.queueIndex === m.events.length - 1 ? ' disabled' : ''}>${i('chevron')}</button></nav>`;
  }
  function choices(m) {
    return `<div class="choice-list${m.choices.length === 1 ? ' single' : ''}" aria-label="다음 작업 선택">${m.choices.map((choice, index) => `<button class="choice${m.stagedChoice === index ? ' chosen' : ''}" data-choice="${index}" aria-pressed="${m.stagedChoice === index}"${m.expired ? ' disabled' : ''}><span class="choice-icon">${i(choice.icon)}</span><span class="choice-copy"><strong>${esc(choice.title)}</strong>${choice.recommended ? '<small class="recommended">권장</small>' : ''}</span><kbd>${m.expired ? '만료' : `${keyLabels[m.savedShortcuts.selection]}${index + 1}`}</kbd>${m.stagedChoice === index ? `<span class="choice-check">${i('check')}</span>` : ''}</button>`).join('')}</div>`;
  }
  function details(m) {
    return `<section class="task-details"><h3>작업 맥락</h3><p>${esc(m.event.summary)}</p>${metadata([['프로젝트', m.event.project], ['작업 폴더', m.event.folder], ['위험', '낮음 · 보고된 위험 사유 없음'], ['복구 지점', '사용 불가'], ['부수 효과', '이 데모에서 실제 실행 없음']])}<details class="diagnostic"><summary>대상 식별자</summary><code>${esc(m.event.id)}<br>${esc(m.event.session)}</code></details></section>`;
  }
  function decision(m) {
    const label = m.expired ? '만료됨' : m.reminder ? '결정 알림' : '선택 대기';
    const selected = m.choices[m.stagedChoice];
    return chrome(label, m.expired ? 'error' : m.reminder ? 'amber' : 'muted') + queue(m) + `<div class="panel-content"><div class="task-heading"><div><p class="eyeline">Codex · ${esc(m.event.project)}</p><h2>${esc(m.long ? '긴 작업도 충분히 읽고 결정할 수 있도록' : m.event.title)}</h2></div><button class="text-button" data-action="details" aria-expanded="${m.details}">${m.details ? '접기' : '상세'}${i(m.details ? 'up' : 'down')}</button></div><p class="task-summary">${esc(m.long ? '여러 프로젝트에 걸친 작업의 결과와 다음 선택을 한눈에 확인하고, 필요한 맥락은 같은 폭 안에서 더 자세히 읽어 보세요.' : m.event.summary)}</p>${m.reminder ? `<div class="inline-notice amber">${i('clock')}아직 결정하지 않은 작업이 있어요.</div>` : ''}${m.expired ? `<div class="inline-notice error">${i('clock')}유효 시간이 지나 선택할 수 없어요.</div>` : ''}<div class="air-meter" role="img" aria-label="${m.expired ? '만료된 선택지' : `${m.choices.length}개의 다음 선택`}"><span class="meter-count">${dotted(String(m.expired ? 0 : m.choices.length).padStart(2, '0'))}</span><div><span class="meter-label">${m.expired ? '선택 만료' : '개의 다음 선택'}</span><span class="meter-caption">${m.expired ? '새 요청을 기다려 주세요' : '지금 필요한 작업부터'}</span></div><span class="meter-line" aria-hidden="true"></span></div>${choices(m)}${m.details ? details(m) : ''}${m.disabled ? '<p class="disabled-reason">이전 프롬프트로 돌아가는 기능은 현재 사용할 수 없어요.</p>' : ''}</div><div class="panel-actions"><div class="send-action"><button class="send-button" data-action="send-choice"${!selected || m.expired || m.clickMode === 'direct' ? ' disabled' : ''}>${i('return')}<span>${m.expired ? '만료된 선택지' : m.clickMode === 'direct' ? '카드를 누르면 바로 전달' : selected ? '선택 전달하기' : '항목을 선택해 주세요'}</span>${i('arrow')}</button><p class="selection-hint">${selected ? '선택한 항목을 원래 작업에 전달해요.' : `${keyLabels[m.savedShortcuts.selection]} 숫자키로 바로 전달 · ${previewLabels[m.savedShortcuts.preview]} 상세`}</p></div></div><div class="secondary-actions">${btn(i('clock') + '나중에', 'defer')}${btn(i('skip') + '선택 건너뛰기', 'skip')}${btn(i('undo') + '이전 프롬프트', 'previous', '', true)}</div>` + bottom();
  }
  function hold(m) {
    const choice = m.choices[m.previewChoice || 0];
    return chrome('상세 미리보기') + `<div class="panel-content preview-detail"><div class="hold-heading"><p class="eyeline">${esc(m.event.project)} · ${(m.previewChoice || 0) + 1}번 선택</p><kbd>${previewLabels[m.savedShortcuts.preview]}</kbd></div><div class="preview-symbol">${i(choice.icon)}</div><h2>${esc(choice.title)}</h2><p class="preview-description">${esc(choice.detail)}</p><h3>확인할 내용</h3><ul class="preview-checklist"><li>현재 작업의 맥락과 선택 목적</li><li>변경할 범위와 완료 기준</li><li>다른 작업에 영향을 주는지 여부</li></ul>${metadata([['작업', m.event.project], ['전달 대상', m.event.session], ['위험', '낮음 · 화면 검토']])}</div><div class="panel-actions">${btn('상세 닫기', 'preview-close')}</div>` + bottom('누른 조합을 놓으면 닫힙니다. 상세 보기는 선택을 전달하지 않아요.');
  }
  function message(m) {
    if (m.type === 'ready' && m.id === '08') {
      return chrome('준비됨') + `<div class="panel-content"><div class="empty-state muted"><div class="state-orbit muted clock-orbit">${clockTicks()}${dottedBee()}</div><h2>Waiting</h2></div></div>`;
    }
    const copies = {
      ready: ['준비됨', 'bee', '필요한 순간에, 여기에서', 'Codex가 선택지를 보내면\n바로 확인할 수 있어요.', 'muted'],
      working: ['작업 중', 'more', 'Codex가 작업하고 있어요', '다음 선택지가 도착하면\n이곳에서 이어서 확인해 주세요.', 'muted'],
      invalid: ['표시 중지', 'alert', m.id === '22' ? '위험 정보를 읽을 수 없어요' : '응답을 읽을 수 없어요', '잘못된 선택을 막기 위해 표시를 멈췄어요.\n새로운 상태를 확인해 주세요.', 'error'],
      'connection-error': ['연결 끊김', 'link', '서비스 연결을 확인해 주세요', '연결이 끊겨 선택지를 받을 수 없어요.\n연결 설정에서 상태를 확인할 수 있어요.', 'error'],
      sending: ['전달 중', 'return', '선택을 전달하고 있어요', m.selected || '유리의 빛과 여백 다듬기', 'muted'],
      received: ['접수됨', 'check', '전달 요청을 접수했어요', '원래 대화의 수신과 작업 실행 여부는\n아직 확인되지 않았어요.', 'positive'],
      uncertain: ['결과 불명확', 'clock', '전달 여부를 확인할 수 없어요', '중복 전달을 막기 위해 다시 보내지 않아요.\n원래 Codex 대화에서 상태를 확인해 주세요.', 'amber'],
      'permission-result': ['응답 접수', 'shield', m.permissionResult === 'reject' ? '거절 응답을 접수했어요' : m.permissionResult === 'codex' ? 'Codex에서 이어서 결정하세요' : '이번 요청의 승인 응답을 접수했어요', '응답 접수와 명령 실행 결과는 별개예요.\n실행 결과는 Codex에서 확인해 주세요.', 'positive'],
      deferred: ['숨김', 'clock', '패널을 잠시 숨겼어요', '작업을 전달하지 않았어요.\n데모에서 패널을 다시 열 수 있어요.', 'muted']
    };
    const [label, symbol, title, description, tone] = copies[m.type] || copies.ready;
    let content = chrome(label, tone) + `<div class="panel-content"><div class="empty-state ${tone}"><div class="state-orbit ${tone}${symbol === 'bee' ? ' clock-orbit' : ''}">${symbol === 'bee' ? clockTicks() + dottedBee() : i(symbol, 'state-symbol')}</div><p class="eyeline">${esc(m.event.project)}</p><h2>${esc(title)}</h2><p>${esc(description).replace(/\n/g, '<br>')}</p>${m.type === 'sending' ? `<span class="status muted">응답을 기다리는 중</span>` : ''}</div>${m.diagnostic ? `<details class="diagnostic error-diagnostic"${m.id === '20' ? ' open' : ''}><summary>진단 정보</summary><code>${esc(m.diagnostic)}</code></details>` : ''}</div>`;
    if (['invalid', 'connection-error'].includes(m.type)) content += `<div class="panel-actions">${btn('연결 설정', 'connection', 'primary')}</div>`;
    if (m.type === 'deferred') content += `<div class="panel-actions">${btn('데모 패널 다시 열기', 'reopen', 'primary')}</div>`;
    return content + bottom(m.type === 'received' ? '접수는 대화 수신이나 작업 완료를 뜻하지 않습니다.' : m.type === 'sending' ? '선택이 전달되는 동안 중복 요청을 막습니다.' : m.type === 'uncertain' ? '자동으로 다시 전달하지 않습니다.' : '지금 필요한 정보만, 차분하게.');
  }
  function permission(m) {
    return chrome('승인 요청', 'amber') + `<div class="panel-content permission-content"><p class="eyeline">Codex · ${esc(m.event.project)}</p><div class="permission-title">${i('shield')}<h2>이 명령의 실행을 허용할까요?</h2></div><p class="task-summary">화면 변경과 관련된 검사를 실행하려고 해요.</p>${metadata([['요청 출처', '관리형 Codex App Server'], ['작업 폴더', m.event.folder], ['환경', 'local'], ['요청 대상', m.event.session]])}<p class="field-label">실행할 명령</p><pre class="command"><code>npm run test:swift -- --filter 'PetPanelSizePolicy|PetChoicePreview'</code></pre><div class="inline-notice amber">${i('shield')}승인은 표시된 요청에만 적용돼요.</div></div><div class="panel-actions permission-actions">${[['approve', '이번만 승인', 'check'], ['reject', '거절', 'close'], ['codex', 'Codex에서 직접 선택', 'external']].map(([value, label, icon], index) => `<button class="permission-choice ui-button${value === 'approve' ? ' primary' : ''}" data-permission="${value}">${i(icon)}<span>${label}</span><kbd>⌘${index + 1}</kbd></button>`).join('')}</div>` + bottom('원래 요청의 명령과 대상을 확인한 후 응답하세요.');
  }
  function rollback(m) {
    return chrome('복구 정보', 'positive') + `<div class="panel-content"><p class="eyeline">Codex · ${esc(m.event.project)}</p><h2>이 작업에는 이전 기록이 있어요</h2><p class="task-summary">복구 가능 상태를 표시하는 예시예요. 이전 프롬프트 기능은 현재 사용할 수 없어요.</p>${metadata([['기록 지점', '화면 구성 변경 전'], ['대상', '현재 작업의 기록'], ['복구 실행', '현재 제공하지 않음']])}<div class="inline-notice">${i('undo')}기록이 있다는 사실과 복구 실행은 구분돼요.</div></div><div class="panel-actions">${btn(i('undo') + '이전 프롬프트', 'previous', '', true)}</div>` + bottom('복구 요청을 생성하거나 작업을 되돌리지 않습니다.');
  }
  function risk(m) {
    return chrome('범위 확인', 'amber') + `<div class="panel-content"><p class="eyeline">Codex · ${esc(m.event.project)}</p><h2>진행하기 전에 범위를 확인해 주세요</h2><p class="task-summary">이 선택은 기존 파일을 제거할 수 있어요.</p><div class="risk-summary"><strong>${i('alert')}생성 산출물 정리</strong><p>아래 폴더의 파일이 삭제될 수 있으며 되돌릴 수 없을 수 있어요.</p><code>/demo/BiaDone/apps/blabee/output/</code></div>${metadata([['위험 근거', '대상 폴더 파일 삭제'], ['복구 지점', '없음']])}</div><div class="panel-actions stack-actions">${btn('범위를 확인하고 전달…', 'risk-confirm', 'danger')}${btn('선택하지 않고 닫기', 'close')}</div>` + bottom('작업 선택과 명령 실행 승인은 별개입니다.');
  }
  function updateFooter(m) {
    const copy = {
      current: '',
      available: '빌드 43 업데이트 가능',
      downloading: '업데이트 다운로드 중',
      review: '설치 준비 완료 · 빌드 43',
      failure: '파일 검증 실패 · 설치 중단',
      restored: '세션 1개 복원 · 1개 확인 필요'
    };
    const state = m.updateState in copy ? m.updateState : 'current';
    const checkButton = btn(`<span aria-live="polite" aria-atomic="true">${esc(m.updateCheckResult || '업데이트 확인')}</span>`, 'update-check', 'update-check');
    return `<footer class="settings-footer update-footer" aria-label="앱 업데이트"><div class="update-summary"><span>0.1.0 · 빌드 ${state === 'restored' ? '43' : '42'} 예시</span>${copy[state] ? `<span class="update-status${state === 'failure' ? ' update-error' : ''}">${esc(copy[state])}</span>` : ''}${state === 'downloading' ? '<div class="update-progress"><progress max="100" value="62" aria-label="예시 다운로드 진행률">62%</progress><span>62%</span></div>' : ''}</div>${state === 'available' ? btn('업데이트', 'update-start', 'primary') : state === 'review' ? btn('설치 내용 확인', 'update-review', 'primary') : state === 'downloading' ? btn('취소', 'update-cancel') : ''}${['current', 'available', 'failure', 'restored'].includes(state) ? checkButton : ''}${state === 'restored' ? '<details class="restore-details"><summary>복원 결과</summary><ul class="restore-list"><li>Blabee · 원래 터미널에서 복원됨</li><li>Blabase · 세션 ID로 직접 이어가기 필요</li></ul></details>' : ''}</footer>`;
  }
  function settings(m) {
    let html = chrome('설정') + `<div class="settings-chrome"><h2>Blabee 설정</h2><nav class="settings-tabs" role="tablist" aria-label="설정 분류">${Object.entries(titles).map(([key, title]) => `<button id="tab-${key}" role="tab" aria-selected="${m.pane === key}" aria-controls="settings-pane" tabindex="${m.pane === key ? 0 : -1}" data-pane="${key}">${i({ general: 'sliders', shortcuts: 'keyboard', projects: 'folder', services: 'link' }[key])}<span>${title}</span></button>`).join('')}</nav></div><div id="settings-pane" role="tabpanel" aria-labelledby="tab-${m.pane}" class="settings-body">`;
    if (m.pane === 'general') {
      html += `<p class="pane-lead">연결 상태와 실제 동작을 나누어 확인해요.</p><div class="setting-group">${row('Blabee 서비스', status(m.appService ? '연결됨' : '꺼짐', m.appService ? 'positive' : 'muted'))}${row('Codex Plugin', status('설치됨', 'positive'))}${row('관찰 프로젝트', status(`${m.projects.length}개`))}${row('원래 대화로 선택 전달', status('확인 필요', 'amber'))}</div>`;
    } else if (m.pane === 'shortcuts') {
      html += `<p class="pane-lead">상세 보기와 선택 실행을 구분해요.</p><p class="field-label">상세 미리보기</p><div class="setting-group preview-setting">${row('누르는 동안 상세', `<div class="select-wrap"><button class="key-selector" data-action="preview-menu" aria-expanded="${m.menu}" aria-controls="preview-options">${previewLabels[m.shortcutDraft.preview]}${i('down')}</button><div id="preview-options" class="shortcut-menu"${m.menu ? '' : ' hidden'}>${Object.entries(previewLabels).map(([key, label]) => `<button data-preview="${key}" aria-pressed="${m.shortcutDraft.preview === key}">${m.shortcutDraft.preview === key ? i('check') : '<span class="icon"></span>'}${label}</button>`).join('')}</div></div>`)}</div><p class="setting-help">조합의 보조 키를 놓으면 상세가 닫혀요. 이 데모 창 안에서만 동작합니다.</p><p class="field-label">선택 단축키</p><div class="setting-group">${row('선택 1–4', `<select class="key-select" data-setting="selection" aria-label="선택 단축키 조합">${Object.entries(keyLabels).map(([key, label]) => `<option value="${key}"${m.shortcutDraft.selection === key ? ' selected' : ''}>${label} + 1–4</option>`).join('')}</select>`, '선택 단축키는 전달 버튼을 거치지 않아요.')}${row('작업 이동', '<kbd>⌥ ← / →</kbd>')}${row('승인 응답', '<kbd>⌘ 1–3</kbd>')}</div><p class="setting-help warning">다른 앱의 전역 단축키를 등록하거나 검사하지 않아요. Control + Option은 VoiceOver와 겹칠 수 있어요.</p>${m.shortcutError ? `<div class="inline-notice error">${i('alert')}${esc(m.shortcutError)}</div>` : ''}`;
    } else if (m.pane === 'projects') {
      html += `<p class="pane-lead">작업을 확인할 프로젝트를 모아 두세요.</p><div class="list-heading"><span>프로젝트 <strong>${m.projects.length}</strong></span>${btn(i('plus') + '추가', 'project-add')}</div><div class="setting-group project-list">${m.projects.map((name, index) => `<div class="setting-row">${i('folder')}<div class="row-copy"><strong>${esc(name)}</strong><small>/demo/BiaDone/${esc(name.toLowerCase())}</small></div><button class="row-remove" data-project-remove="${index}" aria-label="${esc(name)} 제거">제거</button></div>`).join('') || '<p class="setting-text">등록한 프로젝트가 없어요.</p>'}</div><p class="setting-help">추가·제거는 이 데모의 목록만 바꿉니다.</p>`;
    } else {
      html += `<p class="pane-lead">설치 상태와 실제 수신 여부를 따로 확인해요.</p><div class="setting-group">${row('Codex Plugin', status('설치됨', 'positive'))}${row('Hook 활성', status('설정됨', 'positive'))}${row('카드 수신 확인', status('확인 필요', 'amber'))}</div><p class="field-label">후속 제안</p><div class="setting-group">${row('제안 범위', `<select class="key-select" data-setting="suggestion" aria-label="후속 제안 범위">${['스마트', '항상', '작업만'].map(value => `<option${m.suggestion === value ? ' selected' : ''}>${value}</option>`).join('')}</select>`)}</div><p class="setting-help">후속 선택의 범위이며 명령 승인 권한을 바꾸지 않아요.</p><p class="field-label">서비스</p><div class="setting-group">${row('앱 실행형 서비스', `<button class="switch" role="switch" aria-checked="${m.appService}" data-action="service-toggle" aria-label="데모 앱 실행형 서비스"><span></span></button>`)}${row('macOS 자동 시작', `<button class="switch" role="switch" aria-checked="${m.autostart}" data-action="autostart-toggle" aria-label="데모 자동 시작"><span></span></button>`)}</div><p class="field-label">Codex 관리 세션</p><div class="setting-group"><label class="setting-text" for="resume-session">이어갈 세션 ID<input id="resume-session" type="text" value="${esc(m.resumeSession)}" placeholder="세션 ID 입력" autocomplete="off"></label><div class="setting-inline-action">${btn('데모 목록에 추가', 'session-add')}</div>${m.sessions.map(session => `<div class="setting-text"><code>${esc(session)}</code></div>`).join('')}</div><p class="setting-help">원래 터미널 우선 · 지원하지 않으면 Terminal 새 창. 이 데모에서는 터미널을 실행하지 않아요.</p>`;
    }
    html += '</div>';
    const dirty = m.shortcutDraft.preview !== m.savedShortcuts.preview || m.shortcutDraft.selection !== m.savedShortcuts.selection;
    return html + (m.pane === 'shortcuts' ? `<footer class="settings-footer">${btn('기본값', 'shortcut-default')}<span>${dirty ? '저장 전' : '변경 없음'}</span>${btn('취소', 'shortcut-cancel')}${btn('저장', 'shortcut-save', 'primary', !dirty)}</footer>` : updateFooter(m));
  }
  function dialog(m) {
    if (!m.dialog) return '';
    return `<div class="dialog-scrim"><section class="confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-description" tabindex="-1"><h3 id="dialog-title">${esc(m.dialog.title)}</h3><p id="dialog-description">${esc(m.dialog.body)}</p>${m.dialog.input ? `<label for="dialog-input">프로젝트 이름</label><input id="dialog-input" type="text" maxlength="80" placeholder="새 프로젝트" autocomplete="off">` : ''}<div class="message-actions">${btn('취소', 'dialog-cancel')}${btn(esc(m.dialog.confirm), 'dialog-confirm', m.dialog.danger ? 'danger' : 'primary')}</div></section></div>`;
  }
  function render(m) {
    if (m.closed) return `<article class="glass-panel closed-panel" data-state="hidden" aria-label="Blabee 데모 패널 숨김"><div class="panel-content"><div class="empty-state">${dottedBee()}<h2>패널을 숨겼어요</h2><p>패널 표시만 숨겼어요.<br>기존 작업 상태는 그대로예요.</p></div></div><div class="panel-actions">${btn('데모 패널 다시 열기', 'reopen', 'primary')}</div></article>`;
    const contents = { decision, settings, permission, rollback, risk, 'hold-preview': hold };
    return `<article class="glass-panel${m.type === 'settings' ? ' settings-window' : ''}${m.type === 'permission' ? ' permission-panel' : ''}" data-state="${esc(m.type)}" aria-label="Blabee ${m.type === 'settings' ? '설정' : '데모 패널'}">${(contents[m.type] || message)(m)}${dialog(m)}</article>`;
  }
  return { esc, i, render, previewLabels, keyLabels };
})();
