# Blabase Local Launcher Contract

상태: Phase 4C macOS local beta v0.1

## 1. 목적

Blabase macOS 앱은 메뉴바에 상주하고 전역 단축키로 현재 Active Attention 결과
한 개를 즉시 보여준다. 런처는 추천 후보, 순위, 상태 또는 실행 대상을 새로
추론하지 않는다. Phase 4B resolver의 현재 top suggestion을 작은 표시 계약으로
투영하고, 사용자가 명시적으로 실행한 안전한 동작만 Local Agent에 요청한다.

전체 Work Cockpit과 설정 화면은 런처에 내장하지 않고 별도 웹 대시보드에서
연다.

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
- 웹 대시보드 URL은 런처 설정으로 교체 가능하다. 개발 기본값은 현재 local Work
  Cockpit이다.
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
  contract: "blabase-launcher-attention-v1";
  resultId: string;
  asOf: string;
  decisionStatus:
    | "suggested"
    | "needs_clarification"
    | "no_action"
    | "insufficient_evidence";
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

기본 data root는 `~/Library/Application Support/Blabase`다. connector token,
snapshot, monitor, replay와 Work Resumption state는 기존 store 계약에 따라 그
아래 `.local/`에 저장한다. `.local`, `.env*`, credential, production record는
앱 bundle이나 DMG에 포함하지 않는다.

기본 root의 bundle Agent는 `managed` mode의 유일한 source sync writer다.
`BLABASE_LAUNCHER_DATA_ROOT` override를 사용하면 host가 Agent를 강제로
`read_only` mode로 시작한다. 이 모드의 `refresh: true`는 기존 snapshot만 다시
평가하고 source scheduler, explicit source sync와 monitor history write를 하지
않는다. override root에 fresh data가 필요하면 그 root를 소유한 웹
`SourceSyncCoordinator`가 동기화하며, 같은 root에서 두 coordinator를 실행하지
않는다.

개발자가 기존 local fixture/store를 확인할 때만
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
