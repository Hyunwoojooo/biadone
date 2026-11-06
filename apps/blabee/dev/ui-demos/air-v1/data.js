/* Display-only fixtures. No live identities, file access or service connection. */
window.BLABEE_CASES = [
  { id: '01', group: '기본 상태', title: '준비됨', type: 'ready', note: '새 선택지가 없는 상태. 주변 배경과 재질을 비교해 보세요.' },
  { id: '02', group: '설정', title: '일반 · 연결과 업데이트', type: 'settings', pane: 'general', update: 'current', note: '업데이트 확인을 누르면 최신 버전 예시가 3초간 표시됩니다. 실제 업데이트 조회는 하지 않습니다.' },
  { id: '03', group: '설정', title: '단축키 설정', type: 'settings', pane: 'shortcuts', note: '초안은 탭을 이동해도 유지됩니다. 저장은 이 데모 안에서만 적용됩니다.' },
  { id: '04', group: '설정', title: '미리보기 조합 메뉴', type: 'settings', pane: 'shortcuts', menu: true, note: '조합을 바꿔 상세 미리보기의 표시 방식을 비교하세요.' },
  { id: '05', group: '설정', title: '단축키 · 저장과 취소', type: 'settings', pane: 'shortcuts', note: '초안·취소·저장을 구분하고 하단 버튼을 고정합니다.' },
  { id: '06', group: '설정', title: '관찰 프로젝트', type: 'settings', pane: 'projects', note: '목록 추가와 제거는 메모리 안의 데모 데이터만 변경합니다.' },
  { id: '07', group: '설정', title: '연결 · 관리 세션', type: 'settings', pane: 'services', note: '플러그인 설치·Hook 활성·카드 수신을 구분합니다.' },
  { id: '08', group: '기본 상태', title: '준비됨 · 간결한 안내', type: 'ready', note: '연결과 실제 작업 수신을 같은 상태로 취급하지 않습니다.' },
  { id: '09', group: '선택과 상세', title: '선택지 2개', type: 'decision', count: 2, note: '카드 클릭은 선택 표시, 전달 버튼은 데모 전달 상태로 전환합니다.' },
  { id: '10', group: '선택과 상세', title: '작업 전체 상세', type: 'decision', count: 2, details: true, note: '상세에서도 폭은 460px로 유지되고 본문만 스크롤됩니다.' },
  { id: '11', group: '선택과 상세', title: '선택지 3개', type: 'decision', count: 3, note: '세 번째 선택은 왼쪽 아래. 없는 네 번째 행동은 만들지 않습니다.' },
  { id: '12', group: '선택과 상세', title: '선택지 4개', type: 'decision', count: 4, note: '카드를 누른 뒤 전달해 보세요. Control + 숫자를 누르는 동안 상세를 봅니다.' },
  { id: '13', group: '선택과 상세', title: '긴 한글 · 여러 줄 카드', type: 'decision', count: 4, long: true, note: '긴 선택지와 명령문을 자르지 않고 동일 폭에서 읽습니다.' },
  { id: '14', group: '대기와 예외', title: '작업 이동 · 세 프로젝트', type: 'decision', count: 4, queue: true, note: 'Option + ← / →로 Blabee·Blabase·BiaDone을 오갑니다. 선택은 이동 시 지워집니다.' },
  { id: '15', group: '대기와 예외', title: '결정 리마인더', type: 'decision', count: 2, reminder: true, note: '정적인 알림 예시이며 시간 경과로 상태를 바꾸지 않습니다.' },
  { id: '16', group: '대기와 예외', title: '만료된 선택', type: 'decision', count: 2, expired: true, note: '만료된 선택은 클릭과 단축키 모두 전달하지 않습니다.' },
  { id: '17', group: '기본 상태', title: 'Codex 작업 중', type: 'working', note: '선택 전달 중과 작업 중을 구분하며 가짜 진행률은 표시하지 않습니다.' },
  { id: '18', group: '대기와 예외', title: '응답 형식 오류', type: 'invalid', diagnostic: 'invalid Pet snapshot field: snapshot', note: '읽지 못한 응답으로 선택이나 승인 버튼을 만들지 않습니다.' },
  { id: '19', group: '대기와 예외', title: '서비스 연결 끊김', type: 'connection-error', diagnostic: 'operational_transport_closed: operational_transport_closed', note: '자동 재연결 성공을 연출하지 않고 연결 설정으로 안내합니다.' },
  { id: '20', group: '대기와 예외', title: '연결 오류 · 상세 진단', type: 'connection-error', diagnostic: 'operational_transport_closed: operational_transport_closed', note: '원본 파일명과 달리 관찰된 상태는 연결 오류입니다.' },
  { id: '21', group: '대기와 예외', title: '비활성 보조 동작', type: 'decision', count: 1, disabled: true, note: '이전 프롬프트 기능은 제품과 동일하게 비활성으로 둡니다.' },
  { id: '22', group: '대기와 예외', title: '위험 정보 형식 오류', type: 'invalid', diagnostic: 'invalid Pet snapshot field: risk.reasons[0]', note: '위험을 알 수 없는 상태를 정상 승인 화면으로 바꾸지 않습니다.' },
  { id: '24', group: '권한', title: '명령 승인 요청', type: 'permission', note: '세 버튼 모두 로컬 UI 데모입니다. 명령 실행이나 실제 권한 승인은 없습니다.' },
  { id: 'S1', group: '보완 상태', title: '복구 가능 정보', type: 'rollback', note: '복구 상태만 표시합니다. 현재 제품의 비활성 복구 기능을 활성화하지 않습니다.' },
  { id: 'S2', group: '보완 상태', title: '높은 위험 · 범위 확인', type: 'risk', note: '일반 선택의 위험 확인과 실제 명령 승인을 분리합니다.' },
  { id: 'S3', group: '보완 상태', title: '선택 전달 중', type: 'sending', note: '자동 완료하지 않습니다. 스튜디오의 결과 상태에서 후속 상태를 직접 선택하세요.' },
  { id: 'S4', group: '보완 상태', title: '전달 요청 접수', type: 'received', note: '접수는 원래 대화의 수신이나 작업 완료를 증명하지 않습니다.' },
  { id: 'S5', group: '보완 상태', title: '전달 결과 불명확', type: 'uncertain', note: '자동 재전송·수신 확인 타이머·가짜 성공을 만들지 않습니다.' },
  { id: 'S6', group: '보완 상태', title: '승인 응답 접수', type: 'permission-result', note: '승인 응답을 받은 것과 명령이 성공한 것은 다른 상태입니다.' },
  { id: 'S7', group: '보완 상태', title: '나중에 · 패널 숨김', type: 'deferred', note: '나중에는 패널만 숨깁니다. 영속 보관함이나 복구를 만들지 않습니다.' },
  { id: 'H1', group: '추가 상태', title: '누르는 동안 상세', type: 'hold-preview', count: 4, note: '상세는 읽기 전용입니다. Control을 놓거나 창 포커스를 잃으면 닫힙니다.' },
  { id: 'U1', group: '추가 상태', title: '업데이트 발견', type: 'settings', pane: 'general', update: 'available', note: '로컬 예시 빌드 정보이며 GitHub에 접속하지 않습니다.' },
  { id: 'U2', group: '추가 상태', title: '업데이트 다운로드', type: 'settings', pane: 'general', update: 'downloading', note: '62% 정지 fixture입니다. 시간 경과나 네트워크 다운로드는 없습니다.' },
  { id: 'U3', group: '추가 상태', title: '업데이트 실패', type: 'settings', pane: 'general', update: 'failure', note: '설치 전에 검증이 실패한 상태를 보여줍니다. 실제 파일은 없습니다.' },
  { id: 'U4', group: '추가 상태', title: '관리 세션 복원 결과', type: 'settings', pane: 'general', update: 'restored', note: '복원 결과의 화면 예시입니다. 터미널이나 Codex를 종료·실행하지 않습니다.' }
];

