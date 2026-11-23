# 등록 전 Codex 새 버전에서 기본 기능 쓰기 (설계, 2026-11-20)

상태: 사용자 승인(2026-11-20, 승인 카드는 등록 버전으로 유지하는 권장안). 같은 날 구현했다. r95 대상(2-A). r94는 이 변경 없이 먼저 빌드했고 게시하지 않았다(2026-11-23 결정, r94 내용은 r95로 함께 나간다).

## 문제

Codex는 일주일에 두세 번 새 버전이 나오고 Homebrew가 자동으로 올린다. Blabee는 등록한 버전만 받으므로
새 버전이 나오면 Blabee를 다시 빌드·배포·설치할 때까지 Codex 연결이 전부 꺼진다.

- r93(0.170.0까지 등록)을 2026-11-19에 설치했고, 다음 날 Homebrew가 0.171.0으로 올려 다시 막혔다.
- 다른 사람에게 배포하면 사용자는 Blabee 업데이트를 기다리는 것 말고 할 수 있는 일이 없다.

## 목표

- 등록되지 않은 **더 새로운** 공식 Codex에서도 제안 카드와 선택 전달이 동작한다. 사용자가 할 일은 없다.
- 등록 전 버전에는 명령 승인 권한을 주지 않는다. 승인은 Codex 창에서 한다.
- 문제가 확인된 버전은 Blabee 릴리스로 막을 수 있다.

하지 않는 것:

- 관리형 `blabee-codex` 경로는 그대로 정확한 버전·fingerprint만 받는다.
- 등록 절차(`npm run codex:register`, 매일 확인)는 그대로다. 등록은 이제 "승인 카드를 켜는 일"이 된다.
- 설정 화면·Doctor·운영 DB는 바꾸지 않는다.

실패로 보는 것: 등록 전 버전이 승인 권한을 얻는다. 서명·공증을 확인하지 않은 실행 파일을 Blabee가 실행한다.
새 버전에서 Codex 자체 동작(프롬프트, 승인 창)이 Blabee 때문에 막히거나 늦어진다.

## 지금 막는 곳 (일반 Plugin 경로)

| 지점 | 코드 | 지금 동작 |
| --- | --- | --- |
| 세션 시작 | Hook `CodexHookApprovalQualification.attestedCaller` → 코디네이터 `sessionStart` | OpenAI 서명이지만 CDHash 미등록이면 `codex_runtime: "unqualified"` → `enabled:false`. 이후 사람 프롬프트도 `enabled:false` |
| 연결 설정·선택 전달 | `CodexPluginSetupProductionTrust.supportedVersion(from:)` | `codex --version`이 등록 목록에 없으면 `codex_native_version_unqualified` |
| 명령 실행 직전 | `CodexPluginSetupProductionTrust.revalidate` | 버전이 등록 목록에 없으면 `approvalDrift` (`codex_native_binary_changed`) |
| 승인 카드 | `HookPermissionPolicy.qualifiedProfiles`(CDHash) | 미등록이면 한 번 허용 불가 |
| Pet 안내 | 스냅샷 `codex_runtime_status: "unqualified"` | "이 Codex 버전은 아직 지원되지 않아…" + 업데이트 확인 |

연결 설정·전달 검사는 버전 비교 전에 이미 경로 안전(`CodexRuntimeTrustGate`), OpenAI 서명(identifier `codex`, Team ID `2DC432GLL2`, strict),
Apple 공증(`codesign -R=notarized --check-notarization`)을 확인한다. `parseVersionOutput`은 `X.Y.Z`만 받으므로
`0.169.0-alpha.11.1` 같은 미리보기 버전은 지금도 `probeOutputInvalid`로 거부된다.

## 허용 규칙

`CodexCompatibility`에 Plugin 경로용 판정을 하나 둔다.

| 결과 | 조건 |
| --- | --- |
| `reviewed` | `pluginCLISupportedVersions`에 있다 (지금과 같음) |
| `unreviewedNewer` | 차단 목록에 없고, 등록된 Plugin 버전 중 가장 높은 것보다 크고(숫자 세 자리 비교), major가 같다 |
| `rejected` | 그 밖 전부: 등록되지 않은 옛 버전, 차단 목록, major가 바뀐 버전 |

