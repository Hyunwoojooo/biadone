# Blabase Local Launcher Contract

상태: Phase 4C.2 macOS local beta v0.3

## 1. 목적

Blabase macOS 앱은 메뉴바에 상주하고 전역 단축키로 현재 Active Attention 결과
한 개를 즉시 보여준다. 런처는 추천 후보, 순위, 상태 또는 실행 대상을 새로
추론하지 않는다. Phase 4B resolver의 현재 top suggestion을 작은 표시 계약으로
투영하고, 사용자가 명시적으로 실행한 안전한 동작만 Local Agent에 요청한다.

전체 Work Cockpit은 런처에 내장하지 않고 별도 웹 대시보드에서 연다. 런처에는
추천 엔진 설정이 아니라 first-run data root와 dashboard endpoint를 선택하고
source 가용 상태를 확인하는 최소 설정 화면만 둔다.

```text
⇧ Space
  → Swift/AppKit 메뉴바 앱
  → JSON Lines over child-process stdin/stdout
  → bundled Node Local Agent
  → current Phase 4B Active Attention result
  → 기존 Work Resumption focus_or_resume
```

## 2. 구성 요소와 소유권

### macOS Host

- AppKit이 메뉴바, floating panel, foreground focus와 앱 lifecycle을 소유한다.
- Carbon global hot key의 첫 기본값은 `⇧ Space`다.
- SwiftUI는 Local Agent가 준 projection만 표시한다.
- `SMAppService`로 로그인 시 실행을 등록하며 실패는 사용자에게 표시한다.
- GitHub와 dashboard URL은 허용된 scheme/host를 확인한 뒤 `NSWorkspace`로 연다.
- `⇧ Space` 등록 실패는 launcher footer와 메뉴에 충돌 상태로 표시한다.
- first-run과 이후 설정 화면에서 기존 Blabase data root를 사용자가 직접 선택하고,
  허용된 dashboard URL과 source 가용 상태를 표시한다.
- data root 변경을 저장하면 실행 중인 Local Agent의 실제 종료를 기다린 뒤 새
  root로 시작하고 현재 snapshot을 재평가한다. dashboard-only 변경은 Agent를
  재시작하지 않는다. Swift가 재평가 결과를 보정하거나 다시 순위화하지 않는다.
- prompt, shell command, native Codex thread ID 또는 local cwd를 만들거나 IPC로
  전달하지 않는다.

### Node Local Agent

- 기존 `evaluateCurrentAttention`과 source sync runtime을 재사용한다.
- 기존 Work Resumption store, exact binding/execution 검증과 Companion daemon을
  재사용한다.
- 런처 projection과 실행 요청의 현재성 검증을 소유한다.
- stdout은 protocol JSON Lines에만 사용하고 진단은 stderr로 보낸다.
- Swift는 stdin write를 전용 serial queue에서 수행하고 취소된 request의 pending
  continuation과 timeout을 즉시 정리한다. malformed response는 기다리지 않고
  agent를 fail-closed 재시작한다.
- 앱이 종료되거나 stdin이 닫히면 scheduler와 Companion을 함께 종료한다.

### 서버와 웹 대시보드

- Phase 4C local beta의 추천 계산과 Codex 실행 관찰은 Local Agent에서 수행한다.
- 웹 대시보드 URL은 런처 설정으로 교체 가능하다. 기본값은 Blabase Cloud이고
  개발용 local Work Cockpit은 설정 preset으로 제공한다.
- 저장 가능한 endpoint는 HTTPS Blabase Cloud와 HTTP localhost 계열로 제한한다.
  임의 외부 host, credential이 들어간 URL, 지원하지 않는 scheme은 저장하거나
  열지 않는다.
- 장기적으로 server-authoritative 추천으로 이전하더라도 Swift UI 계약을
  유지하고 Local Agent가 transport와 local execution boundary를 담당한다.

## 3. IPC envelope

