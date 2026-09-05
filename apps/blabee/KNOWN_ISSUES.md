# Blabee 알려진 오류 및 안정성 이슈

- 최초 작성: 2026-09-02 (KST)
- 마지막 갱신: 2026-09-05 (KST)
- 문서 상태: 활성
- 검토 기준: `a85d34be66f57304014fdf83d21044c6c2827f38` 위 현재 미커밋 작업 트리
- 범위: 아직 해결되지 않았거나 배포 전 재검증이 필요한 Blabee 제품 오류와 안정성 위험

## 문서 목적

이 문서는 Blabee 개발과 도그푸딩, 다른 사용자 PC 검증에서 발견한 오류를 한곳에 기록한다.
각 항목은 관찰된 증상과 추정 원인을 구분하고, 임시 대응을 근본 해결로 오해하지 않도록
완료 기준까지 함께 관리한다.

해결된 항목도 삭제하지 않는다. 상태를 `해결됨`으로 변경하고 수정 커밋, 검증 환경과
재현 결과를 남긴다.

## 상태와 심각도

### 상태

| 상태 | 의미 |
|---|---|
| `열림` | 문제가 확인됐지만 수정이 완료되지 않음 |
| `조사 중` | 증상은 확인했으나 생성 경로나 근본 원인이 아직 확정되지 않음 |
| `수정 예정` | 수정 방향과 완료 기준이 정해짐 |
| `수정 중` | 구현이 진행 중 |
| `검증 중` | 구현은 끝났지만 자동·실사용 검증이 남음 |
| `해결됨` | 수정과 요구된 검증이 모두 완료됨 |
| `보류` | 현재 범위 밖이며 보류 이유가 기록됨 |

### 심각도

| 심각도 | 기준 |
|---|---|
| `치명적` | 사용자 데이터 손상, 권한 우회 또는 광범위한 실행 불능 가능성 |
| `높음` | 핵심 기능이 동작하지 않거나 원래 Codex 사용을 방해할 가능성 |
| `중간` | 일부 환경이나 기능에서 실패하지만 안전한 대체 경로가 존재함 |
| `낮음` | 제한적인 사용성·관찰성 문제 또는 우회 가능한 결함 |

## 현재 이슈 요약

| ID | 최초 확인일 | 심각도 | 상태 | 요약 |
|---|---|---:|---|---|
| `BLB-RUNTIME-001` | 2026-09-01 | 높음 | 검증 중 | 관리형 Codex가 본체 한 파일만 고정해 `codex-code-mode-host`가 누락됨 |
| `BLB-RUNTIME-002` | 2026-09-01 | 높음 | 검증 중 | 다른 버전 또는 빌드의 host 혼입으로 IPC 스키마 불일치 발생 |
| `BLB-RUNTIME-003` | 2026-09-02 | 중간 | 검증 중 | 비정상 종료 staging 회수의 원자성·경계·starvation 위험 |
| `BLB-DEPLOY-001` | 2026-09-01 | 높음 | 조사 중 | pull한 소스와 실제 설치·실행 중인 Blabee 빌드가 다른 정황 |
| `BLB-DIAG-001` | 2026-09-01 | 높음 | 검증 중 | Doctor가 본체 버전만 확인하고 host 및 실제 code-mode 동작을 확인하지 않음 |
| `BLB-DIST-001` | 2026-09-02 | 높음 | 수정 예정 | 새 사용자 PC의 원클릭 설치와 지원 환경 자격 시험이 아직 완료되지 않음 |
| `BLB-CLEANUP-001` | 2026-09-01 | 중간 | 조사 중 | 구형 영구 runtime 경로의 소유권을 증명할 수 없어 자동 정리가 위험함 |
| `BLB-ROTATION-001` | 2026-09-02 | 높음 | 검증 중 | 열린 Codex 세션 중 Plugin·service 교체 시 Hook과 prompt authority가 끊김 |
| `BLB-PLUGIN-001` | 2026-09-03 | 중간 | 검증 중 | Plugin 검사와 공식 Codex CLI 변경 사이의 짧은 same-user 경쟁 구간 |
| `BLB-PLUGIN-002` | 2026-09-04 | 중간 | 검증 중 | 구형 Plugin만 제거된 부분 마이그레이션이 재시도 불가능한 충돌로 고정됨 |
| `BLB-PLUGIN-003` | 2026-09-04 | 중간 | 검증 중 | 한 연결 작업에서 Codex 전체 hash와 자격 검사를 반복해 과도한 I/O가 발생함 |
| `BLB-PACKAGE-001` | 2026-09-03 | 낮음 | 검증 중 | 실패 staging 격리 후 경로 기반 재귀 정리의 짧은 same-user 경쟁 구간 |
| `BLB-PACKAGE-002` | 2026-09-04 | 중간 | 검증 중 | 오래된 바이너리·혼합 시점 소스 포장과 특수 파일 교체로 빌드가 멈출 수 있음 |
| `BLB-SERVICE-001` | 2026-09-05 | 높음 | 검증 중 | ad-hoc 앱 교체 뒤 기존 launch constraint가 새 service 실행을 거부할 수 있음 |
| `BLB-PET-001` | 2026-09-03 | 중간 | 해결됨 | 설정 상태 새로고침과 변경 작업이 겹치면 오래된 상태·오류가 UI를 덮을 수 있었음 |
| `BLB-QA-001` | 2026-09-03 | 중간 | 해결됨 | 반복 테스트에서 전역 Hook·SQLite·bridge 자원의 수명주기가 다른 테스트에 영향을 줄 수 있었음 |

---

## BLB-SERVICE-001 — ad-hoc 앱 업데이트 뒤 background service 실행 거부

- 최초 확인: 2026-09-05
- 기록일: 2026-09-05
- 심각도: 높음
- 상태: 검증 중
- 근거 수준: 설치된 r5/r6, `launchctl print`, unified log, 코드서명과 Apple 문서를 대조함

### 증상

