# Blabase Local Launcher Contract

상태: Phase 4C.3 + L-001 default-off display-only Work Board local checkpoint

## 1. 목적

Blabase macOS 앱은 메뉴바에 상주하고 전역 단축키로 현재 제안을 보여준다.
L-001이 exact default-off flag로 활성화되면 별도 Work Board projection을 먼저
요청하고, 그렇지 않거나 fallback이면 기존 Active Attention 결과 한 개를 그대로
보여준다. 런처는 추천 후보, 순위, 상태 또는 실행 대상을 새로
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
  → default-off Work Board preserve projection
  → 불가/fallback 시 current Phase 4B Active Attention result
  → 기존 Active Work Resumption focus_or_resume만 유지
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
- read-only root의 source별 연결 동작은 dashboard와 Local Agent의 opaque root ID와
  persisted sync revision이 모두 일치할 때만 고정된 `/sources` deep link를 연다.
- managed root에는 아직 root-owning Connection Hub가 bundle되지 않았으므로 source
  연결 URL을 열지 않고 기존 owner Work Cockpit data root 선택으로 안내한다.
- data root 변경을 저장하면 실행 중인 Local Agent의 실제 종료를 기다린 뒤 새
  root로 시작하고 현재 snapshot을 재평가한다. dashboard-only 변경은 Agent를
  재시작하지 않는다. Swift가 재평가 결과를 보정하거나 다시 순위화하지 않는다.
- prompt, shell command, native Codex thread ID 또는 local cwd를 만들거나 IPC로
  전달하지 않는다.

### Node Local Agent

- 기존 `evaluateCurrentAttention`, canonical
  `evaluateLiveSemanticWorkSuggestionBoard`와 source sync runtime을 재사용한다.
- `--data-root`를 파싱한 직후 그 root의 `.env.local` pointer를 기준으로
  `maintain` shared-local-env snapshot을 정확히 한 번 만들고, source mode,
  scheduler, `LauncherService`, Companion의 Codex binary resolver에 같은 snapshot을
  전달한다. Ambient 값이 shared file보다 우선하며 shared file은 기존 allowlist key만
  보충한다. 단, 빈 ambient allowlist 값은 unset으로 취급되어 보충될 수 있다.
  Snapshot 객체는 module-private `WeakSet`에 resolved로 표시되어 이후 legacy loader가
  다른 현재 작업 디렉터리의 pointer로 재보충하거나 변경하지 않는다. Feature flag와
  provenance는 shared file에서 주입되지 않고 ambient default-off 경계를 유지하며,
  request마다 env file을 다시 읽거나 `process.env`를 변경하거나 path/secret을
  진단에 기록하지 않는다.
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
  method:
    | "attention.get"
    | "work-board.get"
    | "attention.execute"
    | "command.get"
    | "status.get";
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
  currentFocusSummary?: {
    status: "selected" | "unresolved" | "unavailable";
    displayLabel: string | null; // selected일 때만, 최대 240자
    reasonCodes: string[]; // canonical unique, 1..12
    attentionSelectionEffect: "none";
  } | null;
  recentWorkSummary?: {
    displayLabel: string; // 최대 240 UTF-16 code units
    pushOccurredAt: string; // YYYY-MM-DDTHH:mm:ss.SSSZ
    trackingState:
      | "in_sync"
      | "ahead"
      | "behind"
      | "diverged"
      | "not_configured";
    aheadCount: number | null; // 0..100000
    behindCount: number | null; // 0..100000
    correlation: "repository_scope_only";
    presentation: "display_only";
    attentionSelectionEffect: "none";
    executionEffect: "none";
  } | null;
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

