# 1순위 문제 해결 방안 (2026-11-12)

상태(2026-11-12 구현 후): 1, 2, 3, 6, 7, 9번과 4·5번 단계 1·2를 구현했다. 4·5번 단계 3은 [설계 문서](../bridges/claude/product-connection/RECONNECT_DESIGN.md)만 썼다.
커밋·빌드·설치는 하지 않았다. 구현하며 방안과 달라진 점:
- 1번: 메뉴바 아이콘 배지는 넣지 않았다. 아이콘의 주의 표시는 패널 자동 표시와 연결되어 있어, 패널 상태 줄과 우클릭 메뉴 제목으로 알린다.
  잘못된 태그는 건너뛰되, 유효한 새 버전이 없으면 "최신"이라고 단정하지 않는다(기존 테스트의 의도 유지).
- 2번: Hook 호출자를 "등록된 Codex / OpenAI 서명이지만 미등록 / 판단 불가" 셋으로 나눈다. 판단 불가(래퍼 경유 등)는 지금 동작을 유지한다.
  관리형 경로의 "unsafe bundle" 문구는 출시 앱에 그 실행기가 없어 바꾸지 않았다.
- 6번: 계약 스키마를 늘리는 대신 일반 소켓에 `pet_codex_v1` wrapper 하나를 더했다. `Contracts/bridge`는 바뀌지 않았다.
- 7번: 막는 Claude 세션의 "이름"은 기록에 대화·폴더를 저장하지 않으므로 보여줄 수 없어, 남은 연결 수를 보여준다.
  Claude 사용 기록의 수동 해제는 추가하지 않았다(재시동만 해제 수단으로 유지).
- 9번: 게시(GitHub 릴리스, 공개 문서, README, 태그)는 아직 수동 체크리스트다.

이전 상태: 방안만. 코드는 아직 바꾸지 않았다. 근거와 항목 ID는 [BLABEE_AUDIT_20261111.md](BLABEE_AUDIT_20261111.md).
대상: 1순위 가운데 규모가 중간·큼인 묶음 1, 2, 3, 4, 5, 6, 7, 9. 작은 묶음 8, 10은 따로 진행한다.

"세션 연결 규칙"과 `Contracts/`를 건드리는 방안은 그렇게 표시했다. 이 저장소 규칙상 사용자 승인이 필요하다.

## 1. 앱이 스스로 업데이트를 확인하지 않음 (APP-2)

방안
- 앱 시작 30초 뒤 1회, 그 뒤 24시간마다 확인한다. 잠자기에서 깨어났을 때 마지막 확인이 24시간을 넘었으면 1회 확인한다. 마지막 확인 시각은 UserDefaults에 둔다.
- 기존 `checkForAppUpdates()`를 그대로 쓴다. 자동 호출은 실패해도 화면을 "확인 실패"로 바꾸지 않고 다음 주기를 기다린다.
- 새 버전이 있으면 메뉴바 아이콘에 약한 배지와 패널 상단 한 줄을 띄운다. 다운로드와 설치는 지금처럼 사용자가 확인한다.
- Codex가 미지원 버전으로 판정되면(2번) 주기를 기다리지 않고 즉시 1회 확인한다.
- 설정에 "업데이트 자동 확인" 토글을 둔다.
- 같이 고칠 것: 파싱되지 않는 태그 하나로 확인 전체가 실패하는 문제(APP-14). 자동 확인에서는 한 번의 잘못된 태그가 전 사용자를 막는다.

바뀌는 곳: `app/coordination/PetViewModel.swift`, `app/ui/PetApplication.swift`, `app/ui/PetPanel.swift`, `app/ui/settings/PetSettingsView.swift`, `app/update/PetAppUpdates.swift`, `Tests/swift/BlabeePetTests/`. 공통 앱 셸.
검증: 가짜 시계로 주기·깨어남·실패 무표시를 테스트. 사용 통계의 "업데이트 발견" 이벤트가 자동 확인으로 중복되지 않는지 확인.
결정: 기본값을 켬으로 할지. 주기 24시간.

## 2. 지원 목록보다 새 Codex에서 죽은 카드가 뜸 (CDX-1)