`CFBundleIdentifier`와 `CFBundleVersion=1`이 같은 r5 ad-hoc 앱을 r6로 교체한 뒤
`SMAppService.status`는 enabled였지만 service socket이 생성되지 않았다. launchd는
`OS_REASON_CODESIGNING`, `Launch Constraint Violation`, `needs LWCR update`를
보고했고 job은 실행되지 않았다. 같은 r6 실행 파일을 foreground에서 시작하면 service
자체는 정상 기동했으므로, 제품 설정보다 등록된 코드 제약과 새 ad-hoc code identity의
불일치가 가장 강한 원인이다.

### 원인과 경계

ad-hoc 서명의 designated requirement는 안정적인 인증서 identity가 아니라 특정 코드
내용에 묶일 수 있다. 내용이 바뀐 r6의 CDHash는 r5와 다르다. 수동
`launchctl bootout`은 `SMAppService.unregister()` 완료와 같은 등록 제거 증거가 아니며,
`.enabled`도 실제 실행 중이 아니라 실행 자격만 뜻한다.

`CFBundleVersion`을 증가시키는 것은 필수 빌드 위생이지만, 그것만으로 LWCR 갱신을
보장한다는 Apple 근거는 없다.

### 수정과 완료 기준

- fresh 내부 DMG에 명시적 전역 증가 build number를 필수화하고 파일명 `rN`, staging
  `CFBundleVersion`, 조립·mount 검증 결과를 exact 일치시킨다.
- ad-hoc 업데이트 가이드를 구버전 앱의 `SMAppService.unregister()` 완료 → 앱 종료 →
  새 번들 전체 교체 → 더 큰 build 확인 → 새 앱에서 register → 실제 socket 확인 순서로
  고정한다.
- 정상 업데이트 흐름에서 raw `launchctl`과 `sfltool resetbtm`을 사용하지 않는다.
- 현재 Mac에서 새 산출물이 clean registration 뒤 실제 service request에 응답해야 한다.
- 공개 배포 전에는 stable Apple-issued signing identity와 지원 macOS별 업데이트 시험을
  별도로 통과해야 하며, ad-hoc 결과를 seamless upgrade 승인으로 쓰지 않는다.

2026-09-05 소스에서는 서비스 transport 오류와 `SMAppService` 등록 상태를 UI에서
분리했다. transport가 끊겼다는 이유만으로 등록 상태를 추정하거나 자동 재등록하지 않고,
등록됐지만 응답이 없으면 `실행 확인 필요`로 안내한다. build number `8`과 exact `arm64`를
봉인한 r8 내부 후보도 생성·검증했다. r8을 `/Applications`에 설치한 첫 service 시작은
`OS_REASON_CODESIGNING` 뒤 `Unable to get updated LWCR... Invalid argument`로 실패했다.
앱의 명시적 서비스 재시작은 unregister/re-register를 수행해 새 BTM UUID를 만들었고,
이후 launchctl running과 실제 service 응답을 확인했다. 설정에는
`operational_socket_unavailable`이 남지 않았다. 이는 ad-hoc 내부 업데이트의 로컬 복구
증거이며 근본적인 공개 업데이트 identity 해결은 아니다.

---

## BLB-ROTATION-001 — 열린 세션 중 Blabee 교체로 Hook authority 유실

- 최초 확인: 2026-09-02
- 기록일: 2026-09-02
- 심각도: 높음
- 상태: 검증 중
- 근거 수준: 현재 세션 log·프로세스·Plugin cache·journal과 소스로 확인됨

### 증상

열린 Codex 세션이 구 Plugin을 사용 중인 상태에서 구 Plugin을 제거하고 새 service를
시작하면 다음 두 현상이 발생한다.

- 구 cache의 Hook 파일이 없어져 이후 prompt에 Blabee context가 주입되지 않는다.
- 교체 전 Hook context로 `emit_decision`을 호출해도 새 service에는 process-local
  prompt binding이 없어 거부된다.

이전 runtime identity allowlist는 구 MCP 요청을 새 UDS server까지 전달할 뿐, 사라진
Hook 파일이나 process-local prompt binding을 복구하지 않는다.

### 2026-09-02 수정 현황

- dogfood 산출물에 읽기 전용 `blabee-rotation-preflight`와 변경 전용
  `blabee-rotation` wrapper를 추가했다. 기본 runbook은 raw 제거 명령을 노출하지 않는다.
- 모든 dogfood root가 사용자 단위 공유 lease를 사용하고, plugin·marketplace·output root
  변경은 lease 획득과 사전 점검이 성공한 같은 wrapper 안에서만 실행한다.
- 활성 Codex, MCP, service, Pet 또는 구 Plugin cache 참조가 있거나 process snapshot을 읽지
  못하면 교체를 보류한다. foreground service와 Pet은 사용자가 먼저 종료한다.
- malformed lease는 자동 삭제하지 않으며, PID와 canonical process start-time으로 기존
  소유자가 사라졌음이 확인될 때만 stale lease를 회수한다.
- 사전 점검은 프로세스를 종료하지 않고 PID와 종류만 보고한다.
- 예상하지 못한 restart, stale wrapper 또는 알 수 없는 session으로 context를 찾지 못하면 내부
  `proposal_session_context_missing`으로 분류하고 journal write 없이 거부한다.
- 공개 응답은 세션 존재 여부를 추측할 수 없도록 다른 binding mismatch와 같은
  `decision_context_invalid_or_expired`를 사용한다.
- 저장소와 그 밖의 내부 오류는 `coordinator_unavailable_or_rejected`로 숨겨 binding 오류와
  구분하되, 어떤 session이 존재하는지는 공개하지 않는다.

### 남은 작업

`Contracts/v1`에는 decision boundary 이전 prompt binding event가 없고 SQLite v1도
exact-schema라, 안전한 영속 복구는 v1에 억지로 추가하지 않는다. 장기 설계와 migration
조건은 [PROMPT_BINDING_RESTART_V2.md](src/coordinator-swift/docs/PROMPT_BINDING_RESTART_V2.md)에
기록한다.