- 차단 목록은 정확한 버전 문자열 집합이다. 등록 데이터와 같은 방식으로 JSON에서 생성 Swift로 만들고 처음에는 비어 있다.
- major 제한은 제 제안이다. 0.x에서 1.0으로 넘어가는 릴리스는 Hook·queue 형식이 바뀔 가능성이 커서 자동 허용에서 뺀다.
- 미리보기 버전(ChatGPT 앱에 든 alpha 등)은 계속 거부한다. 파서가 이미 막고 있어 바꿀 것이 없다.
- `CodexCompatibility.qualify(version:)`(관리형)은 손대지 않는다.

`supportedVersion(from:)`과 `revalidate` 두 곳이 `reviewed`와 `unreviewedNewer`를 통과시킨다. 서명·공증·경로 검사는 그대로 먼저 돈다.
실패 기록의 정책 revision(`CodexNativeRuntime.live`의 `policyRevision`)에 규칙 이름과 차단 목록을 넣어, 규칙이 바뀌면 옛 `version_unqualified` 기록이 풀리게 한다.

## 접근: 세션의 Codex 버전을 누가 판정하는가

Hook은 호출한 Codex의 서명만 확인하고 버전은 모른다. `unqualified` 세션을 살릴지 정하려면 버전이 필요하다.

| 방법 | 판단 |
| --- | --- |
| **서비스가 판정하고 기억** | 채택. Hook은 지금처럼 서명만 보고 실행 파일 경로를 함께 보낸다. 서비스가 전달 때와 같은 검사로 한 번 판정해 메모리에 둔다. Hook은 기다리지 않는다. |
| Hook이 직접 `codex --version` 실행 | 세션을 열 때마다 220MB 서명 검사·공증 조회·프로세스 실행이 들어간다. "Hook은 버전 프로세스를 띄우지 않는다"는 기존 원칙도 깬다. |
| 가리지 않고 전달 때만 검사 | 가장 단순하지만 옛 미등록·차단·미리보기 버전 세션에도 카드가 뜨고 선택하면 전달이 실패한다. |

사용자 결정(2026-11-20): 등록 전 새 버전은 기본 기능만 허용, 승인 카드는 끔, 관리형은 그대로, 차단 목록을 둔다.
미리보기 버전 제외는 권장안으로 진행한다고 알렸고 반대가 없었다.

## 동작

### Hook (`bridges/codex/swift/hooks`)

- `attestedCaller`는 `.unqualified`일 때도 kernel이 알려 준 Codex 실행 파일 경로를 돌려준다. 지금은 `.qualified`만 준다.
- `codex_runtime`을 SessionStart뿐 아니라 UserPromptSubmit payload에도 붙인다(계보 확인은 이미 두 이벤트 모두에서 한다).
  서비스가 다시 떠도(Blabee 업데이트 포함) 열려 있던 세션이 다음 프롬프트에서 다시 판정되고, 차단 목록을 실은 릴리스가 실행 중인 세션에도 적용된다.
- PermissionRequest: 호출자가 `.unqualified`면 코디네이터에 보내지 않고 바로 끝낸다. Codex 자체 승인 창이 곧바로 뜬다.
  세션이 켜져 있어도 허용 버튼 없는 카드를 기다리게 하지 않기 위해서다. `.unknown`(계보를 못 읽음)은 지금 동작을 유지한다.

### 판정 저장소 (`bridges/codex/swift/runtime`, 새 파일)

입력은 Hook이 보낸 실행 파일 경로, 호출은 기다리지 않는다.