방안
- **세션을 띄운 Codex를 기준으로 판정한다.** Hook 프로세스는 자신을 호출한 `codex`의 경로를 이미 읽는다(`CodexHookApprovalQualification.swift:158`). SessionStart에서 그 실행 파일의 CDHash가 등록 목록에 있는지 본다. 프로세스를 새로 띄우지 않는다.
- 미지원이면 SessionStart와 UserPromptSubmit이 `enabled:false`를 돌려준다. 안내문 주입, 제안 도구 호출, 전달 못 할 카드가 모두 사라진다.
- 코디네이터가 "Codex 전달 상태"를 하나 갖고 Pet 스냅샷에 싣는다. Pet은 "Codex 0.167.1은 아직 지원되지 않습니다"와 업데이트 확인 버튼을 보여준다. 지금의 "실행 검사를 다시 진행해 주세요" 문구는 버전 미지원일 때 쓰지 않는다. 연결 설정 화면의 문구(`PetConnectionSetup.swift:39`)는 이미 올바르다.
- 관리형 경로는 패키지 레이아웃을 보기 전에 버전 목록을 먼저 확인해 "미지원 버전"으로 보고한다.

바뀌는 곳: `bridges/codex/swift/hooks/OperationalCLI.swift`, `app/coordination/CoordinatorOperationalApplication.swift`(Hook 어댑터 부분), `app/coordination/PetViewModel.swift`, `app/ui/PetModels.swift`, `bridges/codex/swift/runtime/ManagedCodexTrust.swift`. Codex Bridge와 Engine 경계.
검증: 미등록 CDHash의 가짜 호출자로 Hook이 `enabled:false`를 내는지, 등록 버전에서는 변화가 없는지.
결정: 미지원 버전에서의 정책.
- (가) 완전히 끈다. 현재 불변식(정확한 버전만)을 유지한다. 추천.
- (나) 서명 Team ID와 공증이 맞으면 카드 전달만 허용하고 일회성 승인은 계속 막는다. 신뢰 정책이 바뀐다.
근본 해결인 버전 등록 구조 개선은 2순위 16번이다.

## 3. `cd`로 Claude 연결이 영구 종료됨 (CLD-1)

방안
- **Hook이 서버에 보내는 식별용 폴더를 실행 시 폴더로 고정한다.** 지금은 Hook 입력의 현재 폴더를 그대로 보낸다(`bridges/claude/src/auto-connect-hook.mjs:27`). 실행 시 폴더는 이미 환경에 있다(`auto-connect-client.mjs:66`). bootstrap 요청, Hook 관측, `hook.poll`·`hook.cancel` 모두 같은 값을 쓴다. 서버 검사는 그대로 엄격하게 둔다.
- 안내문을 원인에 맞게 나눈다. 세션 ID가 바뀐 경우에만 "/resume·/clear" 문구를 쓴다.
- 종료된 뒤 프롬프트마다 안내가 반복되지 않게 서버의 확인 순서를 바꾼다(`ClaudeAutoConnectBootstrap.swift:224`의 폴더 비교보다 종료 상태 확인을 먼저).

대안: 서버가 폴더 불일치를 종료가 아닌 무시로 처리한다. Swift 두 곳과 wire 의미가 바뀌어 더 크다.
바뀌는 곳: `bridges/claude/src/auto-connect-hook.mjs`, `session-v2-hook.mjs`, `session-v2-lifecycle.mjs`, `Tests/bridges/claude/auto-connect.test.mjs`, 문서 `AUTO_CONNECT.md`. Claude Bridge. Node만 바뀌지만 런타임 payload를 다시 묶어야 설치본에 반영된다.
검증: 하위 폴더에서 온 UserPromptSubmit과 Stop이 통과하는 테스트. 기존 테스트의 "cwd가 바뀌면 종료" 기대값을 바꿔야 한다.
결정: **세션 연결 규칙 변경.** 완전히 다른 폴더로 옮겨도 연결이 유지된다. 카드의 프로젝트 표시는 실행 시 폴더 기준으로 남는다.

## 4·5. MCP 서버가 한 번 실패로 끝남, 긴 잠자기로 끝남 (CLD-3, CLD-2)

세 단계로 나눈다. 앞 단계만으로도 효과가 있다.

**단계 1. 보내지 못한 heartbeat는 견딘다 (작음)**
- 요청을 쓰기 전에 실패한 poll은 다음 틱에 다시 시도한다. 연속 횟수와 4초 한도를 둔다. 서버의 5초 창을 넘기면 진행 중인 카드만 폐기되고 연결은 남는다. 이것은 현재 서버 규칙과 같다.
- 앱 업데이트 중 거절은 종료가 아니라 대기로 처리한다.
- 바뀌는 곳: `bridges/claude/src/session-v2-channel-poller.mjs`, `session-v2-mcp.mjs`, 테스트.

