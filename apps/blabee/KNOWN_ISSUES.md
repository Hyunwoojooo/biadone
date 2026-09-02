# Blabee 알려진 오류 및 안정성 이슈

- 최초 작성: 2026-09-02 (KST)
- 마지막 갱신: 2026-09-02 (KST)
- 문서 상태: 활성
- 검토 기준 커밋: `50ca1c17ac6e4df21676d5dfc200d65a95b0c964`
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
