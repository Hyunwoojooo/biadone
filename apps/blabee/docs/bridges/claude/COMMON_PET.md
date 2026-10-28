# Claude 세션과 공통 Pet 연결

> 아래는 세션별 검증 host의 기록이다. 2026-09-23 제품 소스의 Codex·Claude 도착순 통합 목록과
> 공통 설정 동작은 [통합 카드 목록](../../features/UNIFIED_PROVIDER_INBOX.md)을 참고한다.

공통 `blabee-coordinator`의 `claude-session-host --pet` 실행은 기존 `PetRootView`, `PetViewModel`, `PetPanelController`를 그대로 사용한다. 새 Claude 전용 화면이나 엔진 복사본을 만들지 않는다. 현재는 설치본을 보존하는 세션별 검증 실행이며, 설치된 한 Pet에 Codex와 여러 Claude 세션을 함께 모으는 등록·패키징 단계와 구분한다.

## 실행

`claude:shared`에 `--pet`을 명시하면 같은 native host 안에서 UI와 UDS 서버를 함께 실행한다. 기본 API와 플래그 없는 CLI는 기존처럼 화면 없이 실행한다. 설치본의 서비스·메뉴·전역 단축키를 소유하지 않는다. 검증 프로세스의 메뉴 막대에 `Blabee · Claude`가 표시되고, 이를 누르면 숨긴 패널을 다시 열 수 있다.

준비된 로컬 제품 빌드의 실행 명령:

```sh
cd ~/BiaDone/apps/blabee/claude
npm run claude:live
```

새로 열린 Claude 세션과 패널이 한 쌍이다. 이전에 실행한 화면 없는 세션이나 독립 개발 앱에 UI를 소급 연결하지 않는다. CLI 시작 안내에서 `common engine · UI on`과 프로젝트 경로를 확인한다. `build/` 산출물은 Git에 포함되지 않는다.

현재 검증 launcher에는 서로 다른 만료가 있다. **연결 확인(readiness)은 probe 생성부터 5분**, **세션 접속 권한(grant)은 launcher 시작부터 1시간**이다. 전자는 아래 단일 프롬프트로 재확인·새 제안이 가능하다. 1시간이 지난 세션에서 `claude_session_unauthorized`가 나오면 그 Claude 테스트 세션에 `/exit`를 입력하고 위 `npm run claude:live`로 새 세션을 연다. 새 Hook boundary만으로 만료된 접속 권한이 복구되지는 않는다. 이 제한과 장시간 세션 관리의 후속 범위를 최종 배포 동작과 구분한다.

## 데이터와 권한

```text
Claude Hook/MCP ── native UDS ── ClaudeNativeSession ── 공통 core/SQLite
                                    ↑
기존 Pet UI ── ClaudePetTransport ── selector 역할
```

- UI는 native host에 이미 있는 selector capability만 사용한다. grant·토큰을 UI 설정 파일이나 Claude 자식에 새로 전달하지 않는다.
- selector 전용 `pet.snapshot`의 결과는 `schema_version=blabee.claude-pet.v1`이다. 기존 `snapshot` 응답과 Codex의 v1 snapshot 계약을 유지한다.
- 화면 어댑터가 버전·scope·session·role·요청 ID를 검사하고, 공통 core의 routing과 packet·전체 binding·선택지 매핑을 정확히 결합한다. 표시 모델로 변환할 뿐 Claude 응답을 Codex wire 응답으로 위장하지 않는다.
- 독립 readiness ACK, 현재 bridge heartbeat, 현재 prompt의 Stop, 유효한 packet/revision이 모두 있어야 선택할 수 있다. 클릭 직전에 다시 확인하며 서버도 동일 조건을 검사한다.
- native 선택 응답의 `delivery=awaiting_claude_claim`은 선택 접수다. Codex의 `queued_submission_id`를 만들거나 모델 실행·완료로 표시하지 않는다. 유실되거나 불확실한 선택은 자동 재전송하지 않는다.
- claim 뒤 transport 대기가 끝나도 별도의 `pending_report_count`가 남아 있으면 UI는 `선택 결과 대기`를 유지한다. count는 현재 세션의 보고 권한 수이며 작업 성공 수가 아니다.
- 완료는 `complete_selection_v1`의 **Claude 보고**로 표시한다. 최근 결과에는 원래 selection 식별자를 표시하며, 과거 A의 보고가 현재 C/D 카드를 완료시키지 않는다.
- 제안의 부수 효과 `kind`는 공통 Pet와 같은 `^[a-z][a-z0-9_]{0,63}$` 코드만 받는다. 잘못된 값은 저장 전에 거부하며, 표시 단계에서 유효한 카드 전체가 사라지지 않도록 한다.
- 초기 검증에는 설정, 선택 건너뛰기, rollback, 전역 단축키가 포함되지 않았다.
  2026-09-24 소스부터 `선택 건너뛰기`는 공통 제품과 세션별 host 양쪽에 연결했다.
  현재의 유효한 카드만 `user_dismissed`로 종료하며 선택·Channel 전달·작업 실행은
  만들지 않는다. 설정·rollback·전역 단축키의 세션별 host 범위는 유지한다.
  UI 선택이나 건너뛰기는 Claude의 네이티브 도구 권한 승인을 대신하지 않는다.
- launcher 수명 FD와 권한 회수 규칙은 [NATIVE_SESSION.md](NATIVE_SESSION.md)를 유지한다. UI 서버가 종료되면 사용할 수 없는 카드가 남지 않도록 창도 닫는다.

## 실제 Claude에서 버튼 테스트