일반/native Codex는 Blabee 공유 lease에 참여하지 않으므로 process snapshot 직후 새로
시작되는 짧은 경쟁 구간은 남는다. Codex 자체를 변경하지 않는 제품 원칙상 v1에서는 이
한계를 명시하고, 불확실한 상태와 malformed lease는 항상 수동 점검으로 보낸다.

### 완료 기준

- 활성 구 세션이 있는 실제 교체 시도에서 어떤 cache·service·Plugin도 변경되지 않는다.
- 모든 구 세션 종료 후 새 세션이 최신 Hook을 로드한다.
- daemon crash 뒤 구 proposal은 통합 invalid-or-expired 오류와 journal 무변경으로 종료된다.
- Contracts/v2에서는 정확한 prompt binding이 restart 뒤 복구되고 replay·response-loss에도
  boundary와 packet이 중복 생성되지 않는다.

---

## BLB-RUNTIME-001 — 관리형 Codex 런타임 번들 불완전

- 최초 확인: 2026-09-01
- 기록일: 2026-09-02
- 심각도: 높음
- 상태: 검증 중
- 근거 수준: 현재 소스와 다른 사용자 PC의 실제 오류로 확인됨

### 증상

다른 사용자 PC에서 Blabee 관리형 Codex 0.152.0을 다음 경로로 실행했다.

```text
~/Library/Application Support/Blabee/codex/0.152.0/codex
```

텍스트 응답과 Hook 감지는 동작했지만 로컬 명령, 파일 수정 등 code-mode 도구 호출은
다음 오류로 실패했다.

```text
failed to spawn code-mode host
~/Library/Application Support/Blabee/codex/0.152.0/codex-code-mode-host:
No such file or directory (os error 2)
```

### 확인된 원인

장애가 발생한 당시의 [ManagedCodexTrust.swift](src/coordinator-swift/Sources/BlabeeCoordinator/ManagedCodexTrust.swift)는
검사한 `codex` 실행 파일 하나만 비공개 임시 디렉터리로 복사했다. 공식 Codex package는
`codex`, `codex-code-mode-host`, `codex-path/rg`, package manifest와 플랫폼별 리소스를
하나의 런타임으로 제공한다.

Codex는 기본적으로 현재 실행 중인 `codex`와 같은 `bin` 디렉터리에서
`codex-code-mode-host`를 찾는다. 따라서 본체만 다른 디렉터리로 옮기면 해당 버전의
code-mode가 동반 host를 요구하는 순간 도구 실행이 실패한다.

참고:

