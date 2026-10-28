# Queued Hook 재시도와 최신 프롬프트 보호

Codex 선택 전달은 `codex queue`의 반환과 `UserPromptSubmit` Hook이 서로 다른 순서로 도착할 수 있다. 그 사이 사용자가 새 프롬프트를 입력하더라도 이미 선택한 전달의 검증은 동일해야 한다.

## 선택 내용이 보이는 프롬프트 (2026-10-17)

새 전달에는 기존 `ref` 첫 줄 뒤에 선택한 옵션의 제목, 작업 목표, 제약 조건,
완료 조건을 읽기 쉬운 기록으로 함께 표시한다. 선택한 내용을 다시 생성하거나
요약하지 않고 저장된 action에서 결정적으로 만든다. 사용자 문장은 인용하고
제어 문자와 방향 변경 문자는 표시용으로 escape한다. 내용을 조용히 자르지 않는다.

첫 줄을 유지하는 이유는 구버전 Hook·서비스가 추가 본문을 일반 사용자 명령으로
오인하지 않고 잘못된 envelope로 거절하게 하기 위해서다. 현재 queue 전달은 하나의
`--message` 인수뿐이며, 숨겨진 ref와 별도의 표시 본문을 전달하는 인터페이스는 사용하지 않는다.

표시 본문 자체에는 실행 권한이 없다. Hook에서 인증된 journal의 선택 action으로
같은 본문을 재생성해 NFC bytes를 비교하고, 기존 session/turn/cwd·단일 claim·무결성
검사를 통과한 action만 실행 문맥으로 반환한다. 서비스 재시작 후에도 이 비교를 한다.
claim의 digest는 계속 Hook이 받은 **원본 bytes**에 묶이며, 다른 턴이나 변경된 본문은
정확한 재시도가 아니다. 과거 ref-only 전달의 복구는 계속 지원한다.

표식이 있는 요청은 연결 실패, 잘못된 응답, 비활성 프로젝트 등으로 검증 문맥을
받지 못하면 고정된 실행 금지 안내를 반환한다. 정확한 envelope만 기존의 제한된
재시도를 사용한다. 일반 사용자 입력과 PermissionRequest 처리는 이 변경과 구분한다.
Hook 자체가 실행되지 않는 상황까지 네이티브 실행 차단을 증명하는 변경은 아니다.

선택 내용이 Codex 대화와 로컬 `queue --message` 인수에도 남는다는 표시 범위 변화가 있다.
binding·인증 token·내부 식별자는 추가하지 않으며 진단 로그에 본문을 기록하지 않는다.
알려진 secret 검사를 유지하지만 임의의 모든 민감정보를 식별하는 필터로 간주하지 않는다.

2026-10-17 검증은 임시 저장소를 사용하는 직렬 Swift 검사로 진행했다.
`operational|Queued|queuedPrompt|codexQueue|ordinaryHook|permissionHook|nonqueuedPrompt`
필터의 211건이 통과했고, 마지막 legacy 응답 호환성 보완 후
`readableQueued|legacyQueuedPromptOutput|queuedPrompt|exactQueued|malformedQueued|nonqueuedPrompt|ordinaryHook|permissionHook|codexQueue`
필터의 34건을 다시 실행해 통과했다. 두 실행에는 중복 검사가 포함된다.
본문 변조, 재시작 후 복구, 정확한 재시도와 단일 claim, 다른 턴의 재사용 거절,
표시 문자열 생성 실패 시 선택 미소비, 한 개의 argv로 전달되는 줄바꿈 본문,
Hook 실패 안내와 기존 일반·권한 Hook 동작을 확인했다.
Node roundtrip 파일은 문법 검사만 수행했다. 제품 패키징·서명·설치 및 실제 Codex
대화에서의 표시 확인은 수행하지 않았다.

## 등록·선택 전 최종 크기 검사 (2026-10-17 후속)

원본 action JSON은 60,000바이트 이내여도, 제어·포맷 문자의 표시용 escape와 각 줄의
인용 접두사를 넣은 프롬프트는 131,072 UTF-8 바이트를 넘을 수 있다. 이전 생성 실패
검사는 consume·실제 전송이 발생하지 않는지만 확인했으며, 그 전에 선택과 dispatch
기록이 저장되는 문제는 막지 못했다.

새 제안은 현재 세션·토큰·프롬프트·secret 검사를 통과한 뒤 모든 옵션에 실제 표시문
생성기를 적용한다. `canRender`는 길이가 고정된 ASCII ref 자리표시자로 동일 생성기를
호출하며, 별도 길이 추정식을 두지 않는다. 상한에는 NFC 처리 이후 전체 표식·인용·
escape·가드 문구가 포함된다. 초과하면 reconciliation·제안 등록·journal 쓰기 전에
`queued_prompt_preview_invalid`로 거부한다. 기존에 등록된 동일 제안의 정확한 재시도와
충돌 판정은 유지한다.

Codex MCP에는 `decision_preview_too_large`, `accepted=false`, `retryable=true`로
반환한다. 재시도 가능은 **내용을 고친 제안**에 대한 것이며, 기존 요청을 그대로 자동
반복해서는 안 된다는 안내를 함께 보낸다. 세션·토큰 등이 잘못된 요청에는 이 크기 오류를
먼저 노출하지 않는다. 응답 유실로 acceptance가 불확실한 경우는 계속
`decision_delivery_unconfirmed`, `retryable=false`로 처리한다.

선택할 때도 immutable packet의 정확한 action과 실제 생성할 ref로 전달문을 먼저
만든다. 이 단계가 실패하면 `routeSelection`을 호출하지 않는다. 라우팅이 성공한 뒤에는
effect의 binding·packet/option/action ID·revision과 action 원문이 사전 검증값과
같은지 확인하고, 새 token에 대한 secret 검사를 거쳐 미리 만든 동일 전달문을 보낸다.
MAC·freshness·만료·단일 claim·세션 바인딩 검증과 과거 ref-only 응답 호환은 유지한다.

이전 카드가 크기 검사에서 거부되면 앱은 영어/한국어로 “카드 내용이 너무 길어요”와
내용을 줄인 새 카드 요청 방법을 표시한다. 작업이 전송되지 않았다는 오류만 명시적으로
분류하며, 일반 timeout·응답 유실의 결과는 계속 알 수 없음으로 둔다. 사용자 작업을
자동으로 요약·절단·재전송하지 않고 128KiB 상한을 유지한다.

