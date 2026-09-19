# Blabee 아키텍처 증거 기준

이 문서는 `docs/architecture/`의 C4, runtime, arc42-lite, ADR이 어떤 코드·문서 스냅샷과 자격 수준을 표현하는지 고정한다. 구조를 읽을 때는 [arc42-lite 인덱스](README.md)로 돌아간다.

## 1. 스냅샷

| 항목 | 값 |
|---|---|
| 기준일 | 2026-09-07 (Asia/Seoul) |
| 저장소 범위 | BiaDone 저장소의 `apps/blabee` 하위 프로젝트 |
| Git branch | `feat/common-lineage-v01-verifier` |
| 검증한 Git HEAD | `a352baa773e11a9be96c9d5b5aafca19aa5fb543` |
| 소스 범위 | **커밋된 Git blob** — 현재 작업 트리의 미커밋 변경·미추적 제품 소스는 제외 |
| graph project | `Users-joo-BiaDone` |
| graph tier | Tier 2 verification |
| graph generation | `2026-09-03T07:16:03Z` |

모든 소스 판정과 source link는 위 커밋에 고정한다. 작업 트리는 dirty이므로 `git show <commit>:<path>`로 커밋된 원문을 읽었다. 이 페이지는 검증 시점의 정적 스냅샷이며 저장소의 이후 변경을 자동 확인하지 않는다. 구조 검증은 실제 제품 실행·설치·공개 배포 자격을 새로 부여하지 않는다.

### 1.1 갱신 이력

- 이전 기준: 2026-09-05 · `b334de1` + 당시 dirty worktree. [이전 근거와 해시 원문](snapshots/2026-09-05-evidence.md)을 보존했다.
- 이번 기준: 2026-09-07 · `a352baa` 커밋만 대조. 기존 ADR의 최초 기록일과 결정 상태는 유지하고 재검증일을 별도로 기록했다.
- `b334de1..a352baa`의 Blabee 변경 파일 29개를 살피고, C4 4개·runtime 4개·ADR 8개의 관련 경계와 source map을 재검증했다. 그래프는 working tree를 반환할 수 있어 커밋 원문과 동일하다고 가정하지 않았다.

| 재검증 영역 | 반영한 내용 |
|---|---|
| Plugin 설정 | 실행 파일 신뢰 재검증, 작업별 단조 deadline, 이전 설치의 파일 identity와 명시적 확인을 재검증 |
| Managed Codex | 소유한 App Server/TUI 자식에 시간 제한이 있는 TERM/KILL 정리, TUI 종료 상태 보존, 자동 재실행 금지 |
| 내부 패키징 | fresh-source 빌드, 명시적 빌드 번호/CFBundleVersion, exact arm64, transaction v2의 빌드·아키텍처 결속 |
| 배포 자격 | r8 한 개발 Mac의 설치·service 복구 기록은 제한된 과거 LIVE로 반영. clean Mac·Hook/Pet·관리형 왕복·공개 배포 게이트는 유지 |
| 결정 시퀀스 교정 | 초기 prompt binding은 process-local, `emit_decision`에서 원자 open/seal, `Stop`에서 sealed → waiting으로 선택 게시 |
| 다음 턴 전달 교정 | queue에는 reference envelope를 전달. exact 재진입에서 journal의 봉인 action을 한 번 claim하여 Hook context로 제공 |
| lifecycle 교정 | exact queue receipt **또는** 기대한 queued-prompt digest의 재진입이 완료 근거. 임의 사용자 입력은 대체 불가 |
| 관리형 시퀀스 교정 | 실제 UDS operation은 `managed_command_approval`; 승인 resolution·delivery claim은 process-local이며 durable journal 기록이 아님. 신뢰 통과 후 첫 자식 전 준비 실패만 fallback 가능 |

시퀀스·전달·lifecycle 교정은 커밋 이후 새로 추가된 기능이라는 뜻이 아니라, 소스 대조에서 발견한 기존 아키텍처 설명의 부정확성을 교정한 것이다.

## 2. 증거 성숙도 어휘