- 검사는 전달과 같은 후보 순서로 한다: Hook이 보낸 경로, 그다음 고정 후보(`CodexPluginSetupExecutableResolver.candidateURLs`).
  이 가운데 Hook 경로와 **같은 파일**(device·inode 일치)로 이어지는 경로만 하나씩 `CodexNativeRuntime.live(explicitExecutableURL:)`로 검사한다.
  Hook 경로만 검사하면 안 된다. Homebrew는 `/opt/homebrew/Caskroom`이 그룹 쓰기 가능이고,
  `CodexRuntimeTrustGate`는 출발점이 정확히 `/opt/homebrew/bin/codex`일 때만 이를 허용한다(`matchingMonitoredEntry`).
  kernel 경로(`/opt/homebrew/Caskroom/codex/<ver>/bin/codex`)를 직접 넣으면 `path_unsafe`가 된다.
- 첫 실패가 아니라 같은 파일에 대한 답을 모은다. Caskroom 경로의 `path_unsafe` 뒤에 symlink 경로가 버전을 거부하면 `ineligible`이다.
- 다른 파일(다른 설치본)은 검사하지 않는다. 세션은 A로 돌고 PATH에는 B만 있으면 버전을 확인하지 못한 것이므로 켜지 않는다.

| 검사 결과 | 판정 | Pet 상태 |
| --- | --- | --- |
| 통과, 같은 파일 (새 버전이거나, 등록된 버전인데 CDHash가 다른 빌드) | `eligible` | `unreviewed` |
| `codex_native_version_unqualified`, `codex_native_probe_output_invalid` | `ineligible` | `unqualified` (지금 문구) |
| 다른 검사 진행 중(`execution_in_progress`), 실패 기록 잠금(`guard_unavailable`) | 검사 못 함. 기억하지 않고 다음 요청 때 다시 검사 | 없음 |
| 그 밖 전부: 경로·서명 실패, 공증 조회 불가, 시간 초과, 실행 실패, 같은 파일인 후보 없음 | 미정 | 없음 |

- `eligible`은 파일 식별값(`CodexNotarizationCache.key(for:)`와 같은 기준)별로 서비스가 떠 있는 동안 기억한다. 파일이 바뀌면 다시 검사한다.
- 나머지는 기억하지 않고, 같은 파일에 대한 재검사 간격만 제한한다. 버전·출력 실패는 실패 기록에 이미 남아 있어 재검사해도 Codex를 다시 띄우지 않는다.
- 처음 보는 파일이면 "미정"을 돌려주고 백그라운드에서 검사를 한 번 돌린다. 메모리에만 두고 개수를 제한한다.
- 검사는 실패 기록의 프로세스 잠금을 쓴다. `eligible`이 된 파일은 다시 검사하지 않지만, 그렇지 않은 파일은 요청이 올 때 10분에 한 번까지 다시 검사한다.
  검사 중(보통 1~6초)에 겹친 선택 전달은 2초 기다린 뒤 `codex_native_execution_in_progress`로 실패할 수 있다.
  Pet의 연결 검사와 전달이 겹칠 때 이미 있는 동작이며, 이번 변경에서 잠금 구조는 바꾸지 않는다.
  반대로 검사가 잠금에 밀리면 "검사 못 함"으로 두고 다음 요청에서 바로 다시 한다. 10분 동안 꺼 두지 않는다.

### 코디네이터 (`CoordinatorOperationalApplication.sessionStart`, `userPromptSubmit`)

판정은 주입된 클로저로 받는다(`codexSessionRuntimeObserver`와 같은 방식, `main.swift`에서 연결).
SessionStart와 사람 프롬프트마다 payload의 `codex_runtime`과 경로로 판정을 본다. 세션별로 기억해 둔 값에 기대지 않는다.

| `codex_runtime` | 판정 | 세션 시작 | 사람 프롬프트 | Pet 상태 |
| --- | --- | --- | --- | --- |
| `qualified` | - | 켬 | 켬 | 없음 |
| `unqualified` | `eligible` | 켬 | 켬 | `unreviewed` |
| `unqualified` | 미정 | 끔 | 끔 | 없음 |
| `unqualified` | `ineligible` | 끔 | 끔 | `unqualified` (지금과 같음) |
| 없음(계보 불명) | - | 켬 | 켬 | 없음 (지금과 같음) |