회귀 검사는 4개 옵션 위치의 제어/포맷 문자, 크기 상한 직전·정확히 상한·1바이트 초과,
한글·emoji·줄바꿈의 실제 Hook claim과 정확한 재시도, 수정한 동일 proposal ID의 등록,
영어/한국어 안내와 자동 재전송 없음에 해당한다. 구형 oversized packet 검사는 실제
의미 계층에 저장한 packet에 제품과 같은 선택 preflight를 적용하는 **gate 단위 검사**다.
운영 actor가 기존 pending packet을 hydrate하는 진입점은 없어 전체 actor 재시작 복원
검사를 대신하지 않는다. 정상 action의 등록→선택→Hook 검증은 전체 actor 경로로 검사한다.

후속 격리 Swift 검사는 Engine 316개와 앱/Hook 51개가 성공했다. pending reconciliation
검사를 추가한 뒤 preflight 관련 5개를 다시 실행해 모두 성공했다(앞선 실행과 일부 중복).
명령·로그·검증 한계는 `build/queued-preview-preflight-20261017/`와
[전체 디버깅 보고서의 3번 후속 수정](../development/FULL_DEBUG_20261017.md)에 기록했다.
테스트용 컴파일만 수행했으며 배포 앱·설치본과 실제 모델 전달은 검증하지 않았다.

## 처리 규칙

| 입력 | 처리 |
| --- | --- |
| 현재 턴의 동일 Hook 재시도 | 기존 응답을 재사용한다. 원문 prompt bytes와 cwd가 다르면 거절한다. |
| A 전달 중 새 사용자 B, 이후 A Hook 최초 도착 | A 자신의 정확한 in-flight 경계를 찾아 기존 원자적 transport 완료·boundary 종료·claim 경로를 사용한다. |
| A claim 후 새 사용자 B, 이후 A Hook 재시도 | 작업 본문·Hook 식별자를 포함하지 않는 거절 문맥만 반환한다. B의 prompt·episode·token·카드·승인 요청은 갱신하지 않는다. |
| claim은 저장됐지만 첫 응답 반환에 실패했고 새 프롬프트는 없음 | 같은 문맥에서 시작한 정확한 미완료 전달만 기존 durable claim을 재검증해 복구한다. |
| 이미 claim한 ref를 다른 전달 턴에서 재사용 | 현재 프롬프트가 있으면 동일하게 거절하고 보존한다. |
| 서비스 재시작 후 아직 현재 프롬프트가 없는 상태의 동일 claim 복구 | 기존 delivery turn 및 prompt/cwd/action digest가 정확히 일치할 때만 복구한다. 새 claim은 추가하지 않는다. |

과거 전달 여부는 기존 durable claim에서 확인한다. 새 전체 턴 캐시나 저장 schema는 추가하지 않는다. 원래 전달 턴을 사용한 ref·cwd 변형과 잘못된 envelope suffix도 새 프롬프트로 등록하지 않는다. Blabee envelope에 해당하지 않는 일반 입력의 origin 판정은 이 변경의 범위가 아니다.

응답 반환 전 실패를 구분하기 위해 진행 중 claim별 시작 시점의 prompt ID와 전달 턴·digest만 메모리에 보존한다. 같은 세션에서 여러 전달이 실패해도 서로 덮어쓰지 않는다. 새 프롬프트 문맥이 정상 게시되면 해당 세션의 미완료 응답 복구 정보는 모두 폐기한다. 이 정보 자체로 작업을 승인하지 않으며, action 본문과 correlation token도 저장하지 않는다.

## 유지하는 경계

- in-flight 조회는 정확한 project/session, 전체 boundary binding, continuation ID, 진행 중 상태 및 NFC envelope digest가 일치해야 한다. 일치하는 continuation은 하나여야 한다.
- NFC는 envelope 인식에만 사용한다. 실제 claim은 Hook이 받은 원문 bytes, cwd, action의 digest를 검증한다.
- 완료 후 카드 승격은 찾은 A의 `binding.turnKey`에 적용한다.
- claim 저장 뒤 후속 카드 승격이 실패하면 완료 복구 목록에 경계를 보존해 정확한 승격만 재시도한다.
- 기존 authority projection을 재사용한다. 정상 queued 전달에 추가 journal load를 만들지 않으며 일반 프롬프트에도 새 authority 조회를 추가하지 않는다.
- 만료·실패한 전달을 되살리거나 다른 세션으로 보내지 않는다. 자동 재전송·실행은 추가하지 않는다.
- claim 또는 queue receipt는 사용자 작업의 실행 완료 증거가 아니다.

## 회귀 검증

`Tests/swift/CoordinatorSwiftTests/OperationalApplicationTests.swift`:

- `operationalQueuedHookAfterHumanPreservesArrivalOrder`: 중간 사용자 프롬프트, receipt-first/Hook-first, NFC/NFD 최초 전달, 정확한 재시도, 단일 claim·dispatcher 호출.
- `operationalStaleQueuedHookPreservesCurrentPrompt`: 동일·다른 전달 턴, ref/cwd/본문 변형, 프로세스 재시작, 최신 제안·Stop·대기 카드·native 승인 보존.
- `operationalQueuedClaimResponseRetryPreservesPromptFence`: claim 응답과 즉시 복구 읽기가 모두 실패한 뒤, 새 프롬프트 유무에 따른 복구·거절 구분.
- `operationalQueuedClaimRetriesAfterStagedPromotionFailure`: claim 후 후속 카드 승격 실패의 정확한 재시도.
- `operationalQueuedClaimRecoveryDoesNotReplaceAnotherAttempt`: 동시 전달 중 하나의 실패가 다른 미완료 응답의 복구 정보를 덮어쓰지 않음.

관련 전체 회귀 명령:

```sh
npm run test:swift -- --filter 'operational|routing|sqliteQueuedActionClaim|sqliteReceiptCompletionBatch'
```

검증 로그와 수정 직전 원본은 `build/queued-hook-races-20260923/`에 있다. 테스트는 운영 앱·DB를 사용하지 않는다. 설치 앱의 실사용 확인은 별도 단계다.

## 2026-09-24 공통 focus 지연과 Engine 중복 작업 수정

이번 변경은 소스 수정과 회귀 테스트 작성까지다. 빌드·컴파일·Swift 테스트·패키징·설치·운영 앱 재시작은 실행하지 않았다. 기존 Hook 순서·정확한 재시도 처리는 유지하며, Codex/Claude 전용 bridge 코드는 이 작업에서 수정하지 않는다.