Swift는 success envelope의 exact key set을
`{contract,requestId,ok,result}`, failure는
`{contract,requestId,ok,error}`로 검증한다. `result`/`error` 공존, extra key,
non-canonical `request-<lowercase UUID>` ID와 error의 `code/message` 외 key는 protocol
corruption이다. Error code는 1~120 ASCII 대문자/숫자/underscore, message는 1~500
UTF-16 unit이고 control text는 금지한다. IPC v1 compatibility상 locator, credential 또는
private-ref 모양의 bounded message 자체는 protocol corruption으로 재분류하지 않지만,
Swift가 app-owned generic 문구로 치환해 화면에 raw text를 노출하지 않는다. Code는
보존되므로 `INVALID_REQUEST` fallback 정책도 유지된다. 구조/code/control 위반은 현재
agent generation을 retire하고 같은 JSONL session에서 fallback 요청을 보내지 않는다.

`status.get`은 strict empty params만 받고 다음 bounded control-plane 상태를 반환한다.
절대 경로, URL, token, credential과 source 원문은 포함하지 않는다.

```ts
type LauncherStatus = {
  contract: "blabase-launcher-status-v1";
  rootId: `root_${string}` | null;
  sourceMode: "managed" | "read_only";
  mutationAuthority: "launcher_agent" | "none";
  syncRevision: string | null;
};

type DashboardRootContext = {
  contract: "blabase-root-context-v1";
  rootId: `root_${string}`;
  mutationAuthority: "dashboard";
  syncRevision: string | null;
};
```

root ID는 `root_` 뒤 lowercase hex 32자이며 owner가
`<root>/.local/root-context.json`에 원자적으로 생성한다. `.local`은 `0700`, marker는
`0600`이고 symlink와 다른 UID 소유 파일은 거부한다. dashboard/managed owner만
missing marker를 만들거나 안전한 기존 권한을 강화하며 read-only Local Agent는
생성·복구하지 않는다. sync revision은 양쪽 모두 같은 persisted source-sync
`latest.json`에서 계산하고 snapshot이 없으면 `null`이다.

`sourceDiagnostics` 순서는 GitHub, Codex, Notion, Google Calendar로 고정한다.
GitHub·Codex만 후보 source이므로 `candidateSetComplete`를 boolean으로
표시하고 Notion·Calendar는 `null`을 사용한다. 상태와 bounded reason code,
decision status와 decision reason/candidate count가 모두 일치해야 decoder가
받아든인다. 이 진단 필드는 런처가 추천을 다시 판정하기 위한 값이
아니라, 제안이 없을 때 source 연결·수집·후보 범위 중 어디가 막혔는지
사용자에게 설명하기 위한 관찰 계약이다.

`currentFocusSummary`는 같은 평가에서 이미 계산된 Phase 1 Current Focus의 bounded
표시 요약이다. 이전 v2 producer와의 호환을 위해 생략 가능하며 consumer는 생략을
`null`로 처리한다. 선택된 경우에만 최대 240자의 `displayLabel`을 포함하고, status와
canonical reason code 외 workstream/focus ID, identity ref, event payload, prompt,
command, path는 전달하지 않는다. 이 필드는 항상
`attentionSelectionEffect: "none"`이며 후보 생성·eligibility·순위·card·실행 guard를
변경하지 않는다.

`recentWorkSummary`는 이전 v2 producer와의 호환을 위해 생략 가능하며 consumer는
생략을 `null`로 처리한다. `pushOccurredAt`은 public seam에서 canonical UTC
millisecond 형식으로 정규화한다. tracking count는 `in_sync=0/0`,
`ahead=>0/0`, `behind=0/>0`, `diverged=>0/>0`,
`not_configured=null/null`만 허용한다. 이 요약은 display-only이며 repository-level
상관관계만 표현한다. candidate/action/URL/project/scope/repository/hash, raw SHA,
branch, remote, path를 포함하지 않고 Attention 선택·eligibility·순위·card·실행
guard 또는 실행에 영향을 주지 않는다.

projection에는 `baseResult`, replay input, raw prompt/answer, command/output/diff,
credential, native thread ID와 project cwd를 포함하지 않는다.

### 4.1 L-001 Work Board projection