- "미정"은 끈다. 사람 프롬프트 응답(`promptContext`)이 경계와 안내문을 매번 싣고 세션 등록도 거기서 하므로,
  세션 시작 때 꺼져 있었어도 판정이 `eligible`이 된 뒤 첫 프롬프트부터 동작한다. 옛 버전·차단·미리보기 세션에는 안내문이 들어가지 않는다.
  치르는 값: 서비스가 뜬 뒤 그 Codex 파일을 처음 볼 때, 검사가 끝나기 전에 보낸 프롬프트 하나는 카드가 없다.
- 켜졌던 세션이 다음 프롬프트에서 `ineligible`·미정이 되면(차단 릴리스 설치, Codex 파일 교체) 그 프롬프트부터 `enabled:false`다.
  이미 만들어진 카드는 건드리지 않고, 선택하면 전달 검사가 지금처럼 막는다.
- 큐로 들어온 Blabee 프롬프트는 지금처럼 판정과 무관하게 처리한다.

### Pet (`app/ui/PetModels.swift`, `app/coordination/PetViewModel.swift`)

- 스냅샷 `codex_runtime_status`가 `"unreviewed"`도 받는다.
- 안내 문구(같은 자리, `providerDiagnostic`):
  "이 Codex 버전은 아직 검토 전이에요. 제안 카드는 쓸 수 있고, 명령 승인은 Codex 창에서 해 주세요." (영문 병기)
- 처음 관측하면 `unqualified`와 같이 업데이트 확인을 한 번 돌린다. 등록된 Blabee가 나와 있으면 승인 카드가 돌아온다.
  안내 종류마다 Pet 실행 중 한 번만 강제 확인한다. 프롬프트마다 판정을 보므로, Codex 설치본 두 개(예: ChatGPT 앱과 CLI)를 번갈아 쓰면 안내가 계속 바뀔 수 있어서다.
- 사용 통계의 `compatibility`는 기존 값 `unqualified`를 그대로 쓴다. 운영 DB check 제약(`qualified`/`unqualified`/`unknown`)을 바꾸지 않기 위해서이고, 버전 문자열이 함께 기록되므로 구분할 수 있다.

## 등록 전 버전이 얻는 것

| 항목 | 등록 전 새 버전 |
| --- | --- |
| 세션에 Blabee 안내문 주입, 제안 카드 | 예 |
| `codex queue --thread --message`로 선택 전달 | 예 (서명·공증 확인 뒤) |
| Plugin 설치·갱신 명령 | 예 |
| Hook 신뢰 상태 조회(`PetHookReadiness`의 `codex app-server` `hooks/list`) | 예. 연결 설정을 끝내려면 필요한 조회다. 검사 중 Codex가 기존 Hook 신뢰 정보를 갱신할 수 있다(Pet 안내 문구와 같다) |
| 명령 한 번 허용 | 아니오 |
| 관리형 `blabee-codex`(App Server 중계) | 아니오 |

남는 위험: 새 버전이 Hook 입력이나 `codex queue` 인자를 바꾸면 카드가 안 뜨거나 전달이 실패한다. Hook은 fail-open이라 Codex는 막히지 않고,
전달 실패는 재전송하지 않는다. `codex queue`의 의미가 조용히 바뀌는 경우는 검사로 알 수 없다. 이런 버전은 차단 목록에 넣은 릴리스로 막는다.

## 바꾸는 파일

- Codex Bridge: `setup/CodexCompatibility.swift`, `setup/CodexPluginSetup.swift`, `runtime/CodexNativeRuntime.swift`,
  `hooks/CodexHookApprovalQualification.swift`, `hooks/OperationalCLI.swift`, 새 판정 저장소, 차단 목록 JSON과 `scripts/codex/qualification.mjs`.
- 영역 경계(사용자 확인 필요): `app/coordination/CoordinatorOperationalApplication.swift`의 `sessionStart`·`userPromptSubmit`·스냅샷,
  `app/entrypoints/main.swift` 연결, `app/ui/PetModels.swift`, `app/coordination/PetViewModel.swift`.