| 표기 | 의미 | 이 표기가 의미하지 않는 것 |
|---|---|---|
| `SOURCE` | 제품 소스, 계약, 설정 또는 현재 문서에 구조와 동작이 존재하며 직접 읽었다 | 실행 성공, 설치 성공, 공개 사용 승인 |
| `AUTOMATED` | 관련 자동 테스트·정적 검증·계약 검증이 존재하고 해당 범위의 결과가 기록되었다 | 실제 Codex/provider 소비, 사람 승인, 다른 Mac 재현 |
| `LIVE` | 특정 로컬 환경과 버전에서 실제 프로세스 왕복 또는 사용자 흐름을 관찰했다 | 일반 지원 범위, 깨끗한 설치, 공개 배포 자격 |
| `GATE` | 설치본·지원 버전·보안·사람 검수·공개 배포 등 별도 통과가 필요한 조건이다 | 실패한 구현 또는 단순 TODO와 동일하다는 뜻 |

한 기능에는 여러 표기가 동시에 붙을 수 있다. 예를 들어 `SOURCE + AUTOMATED + GATE`는 구현과 자동 검증은 있으나 실제 설치본 자격이 아직 남았다는 뜻이다.

## 3. 조사 방법과 한계

- 구조 탐색은 codebase-memory graph의 Tier 2 verification으로 시작했다.
- graph generation은 기준일보다 이르며 worktree가 dirty이므로, graph는 후보 경로와 관계를 찾는 보조 수단으로만 사용했다.
- 의존 경로의 index coverage를 확인했다. metadata_changed·not_tracked·partial은 완전성 근거로 사용하지 않고 커밋된 Git blob의 관련 범위와 diff로 보완했다.
- 주요 변경 파일과 source map의 행 범위를 pinned Git blob에서 확인했다. `UnixDomainSocketTransport.swift`, `CoordinatorRoutingApplication.swift` 등 reported partial 범위도 직접 확인했다. schema/행 범위 검사는 의미적 정확성이나 제품 실행 성공을 대신하지 않는다.
- clean coverage는 **기록된 gap이 없다는 뜻**이지, 인덱스가 저장소 전체의 의미를 완전하게 증명한다는 뜻이 아니다.
- 문서와 테스트의 과거 `LIVE` 기록은 당시 환경의 관찰 근거다. 현재 설치본 또는 현재 Codex 버전 자격으로 자동 승격하지 않았다.
- 이번 작업은 `docs/architecture/`의 문서·도식·포털만 수정했다. 제품 소스·설치 상태·Git index는 변경하지 않았으며 제품 테스트나 LIVE 검증을 새로 실행하지 않았다.

## 4. 현재 As-Is 판정

| 영역 | 현재 판정 | 성숙도 | 근거 요약 |
|---|---|---|---|
| 일반 Codex 통합 | Skill + 네 종류 Hook + 로컬 MCP가 Coordinator로 연결됨 | `SOURCE` + `AUTOMATED` | Hook 장애는 제한된 fail-open, MCP 오류는 fail-closed |
| Coordinator | 단일 UDS owner가 operational, routing, semantic application을 조율 | `SOURCE` + `AUTOMATED` | request namespace/runtime identity 검사 후 mutation |
| Pet | heartbeat lease, FIFO 선두 snapshot, exact 선택 binding을 사용 | `SOURCE` + `AUTOMATED` | 후순위·stale 카드 선택 거부 |
| 로컬 원장 | SQLite authenticated journal + Keychain freshness anchor | `SOURCE` + `AUTOMATED` | 저장소 손실·rollback ambiguity를 조용히 초기화하지 않음 |
| 결정 연속 진행 | 참조 envelope를 같은 session의 `queued_next_turn`으로 전달하고 exact 재진입에서 봉인 action을 1회 claim | `SOURCE` + 과거 `AUTOMATED` + 제한된 `LIVE` | exact receipt 또는 exact 재진입은 전달 근거이며 새 turn outcome은 별도 증거 |
| Hook PermissionRequest | 짧은 안전 단일 행 Bash에 deny/direct-decision만 제공 | `SOURCE` + `AUTOMATED` | Hook `allow`를 만들지 않으며 불확실하면 Codex로 반환 |
| 관리형 App Server | 명시적 `blabee-codex`의 command approval bridge가 소스와 자동 시험에 존재 | `SOURCE` + `AUTOMATED` + `GATE` | **현재 설치본 live 왕복 자격은 pending** |
| 내부 패키징·설치 | fresh-source arm64 내부 DMG와 r8 설치·service 복구 기록 | `SOURCE` + 과거 `AUTOMATED` + 제한된 과거 `LIVE` | 한 개발 Mac의 기존 기록이며 이번 작업에서 실행하지 않음; 추가 실환경·공개 배포는 `GATE` |
| 추론 | 결정 내용은 Codex 결과를 사용하며 Blabee cloud inference backend 없음 | `SOURCE` | 별도 Blabee LLM API/service를 아키텍처에 두지 않음 |