새 터미널에서 위 `npm run claude:live`를 실행한다. **그 명령으로 열린 Claude 세션**에 아래 블록 전체를 한 번에 입력한다. 이미 같은 세션이 열려 있으면 재시작하지 않고 입력한다. 현재 작업 폴더는 launcher가 만든 격리된 테스트 프로젝트다.

연결 확인은 probe 생성 시점부터 5분만 유효하다. `ready:true`는 영구 연결 인증이 아니다. 연결 확인과 제안을 별도 대화로 나누면 안내를 주고받는 동안 만료될 수 있으므로 아래 프롬프트는 ACK 직후 제안을 이어서 저장한다. 새 사용자 입력은 이전 카드를 무효화하므로, 재확인 후에는 새로운 A/B 제안도 필요하다.

**[프롬프트 시작 — 연결 재확인부터 A/B 제안까지]**

```text
Blabee 공통 Pet의 버튼 선택을 테스트해 줘.
check_connection_v1, ack_readiness_probe_v1,
emit_decision_v1, claim_selection_v1, complete_selection_v1이 있는지 확인해 줘.
없으면 실제 Blabee 도구 이름만 보고하고 멈춰 줘.

먼저 check_connection_v1을 호출해 줘.
이 서버의 연결 확인 Channel 메시지가 오면 받은 probe_id와 nonce 그대로
ack_readiness_probe_v1을 호출해 줘. nonce를 추측하지 마.
ready:true가 확인되면 추가 사용자 입력을 기다리지 말고 아래 제안을 이어서 저장해 줘.
ACK에 실패하면 제안을 저장하거나 작업을 실행하지 말고 멈춰 줘.

현재 Hook이 제공한 boundary_id로 emit_decision_v1을 호출해
아래 A/B 선택지를 저장해 줘. 필수 필드는 실제 상태에 맞게 작성해 줘.

A: 현재 작업 폴더에 pet-a.txt를 새로 만들고 BLABEE_SHARED_PET_A_OK를 기록한다.
B: 현재 작업 폴더에 pet-b.txt를 새로 만들고 BLABEE_SHARED_PET_B_OK를 기록한다.

제약: 선택된 파일 하나만 만들고, 기존 파일이 있으면 덮어쓰지 않는다.
선택 전에 파일을 만들거나 선택지를 실행하지 않는다.
저장하면 packet_id와 revision을 보고하고 대기한다.

이 서버의 선택 Channel 메시지가 오면 받은 참조 그대로 claim_selection_v1을 호출한다.
claim 성공으로 확인한 선택 작업만 실행한다. 실패하면 추측하거나 재시도하지 않는다.
끝나면 원래 selection_id로 complete_selection_v1에 실제 결과를 보고한다.
추가 선택지는 제안하지 않는다.
```

**[프롬프트 끝]**

제안 후 Claude 응답이 끝나면 **추가 채팅을 보내지 말고 바로** 공통 Pet에서 A를 한 번 누른다. 숨겨진 창은 메뉴 막대 `Blabee · Claude`로 연다. 연결이 만료됐다면 위 블록 전체를 다시 입력해 연결과 새 제안을 함께 만든다. 성공 기준은 같은 Claude 세션의 claim 성공, `pet-a.txt`의 정확한 내용, `pet-b.txt` 미생성, 원래 선택의 완료 보고와 Pet의 `완료 보고` 표시다. 도구 권한 승인이 나오면 Claude의 정상 승인 절차를 따른다. 이 관측을 남겨야 실제 모델의 UI 왕복을 통과로 기록한다.

## 검증

```sh
npm run test:common-pet
npm run test:native-session
npm run test:shared-engine
npm run test:product-ingress
```

`test:common-pet`는 별도 scratch에서 공통 UI와 native adapter를 컴파일하고, 실제 in-memory core의 선택·보고 흐름, 표시 상태, SwiftUI 렌더링과 기존 Codex UI 회귀를 검사한다. 렌더링은 직렬 실행한다. `build/common-pet/artifacts/`에 Claude 화면 이미지를 남긴다. 실제 Claude 모델 역할과 파일 실행을 증명하는 시험은 아니다.

`tests/shared-engine/pet-window-qualification.mjs`는 별도의 실제 창을 띄우는 수동 검증 보조다. `test:native-session`으로 만든 테스트 실행 파일을 인수로 받는다. Hook·모델 역할은 harness이며, 실제 Pet 버튼 A를 누른 뒤에만 claim·파일 표식·새 카드 유지·원래 A 완료를 검사한다. 증거는 `build/pu-*/evidence.json`에 남긴다. 이 결과도 실제 Claude 모델의 시험과 구분한다.

2026-09-18 초기 사용자 로그에서는 공통 엔진의 readiness와 제안 저장이 확인됐다. 이후 20:38 실제 Claude에서 A claim·완료 보고 `recorded:true`, `pet-a.txt`의 정확한 내용과 B 미생성까지 확인했다. 실제 모델과 harness 결과, 이후 1시간 grant 만료 문제는 [QA_REPORT.md](../../../dev/claude-standalone/docs/QA_REPORT.md)에 구분한다. A 시험 파일은 이미 존재하므로 반복 시험에는 새 파일명을 명시하며 기존 결과를 덮어쓰지 않는다.

## 승인된 소스 범위

이번 연결은 공통 `ClaudeCoreAdapter`의 native snapshot·카드 투영, `BlabeeCoordinator`의 Pet transport/provider 표시·native host, 관련 Swift 테스트와 `claude/`의 launcher·도구·검증·문서에 한정한다. `Contracts/v1`, 기존 Codex Hook/MCP 진입점, 설치본·전역 설정·다른 세션의 변경은 유지한다. 임시 source 기준 사본과 실행 산출물은 `claude/build/` 아래에 있다.