window.BLABEE_EVENTS = [
  {
    id: 'demo-blabee-01', project: 'Blabee', title: '다음은 어디를 다듬을까요?',
    summary: '가볍고 선명한 화면을 준비했어요. 이어서 살펴볼 부분을 골라 주세요.',
    folder: '/demo/BiaDone/apps/blabee', session: 'demo-session-blabee',
    choices: [
      { id: 'air', title: '유리의 빛과 여백 다듬기', icon: 'sliders', recommended: true, detail: '밝은 문서와 어두운 터미널 위에서 카드의 경계와 글자를 확인합니다. 하늘빛과 크림빛은 조명처럼 얇게 남기고, 배경에 따라 본문이 흐려지지 않도록 조절합니다.' },
      { id: 'flow', title: '선택부터 전달까지 살펴보기', icon: 'return', detail: '카드를 누를 때는 선택만 표시하고 전달 버튼으로 확정합니다. 즉시 전달 방식과 비교하고, 선택 대상을 바꿨을 때 이전 선택이 남지 않는지 확인합니다.' },
      { id: 'keys', title: '단축키와 상세 미리보기', icon: 'keyboard', detail: '이 데모 창이 활성화된 동안 Control과 숫자를 눌러 읽기 전용 상세를 확인합니다. modifier를 놓으면 이전 화면으로 돌아오며 어떤 선택도 전달하지 않습니다.' },
      { id: 'states', title: '긴 문장과 예외 화면 확인', icon: 'doc', detail: '폭 460px를 유지한 채 긴 한국어 제목과 명령문, 승인·오류·만료 화면을 확인합니다. 본문만 스크롤하고 주요 버튼은 하단에 유지합니다.' }
    ]
  },
  {
    id: 'demo-blabase-02', project: 'Blabase', title: '근거를 어느 범위까지 확인할까요?',
    summary: '검토할 결과가 모였어요. 필요한 범위를 먼저 정해 주세요.',
    folder: '/demo/BiaDone/apps/blabase', session: 'demo-session-blabase',
    choices: [
      { id: 'source', title: '원문과 근거 문장 비교', icon: 'doc', recommended: true, detail: '추출한 결과를 원문의 인접 문맥과 대조합니다. 출처가 없는 문장은 별도로 구분하고 검토할 항목을 정리합니다.' },
      { id: 'evaluation', title: '평가 결과 차이 살펴보기', icon: 'list', detail: '이번 평가 결과의 변화가 큰 항목부터 확인합니다. 수치뿐 아니라 판단을 뒷받침하는 근거를 함께 표시합니다.' },
      { id: 'report', title: '검토 내용을 문서로 정리', icon: 'folder', detail: '확인한 사실, 남은 질문과 다음 작업을 한 문서로 묶습니다. 이 데모에서는 문서를 생성하지 않습니다.' }
    ]
  },
  {
    id: 'demo-biadone-03', project: 'BiaDone', title: '사이트의 다음 작업을 선택해 주세요',
    summary: '페이지 시안을 살펴봤어요. 지금 처리할 작업부터 시작할 수 있어요.',
    folder: '/demo/BiaDone/sites/biadone.com', session: 'demo-session-biadone',
    choices: [
      { id: 'mobile', title: '모바일 화면 먼저 확인', icon: 'sliders', recommended: true, detail: '작은 화면에서 제목과 주요 버튼이 한눈에 읽히는지 살펴봅니다. 가로 스크롤과 눌리지 않는 버튼이 없는지 확인합니다.' },
      { id: 'copy', title: '소개 문구를 간결하게 정리', icon: 'doc', detail: '무엇을 제공하는지 첫 문장에서 이해할 수 있도록 소개 문구를 다듬습니다. 이 예시에서는 실제 사이트 파일을 수정하지 않습니다.' }
    ]
  }
];
window.BLABEE_PROJECTS = ['Blabee', 'Blabase', 'BiaDone'];