## 5. As-Is가 아닌 항목

다음 항목은 그림에 구현 완료 요소로 넣지 않는다.

| 항목 | 분류 | 이유 |
|---|---|---|
| `PreToolUse` / `PostToolUse` 근거 수집 | To-Be / 제외 | 초기 개념도에는 등장하지만 현재 T-011 Plugin Hook 구성에 포함되지 않음 |
| 실제 사용자 저장소 rollback 실행 | To-Be / 제외 | 정책·계약 서술과 실제 복원 동작을 구분하며 이번 As-Is 범위에서 구현 완료로 주장하지 않음 |
| Developer ID 서명·공증·Gatekeeper 공개 배포 | `GATE` | ad-hoc/local 산출물과 공개 신뢰 사슬은 별도 |
| clean Mac의 service·로그인 수명과 제품 왕복 | `GATE` | 한 개발 Mac의 r8 설치·service 복구는 기록됐지만 다른 Mac·Hook/Pet·관리형 승인 전체의 자격은 아님 |
| 관리형 App Server 설치본 end-to-end | `GATE` | source/automated 자격과 installed live dogfood를 분리 |
| Blabee cloud inference backend | 범위 밖 | 현재 local-first 구조에 존재하지 않음 |
| same-UID 전체를 포괄하는 절대 신뢰 | 주장 금지 | Keychain·서명·runtime identity는 방어 계층이며 동일 사용자 환경 전체를 완전 신뢰로 만들지 않음 |

## 6. 소스 맵

아래 제품 소스 링크는 `a352baa`의 Git blob에 고정한다. 현재 working tree와 달라질 수 있다. 과거 설계 문서와 실제 구현이 충돌한 queue payload·봉인 시점은 아래 구현 코드를 우선한다.