한 줄은 최대 하나의 JSON object다. 첫 release는 request/response 방식만
지원하며 임의 method, 알 수 없는 contract와 과대 payload를 거부한다. 입력은
64 KiB 고정 byte buffer로 delimiter까지 읽고, 제한을 넘은 frame은 나머지를
저장하지 않은 채 버린 뒤 다음 JSON line부터 복구한다.

```ts
type LauncherRequest = {
  contract: "blabase-launcher-ipc-v1";
  requestId: string;
  method: "attention.get" | "attention.execute" | "command.get";
  params: unknown;
};

type LauncherResponse =
  | {
      contract: "blabase-launcher-ipc-v1";
      requestId: string;
      ok: true;
      result: unknown;
    }
  | {
      contract: "blabase-launcher-ipc-v1";
      requestId: string;
      ok: false;
      error: { code: string; message: string };
    };
```

## 4. Attention projection

`attention.get`은 `refresh: boolean`만 받는다. `false`는 저장된 source snapshot을
즉시 평가하고, `true`는 `managed` mode에서 source refresh 뒤 새 평가를 수행한다.
shared-root `read_only` mode의 `true`는 저장된 snapshot만 다시 평가한다. 어떤
경우에도 Swift가 engine reason code를 해석해 다시 순위를 만들지 않는다.

```ts
type LauncherAttentionProjection = {
  contract: "blabase-launcher-attention-v2";
  resultId: string;
  asOf: string;
  decisionStatus:
    | "suggested"
    | "needs_clarification"
    | "no_action"
    | "insufficient_evidence";
  decisionReasonCodes: Array<
    | "DECISION_BEST_ELIGIBLE_CANDIDATE"
    | "DECISION_REFRESH_REQUIRED"
    | "DECISION_USER_CLARIFICATION_REQUIRED"
    | "DECISION_SCOPED_NO_ACTION"
    | "DECISION_RELEVANT_COVERAGE_INSUFFICIENT"
  >;
  candidateCounts: {
    eligible: number;
    reviewRequired: number;
    ineligible: number;
  };
  sourceDiagnostics: Array<{
    source: "github" | "codex" | "notion" | "google_calendar";
    state:
      | "available"
      | "stale"
      | "invalid"
      | "missing"
      | "rejected"
      | "disconnected"
      | "collection_failed"
      | "unevaluated";
    signalCount: number;
    candidateSetComplete: boolean | null;
    reasonCode:
      | "SNAPSHOT_MISSING"
      | "SNAPSHOT_PARSE_FAILED"
      | "SNAPSHOT_SCHEMA_UNSUPPORTED"
      | "CONNECTOR_DISCONNECTED"
      | "COLLECTION_FAILED"
      | null;
  }>;
  card: {
    candidateId: string;
    title: string;
    contextLabel: string;
    laneLabel: string;
    certainty: "confirmed" | "provisional";
    whyNowText: string[];
    explanation: string;
    firstStep: string;
    dueAt: string | null;
    primaryAction:
      | { kind: "focus_or_resume"; enabled: boolean }
      | { kind: "open_github"; url: string };
  } | null;
  clarificationQuestion: string | null;
  scopeStatement: string;
  unavailableSources: Array<
    "github" | "codex" | "notion" | "google_calendar"
  >;
  dashboardPath: "/";
};
```

`sourceDiagnostics` 순서는 GitHub, Codex, Notion, Google Calendar로 고정한다.
GitHub·Codex만 후보 source이므로 `candidateSetComplete`를 boolean으로
표시하고 Notion·Calendar는 `null`을 사용한다. 상태와 bounded reason code,
decision status와 decision reason/candidate count가 모두 일치해야 decoder가
받아든인다. 이 진단 필드는 런처가 추천을 다시 판정하기 위한 값이
아니라, 제안이 없을 때 source 연결·수집·후보 범위 중 어디가 막혔는지
사용자에게 설명하기 위한 관찰 계약이다.

projection에는 `baseResult`, replay input, raw prompt/answer, command/output/diff,
credential, native thread ID와 project cwd를 포함하지 않는다.

## 5. 실행 계약