### 조사 근거와 판단 범위

- 근거: `/private/tmp/blabee-queued-ref-repeat-20260924-grvjgj66/REPORT.md`와 같은 디렉터리의 evidence, service sample, service log. 첫 사건은 `/private/tmp/blabee-queued-ref-20260924-_ijjy_5c/REPORT.md`다.
- 재발 사건은 13:10:39.117 KST 선택·dispatch, 13:11:01.672 transport 완료, 13:11:08.747 전달 턴 시작, 13:11:11.265 claim occurred_at, 13:11:15.076 Hook 검증 불가 안내였다. 카드 만료는 13:19:51.766으로, 사용자 클릭 지연이나 카드 만료로 설명할 수 없다.
- 정확한 prompt digest·delivery turn에 해당하는 durable claim은 하나이고 실패한 턴의 도구 호출은 0개다. `occurred_at`은 commit 완료/응답 반환 시각이 아니며, claim 저장은 작업 실행 증거가 아니다.
- r69 서비스의 13:24:41부터 수집한 표본에서 focus → setForeground → processDueLocked → 전체 journal 검증/replay를 관측했다. 이는 13:11 실패 순간의 스택이 아니며 표본 수는 호출 횟수나 정확한 처리 시간이 아니다.
- 현재 소스에서는 focus 실패 후 다음 snapshot/poll의 재시도 제한이 없었고, 한 요청 안에서 이미 검증한 journal을 다시 파싱하고 전체 semantic replay하는 중복 작업이 확인됐다. 공통 actor의 동기 처리 지연과 재시도 누적은 Hook 예산을 소진할 수 있지만, 당시 최초 요청/재시도의 개별 오류가 없으므로 사건 전체의 원인으로 확정하지 않는다.
- 조사 시 설치 앱의 Info.plist는 0.1.0(69)였다. 설치 제품, 현재 수정 소스, 이전 로컬 빌드 산출물은 서로 구분한다. 과거 ref는 재전송·실행하지 않았다.

### app의 focus 권한과 자동 재시도

- 같은 immutable target과 provider/service 문맥에 대한 실패를 snapshot 연결 상태와 별도로 보관한다. 자동 재시도는 실패 후 2초, 4초, 이후 8초 간격으로 제한한다. 성공한 snapshot이 실패 기록을 초기화하거나 focus acknowledgment를 대신하지 않는다.
- 통합 inbox에서 이동 목표와 표시 카드가 달라 직접 `focusInboxEntry`를 호출하는 자동 경로에도 같은 제한을 적용한다. provider 전환과 현재 대상 검증을 마친 뒤 실제 focus 요청 직전에 해당 context의 실패/I/O 기록을 확인한다. 사용자 방향키 탐색은 cooldown을 기다리지 않지만 기존 중복 요청 방지와 focus 응답·snapshot 권한 검증은 그대로 거친다.
- 재시도/I/O 중복 방지 키는 실제 provider context의 service/session/authority/UI 세대와 app service generation을 사용한다. 읽기 실패만으로 증가하는 local providerGeneration은 응답 무효화에 사용하되 재시도 제한을 풀지는 않는다. snapshot 유실 후 같은 문맥이 복원되어도 이전 요청/실패 기록이 유지된다. 실패 메타데이터는 최대 64개이며 선택 권한은 저장하지 않는다.
- 결정 카드의 `focus_interaction`과 `focus_event`는 전체 `PetInteractionIdentity`(interaction·packet·revision·전체 binding)를 하나의 재시도/I/O 키로 공유한다. permission·managed는 종류와 전체 binding을 포함한 `PetEventFocusTarget`을 유지한다. event 요청은 생성 때 정한 `retryTarget`을 보관하여 성공·실패·무효화에도 같은 키를 사용한다. 현재 snapshot으로 오래된 요청의 키를 재구성하지 않으며, 응답 검증용 원래 target과 operation UUID·context 검사는 그대로 유지한다.
- 실제 focus 요청이 끝나기 전에는 같은 대상 요청을 중복 발행하지 않는다. UI에서 오래된 operation을 무효화하는 것과 실제 I/O가 끝나는 것은 구분한다.
- legacy interaction, event, provider inbox의 비동기 결과에 operation UUID와 대상/문맥 검사를 적용한다. 카드 revision·세션·서비스 세대가 바뀐 뒤 도착한 성공/실패와 defer가 최신 상태를 덮어쓰지 못하게 한다.
- 정확한 focus 응답과 현재 snapshot의 대상/foreground 권한이 모두 확인된 뒤에만 local selection authority를 만든다. 응답이 아직 없거나 유실됐을 때 matching snapshot만으로 선택을 활성화하지 않는다.
- 이 제한은 focus 확인 요청에만 적용된다. 실패한 queued 작업의 재전송·자동 선택·실행을 추가하지 않으며 Hook의 응답 예산도 늘리지 않는다.

### Engine의 검증 재사용 범위

| 경계 | 처리 |
| --- | --- |
| 요청 시작/authority 조회 | 저장소의 현재 schema·MAC chain·head·sequence·freshness 검증과 전체 semantic replay를 수행한다. |
| 같은 append 트랜잭션 | `BEGIN IMMEDIATE`와 기존 잠금 아래 `loadUnlocked`가 이미 검증/파싱한 PreparedEvent·PreparedDocument만 재사용한다. |
| candidate semantic 상태 | 해당 요청에서 검증한 state에 새 이벤트/sidecar만 기존 reducer로 적용한다. envelope·binding·sequence·중복·토큰·orphan 검사는 공유한다. |
| CAS 충돌/다른 writer | projection을 버리고 저장소를 다시 읽는다. 새 journal head·sequence 및 freshness를 확인한 뒤 판단한다. |
| append 이후 | 독립적인 전체 scan과 target checkpoint·정확한 event suffix·freshness commit 확인을 유지한다. |
| 정확한 같은 턴 claim 재시도 | fresh authority와 전체 retry tuple을 검증한다. 새로운 이벤트가 없으면 append와 candidate replay를 생략하고 기존 claim을 반환한다. |
| 요청 종료 | 검증 결과를 다음 요청용 캐시로 보존하지 않는다. 만료·무결성 실패·다른 세션/턴의 ref 재사용은 기존대로 거절한다. |