| 관심사 | 근거 |
|---|---|
| 제품 결정, local-first, Native Codex Preservation, 관리형 경로 경계 | [TECH_SPEC.md:L26-L45](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L26-L45) |
| MVP 구조와 현재 T-011 Hook 범위 | [TECH_SPEC.md:L59-L112](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L59-L112) |
| runtime identity와 exact operation 제한 | [TECH_SPEC.md:L118-L146](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L118-L146) |
| `queued_next_turn`, MCP, PermissionRequest, Stop | [TECH_SPEC.md:L174-L226](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L174-L226) |
| 관리형 App Server 의미와 서로 다른 receipt | [TECH_SPEC.md:L635-L705](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/TECH_SPEC.md#L635-L705) |
| Swift 제품 모듈 배치 | [CODEMAP.md:L140-L205](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/CODEMAP.md#L140-L205) |
| 연속 진행과 관리형 승인 흐름 | [CODEMAP.md:L455-L535](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/CODEMAP.md#L455-L535) |
| As-Is 지원·미자격 요약 | [CODEMAP.md:L585-L610](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/CODEMAP.md#L585-L610) |
| PermissionRequest 후속 계약 | [IMPLEMENTATION_PLAN.md:L52-L71](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/IMPLEMENTATION_PLAN.md#L52-L71) |
| journal, Keychain, `queued_next_turn`, 지원 버전 gate | [IMPLEMENTATION_PLAN.md:L103-L117](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/IMPLEMENTATION_PLAN.md#L103-L117) |
| 실제 네 종류 Plugin Hook 설정 | [Plugin/blabee/hooks/hooks.json:L1-L56](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/Plugin/blabee/hooks/hooks.json#L1-L56) |
| Coordinator 고수준 operation과 두 승인 경로 | [src/coordinator-swift/README.md:L168-L226](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/README.md#L168-L226) |
| native/managed 경로와 App Server 설치본 gate | [src/coordinator-swift/README.md:L239-L312](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/README.md#L239-L312) |
| UDS runtime identity | [src/coordinator-swift/README.md:L363-L395](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/README.md#L363-L395) |
| SQLite·Keychain 무결성 경계 | [src/coordinator-swift/README.md:L468-L490](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/README.md#L468-L490) |
| 관리형 Codex 신뢰 원칙 | [MANAGED_CODEX_TRUST.md:L7-L18](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/docs/MANAGED_CODEX_TRUST.md#L7-L18) |
| private bundle 실행·fallback 순서 | [MANAGED_CODEX_TRUST.md:L53-L84](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/docs/MANAGED_CODEX_TRUST.md#L53-L84) |
| 정적 Doctor와 live qualification 분리 | [MANAGED_CODEX_TRUST.md:L105-L129](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/docs/MANAGED_CODEX_TRUST.md#L105-L129) |
| 관리형 완료 기준 | [MANAGED_CODEX_TRUST.md:L138-L148](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/docs/MANAGED_CODEX_TRUST.md#L138-L148) |
| operational dispatch entry | [CoordinatorOperationalApplication.swift:L539-L650](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L539-L650) |
| routing application | [CoordinatorRoutingApplication.swift:L106-L190](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorRoutingApplication.swift#L106-L190) |
| semantic application | [CoordinatorSemanticApplication.swift:L79-L170](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorSemanticApplication.swift#L79-L170) |
| authenticated SQLite journal | [SQLiteJournal.swift:L46-L130](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/SQLiteJournal.swift#L46-L130) |
| Keychain freshness store | [KeychainFreshnessAnchorStore.swift:L5-L80](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/KeychainFreshnessAnchorStore.swift#L5-L80) |
| Pet state/UI adapter | [PetViewModel.swift:L89-L180](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/PetViewModel.swift#L89-L180) |
| runtime identity와 UDS client/server | [UnixDomainSocketTransport.swift:L23-L120](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/UnixDomainSocketTransport.swift#L23-L120), [L608-L780](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/UnixDomainSocketTransport.swift#L608-L780) |
| 관리형 approval selection과 delivery ack | [ManagedCodexApprovalRuntime.swift:L118-L243](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/ManagedCodexApprovalRuntime.swift#L118-L243) |
| App Server wire adapter | [CodexAppServerApprovalAdapter.swift:L128-L230](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/CodexAppServerApprovalAdapter.swift#L128-L230) |

### 6.1 이번 갱신의 직접 구현 근거

| 관심사 | 고정 커밋 근거 |
|---|---|
| Plugin 이전 설치 확인·identity | [CodexPluginSetup.swift:L1331-L1362](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/CodexPluginSetup.swift#L1331-L1362) |
| Plugin 작업별 deadline·실행 파일 자격 | [CodexPluginSetup.swift:L1648-L1689](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/CodexPluginSetup.swift#L1648-L1689) |
| 관리형 자식 정리·종료 상태 | [ManagedCodexLauncher.swift:L245-L285](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/ManagedCodexLauncher.swift#L245-L285), [L1699-L1729](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/ManagedCodexLauncher.swift#L1699-L1729) |
| DMG 빌드 번호·앱 검증 | [build-internal-dmg.mjs:L1410-L1486](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/scripts/build-internal-dmg.mjs#L1410-L1486) |
| exact arm64·transaction 게시 | [build-internal-dmg.mjs:L1537-L1584](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/scripts/build-internal-dmg.mjs#L1537-L1584) |
| 현재 지원 fresh-source 생성 절차 | [INTERNAL_DMG_PACKAGING.md:L47-L82](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/INTERNAL_DMG_PACKAGING.md#L47-L82) |
| r8 기존 LIVE와 공개 배포 한계 | [T012_APP_BUNDLE_REPORT.md:L120-L175](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/T012_APP_BUNDLE_REPORT.md#L120-L175) |
| 초기 prompt process-local binding | [CoordinatorOperationalApplication.swift:L1276-L1301](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L1276-L1301) |
| emit_decision 원자 봉인 | [L1468-L1485](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L1468-L1485), [L3243-L3293](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L3243-L3293) |
| Stop 대기 게시 | [L2848-L2853](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L2848-L2853) |
| 참조값 queue·재진입 완료·action claim | [L3041-L3066](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L3041-L3066), [L1200-L1217](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L1200-L1217), [L3542-L3657](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/CoordinatorSwift/CoordinatorOperationalApplication.swift#L3542-L3657) |

## 7. 아키텍처 산출물 맵

| 관점 | Archify source | HTML 산출물 |
|---|---|---|
| C4 L1 시스템 컨텍스트 | [system-context.archify.json](c4/system-context.archify.json) | [system-context.html](c4/system-context.html) |
| C4 L2 컨테이너 | [container.archify.json](c4/container.archify.json) | [container.html](c4/container.html) |
| C4 L3 Coordinator 컴포넌트 | [coordinator-components.archify.json](c4/coordinator-components.archify.json) | [coordinator-components.html](c4/coordinator-components.html) |
| 로컬 배포·신뢰 경계 | [local-deployment.archify.json](c4/local-deployment.archify.json) | [local-deployment.html](c4/local-deployment.html) |
| 결정 연속 진행 sequence | [decision-continuation.sequence.json](runtime/decision-continuation.sequence.json) | [decision-continuation.html](runtime/decision-continuation.html) |
| Hook 권한 sequence | [hook-permission.sequence.json](runtime/hook-permission.sequence.json) | [hook-permission.html](runtime/hook-permission.html) |
| 관리형 승인 sequence | [managed-approval.sequence.json](runtime/managed-approval.sequence.json) | [managed-approval.html](runtime/managed-approval.html) |
| 결정 경계 lifecycle | [decision-boundary.lifecycle.json](runtime/decision-boundary.lifecycle.json) | [decision-boundary.html](runtime/decision-boundary.html) |

## 8. Archify receipt와 해시

<!-- ARCHIFY_RECEIPTS_START -->

| 산출물 | spec SHA-256 | HTML SHA-256 | showcase validation receipt | visual review |
|---|---|---|---|---|
| `c4/system-context` | `387e92a837830abd1e30da0bec50ae9d8e659e8ec2ca6de760de3adf07aa7e8d` | `75925564567d24c8fb62d49b2fd5b4c8c662d4e297784510951281833152e8c4` | 9/9 · showcase PASS · 0 errors / 0 warnings | 4/4 viewport · capture PASS · 수동 검토 PASS |
| `c4/container` | `68111e6e06a14edb1614b9b0db500576a98dc3c7422d05e89cabd2d25ff76143` | `1cab3129503539b3c98c63f272cbccd192a3e8d9d01d4df20861616936f7e9a0` | 9/9 · showcase PASS · 0 errors / 0 warnings | 4/4 viewport · capture PASS · 수동 검토 PASS |
| `c4/coordinator-components` | `f7441767c3c1c652414e02ad34b7ede6c2cf98d4c4d224c1e33fd954d563fb06` | `61933dacf9f31d5db1956bbed1c3dee176cfc427883451a50674d120bdbb2327` | 9/9 · showcase PASS · 0 errors / 0 warnings | 4/4 viewport · capture PASS · 수동 검토 PASS |
| `c4/local-deployment` | `672e68961f44382e7612b547bdf4803a533dd130a7001f47da2f3bce8cd067ae` | `4d5cd10fc08e523136950b0923bc200aff53c92ff9e4a0bb8ea9e4b9016b0e3f` | 9/9 · showcase PASS · 0 errors / 0 warnings | 4/4 viewport · capture PASS · 수동 검토 PASS |
| `runtime/decision-continuation` | `0fedb7cacb2e94efc0ee4c7bc14bb8fa9f8569b457b289dc965f0b7a77150865` | `a63f73b82b35852f6c0f5b150722b88eda8aa87eaba75d2b7965c0015f43d3b5` | 9/9 · showcase PASS · 0 errors / 0 warnings | 4/4 viewport · capture PASS · 수동 검토 PASS |
| `runtime/hook-permission` | `691069215206706a1d8a27a241e1673c832e6a28f5b7bc53306f88f666756cb8` | `6c3082063d49786b5a2ba175a1f1a366ab098e8826e228feb7c8333d3f086de9` | 9/9 · showcase PASS · 0 errors / 0 warnings | 4/4 viewport · capture PASS · 수동 검토 PASS |
| `runtime/managed-approval` | `11544e2249846437c5fbbfb5b0ddc542f85aae6aeb23f8529415d9447b1f5bde` | `e0f55ee0c7ce6a2de34ccd950d7bfcd74d5008abac41ddd494023521abae4c62` | 9/9 · showcase PASS · 0 errors / 0 warnings | 4/4 viewport · capture PASS · 수동 검토 PASS |
| `runtime/decision-boundary` | `e538ed9200692c3b8551df74d15edcd3ee22e8c53088270f90fdb8e3c44c7cd7` | `8851be0aa2fcd937f9f5f7ac3f98c96b3a2845d629c27e0bb304b5b96b687676` | 9/9 · showcase PASS · 0 errors / 0 warnings | 4/4 viewport · capture PASS · 수동 검토 PASS |

<!-- ARCHIFY_RECEIPTS_END -->

validator 결과와 visual-check 결과는 분리한다. 위 해시는 2026-09-07 `deliver`가 검증한 최종 spec·HTML 바이트다.

- 자동 검증: 도식 8개 각각 showcase 9/9, 오류 0·경고 0. `visual-check` containment는 1440×900, 1600×1000, 1920×1080, 2048×1320 네 viewport에서 모두 PASS.
- 캡처: 도식마다 1440×900·2048×1320의 light/dark PNG 4개를 생성했다. 최종 HTML 해시와 각 visual-check receipt의 해시가 일치한다.
- 수동 화면 검토: 도식 8개의 **2048×1320 light/dark 캡처 16개**를 열어 제목·라벨·연결선·범례의 잘림과 겹침을 확인했다. 이 범위에서 발견된 잔여 시각 결함은 없다.
- 레이아웃 correction rounds: lifecycle 라벨 간격 1회, 나머지 도식 0회. 소스 대조에 따른 내용 교정과 구분한다.
- `*.visual-check.json`의 `visualReview: pending`은 자동 도구가 수동 판정을 기록하지 않는다는 뜻이다. 원본 receipt를 고쳐 PASS로 바꾸지 않으며 수동 검토 결과는 이 문서에 별도로 기록한다.

## 9. 포털 검증과 잔여 경계

- 실제 CSS viewport 390×844, 768×1024, 1440×900에서 첫 화면의 스냅샷 안내가 보이고 페이지 가로 넘침이 없음을 확인했다.
- 공통 근거 링크의 Evidence 이동, runtime iframe 로딩, light/dark 연동, ADR-0006 검색·해당 결정 펼침, 모바일 메뉴의 열기·이동·닫기를 브라우저에서 확인했다.
- 콘솔에는 Adobe Chrome 확장 프로그램의 ReferenceError와 출처를 단정하지 않은 비동기 listener 채널 종료 메시지가 있었다. 이를 포털 오류 0건의 근거로 숨기거나 제품 결함으로 단정하지 않았다. 검증한 화면·동작에는 중단이 없었다.
- 정적 검사 PASS: 고정 커밋 소스 참조 155개(31개 파일)의 경로·행 범위, 로컬 링크 127개, 포털 inline JavaScript 1개의 구문, 도식 8개의 spec·HTML·receipt 해시 일치를 확인했다. 이 수치는 구조·구문의 검증이며 의미 검토와 별도다.
- 제품 작업 트리 연속성은 별도 관찰이다. 작업 시작 시 기록한 tracked 제품 파일 125개 중 아래 4개가 종료 시점 대조에서 달라졌다. 이번 작업은 이 파일들을 편집하지 않았고 현재 변경을 보존했다. 문서의 기준은 계속 고정 커밋이며 작업 트리 전체가 불변이었다고 주장하지 않는다.
  - `src/coordinator-swift/Sources/BlabeeCoordinator/CodexQueueNextTurnDispatcher.swift`
  - `src/coordinator-swift/Sources/BlabeeCoordinator/PetTransport.swift`
  - `src/coordinator-swift/Tests/BlabeePetTests/PetPlatformPolicyTests.swift`
  - `src/coordinator-swift/Tests/BlabeePetTests/PetTransportConcurrencyTests.swift`
- 제품 런타임·실제 설치·현재 Codex App Server 왕복은 이번 문서 갱신의 검증 범위가 아니다. 커밋·푸시·배포는 하지 않았다.