**단계 2. lease 시계에서 잠자기 시간을 뺀다 (중간)**
- lease 만료 계산에만 잠자기 동안 멈추는 시계를 쓴다. 잠든 동안에는 어떤 프로세스도 권한을 쓸 수 없고, 소유 프로세스가 죽으면 소켓이 닫혀 즉시 회수된다.
- 깨어난 뒤에는 heartbeat 공백 때문에 진행 중이던 카드만 폐기된다. 다음 프롬프트부터 정상이다.
- 바뀌는 곳: `ClaudeSessionAuthority.swift`와 `ClaudeOwnerRenewalController.swift`에 주입하는 시계, 테스트, `SESSION_AUTHORITY.md`. 저장되는 기한 값이 있는지 먼저 확인한다.

**단계 3. 재연결 경로 (큼)**
- `claude`를 감싸는 실행기는 Claude 프로세스가 살아 있는 동안 계속 산다. 이것을 닻으로 삼는다.
- 서비스 재시작, 앱 업데이트, lease 만료로 소유 연결이 끊기면 bootstrap을 "종료"가 아니라 "대기"로 되돌린다. 다음 Hook이 새 scope로 다시 등록한다. source는 기존 `resume`을 쓴다. 새 프로세스로 대화를 이어받는 것과 의미가 같다.
- MCP 서버는 종료하지 않고 grant 대기로 돌아가 새 bridge를 연다. Claude Code가 보기에는 같은 서버가 계속 떠 있다.
- 이전 boundary와 선택은 이어받지 않는다. 새 프롬프트가 필요하다. 자동 재전송은 없다.
- 나중에 같은 경로로 창 안 `/resume`과 `/clear`도 받을 수 있다.
- 끊김과 재연결 상태를 Pet에 표시한다. 지금은 Claude 화면에 섞여 나오는 stderr 한 줄뿐이다.

결정: 단계 2와 3은 **세션 연결 규칙 변경**이다. 단계 3은 `TECH_SPEC.md:99`의 "미지원" 결정을 뒤집는다.

## 6. 같은 사용자의 프로세스가 승인을 대신 보낼 수 있음 (APP-4)

방안
- Pet만 해야 하는 요청을 전부 Pet 비밀값 경로로 옮긴다. 지금은 조회·선택·닫기만 그 경로를 타고, 승인 응답(`resolve_permission_request`, `resolve_managed_command_approval`)과 `focus_event`는 그대로 나간다(`PetViewModel.swift:3223,3618,3705`).
- 서비스가 Pet 비밀값을 가진 모드에서는 `get_state`, `pet_snapshot`, `select`, `dismiss_interaction`, `focus_*`, `resolve_*`를 비밀값 없이 받으면 거부한다. 거부 지점은 `ClaudeProductServiceCoordinator.swift:81`의 기본 분기다.
- Hook과 MCP가 쓰는 요청(`session_start`, `user_prompt_submit`, `stop`, `permission_request`, `emit_decision`, 진단)은 그대로 둔다.

바뀌는 곳: `app/service/PetProviderService.swift`, `PetProviderTransport.swift`, `bridges/claude/swift/service/ClaudeProductServiceCoordinator.swift`, `Contracts/bridge/pet-provider` 스키마(작업 종류 추가), 테스트. 공통 앱 셸과 Claude Bridge.
먼저 확인: `enable_project`를 누가 보내는지. Codex 샌드박스 안의 명령이 소켓에 닿는지 1회 확인한다. Claude Code의 Bash 도구는 기본적으로 샌드박스가 없으므로, 이 확인과 무관하게 고치는 편이 맞다.
결정: `Contracts/bridge` 변경 승인.

## 7. 업데이터가 영구히 잠김, 업데이트가 재시동까지 막힘 (APP-3, APP-6)

방안
- **자동 종결 규칙.** helper가 살아 있지 않을 때, 설치된 앱이 후보 빌드와 같으면 성공으로, 이전 빌드와 같고 복원 중인 세션이 없으면 실패로 종결한다. 실패 종결은 다시 시도할 수 있다. 나머지만 "확인 필요"로 남긴다.
- **수동 종결.** "확인했습니다" 버튼이 새 종결 기록을 덧쓴다. 기존 기록은 지우지 않는다.
- 새 앱의 서비스 확인 시간을 30초에서 앱 시작 예산인 120초로 맞춘다. 서비스가 꺼져 있거나 차단 상태이면 "설치 완료, 서비스 확인 불가"로 종결한다.
- 앱이 30초 안에 종료되지 않아 helper가 실패하면 이전 앱을 다시 연다.
- 업데이트를 막는 항목을 창에 이름으로 보여준다. 종류, 폴더, 시작 시각.