`work-board.get`은 별도 strict params `{refresh:boolean}`만 받으며 IPC envelope v1과
기존 `attention.get`/Attention v2 bytes 및 동작을 바꾸지 않는다. Exact flag
`BLABASE_LAUNCHER_WORK_BOARD_ENABLED === "true"`일 때만 활성화되고 나머지는
`INVALID_REQUEST`로 닫힌다. `read_only`는 `refresh:true`여도 sync하지 않으며,
`managed`의 명시적 refresh만 기존 source sync를 한 번 수행한 뒤 canonical
`evaluateLiveSemanticWorkSuggestionBoard`를 같은 data root에서 직접 한 번 호출한다.
Board 평가 자체는 preserve/no-refresh 경계를 유지한다.

```ts
type LauncherWorkBoardProjection = {
  contract: "blabase-launcher-work-board-v1";
  generatedAt: string;
  mode: "full" | "active_only_fallback";
  prominentLane: "attention" | "continuation" | "setup" | "none";
  continuationStatus: "available" | "empty" | "unavailable";
  items: Array<{
    lane: "attention" | "continuation" | "setup";
    title: string;
    evidenceBand:
      | "verified_attention" | "exact" | "corroborated"
      | "single_source" | "setup";
    caveatCodes: string[]; // exact public allowlist, canonical unique
    expiresAt: string | null;
    capability: "display";
    action: null;
  }>; // base primary 뒤 alternatives 순서, 최대 3
};
```

Semantic overlay는 exact public `itemRef`로 server-side에서만 상관하고 projection에는
적용된 title만 남긴다. `itemRef`, work-context/source/candidate/run/proof/hash,
private target, URL/path/credential과 action은 전달하지 않는다. Continuation/Setup은
non-null expiry를 요구하고 모든 non-null expiry는 generatedAt 뒤여야 한다.
Attention의 원본 `expiresAt`은 visibility TTL이 아니라 dueAt이므로 overdue/future와
무관하게 launcher projection에서 항상 `null`이다.
`active_only_fallback`은 Attention item만, `continuationStatus:unavailable`만 허용한다.

새 Swift client는 `work-board.get`을 최대 한 번 호출한다. Full은 항목이 0개여도
terminal Board다. Unsupported/`INVALID_REQUEST`는 sync가 아직 없으므로 원래 refresh로
기존 `attention.get`을 정확히 한 번 호출한다. 완료된 Board의
`active_only_fallback`, `WORK_BOARD_RUN_FAILED` 또는 strict result schema 거부는
double sync를 막기 위해 `attention.get {refresh:false}`로 한 번 fallback한다.
Timeout/disconnect/malformed envelope/protocol corruption은 같은 sequential connection을
재사용하지 않고 hung process generation을 retire한 뒤 기존 error/reconnect 경계로
보낸다. 늦은 byte는 retired generation에서 무시되고 다음 manual/poll load가 새
process를 시작한다. Board request cancellation도 pending request를 실제로 선점한
generation만 retire하므로 빠른 reload가 취소된 평가 뒤에 queue되지 않는다. Timeout,
protocol retirement, config/data-root 변경과 app shutdown은 stdin/handler를 먼저
분리하고 MainActor를 막지 않는 quarantine task에서 SIGTERM bounded grace 뒤에도 살아
있는 child를 SIGKILL해 PID 종료를 확인한다. 종료를 확인하지 못하면 해당 process/task를
보존하고 replacement launch를 거부한다. 모든 start는 lifecycle epoch와 retirement token을
캡처한 뒤 await 이후 cancellation/epoch/current token/permanent shutdown gate를 다시
검증하므로, concurrent config change나 app shutdown이 이전 data root process를 되살리지
못한다. Configuration change는 `beginConfigurationStop` 이후 gate를 유지하고, settings
store가 새 root를 실제 활성화한 뒤 `completeConfigurationChange`가 새 epoch를 열어야만
다음 launch를 허용한다. 중간 취소/실패는 `abortConfigurationChange`로 old-root 상태에
process 없이 복귀하며 permanent shutdown gate는 이 handshake보다 우선한다. Root choice가
다르면 `isAgentActive` flag와 무관하게 retry도 항상 begin-stop을 수행하므로 abort 뒤
재시작된 old-root process를 건너뛰지 않는다.
재귀 fallback은 없다. `WORK_BOARD_RUN_FAILED` 또는 strict result
schema failure로 Attention fallback을 표시할 때는
`Work Board를 불러오지 못해 기존 Attention을 표시합니다` 안내를 함께 표시하며,
그 Attention의 기존 Active action은 유지한다.