같은 foreground도 검증을 생략하지 않는다. terminal 정리는 binding뿐 아니라 packet/interaction/revision까지 비교하므로 외부 writer가 reseal한 이전 카드의 local authority를 제거한다. authority 읽기가 끝난 후 monotonic 시간을 다시 확인하여 읽는 동안 만료되거나 clock regression이 발생한 카드에는 focus를 부여하지 않는다. 정상 focus의 두 번째 시간 확인은 전체 journal을 다시 읽지 않으며, 실제 만료 전이가 필요하면 그 저장은 기존 검증 경로를 사용한다.

추가 검토 3·4번의 만료 경계도 다음과 같이 처리한다.

- 만료 처리 전에 fresh authority에서 전체 binding·interaction·packet·revision을 확인한다. 외부 writer가 reseal했으면 이전 runtime 항목과 해당 foreground만 제거한다. 새 revision의 만료가 연장·유지·단축된 어느 경우에도 이전 만료 명령으로 새 카드를 만료시키거나 자동으로 채택하지 않는다.
- expiry command 자체는 binding을 대상으로 하므로 generic semantic CAS 자동 재시도를 사용하지 않는다. routing이 최대 2회 충돌을 재시도하며 매번 fresh authority와 정확한 revision을 다시 확인한다. 응답 유실 복구의 만료 알림도 같은 revision의 durable expired 상태가 확인될 때만 한 번 보낸다. 다른 revision/다른 종료 상태에는 이전 카드의 만료 알림을 합성하지 않는다.
- authority/MAC/freshness 확인에 실패하면 오류와 pending 항목을 유지하고, 해당 카드의 foreground 권한은 먼저 해제한다. 이는 작업을 재전송하는 재시도가 아니라 만료 상태 정리이며 선택·dispatch·실행을 추가하지 않는다.
- 두 번째 due pass도 다른 continuation의 timeout 저장으로 지연될 수 있다. 모든 due 작업이 끝난 뒤 focus 대상의 monotonic clock·600초 한도·논리적 만료를 마지막으로 확인한다. 성공 확인 이후에는 저장소 호출 없이 foreground를 부여한다. clock regression에서는 durable 정리보다 먼저 전체 foreground를 해제하여 저장 실패가 기존 선택 권한을 남기지 않게 한다.

### 횟수와 시간의 분리

아래는 새 SQLite fixture에서 semantic authority 조회부터 해당 append까지의 소스 경로와 회귀 조건으로 계산한 기대값이다. 앞선 app reconciliation·transport·다른 요청의 비용은 포함하지 않는다. Swift 테스트 실행 결과나 실제 속도 개선 측정값이 아니다. N은 작업 시작 시 journal 이벤트 수, K는 새 append 이벤트 수다. event preparation은 준비 함수 호출 수이며, 그 함수 내부 JSON 파서 호출 수와 다르다.

| 작업 | 변경 전 | 변경 후 |
| --- | --- | --- |
| 정상 claim의 SQLite 전체 인증 scan | 3회 | 3회 유지 |
| 해당 append 경로의 event preparation | `4N + 2K` | `3N + 2K` |
| Hook-first 세 이벤트 전달의 semantic 이벤트 처리 | 전체 replay 5회, `5N + 6` | 전체 replay 1회 + 신규 3개, `N + 3` |
| 정확한 claim 재시도의 candidate replay | 변경 없는 전체 replay | 0회; fresh authority replay 유지 |
| 정상 확인된 동일 카드의 자동 focus | 추가 요청 없음 | 유지 |
| 실패한 동일 focus 뒤 성공 snapshot 반복 | 다음 poll에서 재요청 가능 | cooldown과 진행 중 요청 검사로 제한 |

기본 비활성 observer는 다음 구간을 구별한다. 내용·ref·세션 ID·토큰은 기록하지 않는다.

- `CoordinatorOperationalRequestTiming`: nonisolated `handle` 본문 진입부터 actor 진입까지 대기, actor handler 시작부터 반환까지 경과 시간을 각각 제공한다. 앞선 socket/provider queue 및 wrapper 본문 진입 전 executor hop은 포함하지 않는다. handler 경과 시간은 await도 포함하므로 CPU 시간이나 저장소 시간으로 해석하지 않는다.
- `SQLiteJournalWork`: 전체 인증 scan/행 준비 횟수와 `loadUnlocked` 내부 경과 시간. actor/바깥 잠금 대기와 freshness store 사전 조회는 이 시간에 포함하지 않는다.
- `CoordinatorSemanticReplayWork`: full replay와 incremental 적용의 이벤트 수 및 각 함수 내부 경과 시간. 저장소나 actor 대기 시간은 포함하지 않는다.

observer는 관찰용으로만 사용하고 동기 callback에서 저장소/actor를 다시 호출하거나 느린 I/O를 하지 않는다. 함수 종료 시간 표본은 실패 시에도 발생하며 성공 receipt가 아니다. 필수 전체 scan과 기존 sidecar 검색 비용은 남아 있으므로, 큰 journal에서 Hook 예산을 만족하는지는 별도 측정이 필요하다.

### 검증 상태와 후속 확인