- [공식 Codex package 구조](https://github.com/openai/codex/blob/main/scripts/codex_package/README.md)
- [공식 code-mode host 탐색 코드](https://github.com/openai/codex/blob/main/codex-rs/code-mode/src/remote_session.rs)
- [관리형 Codex 신뢰 경계](src/coordinator-swift/docs/MANAGED_CODEX_TRUST.md)

### 영향

- 관리형 Codex 로컬 명령 실행 실패
- 파일 읽기·수정 및 패치 실패
- 빌드·테스트·프로세스 확인 실패
- 해당 세션 안에서 도구를 이용한 자기 복구 불가
- Hook 감지 성공만으로 전체 시스템을 정상으로 오판할 가능성

모든 Codex 도구가 항상 같은 host를 사용한다고 일반화하지 않는다. 위 영향은 해당 PC와
관리형 code-mode 경로에서 실제 관찰한 범위다.

### 임시 대응

- 불완전한 관리형 runtime을 사용하지 않는다.
- 다른 버전의 host를 임의로 복사하지 않는다.
- 긴급 사용 시 공식 설치된 native `codex`를 직접 실행한다.
- Blabee는 native Codex의 설치 파일, PATH, `.zshrc`, argv 또는 환경을 자동 변경하지 않는다.

### 근본 수정

단일 `ManagedCodexPinnedExecutable`을 폐쇄형 manifest 기반의
`ManagedCodexPinnedRuntimeBundle`로 교체한다.

관리형 호출마다 다음 전체 구조를 같은 공식 배포본에서 검사하고 process-local private
runtime으로 원자 복사한다.

```text
codex-package.json
bin/codex
bin/codex-code-mode-host
codex-path/rg
codex-resources/...
```

복사 전후 source identity와 digest를 확인하고 App Server, TUI, 보조 세션, 첫 자식 전
fallback이 모두 같은 private runtime을 사용하도록 한다.

### 2026-09-02 수정 현황

- production launcher와 Doctor가 같은 bounded runtime inspector를 사용한다.
- manifest, 본체, sibling host, `rg`, optional resources를 하나의 package로 검사한다.
- 동일 Team ID·version만으로 신뢰하지 않고 full-bundle canonical fingerprint를 닫힌
  production catalog와 비교한다. 현재 등록 대상은 official `0.151.0` Apple Silicon뿐이다.
- descriptor 기반 private staging copy, source/destination 재검증, seal과 atomic publish를
  구현했다.
- App Server, TUI, 보조 세션과 pre-child fallback은 같은 private bundle의 본체와 host를
  사용한다.
- native `codex`, 공식 설치 파일, PATH와 셸 설정은 변경하지 않는다.
- runtime trust 집중 테스트 60/60이 통과했다.

소스와 자동 검증이 완료돼도 실제 0.152.0 package의 code-mode smoke와 다른 Mac
설치 검증 전에는 이 이슈를 `해결됨`으로 바꾸지 않는다.

### 완료 기준

- host 누락, 다른 아키텍처, symlink, manifest 불일치를 자식 시작 전에 차단한다.
- 0.152 본체와 다른 버전 host의 혼합을 거부한다.
- 실제 private runtime에서 로컬 명령과 임시 파일 읽기·쓰기가 성공한다.
- App Server, TUI, 보조 세션이 같은 runtime identity를 사용한다.
- 정상·실패·signal 종료 후 orphan 프로세스가 남지 않는다.
- 일반 `codex`, `resume`, `fork`, `exec`의 경로와 의미가 바뀌지 않는다.

---

## BLB-RUNTIME-002 — Codex 본체와 code-mode host IPC 불일치

- 최초 확인: 2026-09-01
- 기록일: 2026-09-02
- 심각도: 높음
- 상태: 검증 중
- 근거 수준: 오류는 확인됨, 정확한 host 빌드 identity는 아직 미확인

### 증상

누락된 host를 다른 위치에서 복사한 뒤 다음 오류가 발생했다.

```text
failed to read code-mode host message:
failed to decode code-mode IPC frame:
missing field `code_mode_host_duration_ns`
```

### 현재 판단

host 프로세스가 실행되어 IPC frame을 반환했지만, Codex 본체가 요구하는 필드가 없었다.
이는 본체와 host가 서로 다른 프로토콜, 버전 또는 빌드에서 만들어졌을 가능성을 강하게
시사한다. 다만 이 오류만으로 semantic version 불일치를 단독 증명할 수는 없다.

### 임시 대응

- host만 따로 복사하지 않는다.
- 동일 공식 배포본의 전체 package만 사용한다.
- 현재 관리형 allowlist에 0.152.0을 추가하지 않는다.

### 완료 기준

- 본체, host, manifest, target과 서명 identity가 하나의 배포 단위로 결합된다.
- mixed-version 및 mixed-build fixture가 자식 시작 전에 거부된다.
- 0.152.0은 실제 code-mode smoke와 lifecycle 검증 뒤 마지막 단계에서만 allowlist에 추가된다.

### 2026-09-02 수정 현황

본체와 host를 개별 파일로 선택하지 않고 동일 manifest tree에서 함께 검사·복사한다.
manifest/CLI 버전 불일치와 package identity drift도 관리형 자식 시작 전에 거부한다.
동일 Team ID·version·target이라도 전체 package fingerprint가 등록 release와 다르면
실패한다. 현재 production catalog는 official `0.151.0` Apple Silicon 하나만 등록하며,
0.152.0이나 미등록 target은 자격을 상속하지 않는다.
다만 보고된 다른 PC의 실제 host build identity는 보존된 증거가 없어 확정하지 못했으며,
0.152.0·0.152.1 live qualification도 아직 수행하지 않았다.

---

## BLB-RUNTIME-003 — 비정상 종료 staging 회수 안정성

- 최초 확인: 2026-09-02
- 기록일: 2026-09-02
- 심각도: 중간
- 상태: 검증 중
- 근거 수준: 소스·전용 자동 테스트·독립 보안 검토로 확인됨

### 문제

private runtime을 복사하거나 게시하던 프로세스가 비정상 종료되면 staging 잔여물이
공유 임시 디렉터리에 남을 수 있다. 이 잔여물을 잘못 판정하면 다음 문제가 생긴다.

- recovery plan을 쓰다 중단되어 partial 파일만 남는다.
- 미래 timestamp, 음수 또는 정수 overflow를 오래된 잔여물로 오판한다.
- 관련 없는 대량 파일 때문에 실제 Blabee 잔여물을 찾지 못한다.
- 앞쪽의 보호된 managed 항목 4,099개가 뒤쪽의 회수 가능한 항목을 계속 굶긴다.

### 2026-09-02 수정 현황

- recovery plan은 owner-only partial 파일에 쓰고 `fsync`한 뒤 exclusive rename으로
  원자 게시하며, 게시된 identity를 다시 확인한다.
- exact managed UUID 이름, owner·mode·ACL·link·type, unlocked lease, plan과 partial
  tree가 모두 일치하고 최소 age가 안전하게 계산되는 항목만 회수한다.
- 미래·음수·overflow timestamp와 unknown entry는 삭제하지 않는다.
- 관련 없는 이름은 managed 후보 상한에 포함하지 않고, 4,099개씩 bounded-memory로
  검사하되 삭제 성공 여부와 무관하게 마지막 검사 이름 뒤로 cursor를 전진시킨다.
- runtime trust 집중 테스트 60/60과 독립 filesystem 보안 검토를 통과했으며 새
  P0~P2 finding은 없다.

### 남은 위험과 완료 기준

같은 UID가 exact managed 형식의 항목을 극단적으로 많이 계속 만들면 batch마다 부모
디렉터리를 다시 훑는 비용이 커질 수 있다. 이는 잘못된 삭제나 메모리 폭증으로 이어지는
문제는 아니지만 실행 지연 가능성이 있어 P3 성능 hardening으로 남긴다.

- 설치본에서 비정상 종료 뒤 다음 실행의 회수를 실제 검증한다.
- 극단적 same-UID managed-name 부하에서 허용 가능한 시간 상한을 정한다.
- 필요하면 전용 private parent 또는 시간 제한·영속 cursor를 별도 설계한다.

---

## BLB-DEPLOY-001 — pull한 소스와 설치된 실행본의 불일치

- 최초 확인: 2026-09-01
- 기록일: 2026-09-02
- 심각도: 높음
- 상태: 조사 중
- 근거 수준: 현재 소스와 다른 PC의 실행 경로가 일치하지 않음

### 확인된 불일치

- 현재 소스의 protocol semantic allowlist는 `0.149.1`, `0.150.1`, `0.151.0`이다.
- 이 중 현재 exact production bundle fingerprint가 등록된 대상은 official `0.151.0`
  Apple Silicon뿐이며 나머지는 별도 bundle qualification이 필요하다.
- 현재 process-local pin은 시스템 임시 디렉터리 아래에 생성된다.
- 다른 PC에서는 0.152.0이 `Application Support/Blabee/codex/0.152.0`에서 실행됐다.
- 현재 추적 소스에서는 이 정확한 영구 경로의 생성 코드를 확인하지 못했다.

### 가능한 원인

- Git은 pull했지만 설치된 Blabee 앱과 service를 다시 빌드·교체하지 않음
- 제거된 구형 자동 연결 산출물이 남음
- 팀원 PC의 로컬·미커밋 installer 또는 별도 branch 사용
- 앱, service, Plugin이 서로 다른 build에서 설치됨

### 근본 수정

- 앱, service, Plugin, Hook에 같은 build identity를 포함한다.
- Doctor와 설정 UI에 실행 중인 실제 경로와 build identity를 표시한다.
- 일반 사용자 배포는 Git pull이 아닌 서명·공증된 원자적 앱 설치·업데이트로 제공한다.
- 설치 후 source checkout이 아니라 실제 실행 중인 산출물을 검증한다.

### 완료 기준

- 다른 PC에서 앱·service·Plugin의 동일 build identity가 확인된다.
- 구형 설치본이 남아 있으면 자동 활성화되지 않고 명확한 안내가 표시된다.
- 앱 업데이트 실패가 native Codex나 기존 소스 checkout을 변경하지 않는다.

---

## BLB-DIAG-001 — Doctor의 runtime 및 code-mode 검증 누락

- 최초 확인: 2026-09-01
- 기록일: 2026-09-02
- 심각도: 높음
- 상태: 검증 중
- 근거 수준: 현재 Doctor 소스로 확인됨

### 문제

발견 당시 [DoctorApplication.swift](src/coordinator-swift/Sources/BlabeeCoordinator/DoctorApplication.swift)는
Codex 실행 파일과 `--version`, Plugin, Hook, daemon과 프로젝트 상태를 검사했다. 하지만
다음 항목은 검사하지 않는다.

- sibling `codex-code-mode-host` 존재와 실행 가능 여부
- 본체와 host의 package·아키텍처·서명 결합
- package manifest와 CLI 버전 일치
- 실제 code-mode 도구 호출 가능 여부

따라서 Hook과 텍스트 응답이 정상이어도 도구 실행이 전부 실패하는 상태를 충분히 구분하지
못한다.

### 근본 수정

Doctor에 다음 독립 검사를 추가하고 launcher와 같은 validator를 사용한다.

- `codex_runtime_layout`
- `codex_runtime_identity`
- `codex_runtime_version`
- `codex_code_mode_compatibility`
- `blabee_build_identity`

### 완료 기준

Doctor가 다음 상태를 별도로 보고한다.

```text
Hook 연결
Codex 본체
code-mode host
실제 도구 실행 자격
Blabee 앱·service·Plugin build 일치
```

`codex --version`만 성공하고 host가 깨진 상태를 정상으로 판정하지 않는다.

### 2026-09-02 수정 현황

Doctor가 production과 같은 read-only runtime inspector를 사용하고 다음 check를 독립적으로
출력하도록 구현했다.

- `codex_runtime_layout`
- `codex_runtime_identity`
- `codex_runtime_version`
- `codex_code_mode_compatibility`
- `blabee_build_identity`

host 누락, malformed manifest, unsafe host mode와 manifest/자격 버전 mismatch를
fail-closed하는 테스트를 추가했다. 기본 Doctor는 private pin이나 persistent
artifact를 만들지 않고 `codex --version`, `codex plugin list`, App Server
`hooks/list`를 포함한 Codex child를 실행하지 않는다. manifest allowlist가
통과해도 exact production bundle fingerprint가 미등록이면 `action_required`, 등록
fingerprint와 다르면 실패한다. catalog가 일치해도 실제 binary 버전, Plugin 설치·활성, Hook 신뢰와
`codex_code_mode_compatibility`는 별도 live qualification 전까지
`action_required`다. daemon의 읽기 전용 `doctor_status` UDS는 계속 허용한다.
또한 실제 Plugin locator가 확인되지 않은 표준 `/Applications` fallback만으로는
`blabee_build_identity`를 통과시키지 않고 별도 `action_required`로 보고한다.
Doctor 집중 테스트 30/30이 통과했다.

2026-09-05 설치된 r8 Doctor는 `coordinator_runtime`, `app_bundle`,
`embedded_coordinator`, `mcp_runtime`, `daemon_status`, `reconciliation_status`,
`project_scope`를 통과했다. 전체 결과가 실패한 이유는 Codex `0.153.2`의 managed
runtime identity/version/code-mode allowlist가 아직 승인되지 않았기 때문이다. 일반
`0.153.2` Plugin CLI 호환성은 별도 자격이며, 이 Doctor 실패를 일반 Codex 또는 Plugin
연결 실패로 해석하지 않는다. 동시에 관리형 App Server 승인을 지원한다고 주장하지도
않는다.

---

## BLB-DIST-001 — 다른 사용자용 설치·업데이트 자격 미완료

- 최초 확인: 2026-09-02
- 심각도: 높음
- 상태: 수정 예정
- 근거 수준: 제품 배포 acceptance가 아직 수행되지 않음

### 목표 사용자 경험

지원하는 공식 Codex가 설치된 Mac에서는 사용자가 별도 파일 복사나 전용 경로 명령 없이
Blabee를 설치하고 바로 사용할 수 있어야 한다. 호환성 검사가 실패하더라도 원래 Codex는
계속 정상 작동해야 한다.

### 1차 지원 범위 제안

- 공식 standalone package
- canonical package layout을 제공하는 Homebrew 설치본
- Apple Silicon
- Intel은 별도 실제 환경 자격 후 지원 여부 결정

npm, asdf, Volta 또는 manifest 없는 설치 방식은 명시적으로 자격을 통과하기 전까지
관리형 기능만 `지원되지 않음`으로 표시한다. native Codex와 호환되는 기본 Hook 기능은
별도 상태로 판단한다.

### 필요한 배포 검증

- Codex 미설치 상태
- 지원하는 Codex 최초 설치
- 미지원 신규 Codex 버전
- host 누락 또는 부분 설치
- Blabee 최초 설치·업데이트·제거
- 앱·service·Plugin 버전 불일치
- Orca 및 새 Codex 세션 재시작
- 실제 결정 카드와 관리형 권한 왕복
- 실패·제거 뒤 native Codex 무변경

### 완료 기준

- 깨끗한 Mac에서 설치부터 첫 결정 카드와 실제 도구 호출까지 통과한다.
- 미지원 환경에서는 관리형 기능만 안전하게 비활성화된다.
- 사용자가 현재 사용 가능한 기능과 필요한 조치를 UI에서 이해할 수 있다.
- Git checkout이나 개발자 캐시에 의존하지 않는다.

2026-09-05 r8은 앱 `0.1.0` build `8`, exact `arm64`, ad-hoc app,
미서명·미공증 DMG의 패키지 검증을 통과했다. SHA-256은
`e0dbe4ff31713a76df9b38dd3e94f799d53f1bbfec86350cc28d35afd2bffa31`이다. r7과
그 이전 로컬 산출물은 배포하지 않는다. 이 결과의
`public_distribution_ready`는 `false`다. 한 개발 Mac의 설치·명시적 service 재시작과
Plugin 설치 상태 표시는 확인했지만 clean Mac 설치·Hook 신뢰·Pet 왕복은 계속 별도
완료 기준으로 남는다.

---

## BLB-CLEANUP-001 — 구형 영구 runtime 자동 정리 위험

- 최초 확인: 2026-09-01
- 심각도: 중간
- 상태: 조사 중
- 근거 수준: 보고된 영구 경로의 생성 주체와 ownership marker가 미확인

### 문제

다른 PC의 다음 경로는 현재 소스의 process-local pin 정책과 일치하지 않는다.

```text
~/Library/Application Support/Blabee/codex/<version>/
```

Blabee가 해당 트리 전체를 정확히 소유한다는 증거 없이 재귀 삭제하면 사용자 파일이나 다른
프로세스가 추가한 파일을 제거할 수 있다.

### 안전 원칙

- 자동 재귀 삭제하지 않는다.
- 실행 중인 프로세스와 lease를 먼저 확인한다.
- Blabee가 기록한 manifest, inode와 ownership marker가 모두 일치할 때만 제한적으로 정리한다.
- 알 수 없는 파일, symlink 또는 identity drift가 있으면 정리를 중단하고 진단만 제공한다.

### 완료 기준

- 구형 경로를 만든 build와 ownership 계약이 확인된다.
- 별도의 검증된 migration 또는 uninstaller가 구현된다.
- 제거 전후 native Codex와 사용자 데이터가 변경되지 않음을 검증한다.

---

## BLB-PLUGIN-001 — Plugin 검사와 공식 Codex CLI 변경 사이 경쟁 구간

- 최초 확인: 2026-09-03
- 기록일: 2026-09-03
- 심각도: 중간
- 상태: 검증 중
- 근거 수준: 변경 소스·집중 테스트·독립 QA로 확인됨

### 현재 완화

- 앱, marketplace, manifest와 Codex 실행 파일을 안전한 descriptor로 읽고 크기·타입·소유권·ACL·서명을 검사한다.
- 설치·업데이트·제거는 사용자의 명시적 버튼에서만 실행하고 Blabee 프로세스끼리는 owner-only lock으로 직렬화한다.
- 다른 Plugin이 `blabee-app` marketplace에 하나라도 있으면 자동 정리·제거하지 않는다.
- 공식 Codex CLI 호출 직전과 변경 직후 상태를 다시 확인하며, drift를 발견하면 성공으로 보고하지 않는다.
- 일반 `codex`, 공식 설치 파일, `PATH`, `.zshrc`, wrapper와 native `/resume`은 변경하지 않는다.

### 남은 제한

검증이 끝난 경로를 `posix_spawn`으로 실행하기 직전, 또는 최종 상태 확인 뒤 공식
`codex plugin remove`가 실행되기 직전에 같은 사용자 권한의 다른 프로세스가 경로·Plugin
상태를 바꿀 수 있는 매우 짧은 구간이 남는다. 사후 검사는 잘못된 성공 표시는 막지만 이미
실행되거나 제거된 동작을 되돌리지는 못한다.

완전히 제거하려면 검증된 Codex 전체 runtime을 private snapshot으로 실행하거나 Codex가
expected-state/CAS 기반 Plugin 변경 API를 제공해야 한다. 전자는 Blabee가 native Codex 위에
가볍게 올라가야 한다는 현재 제품 원칙과 충돌하므로, 지금은 명시적 사용자 동작·짧은 구간·
실패 폐쇄·사후 재검증을 유지한다.

NVM·Volta의 script/shim 형태 Codex는 공식 Mach-O 서명 검사를 통과하지 못해 `사용 불가`로
표시될 수 있다. 이는 보안 실패가 아니라 현재 지원 범위 제한이다.

### 완료 기준

- 깨끗한 Mac에서 설치·업데이트·제거와 충돌 시나리오를 실사용으로 통과한다.
- Codex가 조건부 Plugin 변경 API를 제공하면 이를 사용해 외부 CLI 경쟁 구간을 제거한다.
- 또는 제품 원칙을 재승인한 뒤 private snapshot 실행 경계를 별도 설계·검증한다.

---

## BLB-PLUGIN-002 — 구형 연결 부분 마이그레이션 재시도 불가

- 최초 확인: 2026-09-04
- 기록일: 2026-09-04
- 심각도: 중간
- 상태: 검증 중
- 근거 수준: 소스·전용 회귀·독립 QA로 확인됨

구형 dogfood Plugin 제거는 성공했지만 Marketplace 제거가 실패하면, 다음 조회에서
Marketplace만 남은 상태를 알 수 없는 충돌로 분류해 사용자가 앱에서 마이그레이션을
재개할 수 없었다.

현재는 exact 이름·경로를 가진 알려진 구형 Marketplace가 하나이고 연결된 Plugin이
0개인 상태도 명시적인 이전 연결로 인식한다. 사용자가 두 단계 확인을 다시 수행하면
이미 끝난 Plugin 제거를 반복하지 않고 Marketplace 제거부터 이어서 현재
`blabee@blabee-app`을 설치한다. 중복 Marketplace, 추가 Plugin, 현재 Marketplace 공존,
실행 중 소유권 변경은 계속 실패 폐쇄한다. 전용 Plugin setup 테스트 76/76과 독립 QA가
이 복구 경계를 통과했으며, 설치본의 실제 구형 연결 마이그레이션을 마지막 gate로 남긴다.

---

## BLB-PLUGIN-003 — Plugin 자격 확인의 반복 전체 hash

- 최초 확인: 2026-09-04
- 기록일: 2026-09-04
- 심각도: 중간
- 상태: 검증 중
- 근거 수준: 소스·전용 회귀·전체 Swift 테스트로 확인됨

Codex `0.153.2`의 좁은 공식 바이너리 보완 경로는 약 220MB 실행 파일 전체 hash를
계산한다. 이전 구현은 한 번의 연결 동작에서 상태 조회마다 이 검사를 다시 수행할 수
있어 지연, disk read와 발열을 키웠다.

현재 `connect`, `disconnect`, 구형 연결 마이그레이션은 각자 하나의 최대 45초 operation
context를 사용한다. 선택된 실행 파일의 자격과 hash는 operation당 한 번만 계산하고,
각 subprocess 직전에는 저렴한 전체 identity snapshot을 재확인한다. timeout은 후보 탐색,
hash, 버전 확인과 Plugin 명령 전체가 공유하며 실패 뒤 자동 재시도하지 않는다. 깨끗한
Mac 설치본에서 실제 operation당 전체 hash 1회와 지연·CPU·disk read를 계측하는 검증은
남아 있다.

---

## BLB-PACKAGE-001 — 실패 staging 경로 기반 정리 경쟁 구간

- 최초 확인: 2026-09-03
- 기록일: 2026-09-03
- 심각도: 낮음
- 상태: 검증 중
- 근거 수준: 변경 소스·집중 테스트·독립 QA로 확인됨

### 현재 완화

앱 조립기는 입력을 descriptor snapshot으로 검사하고 경로의 모든 조상 구성요소에서 symlink를
거부한다. 파일별 512 MiB와 전체 크기 제한을 적용하고, codesign 뒤 `_CodeSignature`까지 포함한
최종 트리를 다시 세어 1,024개 entry 제한을 적용한다. 기존 출력이나 조립 중 새로 생긴 출력은
보존하고 publish를 중단한다. 실패 staging은 예측 불가능한 quarantine 이름으로 원자 이동한 뒤
identity를 다시 확인해 정리한다.

### 남은 제한과 완료 기준

현재 검사는 native `openat` 기반 원자 traversal이 아니므로 경로 구성요소 검사 직후 실제 복사 전,
output parent의 경로 기반 publish, quarantine `lstat` 뒤 재귀 삭제 전에 같은 사용자 프로세스가
경로를 바꾸는 이론적 경쟁 구간은 남는다. 완전 제거에는 dirfd 기반
`openat`/`renameat`/`unlinkat` 헬퍼가 필요하다. 현재 자동 테스트와 독립 QA는 통과했으며, 깨끗한
Mac DMG 반복 조립·실패 주입에서 사용자 파일이 보존되는지 추가 검증한 뒤 공개 배포 자격을 판단한다.

---

## BLB-PACKAGE-002 — 오래되거나 혼합된 입력 포장과 무제한 파일 읽기

- 최초 확인: 2026-09-04
- 기록일: 2026-09-04
- 심각도: 중간
- 상태: 검증 중
- 근거 수준: 소스·전용 회귀·독립 QA로 확인됨

과거 저수준 DMG 명령은 미리 빌드한 `--binary`를 받아 현재 소스와 다른 실행 파일을
실수로 포장할 수 있었다. 첫 fresh wrapper도 live source를 직접 읽어, 빌드 중 파일이
잠깐 바뀌었다가 원상복구되면 Swift와 번들 리소스가 서로 다른 시점을 읽을 수 있었다.
또한 `lstat` 뒤 입력이 FIFO나 symlink로 교체되거나 읽는 동안 계속 커지면 빌드가
멈추거나 선언한 파일 크기 상한을 넘을 수 있었다.

현재 사용자용 명령은 fresh source builder 하나뿐이며 저수준 `--binary` CLI는 실행을
거부한다. Swift package, Contracts, Plugin과 macOS packaging 입력을 파일 수·바이트가
제한된 하나의 private source snapshot으로 복사하고, Swift 빌드와 앱 조립이 모두 그
snapshot만 사용한다. 입력 open은 `O_NOFOLLOW | O_NONBLOCK`을 사용하고 최초 크기까지만
읽은 뒤 조기 EOF, 최초 EOF 뒤 추가 byte, descriptor와 경로 identity를 확인한다. release
바이너리의 로컬 사용자 경로 검사도 bounded streaming으로 수행한다. FIFO·symlink 교체,
읽기 중 append, 소스 시점 혼합과 stale CLI 회귀가 통과했고, 독립 QA의 열린 P0~P2는 없다.

2026-09-05에는 게시 transaction schema를 v2로 올려 `build_number`와
`expected_architecture = arm64`를 산출물 identity에 함께 봉인했다. legacy v1 marker나
build·architecture가 다른 복구 요청은 자동 복구하지 않고 실패 폐쇄한다. 빌드·조립·mount
결과도 exact `arm64`만 허용해 x86 또는 Universal 입력을 거부한다. r8 fresh DMG의 구조,
checksum, mount, 아키텍처와 ad-hoc app 서명을 확인했고 전체 Node 346/346과 Swift
Testing 568/568+XCTest 5/5가 통과했다.

한 개발 Mac에서 r8 설치와 service 복구는 확인했다. 남은 gate는 clean Mac 설치와
Plugin·Hook·Pet 제품 왕복이다. 경로 조상과 output parent의 완전한 원자성은
`BLB-PACKAGE-001`의 낮은 잔여 위험으로 별도 유지한다.

---

## BLB-PET-001 — 설정 상태 새로고침과 변경 작업의 UI 경쟁

- 최초 확인: 2026-09-03
- 기록일: 2026-09-03
- 심각도: 중간
- 상태: 해결됨
- 근거 수준: 소스·전용 회귀·전체 Swift 반복 실행으로 확인됨
- 수정 커밋: 미생성 (사용자 승인 전)

Plugin과 서비스·프로젝트 변경을 서로 다른 작업 영역으로 분리하고, 같은 영역의 변경은
single-flight로 직렬화했다. 변경 중 들어온 새로고침은 합쳐서 마지막 상태만 반영하며, 작업 상태를
먼저 적용한 뒤 메서드가 반환되도록 했다. 설정 창을 여는 것만으로 Codex subprocess를 실행하지
않는 수동 확인 원칙도 유지한다.

후속 유휴 최적화에서는 상태 아이콘을 최초 표시와 attention 전이에만 다시 만들고,
동일 snapshot은 UI publish를 생략하되 완료 callback은 보존한다. 전역 단축키 등록 실패
계획도 입력이 바뀔 때까지 재사용해 불필요한 반복 등록을 줄였다. 이는 자동 회귀로
검증했다. r8 설치본의 6-sample idle `top`에서 UI와 service는 각각 0.0~0.1% CPU,
메모리 약 65 MiB와 151 MiB였고 최근 2분 freshness-key 로그에는 실제 access entry가
없었다. 짧은 단일 Mac 표본이므로 장시간 유휴 CPU·발열 개선의 일반 증거는 아니다.

---

## BLB-QA-001 — 반복 테스트의 전역 자원 수명주기 간섭

- 최초 확인: 2026-09-03
- 기록일: 2026-09-03
- 심각도: 중간
- 상태: 해결됨
- 근거 수준: 소스·전용 회귀·전체 Swift 반복 실행으로 확인됨
- 수정 커밋: 미생성 (사용자 승인 전)

테스트 전용 runtime signature Hook을 전체 테스트 본문 동안 lock으로 격리하고, SQLite fixture는
routing과 journal을 명시적으로 해제한 뒤 임시 디렉터리를 정리한다. managed bridge harness도
pipe·socket·child process를 멱등하게 종료·회수한다. 정상 권한에서 동일 소스 전체 Swift
528개를 최종 12회 연속 통과했다. 상세가 보존되지 않은 단일 issue가 그 전에 한 차례 있었지만
즉시 재실행과 이후 반복에서 재현되지 않았다.

한 차례 관찰된 socket bind 49 issues는 제품 회귀가 아니었다. 반복 명령을 셸 루프로 감싸면서
Codex 도구의 외부 sandbox 안에서 실행되어 TCP·UDS bind와 Keychain이 `EPERM`으로 차단된
검증 환경 오류였다. `swift test --disable-sandbox`는 SwiftPM 자체 sandbox만 해제하므로,
소켓·Keychain 전체 테스트는 각 명령을 승인된 환경에서 독립 실행해야 한다.

전체 Node에서 한 차례 발생한 1초 Hook 응답성 실패도 제품 동작 오류가 아니라 wall-clock
스케줄링 outlier였다. 실제 경로 80회가 모두 정상 동작했고 최소 5초 native deadline과의 분리는
유지된다. 테스트 전용 상한을 2.5초로 보정한 뒤 집중 반복과 전체 304/304가 통과했다.

2026-09-05 후속에서는 관리형 Codex 보조 프로세스 정리에서 남아 있던 무제한
`Process.waitUntilExit()`를 제거했다. 이미 종료한 자식은 즉시 상태를 보존하고, 실행 중이면
TERM 후 최대 750ms, 그 exact child에만 SIGKILL 후 최대 750ms를 기다린 뒤 반환한다. 전용
종료 회귀와 기존 보조 연결 회귀를 통과했고 독립 QA에서 열린 Medium 이상 finding은 없다.
최종 전체 Swift Testing 568/568+XCTest 5/5와 Node 346/346이 통과했다.

## 권장 수정 순서

1. **P0 — Runtime 완전성 사전 차단**
   - manifest, host, rg, 아키텍처와 기본 identity 검사
   - full-bundle canonical fingerprint를 닫힌 production catalog와 비교
   - 불완전한 managed runtime을 자식 시작 전에 차단
   - 0.152.0·0.152.1은 계속 allowlist 밖으로 유지
2. **P1 — 전체 runtime bundle 원자 pin**
   - descriptor 기반 staging copy, source/destination 재검증, 원자 게시
   - 전체 bundle manifest 기반 cleanup과 lease 보존
3. **P2 — Launcher와 lifecycle 연결**
   - version probe, App Server, TUI, 보조 세션과 pre-child fallback이 같은 bundle 사용
   - 첫 자식 시작 후 자동 fallback과 중복 실행 금지
4. **P3 — Doctor와 build identity 보강**
   - runtime layout·identity·version과 앱·service·Plugin build 일치 분리 보고
5. **P4 — 실제 0.152.0·0.152.1 qualification**
   - 격리된 명령·파일·App Server·`/resume`·cleanup 검증
   - 모든 검증 뒤 별도 작은 변경으로 allowlist 추가
6. **P5 — 깨끗한 Mac 설치 자격**
   - 최초 설치, 업데이트, 제거와 unsupported 상태의 사용자 경험 검증

## 공통 제품 안전 원칙

- 일반 `codex`, PATH, `.zshrc`, alias, shell function과 공식 설치 파일을 변경하지 않는다.
- Blabee가 실패해도 native Codex는 계속 사용할 수 있어야 한다.
- 지원하지 않는 Codex에서는 managed 기능만 실패 폐쇄한다.
- 서로 다른 버전의 본체와 host를 자동 조합하지 않는다.
- child 시작 전 fallback은 승인한 동일 private runtime으로만 정확히 한 번 허용한다.
- child 시작 뒤 자동 재실행이나 native fallback을 수행하지 않는다.
- Hook 연결, Pet 카드, App Server 응답과 실제 작업 성공을 서로 다른 증거로 기록한다.

## 새 이슈 작성 템플릿

```markdown
## BLB-<영역>-<번호> — <짧은 제목>

- 최초 확인: YYYY-MM-DD
- 기록일: YYYY-MM-DD
- 심각도: 치명적 | 높음 | 중간 | 낮음
- 상태: 열림 | 조사 중 | 수정 예정 | 수정 중 | 검증 중 | 해결됨 | 보류
- 근거 수준: 확인됨 | 강한 추론 | 미확인

### 증상

### 재현 조건

### 확인된 사실

### 추정 또는 미확인 사항

### 영향

### 임시 대응

### 근본 수정

### 완료 기준

### 관련 파일·커밋·로그
```