- 문서: `bridges/codex/CLAUDE.md`의 "미등록 Codex" 문단, `/codex-version-support` 스킬 안내, `CODEX_LATEST_SUPPORT.md`, CHANGELOG.

바꾸지 않는 것: `Contracts/v1`, `qualifiedProfiles`와 승인 정책, catalog·fingerprint, `CodexRuntimeTrustGate`, 실패 기록의 저장 형식과 잠금,
Plugin manifest와 Hook 정의(Plugin 버전 유지), 소켓 요청 종류, 운영 DB.

## 검증

1. 단위 테스트(먼저 실패를 확인하고 구현):
   - 허용 규칙 표: 등록 버전, 최신보다 patch·minor가 큰 버전, 옛 미등록, 차단, major 변경.
   - `supportedVersion(from:)`과 `revalidate`: 새 버전 통과, 옛 미등록·미리보기 출력 거부. 관리형 `qualify(version:)`은 새 버전을 계속 거부.
   - Hook: `.unqualified`도 경로 반환, UserPromptSubmit에 `codex_runtime` 포함, PermissionRequest가 `.unqualified`면 요청을 보내지 않음.
   - 판정 저장소: 결과 표의 네 줄, 다른 설치본, Homebrew식 symlink 출발점(후보 평가는 순수 함수로 시험하고 실제 `liveCheck` 호출은 시험하지 않는다), 재검사 간격.
   - 코디네이터: 동작 표의 다섯 줄, 켜졌던 세션이 다음 프롬프트에서 꺼지는 경우, 스냅샷 값.
   - Pet: 스냅샷 `unreviewed` 파싱과 문구.
   - 실패 기록: 차단 목록이 바뀌면 revision이 바뀜.
2. 기존 묶음: Swift `Codex|ManagedCodex|UpdateManagedCodex|Hook|PetHookReadiness|DoctorApplication`, CoordinatorSwift `OperationalApplication`, `test:t005`, `test:codex-compatibility`.
3. 실사용: r95가 0.171.0을 등록하므로 지금은 시험할 등록 전 버전이 없다. 다음 Codex 버전이 나오면 등록하기 전에
   세션 시작, 카드 생성, 선택 전달, 승인 창이 Codex에 바로 뜨는지, Pet 문구를 확인한다.

## builder에게 맡기는 것

타입·함수 이름, 판정 저장소의 최대 개수와 재검사 간격(실패 기록의 환경 실패 수명 10분이 기준), 차단 목록 JSON의 위치와 이름, 영문 문구,
`CodexNativeDiagnostic.versionUnqualified` 문구 조정(남는 경우는 옛 버전과 차단 버전뿐이다), 테스트 파일 배치.

## 구현 기록 (2026-11-20)

- 허용 규칙: `CodexCompatibility.pluginAdmission`, 정책 revision `pluginPolicyRevision`(`native-v2-newer:…|blocked:…`).
- 차단 목록: `bridges/codex/blocked-versions.json`(비어 있음) → 생성 Swift `CodexQualificationData.blockedPluginVersions`. 등록된 Plugin 버전을 넣으면 생성이 실패한다.
- 판정 저장소: `bridges/codex/swift/runtime/CodexUnreviewedRuntimeAdmission.swift`. 최대 32개, 재검사 간격 10분, 검사 제한 15초(다른 native 검사와 같다).
- Hook: `HookCodexRuntimePayloadPolicy`, `HookPermissionOutputPolicy.route`(보낼지와 함께 실을 qualification을 한 곳에서 정한다).
- 코디네이터: `CoordinatorCodexRuntimeAdmission`, `observeCodexRuntime`. 판정 클로저를 주입하지 않으면 `ineligible`(이전 동작)이다.
- 설계와 다르게 둔 것: SessionStart에 `codex_runtime`이 없으면(계보 불명) 이전처럼 켠다. 표시가 없는 사람 프롬프트만 세션에 남은 표시를 따른다.
- 구현 뒤 검토에서 고친 것: (1) Homebrew에서 거부 버전이 Caskroom 경로의 `path_unsafe`에 가려 `ineligible`이 되지 않던 문제,
  (2) 잠금 2초 대기 실패가 "미정"으로 10분 기억되던 문제, (3) 안내가 바뀔 때마다 강제 업데이트 확인이 돌던 문제.