`open_github`는 Swift가 projection의 HTTPS URL을 검증하고 연다.
`focus_or_resume`만 Local Agent 실행 요청을 사용한다.

```ts
type ExecuteAttentionParams = {
  resultId: string;
  candidateId: string;
  explicitUserAction: true;
};
```

Agent는 실행 직전에 현재 Attention을 다시 평가하고 다음을 모두 확인한다.

1. 표시 결과의 `asOf`가 현재 시각 기준 5분 이내다.
2. 요청한 `resultId`가 현재 result와 같다.
3. 요청한 `candidateId`가 여전히 top suggestion이다.
4. candidate에 exact `bindingId`와 `executionId`가 모두 있다.
5. current Work Session binding의 두 identity가 계산 당시 값과 같다.
6. Companion heartbeat가 fresh하다.

하나라도 다르면 새 작업을 열지 않고 `STALE_RECOMMENDATION`,
`BINDING_IDENTITY_CHANGED` 또는 bounded unavailable error를 반환한다. 성공한
요청은 기존 queue의 `focus_or_resume` command ID만 반환한다. 같은
`resultId + candidateId`가 앱 process 안에서 다시 실행되면 새 command를 만들지
않고 최초 command의 현재 상태를 반환한다. Swift도 terminal status가 정해질
때까지 Enter와 실행 버튼을 비활성화한다. prompt 생성,
approval 응답, retry, arbitrary command와 외부 source mutation은 지원하지 않는다.

## 6. 설치와 데이터 경계

`.app`은 고정 Node runtime과 bundle된 Local Agent JavaScript를 포함한다. 사용자
기기에 Node, npm 또는 source checkout이 있다고 가정하지 않는다.

```text
Blabase.app/Contents/
├─ MacOS/BlabaseLauncher
└─ Resources/runtime/
   ├─ manifest.json
   ├─ bin/node
   └─ launcher-agent.mjs
```

기본 data root는 `~/Library/Application Support/Blabase`다. first-run에서
사용자가 별도 root를 고르지 않으면 이 root를 사용하며 bundle Agent가 `managed`
mode의 유일한 source sync writer가 된다. connector token, snapshot, monitor,
replay와 Work Resumption state는 기존 store 계약에 따라 그 아래 `.local/`에
저장한다. `.local`, `.env*`, credential, production record는 앱 bundle이나 DMG에
포함하지 않는다.

사용자가 설정 화면에서 기존 Blabase data folder를 명시적으로 선택하면 host는
physical absolute path를 저장하고 해당 root를 항상 `read_only` mode로 연다. 사용자는
`.local` 자체가 아니라 그 부모 Blabase data root를 선택한다. 이 모드의
`refresh: true`는 기존 snapshot만 다시 평가하고 source scheduler, explicit source
sync와 monitor history write를 하지 않는다. 선택 root에 fresh data가 필요하면 그
root를 소유한 웹 `SourceSyncCoordinator`가 동기화하며, 같은 root에서 두
coordinator를 실행하지 않는다. 런처는 선택 과정에서 token, OAuth credential,
snapshot 또는 다른 data를 기본 root와 선택 root 사이에 자동 복사·이동·병합하지
않는다.

기존 root를 선택할 때 dashboard가 기본 Blabase Cloud URL이면 host는 같은
로컬 owner를 사용하도록 `http://localhost:3102`로 초기 전환한다. 사용자가
이미 다른 허용된 localhost endpoint를 명시했다면 그 선택은 보존한다.
이는 명시적 data-root recovery를 쉽게 만드는 local beta 기본값이며 token,
snapshot을 옮기거나 Cloud와 local root를 동기화하는 동작은 아니다.

여기서 `read_only`는 **source snapshot 갱신과 Attention history write를 막는 source
ownership mode**이며 파일시스템 전체를 불변으로 만드는 뜻이 아니다. Codex
`focus_or_resume`를 위해 Companion queue, heartbeat와 만료 command 정리 상태는 같은
root 아래에 기록될 수 있다. 따라서 선택 root는 읽기와 이 제한된 runtime state
쓰기가 가능해야 하며, UI에는 `소스 읽기 전용`으로 표시한다.