- 실행한 검사는 `git diff --check`, 소스 검증 경로 비교, 제품 바이너리/Swift를 실행하지 않는 `node --test Tests/Contracts/v1-contracts.test.mjs`다. 오프라인 계약 검사 129개가 통과했다. 이는 수정한 Swift 구현의 동작/타입 검증이 아니다.
- 수정한 제품 Swift 파일 6개가 Package.swift에 각각 한 번만 등록되어 있는지와 이 문서의 회귀 함수명이 실제 테스트 소스에 존재하는지도 확인했다.
- Swift 회귀는 작성만 했다. Pet의 느린/실패 focus·snapshot 분리·늦은 응답, `routingSameForegroundRevalidatesExactRevision`, `operationalFocusReadCrossesDeadline`, `operationalRequestTimingSpans`, `operationalRequestTimingIsInertWithoutObserver`, `sqliteQueuedClaimValidationWorkIsOperationLocal`, `sqliteQueuedClaimIncrementalProjectionReloadsAfterWriterChange`, `sqliteQueuedDeliveryUsesOneFullSemanticReplay` 및 SemanticReplayTests의 full/incremental 동등성 검사를 포함한다.
- 추가 검토 1번의 수정에는 같은 Codex context의 카드 A·B와 실제 `providerInbox`를 쓰는 회귀 3개를 작성했다: `failedInboxMoveKeepsAutomaticFocusBudget`(정상 poll 뒤에도 2·4·8초 경계와 요청 수 유지), `slowAutomaticInboxRetryDoesNotAccumulate`(느린 자동 요청과 겹치는 refresh 차단), `explicitInboxRetryStillRequiresAcknowledgment`(cooldown 중 직접 탐색과 응답 전 선택 차단). 가상 monotonic 시간을 사용하며 실제 성능 측정은 아니다. 이 추가 수정에서도 Swift 컴파일·테스트·설치 실행은 하지 않았다.
- 추가 검토 2번에는 `focusEndpointChangeKeepsPhysicalReservation`(양방향 경로 전환·늦은 성공/실패 4조합), `focusEndpointChangeKeepsFailureBudget`(양방향 실패 간격 공유와 성공 후 초기화 2조합), `focusEndpointKeyRetainsFullDecisionIdentity`(packet·revision·원본 prompt 차이 3조합)를 작성했다. 기존 1번 통합 inbox 회귀를 유지한다. 이 9개 사례도 Swift 실행 없이 소스 검토와 정적 검사만 했으며, 앱 설치 및 운영 상태는 변경하지 않았다.
- 추가 검토 3·4번에는 `routingExpiryRevalidatesRevision`(authority 조회 전/append 경쟁 × 새 만료 단축·유지·연장 6조합), `routingExpiryRetriesUnrelatedWriter`, `routingExpiryAuthorityFailureRetainsPending`(무결성/freshness 오류 전파 2조합), `routingExpiryAppendRecovery`(저장 전 실패·응답 유실·복구 조회 실패 3조합), `routingExpiryRecoveryRejectsOtherAuthority`(복구 조회 전 새 revision pending/expired·같은 revision close 3조합), `routingFocusChecksTimeAfterDueWrites`(timeout 저장 중 만료/clock 회귀 × 만료 저장 성공/실패 4조합)를 작성했다. 총 19개 사례는 메모리 journal·가상 clock만 사용한다. 무결성/freshness 오류는 port에 주입하는 전파 검사이며 실제 SQLite MAC/Keychain 검증을 대신하지 않는다. load·append 횟수와 후속 tick/알림 중복도 검사하도록 작성했지만 Swift 컴파일·테스트는 실행하지 않았다. 정상 같은-target focus의 기존 1회 load 검사도 유지한다.
- 기존 정확한 claim 재시도·다른 턴 단일 승자·freshness/무결성·queued Hook 순서 회귀도 다시 실행해야 한다. 향후 실행 시 `npm run test:swift`의 직렬 잠금과 격리된 메모리 freshness fixture를 유지한다. 이번 작업에서는 실행하지 않았다.
- 설치 바이너리에 임시 DB만 지정한 테스트는 Keychain/production authority 격리의 증거가 아니므로 사용하지 않는다. 명시적으로 격리한 후 새 요청으로 검사하고 조사용 과거 ref는 사용하지 않는다.
- 설치 확인 시 여러 카드/세션, 2초를 넘는 focus 응답, snapshot 성공/실패 교차, 큰 journal, 같은 Hook 전달 턴의 응답 유실·정확한 재시도를 검사한다. focus 요청 수·전체 scan/replay 수·actor 대기·검증 시간·Hook 응답·실제 도구 실행을 각각 기록한다.
- 별도 Codex bridge 작업에는 최초 요청/정확한 재시도의 요청별 오류 코드와 소요 시간, 응답 수신 여부를 구별할 진단을 요청한다. durable claim이 있어도 Hook이 응답을 못 받았을 수 있으며, 자동 재전송으로 보상하면 안 된다.

### 이번 수정 파일

- app: `app/coordination/PetViewModel.swift`, `app/coordination/CoordinatorOperationalApplication.swift`.
- Engine: `engine/routing/CoordinatorRoutingApplication.swift`, `engine/persistence/SQLiteJournal.swift`, `engine/semantic/CoordinatorSemanticApplication.swift`, `engine/semantic/CoordinatorSemanticState.swift`.
- Pet 회귀/fixture: `Tests/swift/BlabeePetTests/PetBehaviorTests.swift`, `PetEventNavigationTests.swift`, `PetProviderUITests.swift`, `PetTestSupport.swift`.
- Engine/운영 회귀: `Tests/swift/CoordinatorSwiftTests/OperationalApplicationTests.swift`, `RoutingApplicationTests.swift`, `SQLiteQueuedActionClaimTests.swift`, `SemanticReplayTests.swift`.
- 문서: `docs/features/QUEUED_HOOK_ORDERING.md`.

기존 작업 트리의 다른 변경은 보존한다. commit/push는 하지 않았다.

## 2026-09-29 선택 전달 실패 진단과 명시적 복구

r73 보고서의 10건은 선택·consume 이후 transport 수락과 claim 증거가 없고,
300초 deadline에 `timed_out_unknown`으로 기록됐다. 이 300초는 실제 실행 시간이
아니며, 과거 요청별 native 단계·오류가 없어 모두 같은 원인이라고 확정할 수 없다.
별도로 관측된 `codex_native_probe_timeout`의 persistent guard 차단은 명시적
Codex 실행 재검사로 복구됐고, 그 뒤 새 선택 한 건의 수락·claim이 확인됐다.

### 요청별 관측과 권위의 구분

- Codex native qualification, cached guard 차단, binary 재검증, notarization,
  access 검사, command 호출, exit, receipt 검증 단계를 구분한다.
- access와 남은 시간 검사를 통과하고 runner를 호출하기 직전만
  `command_invocation_attempted=true`로 기록한다. 프로세스가 실제 생성됐다는
  뜻은 아니다. 그 전 실패는 `not_submitted`, 호출 이후 실패는 `unknown`이다.
- version·help 검사의 exit 정보는 해당 qualification 단계의 관측이다.
  queue 실행 결과로 해석하지 않는다. 후보 탐색이 첫 실패를 반환하면 그 후보의
  관측을 사용하며, cached 차단에 과거 실패 시각이나 프로세스 실행을 합성하지 않는다.
- `.started`, `.accepted`, `.failed` 기록은 인증된 journal 밖의 제한된 로컬
  history에 저장한다. accepted는 정확한 session·submission receipt 검증만 뜻하고,
  claim이나 실제 작업 완료를 뜻하지 않는다. 프로세스 종료로 started만 남을 수 있다.
- sidecar 저장 실패·손상·경합은 기존 queue 결과를 바꾸거나 재전송을 발생시키지
  않는다. OS 로그에는 고정 코드 `next_turn_dispatch_diagnostics_unavailable`만 남긴다.
  저장 형식·보관 범위는 [오류 진단](../ERROR_DIAGNOSTICS.md)을 따른다.