바뀌는 곳: `app/update/AppUpdateTransaction.swift`, `AppUpdateJournal.swift`, `PetAppUpdateWindow.swift`, `PetAutomaticAppUpdateView.swift`, `AppUpdateTransitionPreflight.swift`, 테스트, `docs/AUTOMATIC_UPDATES.md`.
결정: Claude 사용 기록은 설계상 프로세스 생존으로 해제하지 않는다. Codex에 이미 있는 "사용자가 세션 종료를 확인" 방식을 Claude 기록에도 허용할지. 허용하지 않으면 재시동이 유일한 해제 수단으로 남는다.

## 9. 릴리스가 테스트보다 먼저 공증됨 (REPO-1, REPO-5, APP-7, APP-10)

방안
- 릴리스 스크립트 16개를 `scripts/release/`로 옮겨 git에 넣는다. 빌드 번호와 이전 앱 경로는 인자로 받는다. 손으로 고치던 리터럴 약 77개가 없어진다.
- 드라이버 하나가 순서를 강제한다. 작업 트리 확인, 전체 테스트, 준비, 빌드, 검사, 번들 런타임 검사, 공증, 마무리, 증거, 게시, 태그.
- 공증 단계는 전체 테스트와 번들 런타임 검사의 통과 기록이 없으면 거부한다.
- `test:release`를 만든다. 루트 Node, `Tests/Cloud`, Claude 브릿지 Node, Swift 전체, 번들 런타임 검사를 한 번에 돌린다.
- 이전 릴리스의 서명 앱은 `build/` 폴더 대신 게시된 DMG에서 내려받아 검증한 뒤 쓴다.
- 게시 단계에 공개 문서 푸시와 저장소 README 갱신을 넣는다.

바뀌는 곳: `scripts/release/*`(신규), `package.json`, `Tests/AppPackaging/`, `docs/development/`. 공통.
함께 하면 좋은 것: Swift 테스트 410초 건(2순위 14번). 먼저 고치면 게이트가 3분대로 줄어든다.
결정: 릴리스 스크립트를 git에 넣는 것. 태그를 릴리스마다 남기는 것.

## 권장 순서

1. 3번. Node만 바뀌고 가장 자주 겪는 끊김을 없앤다.
2. 4·5번의 단계 1과 단계 2.
3. 6번.
4. 2번.
5. 1번과 7번. 둘은 같은 업데이트 화면을 건드리므로 함께 한다.
6. 9번. 위 수정들을 내보내기 전에 끝낸다.
7. 4·5번의 단계 3. 설계 문서를 먼저 쓴다.

어느 수정도 새 릴리스를 설치해야 반영된다. 1번이 들어간 릴리스부터는 사용자가 수동으로 한 번만 올리면 이후는 알림을 받는다.

## 작은 묶음 8·10번 (2026-11-12 구현)

- **8번 Codex 전달 실패 기록.** 실행 파일 자체의 실패(서명·버전·버전 응답)는 수동 재검사까지 유지한다. 환경 실패(공증 조회 실패·시간 초과·실행 불가·도중 종료·결과 불명)는 10분 뒤 풀리고, 다음에 새로 고른 카드만 다시 검사받는다. 실패한 전달은 다시 보내지 않는다.
  기록 형식 schema 2에 기록 시각·경로·정책을 더했고, 32칸이 차면 경로가 사라졌거나 정책이 바뀌었거나 만료된 기록부터 재사용한다. 공증 온라인 조회는 같은 파일에 대해 서비스 수명 동안 한 번만 한다.
- **10번 서비스 정지.** 앱이 띄운 서비스가 예기치 않게 끝나면 5초 뒤 한 번 다시 띄운다. 그 뒤 10분 안에 또 끝나면 멈춘 채로 둔다. 사람이 처리해야 하는 원인(다른 서비스 실행 중, 앱 확인 실패, Keychain·저장소 문제)은 다시 띄우지 않는다.
  서비스가 멈추거나 막혀 있는 동안 메뉴바 아이콘을 흐리게 표시하고 도움말에 "서비스 멈춤"을 보여준다. 다시 띄운 서비스는 저장 기록으로만 복원하며 선택·전달·승인을 다시 보내지 않는다.