Full Board rows는 고정 Attention/Continuation/Setup lane 순서와 web과 같은 한국어
evidence/caveat allowlist만 표시하며 button, link, Enter shortcut 또는 action이 없다.
현재 시각에 만료된 item은 publish 전에 원래 순서를 유지한 채 제외하고, 가장 가까운
expiry까지 60초 이하 chunk로 재확인한다. Reload/config change/shutdown은 이전 timer와
request generation을 취소한다. `active_only_fallback` 뒤 표시되는 기존 Attention은
기존 Active action 계약을 그대로 유지한다; L-001은 Continuation/X-001 action을
launcher에 연결하지 않는다.

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

Phase 4C.3에서 read-only source 연결을 열기 전 Local Agent `status.get`, dashboard
`GET /api/system/root-context`, 다시 Local Agent `status.get` 순서로 확인한다. 첫
status가 managed이거나 authority가 맞지 않으면 dashboard에 요청하지 않는다. 이후
non-null root ID와 sync revision이 정확히 일치할 때만 네 provider enum으로 만든
`/sources?source=<allowlisted>&entry=launcher#source-<provider>`를 연다. mismatch,
invalid response, redirect, timeout과 unreachable은 모두 fail closed이며 재시도 안내만
표시한다. 절대 data-root path는 dashboard API나 URL로 보내지 않는다.

local Work Cockpit은 선택 root를 `cwd`로 소유한 `SourceSyncCoordinator`여야 한다.
이 handshake는 navigation 직전의 동일-store 확인이며 coordinator의 exclusive lease나
이후 browser/OAuth mutation을 handshake 시점에 묶는 session proof는 아니다. 따라서
현재 release는 operator가 한 owner Work Cockpit만 실행하는 internal dogfood 범위다.
Cloud/local data bridge, lease-backed mutation gate와 launcher-managed Connection Hub는
external beta 후속 release gate다.

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

Phase 4C.3 root handshake와 source deep link/OAuth return도 control-plane과 navigation
변경이다. source snapshot schema, 수집 의미, engine input/output 해석과 후보 순서를
바꾸지 않으므로 Golden Dataset과 semantic baseline은 재실행하지 않는다.

L-001도 existing public Work Board의 strict display-only projection과 native
presentation/fallback만 추가한다. Attention v2, Work Board/public/semantic contracts,
S1/R1/R2/R3/B1 및 dataset은 바뀌지 않으므로 core baseline은 N/A다. Default-off
flag 제거/비활성화 또는 old agent의 `INVALID_REQUEST`가 legacy Attention rollback이다.

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
- owner marker가 stable·atomic·private permission으로 생성되고 read-only lookup은
  missing/invalid marker를 만들거나 복구하지 않는지
- dashboard와 Local Agent root ID 또는 sync revision이 다르면 source link가 열리지
  않고 managed mode에서는 dashboard status 요청조차 하지 않는지
- GitHub/Codex/Notion/Google Calendar만 고정 deep link로 만들고 OAuth 완료·실패가
  임의 return destination이 아니라 해당 `/sources` anchor로 돌아오는지
- 후속: coordinator exclusive lease와 launcher-issued session proof로 preflight 이후
  browser mutation까지 같은 root authority에 묶는지