- sidecar의 동기 파일 I/O는 공통 actor 밖의 단일 worker에서 처리한다. 처리 중인
  건을 포함한 128건·건당 4KiB의 메모리 큐만 actor에서 접근한다. 저장 지연 중에도
  선택 응답·snapshot·queued Hook claim을 처리하며, 포화 시 진단만 생략한다.
  아직 저장하지 못한 기록은 프로세스 종료 때 소실될 수 있다.
- Codex 후보 파일의 identity 접근 실패는 `codex_native_path_unsafe`로 구별해
  뒤의 정상 후보를 검사한다. 해당 파일은 실행하지 않는다. 실제 guard 저장소
  오류·불확실한 실행·cached 차단은 계속 terminal이며 fallback으로 우회하지 않는다.

### 화면과 복구

- `error.dispatch_failure`는 선택적 UDS 오류 속성이다. 기존 code-only 오류도
  계속 받되, 전송되지 않았다고 단정할 근거가 없으면 결과 미확인으로 표시한다.
- 선택 오류 알림을 snapshot 연결 상태와 분리한다. 상태 조회 성공, 소비된 카드의
  소멸, 같은 세션의 자동 FIFO 이동이 이미 표시한 ‘이전 선택 전달’ 안내를 지우지 않는다.
- 일시적인 snapshot 실패는 선택/focus 권한과 진행 중인 응답을 무효화하지만,
  기존 전달 안내만 복구 대기로 유지한다. service/access generation과 정확한
  provider·scope·session·authority·UI 문맥이 다시 확인될 때 안내만 재연결한다.
  과거 선택/focus의 권한이나 늦은 응답은 복원하지 않는다.
- 다른 카드로의 명시적 이동, 새 선택, 닫기, provider·세션·서비스 generation
  변경은 알림을 해제한다. 선택과 재검사의 늦은 응답에는 operation/context 검사를
  적용해 현재 카드나 새 알림을 덮어쓰지 못하게 한다.
- native 오류 안내에서 ‘Codex 다시 검사’를 실행할 수 있다. 이는 기존 명시적
  재검사 API를 호출할 뿐, 실패한 선택이나 과거 ref를 다시 보내지 않는다.
  성공 뒤 새 카드를 받도록 안내한다. unknown이면 기존 대화의 작업 시작 여부를
  먼저 확인하도록 안내한다.
- guard의 persistent suppression, MAC·freshness·정확한 세션·단일 claim,
  queued Hook 순서와 동일 턴의 정확한 재시도 조건은 유지한다.

관련 회귀는 `OperationalApplicationTests`, `CodexNative*Tests`,
`CodexQueueNextTurnDispatcherTests`, `NextTurnDispatch*Tests`, `DispatchDiagnosticBufferTests`,
`PetSelectionDeliveryTests`, `PetActionGenerationTests`, `PetProviderUITests`에 있다.
격리 테스트의 통과와 설치 앱에서 실제 새 카드가 처리되는 확인은 별도 검증 단계다.

### 최초 수정의 검증 결과

- 관련 Swift 회귀: target별 3개와 108개, 합계 111개 통과
  (각 러너 시간 0.108초·2.575초).
- `npm run test:swift -- --skip thousandReplayIDs`: target별 247개와 1,680개,
  합계 1,927개·105개 suite 통과(각 러너 시간 52.809초·75.702초).
  별도 대용량 Claude replay 검사는 제외했다. 기존 opt-in
  4건(실제 Keychain 복구, 대용량 SQLite 벤치마크, 실제 패키지 payload,
  설치 Codex runtime)은 실행하지 않았다. 이 시간은 제품 전달 지연의 측정값이 아니다.
- `npm run test:contracts`: 129개 통과. `git diff --check`, 새 Swift source의 단일
  target 등록, 변경 문서의 상대 링크 검사 통과.
- 수정 중 발견한 receipt ID 문법 불일치와 중단 후 임시 로그 누적도 수정했다.
  dot/colon ID 보존, 고정 pending 파일의 재사용과 unsafe 파일 거절을 회귀로 확인했다.
- 로그와 변경 직전 사본: `/private/tmp/blabee-delivery-fix-20260929-z5fx6h8u/`.
  최종 로그는 `focused-swift-3.log`, `broad-swift-final.log`, `contracts.log`다.
- Swift 테스트용 컴파일은 수행했다. 배포 앱·DMG 생성, 설치 교체, 운영 앱 재시작,
  운영 DB·Keychain·사용자 세션 변경, 과거 ref 재전송, commit/push는 수행하지 않았다.
- 새 배포본 설치 후에는 native 실패 안내 유지 → 명시적 재검사 → **새 카드**의
  전달 수락·Hook claim·실제 작업 실행을 각각 확인해야 한다. r73 과거 10건은
  당시 단계별 로그가 없으므로 이번 변경으로 원인을 소급 확정하지 않는다.

### 빌드 전 추가 디버깅 결과

같은 날 추가 검토에서 세 결함을 수정했다.

1. 진단 저장의 동기 파일 I/O가 공통 actor를 막을 수 있었다. 제한된 메모리 큐와
   단일 worker로 분리했다. 저장 sink를 의도적으로 멈춘 동안에도 select 응답,
   get_state, queued Hook claim이 완료되고 dispatch와 claim은 각각 한 번인 것을
   격리 회귀로 확인했다. 버퍼 포화·FIFO·저장 실패 후 진행·4KiB 초과 거절도 검사했다.
2. 첫 Codex 후보를 읽지 못하는 오류를 guard 저장소 오류로 분류해 정상 fallback도
   막았다. source 접근 실패를 별도 경로 진단으로 바꾸고, guard 저장소 실패와
   cached timeout은 계속 중단시키는 것을 검사했다. 선택 후 접근 상실도 실행 없이 거절한다.
3. provider context를 가진 화면의 snapshot이 실패하면 기존 전달 안내가 사라졌다.
   같은 문맥의 복구 때 안내만 유지하고 권한·진행 중 요청은 복원하지 않도록 했다.
   Codex/Claude 반복 실패, 문맥 변경, 닫기, 늦은 select/outcome 응답을 검사했다.

변경 파일은 `CoordinatorNextTurnDispatcher.swift`, `CoordinatorOperationalApplication.swift`,
`PetViewModel.swift`, `CodexNativeFailureGuard.swift`, `CodexNativeRuntime.swift`와
`DispatchDiagnosticBufferTests.swift`, `OperationalApplicationTests.swift`,
`PetProviderUITests.swift`, 두 `CodexNative*Tests.swift`, 이 문서 및
`docs/ERROR_DIAGNOSTICS.md`다. 운영 runtime bundle의 신뢰 정책은 수정하지 않았다.

