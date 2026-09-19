# Blabee 아키텍처 — arc42-lite

이 디렉터리는 Blabee의 **검증한 커밋 기준 구현(As-Is)** 을 한곳에서 읽기 위한 아키텍처 진입점이다. 2026-09-07 재검증 기준은 커밋 [`a352baa773e11a9be96c9d5b5aafca19aa5fb543`](https://github.com/Hyunwoojooo/biadone/commit/a352baa773e11a9be96c9d5b5aafca19aa5fb543)이며, 작업 트리의 미커밋 변경은 포함하지 않는다. 기준 스냅샷과 증거 성숙도는 [EVIDENCE.md](EVIDENCE.md)에 고정한다.

이 문서군은 실시간 저장소 상태가 아니다. 처음 작성한 2026-09-05 스냅샷에서 바뀐 Plugin 설정, 관리형 자식 종료, 내부 배포 경계를 위 커밋과 다시 대조했다. 자동 시험·설치 기록의 실행 날짜는 문서 재검증일과 구분한다.

문서의 책임은 다음처럼 분리한다.

- **arc42-lite(이 문서)**: 목적, 제약, 품질, 위험을 연결하는 서술과 전체 색인
- **C4**: 시스템·컨테이너·컴포넌트의 정적 구조
- **Sequence / Lifecycle**: 실제 요청 흐름과 상태 전이
- **ADR**: 선택한 구조의 이유, 결과, 남은 trade-off

권장 읽기 순서는 `1 → 3 → 5 → 6 → 9 → 11`이다. 각 그림은 사람이 보는 HTML과 재생성 가능한 Archify JSON을 함께 둔다.

## 1. 소개와 목표

Blabee는 Codex 작업 흐름이 결정 경계에 도달했을 때, macOS Pet에서 근거와 연결된 다음 선택을 보여 주고 사용자가 고른 작업을 **정확히 같은 Codex 세션의 새 사용자 턴**으로 이어 주는 로컬 개발 보조 시스템이다.

핵심 목표는 다음과 같다.

1. 일반 `codex` 사용 의미와 실패 특성을 보존한다.
2. 결정 제안, 사람의 선택, 전달 확인을 서로 다른 증거로 기록한다.
3. 세션·턴·에피소드·패킷·옵션 binding을 검증해 잘못된 선택과 중복 실행을 막는다.
4. 원장과 신뢰 기준을 로컬에 두고 별도 Blabee 추론 백엔드를 요구하지 않는다.
5. 구현 여부, 자동 검증, 실제 설치본 자격, 공개 출시 승인을 혼동하지 않는다.

## 2. 아키텍처 제약

- 제품 UI와 서비스의 1차 플랫폼은 macOS다.
- 현재 에이전트 통합 대상은 Codex이며, Skill·Hook·로컬 MCP를 포함한 Plugin이 기본 통합면이다.
- 기본 `codex` 경로는 Blabee 장애 때문에 차단되면 안 된다. Hook은 제한된 fail-open 계약을 따른다.
- 사용자가 명시적으로 시작한 `blabee-codex` 관리형 경로만 더 좁은 fail-closed 신뢰 계약을 따른다.
- 제품 상태와 결정 원장은 로컬 SQLite·Keychain 경계에 둔다.
- 비밀 token, 원문 continuation token, raw 도구 입력을 Pet·로그·공개 응답으로 확산하지 않는다.
- 현재 As-Is Hook은 `SessionStart`, `UserPromptSubmit`, `Stop`, `PermissionRequest` 네 종류다. `PreToolUse`와 `PostToolUse`는 포함하지 않는다.
- 공개 Developer ID 서명·공증, 깨끗한 다른 Mac 설치 자격, 실제 저장소 롤백은 이 스냅샷의 구현 완료 범위가 아니다.

## 3. 컨텍스트와 범위

정적 시스템 경계는 [C4 L1 시스템 컨텍스트](c4/system-context.html) ([Archify spec](c4/system-context.archify.json))에서 본다.

Blabee의 제품 경계 안에는 Codex Plugin, 로컬 Coordinator, macOS Pet, 인증된 로컬 결정 원장이 있다. 개발자와 Codex CLI/App Server, macOS Keychain은 이 경계와 상호작용하는 actor 또는 외부 시스템이다. 모든 핵심 상호작용은 한 사용자 Mac 안에서 일어나며, Blabee 자체의 클라우드 추론 백엔드는 없다.

범위 밖 항목은 다음과 같다.

- Codex 모델 실행과 Codex 자체의 권한 정책
- 터미널 자동화, OCR, 합성 키 입력을 통한 제어
- 원격 협업·동기화·분석용 Blabee 서버
- 공개 배포용 서명·공증·업데이터 운영

## 4. 해결 전략

Blabee는 다음 전략을 조합한다.

- **Plugin-first ingress**: Hook이 수명 주기 사건을 전달하고 로컬 MCP가 구조화된 결정 제안을 전달한다.
- **단일 Coordinator authority**: operational application이 인증·재조정을 맡고 routing과 semantic application을 호출한다.
- **표시와 권한의 분리**: Pet은 FIFO 선두의 snapshot을 표시하고 exact binding을 포함한 선택만 보낸다.
- **인증된 로컬 원장**: SQLite 이벤트·패킷·검증 기록과 Keychain freshness anchor를 함께 사용한다.
- **정확히 한 번의 연속 진행**: transient token은 프로세스 안에서 소비하고, 비민감 reference envelope를 `queued_next_turn`으로 전달한다. exact `UserPromptSubmit` 재진입에서 원장의 봉인 action을 한 번 claim해 Hook context에 전달한다.
- **경로별 실패 정책**: 일반 Hook은 Codex 지속성을 위해 제한적으로 fail-open하고, MCP·영속 mutation·명시적 관리형 경로는 불확실성을 성공으로 만들지 않는다.
- **증거 분리**: Pet 선택 receipt, transport delivery ack, Codex/App Server 소비, 실제 명령 결과를 각각 구분한다.

## 5. 빌딩 블록 뷰

### 5.1 컨테이너

[C4 L2 컨테이너 뷰](c4/container.html) ([Archify spec](c4/container.archify.json))는 다음 실행 책임을 보여 준다.

- **Blabee Codex Plugin**: Skill, Hook, 로컬 MCP 진입점과 coordinator launcher
- **Coordinator**: 요청 인증, 상태 전이, FIFO routing, 결정 검증, 전달 재조정
- **macOS Pet**: 비활성 패널·메뉴 바 UI, heartbeat, 선두 카드 표시와 선택
- **Decision Journal**: SQLite 기반 이벤트·패킷·검증 원장
- **macOS Keychain**: journal freshness high-water와 무결성 보조 경계
- **Managed Codex bridge**: 명시적 `blabee-codex`에서만 App Server command approval을 중계하는 제한된 경로

### 5.2 Coordinator 컴포넌트

[C4 L3 Coordinator 컴포넌트 뷰](c4/coordinator-components.html) ([Archify spec](c4/coordinator-components.archify.json))는 Coordinator 한 컨테이너를 확대한다.

- UDS transport adapter가 runtime identity와 request namespace를 검사한다.
- Operational application이 고수준 요청과 durable 재조정을 조율한다.
- Routing application이 세션·foreground·FIFO·시간 경계를 소유한다.
- Semantic application이 패킷, 선택, 연속 진행 의미를 검증한다.
- Journal과 freshness store가 crash-safe authority와 anti-rollback 경계를 제공한다.

이 뷰의 UDS는 독립 제품이 아니라 Coordinator의 **transport adapter**다.

같은 제품 실행 파일의 Pet 설정 경로에는 `CodexPluginSetupManager`가 있다. 사용자가 연결·해제·이전 연결 마이그레이션을 선택하면 공식 Codex Plugin CLI를 호출한다. 이전 연결의 마이그레이션은 경로·버전·파일 identity를 묶은 명시적 확인을 다시 검증하며, 일반 연결 동작이 대신 실행하지 않는다. 이는 daemon의 결정 routing이나 관리형 App Server 승인과 별도의 설정 책임이다. [설정 진입과 마이그레이션 조건](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/CodexPluginSetup.swift#L1234-L1362)

## 6. 런타임 뷰

| 시나리오 | 사람이 보는 그림 | 재생성 spec | 핵심 경계 |
|---|---|---|---|
| 결정 제안부터 다음 턴까지 | [결정 연속 진행](runtime/decision-continuation.html) | [JSON](runtime/decision-continuation.sequence.json) | 제안, Pet 선택, queue receipt, 새 `UserPromptSubmit`을 분리 |
| Hook 권한 요청 | [PermissionRequest](runtime/hook-permission.html) | [JSON](runtime/hook-permission.sequence.json) | deny 또는 Codex 직접 결정만; 불확실하면 native defer |
| 명시적 관리형 승인 | [Managed approval](runtime/managed-approval.html) | [JSON](runtime/managed-approval.sequence.json) | 원본 App Server request ID, response write, ack, command outcome 분리 |
| 결정 경계 상태 | [Decision boundary lifecycle](runtime/decision-boundary.html) | [JSON](runtime/decision-boundary.lifecycle.json) | open, seal, waiting, claimed, dispatched, terminal 상태와 실패 폐쇄 |

런타임 그림은 **순서와 상태**를 설명한다. 컨테이너 소유권은 C4, 선택 이유는 ADR을 우선한다.

## 7. 배포 뷰

[C4 로컬 배포·신뢰 경계](c4/local-deployment.html) ([Archify spec](c4/local-deployment.archify.json))는 실제 프로세스, UDS, SQLite, Keychain, 선택적 관리형 child tree의 배치를 보여 준다.

현재 논리 배치는 한 사용자 Mac 안의 로컬 프로세스와 저장소로 구성된다.

```text
Codex CLI / Plugin process
          │ Hook · MCP
          ▼
Unix domain socket ── Coordinator service process ── SQLite journal
          ▲                         │
          │ Pet request             └─────────────── macOS Keychain
     Blabee.app / Pet

명시적 blabee-codex만: private Codex bundle → App Server + TUI child tree
```

UDS peer가 같은 UID라는 사실만으로 신뢰를 완료하지 않는다. 패키지 실행에서는 실행 중 코드와 설치 코드의 CDHash, bundle identifier, 서명으로 보호되는 assembly manifest를 결합한 runtime identity를 operation binding과 함께 검증한다.

내부 DMG는 `build-fresh-internal-dmg.mjs`가 Swift·Contracts·Plugin·Packaging 입력을 private source snapshot으로 묶어 새 scratch에서 빌드한 뒤 조립한다. 명시적 build 번호를 `CFBundleVersion`과 출력 `-rN.dmg`에 맞추고 exact `arm64`를 확인한다. 게시·복구 transaction은 build 번호와 아키텍처, 파일 identity와 checksum을 결합한다. [fresh build와 게시 전 소스 대조](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/scripts/build-fresh-internal-dmg.mjs#L932-L1031), [게시 계약](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/scripts/build-internal-dmg.mjs#L1537-L1584)

2026-09-05 r8 기록에는 한 개발 Mac의 설치와 명시적 서비스 재시작 후 실제 응답을 확인한 제한적 `LIVE` 증거가 있다. 이번 문서 작업에서 재실행한 결과는 아니다. 번들 안의 LaunchAgent plist나 ad-hoc 서명 자체가 자동 시작·공개 배포 승인을 뜻하지 않으며, 깨끗한 다른 Mac, Hook/Pet 왕복, Developer ID·공증·Gatekeeper는 별도 `GATE`다. [r8 설치·서비스 기록과 미실행 범위](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/T012_APP_BUNDLE_REPORT.md#L138-L175)

## 8. 횡단 관심사

### 신뢰와 identity

runtime identity, request type namespace, exact request/response binding을 mutation 전에 검사한다. 관리형 Codex는 검증된 private bundle snapshot과 child lifecycle을 한 신뢰 단위로 다룬다.

Plugin 설정은 별도의 CLI 호환성·실행 파일 신뢰를 검증한다. 한 설정 작업에서 자격 증거를 고정하고 mutation 경계에서 다시 확인하며 공통 monotonic deadline을 검사한다. 이 설정 자격은 관리형 App Server의 bundle/live 자격을 뜻하지 않는다. canonical 경로 검증 뒤 실행까지의 same-UID 교체 가능성은 소스에 남아 있는 제약이다. [설정 trust와 잔여 경계](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/CodexPluginSetup.swift#L711-L742), [작업 deadline](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/CodexPluginSetup.swift#L1648-L1689)

### 일관성과 exactly-once

선택 claim, continuation token 소비, queue delivery, terminal append는 각각 authority를 다시 읽어 재조정한다. commit 여부가 모호하면 성공이나 자동 재시도를 추론하지 않는다.

### 시간과 가용성

Pet heartbeat lease, Hook별 timeout, 관리형 승인 timeout은 process-local monotonic time을 사용한다. daemon 재시작으로 경과를 증명할 수 없는 transient 상태는 복구를 가장하지 않는다.

관리형 broker의 종료는 exact TUI/App Server 자식에 대해 제한된 정리를 수행한다. 종료 상태 통지가 오지 않아도 무기한 대기하지 않으며, 관측된 TUI 종료 결과를 보존한다. 이는 승인 delivery ack나 명령 성공을 추가로 증명하지 않는다. [자식 종료 처리](https://github.com/Hyunwoojooo/biadone/blob/a352baa773e11a9be96c9d5b5aafca19aa5fb543/apps/blabee/src/coordinator-swift/Sources/BlabeeCoordinator/ManagedCodexLauncher.swift#L245-L285)

### 개인정보와 관측성

원문 Stop 메시지, raw command 입력, 비밀 token을 durable journal이나 공개 surface에 넣지 않는다. receipt는 그것이 증명하는 transport 단계만 표현한다.

### 증거 성숙도

이 문서군은 `SOURCE`, `AUTOMATED`, `LIVE`, `GATE`를 사용한다. 정의와 현재 판정은 [EVIDENCE.md](EVIDENCE.md)를 따른다.

## 9. 아키텍처 결정

결정의 이유와 결과는 [ADR 인덱스](adr/README.md)가 소유한다. ADR은 현재 소스에서 역추적한 경우 `Accepted (Retrospective)`로 표시하고, 알 수 없는 최초 결정일이나 검토하지 않은 대안을 만들어내지 않는다.

주요 결정 축은 다음과 같다.

- local-first Codex Plugin 통합
- Native Codex Preservation
- UDS runtime identity와 operation binding
- SQLite journal + Keychain freshness anchor
- `queued_next_turn` 연속 진행과 전달/작업 결과 분리
- 명시적으로 선택하는 관리형 App Server 승인 경로

## 10. 품질 요구사항

| 품질 목표 | 시나리오 | 기대 결과 | 현재 증거 수준 |
|---|---|---|---|
| 네이티브 지속성 | Hook·Coordinator·Pet이 없거나 실패한다 | 일반 Codex가 본래 승인·입출력·종료 의미로 계속된다 | `SOURCE` + `AUTOMATED`; 설치 환경은 별도 `GATE` |
| 안전한 선택 | stale 또는 FIFO 후순위 카드가 선택된다 | mutation과 dispatch 전에 거부한다 | `SOURCE` + `AUTOMATED` |
| 중복 방지 | 전달 결과가 불명확하거나 child가 시작된 뒤 bridge가 실패한다 | 자동 재전송·native 재실행을 하지 않는다 | `SOURCE` + `AUTOMATED`; 설치본 관리형 왕복은 `GATE` |
| 영속 무결성 | DB·key·Keychain anchor가 손실되거나 snapshot이 뒤로 간다 | 새 상태로 조용히 초기화하지 않고 fail-closed한다 | `SOURCE` + `AUTOMATED` |
| 프라이버시 | 결정과 명령을 기록한다 | 비민감 binding만 노출하고 원문 token·raw 입력은 확산하지 않는다 | `SOURCE` + `AUTOMATED` |
| 연속 진행 | Pet이 봉인 action을 선택한다 | 같은 session의 새 turn·episode로 한 번 큐잉하며 receipt와 작업 성공을 분리한다 | `SOURCE` + `AUTOMATED` + 제한된 로컬 `LIVE` |

## 11. 위험과 기술 부채

1. **관리형 App Server 설치본 자격**: 소스와 자동 시험은 있으나, 현재 지원 bundle의 설치본 end-to-end `LIVE` 자격은 별도 게이트다.
2. **Codex 버전 결합**: Hook, queue receipt, App Server wire shape는 버전 의존성이 있어 allowlist와 live qualification을 함께 갱신해야 한다.
3. **배포 신뢰 사슬**: Developer ID, 공증, Gatekeeper, 실제 자동 시작은 아직 공개 배포 완료 근거가 아니다.
4. **Hook 관측 한계**: PermissionRequest에는 원래 PID/창 identity가 없어 정확한 터미널 복귀를 약속할 수 없다.
5. **같은 사용자 경계**: Keychain·서명·runtime identity는 공격면을 줄이지만 same-UID 전체를 절대 신뢰 경계로 만들지는 않는다.
6. **기능 범위 혼동**: 과거 설계의 `Pre/PostToolUse` 및 실제 저장소 rollback을 현재 As-Is로 읽지 않아야 한다.
7. **스냅샷 최신성**: 이 문서군은 고정 커밋을 설명하며 이후 commit이나 미커밋 변경을 자동 추적하지 않는다. 근거 파일 변경 시 다이어그램과 source map을 함께 재검증해야 한다.

## 12. 용어집

| 용어 | 의미 |
|---|---|
| **Decision boundary** | Codex 작업 결과에서 사용자의 다음 선택이 필요한 논리 경계 |
| **Pet** | FIFO 선두 결정·권한 카드를 표시하고 exact 선택을 보내는 macOS UI |
| **Coordinator** | Blabee 상태 전이와 로컬 authority를 소유하는 단일 서비스 |
| **Decision Packet** | 프로젝트·세션·턴·에피소드·revision·옵션에 봉인된 구조화 선택 묶음 |
| **Episode** | 사람 입력 또는 승인된 queued action으로 시작하는 작업 단위 |
| **`queued_next_turn`** | 선택한 action을 같은 Codex session의 새 사용자 turn으로 전달하는 모드 |
| **Native Codex Preservation** | Blabee가 일반 Codex 명령 의미와 실패 특성을 바꾸지 않는 불변 조건 |
| **Runtime identity** | 실행 코드·설치 코드·bundle identifier·manifest를 결합한 UDS 신뢰 식별자 |
| **Delivery ack** | 특정 transport write가 exact binding으로 확인됐다는 증거; 작업 성공은 아님 |
| **Freshness anchor** | 인증된 journal 상태가 과거 snapshot으로 되돌아가지 않았는지 확인하는 Keychain high-water |
| **As-Is** | 이 스냅샷의 소스와 명시된 검증으로 확인한 현재 범위 |
| **To-Be / GATE** | 구현·설치·실사용·배포 승인이 더 필요한 목표 또는 차단 조건 |