first-run은 창을 닫거나 기본 화면을 한 번 열었다는 이유로 완료되지 않는다.
사용자가 기본 managed root 또는 기존 read-only root와 dashboard endpoint를 확인한
뒤 완료 동작을 명시적으로 실행했을 때만 완료 상태를 저장한다. 설정 화면은 현재
effective root/mode와 projection의 `sourceDiagnostics`를 바탕으로 source 연결,
수집, freshness, signal count와 candidate coverage를 보여준다. GitHub와 Codex 중
하나라도 `available`이 아니면 복구 동작을 제공한다. existing read-only
root는 이 root를 소유한 Work Cockpit의 `/sources`를 열고, managed root는 기존
data root 선택을 확인하는 native 설정을 연다.
이는 관찰·복구 표시일 뿐 후보 eligibility나 source 의미를 새로 해석하지 않는다.

저장된 dashboard endpoint는 HTTPS Blabase Cloud 또는 HTTP
`localhost`/`127.0.0.1`만 허용한다. username/password, fragment와 허용되지 않은
host/scheme을 포함한 URL은 fail closed로 거부한다. dashboard URL과 선택 data root는
local preference에 경로/URL만 저장하며 credential이나 source 원문은 preference에
저장하지 않는다.

Phase 4C.1의 dashboard URL은 navigation destination일 뿐 선택한 local data root와
같은 snapshot을 사용한다는 handshake가 아니다. local Work Cockpit은 사용자가
선택한 root를 `cwd`로 소유한 `SourceSyncCoordinator`여야 한다. Cloud와 local Agent
사이의 data bridge도 아직 이 계약에 포함되지 않는다. 후속 단계에서는 dashboard
status API가 opaque root identity와 snapshot revision을 반환하고 런처가 이를
비교하되 절대 경로를 네트워크로 전송하지 않는 handshake를 추가한다.

기존 beta의 `BLABASE_LAUNCHER_DATA_ROOT`와 `BLABASE_DASHBOARD_URL` 값은 저장된 설정이
없는 최초 실행에서만 legacy candidate로 읽는다. 안전한 root/URL 검증 뒤 설정 화면에
미리 채우되 자동 적용하거나 저장하지 않는다. 사용자가 완료 동작을 실행하면
versioned preference를 저장하고 이후에는 이 명시적인 선택이 남아 있는 환경변수보다
우선한다. 따라서 UI에서 바꾼 값과 실제 실행 값이 조용히 달라지지 않는다.

data root가 바뀌면 host는 Local Agent의 pending request와 자동 restart를 정리하고
이전 프로세스의 실제 종료를 bounded wait로 확인한 뒤에만 새 설정을 저장·실행한다.
종료를 확인하지 못하면 새 Agent를 동시에 시작하지 않는다. dashboard endpoint만
바뀌면 Agent input이나 source ownership이 달라지지 않으므로 재시작하지 않는다.

개발자가 기존 local fixture/store를 확인할 때는
`BLABASE_LAUNCHER_DATA_ROOT`로 명시적인 절대 경로를 전달할 수 있다. 배포
artifact는 build machine의 data path를 기록하지 않는다. data root는 symlink를
해소한 뒤 `/`와 사용자 HOME을 다시 거부한다. 임의 Agent executable/argument
override는 debug build에서만 사용할 수 있고 release build는 bundle의 고정
runtime만 실행한다. child environment에서는 `NODE_OPTIONS`, `NODE_PATH`,
`DYLD_*`, `LD_PRELOAD`, source mode, code provenance와 Agent executable override를
제거한다. 설치본은 runtime manifest에 기록된 commit/fingerprint만 다시 주입한다.
manifest는 bundle된 Agent SHA-256도 포함하고 packaging verification에서 실제
bytes와 일치해야 한다. standalone Agent CLI도 symlink와 존재하는 가장 가까운
ancestor를 physical path로 해소한 뒤 `/`와 HOME을 거부한다.