- 집중 회귀: target별 6개와 106개, 합계 112개 통과. 첫 실행의 새 테스트 `try`
  누락을 고친 뒤 통과했다. 제품 코드의 추가 컴파일 오류는 없었다.
- 마지막 전체 Swift 회귀: target별 251개와 1,689개, 합계 1,940개·105개 suite 통과
  (각 러너 시간 52.404초·75.015초). 대용량 Claude replay 하나와 앞서 명시한
  opt-in 4건은 실행하지 않았다. 이 시간은 제품 응답 지연 측정값이 아니다.
- 계약 검사 129개, `git diff --check`, 변경 문서 상대 링크 검사 통과.
- 첫 전체 실행에서는 기존 `privateRuntimePermissionDriftFailsClosed`가 원형
  `ManagedCodexRuntimeBundleError.changed`로 한 번 실패했다. 단일 검사 1개,
  관련 suite 66개, 마지막 전체 재실행은 모두 통과했다. 초기 `provider.next()`의
  번들 검사·복사 경로로 좁혔지만, 정확한 throw 위치와 당시 변경 대상은 확정하지
  못했다. 이번 native guard/fallback 수정은 이 호출 경로에 포함되지 않는다.
  조상 디렉터리 전체 identity 검사가 공유 임시 폴더의 무관한 변경에도 반응할
  수 있는 것은 코드상 원인 후보이며, 당시 원인의 증명은 아니다. 이를 통과시키려고
  identity/ABA 검사를 완화하지 않았으며 간헐 실패로 추적한다.
- 근거: `/private/tmp/blabee-prebuild-debug-20260929-rmug79fd/`의
  `focused-swift-2.log`, `broad-swift.log`, `runtime-permission-targeted.log`,
  `runtime-trust-suite.log`, `broad-swift-2.log`, `contracts.log`, `changed-files.txt`.
- Swift 테스트용 컴파일만 수행했다. 배포 앱·DMG 생성, 설치, 운영 앱 재시작,
  운영 DB·Keychain·인증정보·사용자 세션 변경, 과거 ref 재전송, commit/push는 없다.
  설치 제품에서의 새 카드 전달·실제 실행 확인은 여전히 별도 단계다.

## 2026-09-30 r78 queued claim 비용 축소와 Hook 구간 진단

r78에서 보고된 queued Hook 전달 실패를 조사하면서, 전체 journal 검증 안에서
반복되는 JSON 해석과 sidecar 후보 탐색 비용을 합성 이력으로 재현했다.
이 비용이 큰 journal의 claim 지연을 늘리는 것은 확인했지만, 당시 요청별
Hook·actor·socket 증거가 충분하지 않아 실제 실패 원인 전체를 확정하지는 않는다.

### 저장소 검증 비용과 유지한 조건

- authority 조회, append 직전, commit 직후의 전체 검증 3회는 유지한다.
  각 검증은 schema, MAC chain, head, 연속 sequence, sidecar 일치와 freshness를
  확인한다. 다른 writer의 변경과 저장소 경로 변조를 거부하는 조건도 유지한다.
- 이벤트와 packet의 원본 JSON을 엄격하게 해석한 결과를 같은 준비 작업 안에서
  schema 검증에 재사용한다. JSON 해석은 항목당 3회에서 2회로 줄이며,
  canonical bytes를 다시 해석하고 검증하는 단계와 알려진 secret 검사는 남긴다.
- 매 전체 검증에서 인증·검증한 행으로 packet/revision, 선택 option,
  dispatch ID별 후보 인덱스를 새로 만든다. 요청이나 transaction 사이에
  검증 결과를 보관하지 않는다. 구조화된 key를 사용하고 후보를 배열로 유지해
  식별자 구분자 충돌과 중복 덮어쓰기를 피한다. 후보를 좁힌 뒤에도 기존
  `matches.count == 1`, 전체 binding, 인접 sequence, action, enabled 검사를 수행한다.
- 선택 중복 검사도 boundary ID별 후보로 좁히되 전체 binding 비교를 유지한다.
  같은 boundary ID를 사용하는 서로 다른 문맥을 합치지 않는다.
- 공개 journal load 1회, semantic replay 1회, append 1회와 freshness load 3회·
  CAS 2회는 두 claim 경로에서 동일하다. 재시도 횟수나 timeout을 늘리지 않았다.

### 격리한 재현과 비교 결과

`SQLiteQueuedActionClaimTests.swift`의 새 fixture는 완료된 queued lifecycle
300개 × 8 이벤트와 open/close 50쌍으로 2,500개 이력 이벤트를 만든다.
packet과 verification은 각각 300개이며, 허용된 summary·objective 길이 안에서
packet을 채운다. 대상 lifecycle을 더한 canonical payload는 약 5.99MB이다.
전체 semantic replay로 이력을 확인한 뒤 임시 SQLite에 한 번의 인증된 append로
넣으며, fixture 준비와 사후 확인은 측정 구간에서 제외한다. freshness는 메모리
구현을 사용하고 실제 사용자 DB·Keychain·설치 바이너리에는 접근하지 않는다.

| 측정 항목 | 수정 전 | 수정 후 |
| --- | ---: | ---: |
| receipt 이후 1개 claim 이벤트, 전체 경과 시간 | 6,025.120ms | 3,946.561ms |
| receipt 이전 completion·close·claim 3개 이벤트, 전체 경과 시간 | 5,492.652ms | 3,464.214ms |
| persisted sidecar 후보 비교, 두 경로 공통 | 1,902,621회 | 6,321회 |
| JSON 해석, receipt 이후 | 26,181회 | 17,755회 |
| JSON 해석, receipt 이전 | 26,175회 | 17,751회 |
| 전체 저장소 검증 / semantic replay / 공개 load / append | 3 / 1 / 1 / 1 | 3 / 1 / 1 / 1 |

이는 동일한 합성 이력의 debug 테스트 실행 비교이며 release 성능 벤치마크가
아니다. 측정 범위는 semantic과 SQLite 처리이고 actor 대기, socket 전송,
서비스 시작, 실제 Keychain 지연은 포함하지 않는다. 시간은 비교 증거로 출력하고
통과 기준으로 사용하지 않는다. 설치 제품이 Hook 시간 예산을 만족한다는 증거도 아니다.

