# Codex·Claude 통합 카드 목록

2026-09-23 소스 구현. 설치 앱 적용과 실제 사용자 세션 검증은 별도 단계다.

## 사용자 동작

- 작업 화면에서 도구·세션을 먼저 선택하지 않는다. Codex와 모든 연결된 Claude 세션의
  대기 카드를 하나의 목록으로 탐색한다.
- 최초 표시는 가장 먼저 받은 카드다. `⌥←/→` 또는 화면 화살표로 다른 카드를 선택할 수
  있으며, 마지막에서 처음으로 순환한다. 새 카드가 도착해도 사용자가 보고 있는 카드는
  유지한다. 그 카드가 사라지면 남은 목록의 첫 카드로 이동한다.
- 카드 출처는 상단 대표 심볼로 구별한다. Codex는 terminal, Claude는 asterisk SF Symbol을
  사용하며 접근성 이름은 도구 이름이다. 공식 브랜드 로고를 새로 포함하지 않는다.
- Codex·Claude의 정상 제안 카드 모두 `선택 건너뛰기`로 닫을 수 있다. `나중에`는 창만
  숨기며, 건너뛰기는 현재 카드를 공통 Engine의 `user_dismissed`로 종료한다.
  프롬프트·Channel 선택 이벤트·실행 권한·선택 ID는 만들지 않는다. 네이티브 도구 권한
  승인에는 이 기능을 적용하지 않는다. 미리보기와 승인의 기존 도구별 범위는 유지한다.
- 설정의 일반 탭은 공통 서비스, Codex, Claude의 상태를 각각 보여준다. 연결 탭에서
  `Codex 연결 · 설치 설정`과 `Claude 연결 · 터미널 설정`을 같은 깊이로 제공한다.
  개별 Claude 연결 확인·해제나 새 연결 ACK 확인은 현재 보고 있는 카드를 바꾸지 않는다.

## 순서와 정확한 전달

공통 서비스가 소유하는 `PetEventArrivalLedger`는 Codex 카드·승인과 Claude 카드 수신에
하나의 증가 순번을 배정한다. UI가 세션을 조회한 순서나 도구가 제공한 시각을 정렬 기준으로
사용하지 않는다. 중복 등록은 기존 순번을 유지하며 사라진 카드·세션 정보는 정리한다.

이 순번은 메모리의 표시 정보다. DB schema, 영속 권한 기록, 기존 `Contracts/v1` 또는
provider별 snapshot·selection leaf 계약은 변경하지 않는다. 서비스 재시작 이전의 혼합
수신 순서를 복원하는 영속 기록은 아니다. 조회 당시 아직 순번을 확인하지 못한 카드는
확인된 카드 뒤에 결정적인 식별자 순으로 두고 `arrivalOrderComplete=false`로 구분한다.
조회 시 임의로 수신 순번을 만들어 내지 않는다.

`pet_inbox_v1`은 인증된 앱 전용 순번 조회이며 원래 provider target과 서비스·세션 수명을
검증한다. UI 목록은 표시 전용이다. 실제 선택에는 기존 provider, scope, 서비스·세션
incarnation, authority epoch, UI generation, packet/revision/binding 검증이 계속 필요하다.
표시 identity에서 readiness generation만 제외해 일시적인 상태 갱신으로 카드 순서가
바뀌지 않게 하며, 전송 context에서는 generation을 그대로 검증한다. 늦게 도착한 응답이나
이미 눌린 단축키는 다른 카드·다른 세션에 선택을 전달할 수 없다.

## 선택 건너뛰기

2026-09-24 소스에서 Claude selector의 `dismiss_interaction`을 추가했다. 제품
`blabee.pet-provider.v1` 요청에는 전체 `binding`, `interaction_id`, `packet_id`,
`revision`을 담고 응답의 `dismissal`에 정확히 같은 값을 돌려준다. 별도 세션 host의
selector 경로도 같은 공통 Engine 종료 처리를 사용한다. Hook·bridge 역할에는 이
종료 권한을 부여하지 않는다.

현재 세션의 readiness·Stop·foreground와 카드 만료를 확인하고, 실제 저장 시에는
Engine의 인증된 journal·freshness·revision 검증을 유지한다. 선택과 건너뛰기는 같은
진행 중 요청 슬롯을 사용한다. 서비스·세션·UI generation이 바뀌거나 새 카드가 표시되면
이전 응답으로 현재 화면을 갱신하지 않는다. 응답 유실 시 snapshot으로만 재확인하며
자동 재전송하거나 선택 실행으로 전환하지 않는다.