- 알려진 한계: Homebrew가 Codex를 올려 옛 파일을 지우면, 열려 있던 등록 전 세션은 Codex를 다시 열 때까지 꺼진다(파일이 없어 판정할 수 없다).
  꺼진 사람 프롬프트는 이전 턴의 카드를 정리하지 않는다(제품 접근이 끊겨 꺼질 때와 같은 동작이라 그대로 둔다).
  등록 전 안내는 Pet의 진단 자리에 계속 보인다(2차 검토 뒤 경고색이 아닌 보조색으로 바꿨다).
  검사가 끝나지 않고 멈추면 그 파일은 서비스 재시작 전까지 다시 검사하지 않는다(검사 안의 단계마다 제한 시간이 있어 그대로 둔다).
- 테스트로 확인하지 못한 것: `revalidate`가 거부 버전을 막는 경우(테스트에서 그런 선택값을 만들 수 없다. 같은 판정 함수를 `supportedVersion` 테스트가 덮는다)와 실제 등록 전 Codex에서의 왕복.

## 2차 검토에서 고친 것 (2026-11-21)

커밋 `8c74bcd` 뒤 새 검토자가 전체를 다시 읽었다. Critical 없음.

- Pet이 상태만 바뀐 스냅샷을 버렸다. `PetSnapshot.==`가 `codexRuntimeUnqualified`·`codexRuntimeUnreviewed`·`permissionCardSkipped`를 비교하지 않아,
  세션이 거부될 때(스냅샷에서 `codex_runtime_status`만 바뀐다) "지원되지 않는 버전" 안내가 뜨지 않을 수 있었다. r93에도 있던 문제다. 세 필드를 비교한다.
- 안내 문구가 서로 달랐다. 남은 거부 사유 대부분(등록된 가장 높은 버전보다 낮은 미등록 버전, 미리보기)은 Codex를 올리면 풀린다.
  설정 화면·Pet 패널·전달 실패 안내·native 진단을 "Codex를 최신 정식 버전으로, 그래도 안 되면 Blabee 업데이트"로 맞췄다.
- "검토 전" 안내는 정상 동작 중의 안내라 보조색으로 보인다(`providerDiagnosticIsRoutine`). "지원 안 함"은 주황색 그대로다.
- 백그라운드 검사 제한 10초 → 15초. 차단 목록 `reason`은 줄을 끝내는 문자를 모두 거부한다(생성 Swift 주석으로 들어간다).
- 테스트 보강: 상태만 다른 스냅샷의 안내와 강제 업데이트 확인 횟수(view model), PermissionRequest 경로(`route`), 등록 전 세션의 실행 파일 보고와 켜짐 → 꺼짐 → 켜짐.
- 여전히 확인하지 못한 것: `main.swift`가 판정 저장소를 코디네이터에 잇는 부분과 실제 등록 전 Codex에서의 왕복.
  0.171.0 등록을 뺀 시험 빌드를 쓰면 지금 설치된 Codex로 확인할 수 있다.

## 검토 기록

2026-11-20 builder 검토에서 고친 것:

- Hook 경로만 검사하면 Homebrew에서 항상 `path_unsafe`가 된다 → 전달과 같은 후보 순서로 검사하고 경로 일치를 요구.
- "사람 프롬프트 응답에는 안내문이 없다"는 틀린 전제였다(`promptContext`가 매번 싣는다) → 미정은 끄는 쪽으로 바꿈.
- `codex_runtime`이 SessionStart에만 실려 서비스 재시작 뒤 판정이 끊긴다 → UserPromptSubmit에도 싣는다.
- 버전 검사가 `revalidate`에도 있다 → 두 곳을 함께 바꾼다.
- 검사와 전달이 잠금으로 겹칠 수 있다, 등록 전 버전에서 `hooks/list`용 App Server가 뜬다 → 둘 다 받아들이고 문서에 적음.