- 상시 회귀 `sqliteQueuedClaimWorkWithPacketRichHistory`는 두 receipt 순서에서
  전체 검증·replay·append 횟수, 원본/canonical JSON 해석 2회, 선형 후보 수와
  정확한 durable claim을 검사한다. work outcome은 생성하지 않는다.
- 큰 재현은 `BLABEE_SQLITE_QUEUED_CLAIM_BENCHMARK=1 npm run test:swift -- --filter sqliteQueuedClaimBenchmarkWithPacketRichHistory`로 실행한다.
  프로젝트의 직렬 Swift 잠금을 유지하며 다른 Swift 실행과 겹치지 않는다.

### 요청별 진단과 실패 안내

제품 Hook에 요청 시도별 결과·오류 코드·소요 시간과 최종 결과를 기록한다.
공통 actor의 대기 시간과 handler 시간, socket의 마지막 응답 쓰기 결과도
구분한다. 로그 값은 제한된 유형·코드·결과와 수치로 제한하며 prompt, action,
ref, 사용자 경로, token과 원본 오류 내용을 기록하지 않는다. 이 진단은 실행
권위가 아니며 재전송이나 추가 claim을 발생시키지 않는다.

내부 claim 검증 실패를 일괄적으로 ‘만료된 선택’이라고 안내하지 않는다.
시간 만료가 확인된 경우와 내부 검증에 실패한 경우를 구분하고, 실패 안내만으로
작업이 실행되지 않았다고 단정하지 않는다. 과거 선택이나 ref를 재전송해 복구하지 않는다.

### 검증 상태

- 최종 집중 Swift 실행은 7개 테스트가 통과했다. 같은 후보 key를 가진 인증된
  packet의 전체 binding 위조 5개 사례와 작은 packet-rich fixture의 2개 receipt
  순서 사례, strict JSON·정수 경계·선택 bucket 검사와 큰 비교 벤치를 포함한다.
- 넓은 Swift 회귀는 `npm run test:swift -- --skip thousandReplayIDs`로 직렬 실행해
  Engine 255개와 Pet·Hook 1,705개, 합계 1,960개·105개 suite가 통과했다
  (각 러너 40.412초·79.826초). 동일 턴 재시도·중복 claim·만료·stale revision·
  다른 writer 변경·freshness·MAC·늦은 focus 응답과 새 진단 회귀를 포함한다.
  실제 Keychain·설치 runtime 등 opt-in 검사와 대용량 Claude replay는 제외했다.
  큰 queued claim 벤치는 앞서 별도 opt-in 실행으로 확인했다.
- 계약 검사 129개, `git diff --check`, 이 문서의 상대 링크 검사가 통과했다.
  첫 집중 실행에서는 새 테스트 helper의 Int64/Int 불일치를 수정한 뒤 통과했다.
- 근거: `/private/tmp/blabee-queued-repair-20260930-8cyqcnho/`의
  `baseline-swift.log`, `optimized-swift-2.log`, `regression-swift.log`, `contracts.log`.
- Swift 테스트용 컴파일만 수행했다. 설치된 r78, 운영 DB·Keychain·사용자 세션은
  변경하지 않았으며 배포·설치·과거 ref 사용·commit/push는 하지 않았다.
  새 배포본의 새 선택으로 Hook 응답 수신, durable claim, 실제 작업 실행을
  각각 확인하는 설치 후 검증은 남아 있다.

### 이번 수정 파일

- Engine: `engine/persistence/SQLiteJournal.swift`, `engine/validation/V1IngressValidator.swift`.
- 공통 app: `app/coordination/CoordinatorOperationalApplication.swift`,
  `app/service/UnixDomainSocketTransport.swift`, `app/entrypoints/main.swift`.
- Codex Hook: `bridges/codex/swift/hooks/OperationalCLI.swift`,
  `bridges/codex/swift/core/QueuedPromptEnvelope.swift`.
- 회귀: `Tests/swift/CoordinatorSwiftTests/CoordinatorSwiftTests.swift`,
  `OperationalApplicationTests.swift`, `SQLiteQueuedActionClaimTests.swift`와
  `Tests/swift/BlabeePetTests/HookRequestPolicyTests.swift`, `NextTurnDispatchTransportTests.swift`.
- 이 문서. 다른 세션에서 진행한 Codex 호환성 변경과 기존 미커밋 변경은 보존했다.

## 2026-10-11: 느린 검증의 만료와 닫힌 경계의 결과 기록

새 selection/consume/repair claim/transport completion/dismiss mutation은 authority를 읽은
뒤와 CAS 충돌 후 다시 읽은 뒤에 연속 시각을 검사한다. SQLite는 row 준비까지 끝낸 후
pending freshness CAS 직전에 admission callback을 확인한다. callback은 journal을 다시
읽지 않는다. 여기서 만료되면 row만 rollback하고 freshness pending을 만들지 않는다.
승인 후 디스크 commit이 끝날 때까지 기한 내임을 보장하는 계약은 아니다.

이미 승인된 원본 batch의 동일 append 호출 안에서 발생한 pending-source 복구는 정확한
batch/sequence/checkpoint를 확인한 한 번의 재시도만 허용한다. 이 경우 최초 admission을
유지하되 provider의 commit gate는 다시 확인한다. 다른 호출·다른 batch·semantic CAS
충돌에는 시간 권한을 승계하지 않는다. 이미 완료된 receipt 정리와 정확한 같은 턴의
기존 claim 복구에는 새 만료 조건을 추가하지 않는다.

queue 전달 완료로 닫힌 경계에도 `record_work_outcome`을 기록할 수 있다. 단, consumed,
completed transport, v1 claim, 원본 binding/action digest, 결과 시각이 claim 이후임을
확인한다. 내부 명령은 원본 `action_id`와 claim의 정확한 `delivery_turn_id`가 필요하다.
명령의 turn 필드 자체는 인증이 아니다. 향후 수신 adapter는 실제 인증한 제출자 문맥에서
turn을 얻어야 하며, 현재 앱/UDS/MCP 결과 수신 endpoint는 추가하지 않았다.

기존 열린 경계의 결과 및 Contracts/v1 event payload는 호환된다. 결과는 한 번만 기록하고,
경계를 다시 열거나 다음 작업을 자동 선택·재전송하지 않는다. 결과가 없으면 unknown이다.
검증 기록은 [ENGINE_DEBUG_20261011.md](ENGINE_DEBUG_20261011.md)에 남긴다.