## 7. 배포 단계

- local beta: arm64 SwiftPM build, ad-hoc signing, local DMG 검증
- external beta: Developer ID Application signing, hardened runtime, Apple notarization
- Windows: Local Agent protocol은 재사용하고 native host만 별도 구현

정식 서명과 공증 전 DMG는 이 Mac에서 개발 검증하는 artifact이며 다른 사용자에게
배포 가능한 release로 간주하지 않는다.

## 8. 평가와 호환성

Phase 4C는 기존 Active Attention input, candidate, eligibility, lane, ranking,
selection과 explanation을 바꾸지 않는다. 따라서 frozen Golden이나 Phase 4B
baseline을 새로 실행하지 않는다. 대신 다음을 targeted regression으로 고정한다.

Phase 4C.1 first-run selector도 engine input schema, snapshot 내용, 후보 filtering,
ordering 또는 결과 의미를 바꾸지 않는다. 사용자가 어느 기존 store를 읽을지
명시하는 UI/configuration-only boundary이며, engine 결과를 조합하거나 번역하지
않는다. 이 변경만으로 Golden Dataset 또는 semantic baseline을 다시 실행할 필요는
없다.

Phase 4C.2 diagnostics projection도 기존 resolver output의 상태·개수·source monitor
요약을 private 원문 없이 표시하는 transport/UI 변경이다. candidate 생성,
filtering, ranking, selection을 변경하지 않으므로 Golden Dataset과 semantic
baseline은 재실행하지 않는다.

- 네 decision status와 top suggestion이 손실 없이 projection되는지
- launcher가 top suggestion filtering/ordering을 바꾸지 않는지
- raw/private field가 projection과 stdout log에 나오지 않는지
- stale result/candidate와 changed binding이 실행되지 않는지
- 5분이 지난 표시 결과가 실행되지 않는지
- shared data-root override가 source sync/history write를 하지 않는지
- oversized split JSON line이 bounded memory로 거부되고 다음 frame부터 복구되는지
- runtime provenance와 bundled Agent hash가 설치본에서 검증되는지
- exact current task binding이 있는 candidate만 `focus_or_resume`를 요청하고,
  managed candidate는 계산 당시 binding/execution identity까지 일치하는지
- Swift decoder, URL allowlist, supervisor crash/restart가 fail closed하는지
- `.app`, Info.plist, signature와 DMG layout이 검증되는지
- fresh install에서 first-run이 자동 완료되지 않고 명시적인 완료 뒤에만 relaunch
  시 완료 상태가 유지되는지
- 기본 Application Support root는 `managed`, 사용자가 선택한 기존 root와 환경변수
  override root는 항상 `read_only`인지
- legacy 환경변수는 최초 실행 candidate로만 제시되고 저장 뒤 versioned preference가
  우선하는지
- root 변경은 이전 Agent 종료 뒤 재시작·재평가하고 dashboard-only 변경은 Agent를
  재시작하지 않는지
- HTTPS Blabase Cloud와 HTTP localhost만 dashboard endpoint로 저장·열 수 있는지
- root 선택 중 credential, snapshot과 source data가 복사·이동·병합되지 않는지
- shared root에서 source sync와 Attention monitor write는 차단되지만 Work
  Resumption queue/heartbeat의 제한된 write는 계속 가능한지
- projection의 source unavailable 상태가 표시되지만 추천 순위나 의미에는 영향을
  추가하지 않는지
- v2 projection의 decision reason, candidate count와 네 source diagnostic이 engine
  monitor와 일치하고, 상태/reason·순서·completeness 불일치를 fail closed하는지
- 기존 root 선택 시 기본 Cloud dashboard만 local Work Cockpit으로 전환되고
  사용자가 명시한 허용 localhost endpoint는 보존되는지
- 후속: dashboard status의 opaque root identity/snapshot revision handshake로 서로
  다른 store를 보는 launcher와 Work Cockpit을 감지하는지