Claude의 종료 검증 중 카드 만료나 시계 역행이 관측되면 종료 요청 자체는 기록 없이
거절하고, 별도 snapshot·scheduler 처리에서 만료를 확정한다. 실패한 종료 요청에 만료
기록까지 섞여 연결 권한이 회수되는 것을 피한다. 시계 역행은 시각이 회복되더라도 정리
완료까지 기억하므로 같은 카드가 다시 유효해지지 않는다. 기존 Codex의 due 처리와
정확히 같은 종료 요청의 영속 재시도 검증은 유지한다.
실제 제품 시계의 역행으로 세션 권한 자체를 회수하는 기존 보안 조건은 유지한다.

## 느린 연결과 설정 상태

- 일시적으로 읽지 못한 Claude 카드는 같은 표시 ID로 유지하되 선택을 비활성화한다.
  성공한 새 snapshot의 빈 목록이나 명시적인 연결 해제가 제거 근거다.
- 조회는 1초 내에 새 Claude 읽기를 시작하도록 제한하고 배경 세션을 순환한다. 읽기 socket
  연결은 최대 250ms, 응답은 최대 500ms다. 실제 선택·승인 deadline은 줄이지 않는다.
- 서비스 목록과 순번 조회는 registry 캐시만 읽는다. 바쁜 Claude 세션의 snapshot은 잠금을
  기다리지 않고 실패를 반환한다. 긴 조회에서는 Codex consumer heartbeat를 추가 읽기로
  갱신한다. 순번 조회는 갱신당 최대 128개이며 큰 목록은 순환 조회한다.
- Claude 상태는 해당 세션의 현재 응답으로 판단한다. 마지막 새 연결 시도의 성공이나
  directory 등록만으로 모든 Claude 연결을 정상 표시하지 않는다.
- 디렉터리 조회까지 실패해 캐시만 반환했을 때는 공통 서비스도 연결됨으로 확정하지 않는다.
  첫 실행 설정에서는 일반 카드 조회·focus·consumer heartbeat를 시작하지 않는다.
- Codex 설정은 같은 갱신에서 확인한 Codex projection의 프로젝트·카드 수신 근거를 별도로
  사용한다. Claude 카드를 보더라도 Codex 적용 프로젝트, Hook 검사 대상, 수신 기록이
  바뀌지 않는다. Codex 조회 실패는 정상적으로 비어 있는 프로젝트 목록과 구분한다.

## 책임과 검증

- `app/coordination/PetEventArrivalLedger.swift`: 서비스 수신 순번. 기존 CoordinatorSwift
  target 소속이며 선택 권한·영속 저장 책임은 추가하지 않는다.
- `app/service/PetProviderInbox.swift`, `PetProviderTransport.swift`, `PetProviderService.swift`:
  공통 목록·인증된 메타데이터·scope별 조회 조립.
- `bridges/claude/swift/session/ClaudeSessionRegistry.swift`: Claude의 기존 세션 수명과
  snapshot 투영 시 수신 순번 연결.
- `app/coordination/PetViewModel.swift`, `app/ui/PetView.swift`, `app/ui/settings/`:
  전체 목록 탐색, 정확한 source 선택, 상태·설정 표시.

잠금을 포함하는 `npm run test:swift`로 Swift 회귀를 직렬 실행한다. 테스트는 혼합 도착 순서,
동일 카드 ID의 다른 세션, 늦은 응답, 배경 카드 삭제·추가, 단축키 누름·해제, 일시 실패 카드
보존, 제한 시간·순환 조회, provider별 설정 근거와 렌더를 확인한다.

Swift 컴파일·자동 회귀·렌더 통과는 설치·공증 또는 실제 Codex/Claude 대화 실행 완료의
증거가 아니다. 설치 후 두 도구에서 동시에 카드를 받고 `⌥←/→`로 이동한 뒤, 각 선택이
원래 대화에만 전달되는지 별도로 확인한다. 실제 운영 부하에서의 heartbeat 간격도 이
수동 검증과 구분해 관찰해야 한다.
