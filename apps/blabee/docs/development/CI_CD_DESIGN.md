# Blabee CI/CD 설계

- 작성일: 2026-09-04
- 상태: 제안(설계 전용, 미구현)
- 대상: `apps/blabee`
- 현재 작업 경계: 문서만 추가하며 workflow, 제품 소스, 테스트, 패키징 스크립트,
  GitHub 저장소 설정은 변경하지 않는다.

## 1. 한 줄 결론

Blabee에는 다음 세 단계를 서로 분리해서 도입한다.

1. PR에서는 비밀정보 없이 자동 테스트만 수행한다.
2. `main`에서는 검증된 커밋으로 내부 테스트용 DMG를 만들되 공개하지 않는다.
3. 공개 릴리스는 훗날 사람이 시작하고 승인하는 Developer ID 서명·공증 절차로
   별도 구현한다.

현재 다른 세션이 Blabee를 수정·디버깅 중이므로, 이 설계의 실제 구현은 그 세션이
명시적인 기준 커밋을 만든 뒤 별도 Git worktree와 별도 브랜치에서 시작한다.

## 2. 이 문서를 읽기 위한 초보자용 설명

### 2.1 Git과 GitHub에서 일어나는 일

- **저장소(repository)**: 코드와 변경 이력을 보관하는 프로젝트 공간이다.
- **commit**: 특정 시점의 변경을 하나의 고정된 기록으로 저장한 것이다.
- **branch**: 여러 commit이 이어지는 작업 줄기다.
- **push**: 로컬 commit을 GitHub로 올리는 작업이다.
- **PR(Pull Request)**: 한 branch의 변경을 다른 branch에 합치자고 제안하는 화면이다.
- **merge**: 검토된 PR을 대상 branch에 합치는 작업이다.

GitHub Actions는 로컬 작업 폴더를 읽지 않는다. GitHub에 push된 commit을 새 runner에
checkout해서 검사한다.

```text
현재 로컬 디버깅 폴더와 미커밋 파일
             │
             └── GitHub runner가 볼 수 없음

commit → push → GitHub가 그 commit을 새 runner에 복사 → 테스트·빌드
```

따라서 GitHub-hosted runner에서 실행되는 CI는 현재 로컬에서 실행 중인 Blabee, Keychain,
`/tmp`, Application Support 또는 미커밋 파일을 직접 건드리지 않는다.

### 2.2 GitHub Actions 용어

| 용어 | 쉬운 뜻 | Blabee 예시 |
|---|---|---|
| Actions | GitHub의 자동화 실행 기능 | PR을 만들면 테스트 실행 |
| workflow | 자동화 전체 설명서인 YAML 파일 | `blabee-ci.yml` |
| event/trigger | workflow를 시작시키는 사건 | PR, `main` push, 수동 버튼 |
| runner | 명령을 실행하는 임시 컴퓨터 | GitHub가 준비한 새 macOS VM |
| job | 한 runner에서 실행되는 작업 묶음 | Swift 테스트 job |
| step | job 안의 한 단계 | `npm ci`, `npm run test:swift` |
| check | commit/PR에 붙는 성공·실패 결과 | `Blabee PR Gate` |
| artifact | workflow 결과로 임시 보관하는 파일 | 내부 DMG와 checksum |
| cache | 다음 실행을 빠르게 하는 재사용 데이터 | npm 다운로드 캐시 |
| secret | 로그와 저장소에 넣지 않는 비밀값 | 인증서 비밀번호 |
| environment | 비밀 사용 전에 승인 규칙을 거는 보호 구역 | `blabee-public-release` |
| tag | 특정 commit에 붙인 버전 이름 | `blabee-v0.1.0+build.30` |
| draft release | 파일은 준비됐지만 아직 공개하지 않은 릴리스 | clean-Mac 검사 전 후보 |
| `workflow_dispatch` | Actions 화면에서 누르는 수동 실행 버튼 | 공개 후보 생성 시작 |

Workflow는 저장소 루트의 `.github/workflows/*.yml`에 둔다. 하나의 workflow에는 여러
job이 있고, 각 job에는 순서대로 실행되는 step이 있다. GitHub-hosted job은 매번 새
VM에서 시작하고 job이 끝나면 그 VM은 폐기된다.

[GitHub Actions 기본 개념](https://docs.github.com/en/actions/get-started/understand-github-actions)

### 2.3 CI, Delivery, Deployment의 차이

- **CI(Continuous Integration)**: 변경을 합쳐도 되는지 자동으로 검사한다.
- **Continuous Delivery**: 설치 파일을 전달 가능한 후보 상태까지 자동으로 만든다.
- **Continuous Deployment**: 통과한 결과를 실제 사용자에게 자동 공개한다.

Blabee의 현재 목표는 CI와 승인형 Continuous Delivery다. 완전 자동 Deployment는 현재
범위가 아니다.

```text
CI                 Delivery                         Deployment
테스트 통과 여부 → 검증된 DMG/릴리스 후보 준비 → 실제 사용자에게 공개
                                                ↑
                                  Blabee는 여기서 사람이 승인
```

### 2.4 Artifact와 Release는 다르다

- Actions **artifact**는 특정 workflow 실행에 딸린 임시 결과물이다.
- GitHub **Release asset**은 버전과 함께 사용자에게 전달하려고 올리는 파일이다.
- artifact를 만들었다고 Release가 생기거나 사용자가 자동 업데이트되는 것은 아니다.
- cache는 속도 개선용일 뿐 검증 증거나 배포 파일로 사용하지 않는다.

[GitHub workflow artifact 설명](https://docs.github.com/en/actions/tutorials/store-and-share-data)

## 3. 설계 목표와 비범위

### 3.1 목표

- Blabee 변경을 합치기 전에 자동 회귀를 발견한다.
- 매 검증이 어느 commit에서 실행됐는지 추적할 수 있게 한다.
- 로컬 개발자 환경과 분리된 macOS에서 빌드·테스트한다.
- `main`의 검증된 commit에서 재현 가능한 내부 DMG와 SHA-256을 만든다.
- 내부 ad-hoc 산출물과 공개 Developer ID 산출물을 혼동하지 않는다.
- 자동 테스트, 패키징, Apple 공증, clean-Mac 실사용, 최종 공개를 별도 증거로 남긴다.
- Apple 인증서와 공증 credential을 PR 코드로부터 격리한다.
- 다른 세션의 미커밋 파일이나 실행 중인 Blabee에 영향을 주지 않는다.

### 3.2 이번 설계의 비범위

- 실제 `.github/workflows/*.yml` 생성
- GitHub branch protection 또는 ruleset 변경
- `package.json`, Swift, Node, Plugin, Contract 또는 패키징 코드 변경
- Developer ID 인증서 생성·업로드
- Apple 공증 실행
- DMG 빌드와 테스트 실행
- Git commit, push, tag 또는 Release 생성
- 자동 업데이트 도입
- 공개 릴리스 승인

## 4. 현재 Blabee에서 확인한 기준

이 절은 2026-09-04 현재 작업 폴더의 직접 소스를 기준으로 한다. 코드 그래프는
2026-09-03 세대였고, 패키징 관련 파일 일부는 그 뒤 수정되거나 아직 추적되지 않은
상태여서 해당 파일은 직접 읽어 확인했다. 실제 구현 전에는 기준 commit에서 다시
검증해야 한다.

### 4.1 기술 환경

- Node.js 요구 버전은 `>=22`다.
- npm lockfile v3가 있다.
- Swift tools version은 6.0이다.
- Swift package의 최소 대상은 macOS 13이다.
- 제품 target은 AppKit, Carbon, Security, ServiceManagement, SwiftUI 등을 링크한다.
- Swift package에는 외부 package dependency가 없다.

근거:

- [`package.json`](../../package.json)
- [`package-lock.json`](../../package-lock.json)
- [`Package.swift`](../../Package.swift)

### 4.2 현재 테스트 명령

현재 작업 폴더에는 다음 명령이 보인다.

```text
npm test
npm run test:contracts
npm run test:t005
npm run test:t007a
npm run test:t007b-a
npm run test:t011
npm run test:t012
npm run test:dogfood
npm run test:swift
```

여기서 중요한 점은 `npm test`가 단일한 “빠른 단위 테스트”가 아니라는 사실이다.

- 계약·참조 코어 같은 빠른 Node 테스트가 있다.
- Persistence/Operational 테스트는 Swift를 빌드하고 test-only Keychain을 사용한다.
- AppPackaging 테스트는 실제 `codesign`, `hdiutil`, `lipo`를 사용한다.
- `plugin-lifecycle.test.mjs`는 PATH의 실제 `codex`를 실행한다.
- LocalDogfood의 일부도 격리된 `CODEX_HOME`에서 실제 Codex lifecycle을 실행한다.
- Node와 Swift 모두 의도적으로 직렬 실행한다.

따라서 초기 제안처럼 전체 `npm test`를 곧바로 PR 필수 체크 하나로 지정하지 않는다.
테스트가 증명하는 범위와 실행 전제에 따라 job을 나눈 뒤, 원격 환경에서 자격을 확인한
부분만 필수 체크로 승격한다.

관련 근거:

- [`plugin-lifecycle.test.mjs`](../../Tests/CoordinatorOperational/plugin-lifecycle.test.mjs)
- [`local-dogfood-preparation.test.mjs`](../../Tests/LocalDogfood/local-dogfood-preparation.test.mjs)
- [`internal-dmg-packaging.test.mjs`](../../Tests/AppPackaging/internal-dmg-packaging.test.mjs)
- [`runtime-harness.mjs`](../../Tests/CoordinatorPersistence/runtime-harness.mjs)

### 4.3 현재 내부 DMG 계약

현재 fresh 내부 DMG 경로는 다음 흐름을 목표로 한다.

```text
현재 소스 fingerprint
  → 저장소 밖 private snapshot
  → 전체 Xcode로 Swift release build
  → Blabee.app 조립
  → 앱 ad-hoc 서명
  → DMG 생성·verify·read-only mount 구조 검사
  → SHA-256 sidecar 생성
  → 내부 테스트 산출물
```

현재 반환 계약은 명시적으로 다음 상태다.

```text
app_signing = adhoc
dmg_signing = unsigned
notarized = false
public_distribution_ready = false
```

빌더는 source snapshot, 앱 구조, ad-hoc 서명, DMG 구조, `hdiutil verify`, mount/detach,
checksum, 출력 잠금과 중단 복구를 검증한다. 이 검증을 workflow 안에 다시 구현하지 않고
고수준 빌더를 단일 진입점으로 호출하는 것이 원칙이다.

근거:

- [`INTERNAL_DMG_PACKAGING.md`](INTERNAL_DMG_PACKAGING.md)
- [`build-fresh-internal-dmg.mjs`](../../scripts/build-fresh-internal-dmg.mjs)
- [`build-internal-dmg.mjs`](../../scripts/build-internal-dmg.mjs)

### 4.4 현재 작업 트리로 인한 구현 금지 조건

현재 다른 세션의 작업에는 다음 변경이 포함돼 있다.

- `package.json`의 `test:swift` 추가
- `build:internal-dmg`를 fresh builder로 전환
- 수정 중인 low-level DMG builder와 패키징 테스트
- 아직 Git이 추적하지 않는 fresh builder와 해당 테스트

GitHub runner는 미커밋·미추적 파일을 볼 수 없다. 이 변경이 하나의 검증된 기준
commit으로 확정되기 전에는 CI가 `test:swift` 또는 fresh `build:internal-dmg`를
호출하도록 구현해서는 안 된다.

또한 저장소 루트에 보이는 `.github/workflows/architecture-check.yml`은 현재 다른
세션의 미추적 Blabase 전용 파일이다. Blabee CI 작업에서 수정·이동·포함하지 않는다.

## 5. 전체 목표 구조

```text
개발 branch
   │
   └─ PR
       │
       └─ Workflow A: Blabee PR CI
           ├─ Blabee 영향 없음 → 빠른 Not applicable 성공
           └─ Blabee 영향 있음
               ├─ portable contract/core
               ├─ macOS runtime/Swift
               └─ 고정 이름의 PR Gate
                       │
                       └─ 사람이 review 후 merge
                              │
                              ▼
                            main
                              │
                              └─ Workflow B: Internal Artifact
                                  ├─ 자동 검증 재실행
                                  ├─ fresh internal DMG
                                  ├─ checksum/metadata
                                  └─ 임시 artifact, 공개 없음
                                           │
                                           └─ 내부 테스트

고정된 release tag
   │
   └─ 사람이 Workflow C 실행
       └─ 보호 Environment 승인
           └─ Developer ID 서명 → 공증 → stapling
               └─ draft Release
                   └─ clean-Mac Pet↔Codex 검증
                       └─ 사람이 Publish
```

각 화살표는 별도의 증거 게이트다. 앞 단계 성공이 다음 단계를 자동 승인하지 않는다.

## 6. Workflow A — PR CI 설계

### 6.1 목적

PR의 변경을 `main`에 합치기 전에 결정적인 자동 회귀를 발견한다. Apple 인증서나
공증 비밀정보는 전혀 사용하지 않는다.

### 6.2 제안 파일과 표시 이름

- 미래 파일: `.github/workflows/blabee-ci.yml`
- Workflow 표시 이름: `Blabee CI`
- 최종 필수 check 이름: `Blabee PR Gate`

Branch protection은 내부 job 이름 여러 개가 아니라 이 고정된 최종 gate 하나만 요구한다.
내부 테스트 구성이 바뀌어도 저장소 정책의 check 이름이 흔들리지 않게 하기 위해서다.

### 6.3 Trigger와 변경 범위

필수 check로 사용할 workflow 자체에는 `paths:` 필터를 걸지 않는다. 모든 PR에서
가벼운 scope job은 실행하고, 무거운 테스트만 조건부로 실행한다.

이유는 GitHub가 경로 필터 때문에 workflow 전체를 생략하면 required check가
`Pending`에 남아 무관한 PR까지 merge를 막을 수 있기 때문이다.

[GitHub의 skipped workflow와 required check 설명](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs)

Blabee 영향 경로의 최소 범위는 다음과 같다.

```text
apps/blabee/**
.github/workflows/blabee-*.yml
```

Scope 판별 자체가 실패하거나 base/head commit을 정확히 비교할 수 없으면 테스트를
생략하지 않고 fail-closed한다.

### 6.4 초기 job 분할

#### Job A — `scope`

- 저렴한 Ubuntu runner에서 실행한다.
- PR base와 head 사이의 변경 파일을 판별한다.
- `blabee_changed=true|false`를 출력한다.
- Blabee와 무관한 PR도 최종 gate가 완료될 수 있게 한다.
- 구현 방식은 GitHub 공식 도구 또는 직접 검토한 스크립트를 사용하며, 불필요한
  third-party action dependency는 추가하지 않는다.

#### Job B — `pr-node-contract-core`

초기 필수 후보:

```text
npm ci
npm run test:contracts
npm run test:t007a
```

- 순수 계약·참조 코어 계층을 우선 대상으로 한다.
- 구현 시 Linux에서도 의미가 동일함을 한 번 자격 확인한 뒤 Ubuntu 사용 여부를
  결정한다.
- npm cache를 사용하더라도 `npm ci`는 매번 실행한다.
- `node_modules` 자체는 cache하지 않는다.

#### Job C — `pr-macos-runtime`

초기 대상 후보:

- RuntimeQualification
- CoordinatorPersistence
- 실제 Codex lifecycle을 제외한 CoordinatorOperational 테스트
- 전체 Swift package 테스트

이 job은 전체 Xcode가 있는 검증된 GitHub-hosted macOS image에서 직렬 실행한다.
`xcodebuild -version`, `swift --version`, Node/npm, runner OS와 architecture를 로그에
남긴다.

현재 `test:t011`에는 실제 `codex`를 실행하는 `plugin-lifecycle.test.mjs`가 섞여 있다.
따라서 다음 중 하나를 별도 후속 변경으로 선택해야 한다.

1. workflow에서 CI-safe 테스트 파일을 명시적으로 호출한다.
2. 디버깅 작업 종료 후 `package.json`에 의미가 명확한 `test:ci:*` script를 추가한다.

유지보수성은 2번이 낫지만, 이는 이번 설계 범위가 아니며 별도 승인과 PR이 필요하다.

#### Job D — `pr-gate`

- 앞 job의 성공·실패·취소·생략과 관계없이 항상 실행되도록 설계한다.
- Blabee 변경이면 필요한 모든 필수 job이 성공해야 성공한다.
- Blabee 무관 변경이면 `Not applicable` 이유를 표시하고 성공한다.
- scope 오류, 예상하지 않은 skip, timeout 또는 취소는 통과 증거가 아니므로 실패한다.
- `continue-on-error`로 실패를 숨기지 않는다.

### 6.5 실제 Codex 테스트의 위치

다음 테스트는 초기 PR 필수 gate에서 분리한다.

- `plugin-lifecycle.test.mjs`
- LocalDogfood의 실제 Codex lifecycle 부분

이 테스트는 명시적으로 지원하는 Codex 버전을 설치하고, 격리된 `HOME`과 `CODEX_HOME`을
사용하는 `codex-compatibility` job에서 실행한다. 초기에는 수동 또는 예약 실행으로
자격을 확인하고, 설치 provenance·버전 고정·flakiness가 검증된 뒤 release gate 포함
여부를 결정한다.

분리한다는 것은 중요하지 않다는 뜻이 아니다. “코드 자체의 결정적 회귀”와 “외부
Codex 버전과의 실제 통합”을 서로 다른 실패 원인과 증거로 보여주기 위함이다.

### 6.6 Runner 정책

- 사용자 Mac을 self-hosted runner로 사용하지 않는다.
- 구현 시점에 Swift 6과 호환되는 macOS/Xcode image를 dry run으로 확인한다.
- `macos-latest` 대신 확인된 OS major label을 사용한다.
- OS major label도 patch 수준까지 영구 고정되는 것은 아니므로 도구 버전을 매번 기록한다.
- 미래 image 변화를 미리 보기 위해 안정화 후 비필수 주간 `macos-latest` canary를
  고려한다.
- 현재 `test:swift`의 `/Applications/Xcode.app`과 고정 `/tmp` 경로는 fresh runner에서
  반드시 dry run해야 한다.

[GitHub-hosted runner 참고 문서](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

### 6.7 권한과 보안

PR workflow의 기본 권한은 다음으로 제한한다.

```yaml
permissions:
  contents: read
```

- Apple secret을 정의하거나 참조하지 않는다.
- 일반 `pull_request` event를 사용한다.
- 신뢰하지 않은 PR 코드를 더 높은 권한과 실행할 수 있는 `pull_request_target`은
  사용하지 않는다.
- 외부 action은 가급적 GitHub 공식 action으로 제한한다.
- action은 구현 시 검토한 full commit SHA로 고정한다. 이동 가능한 tag는 immutable
  reference가 아니다.
- 로그와 artifact에 credential, Keychain 내용, 대화 원문을 남기지 않는다.

[GitHub Actions 보안 지침](https://docs.github.com/en/actions/reference/security/secure-use)

### 6.8 동시 실행과 취소

- 같은 PR에 새 commit이 push되면 이전 PR CI를 취소한다.
- 서로 다른 PR은 독립적으로 실행한다.
- 취소된 실행은 성공으로 재해석하지 않는다.
- 자동 재시도로 초록색 결과가 나올 때까지 반복하지 않는다.

[GitHub workflow concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)

### 6.9 Shadow에서 필수 체크로 승격

처음부터 merge 필수 조건으로 켜지 않는다.

1. **Shadow**: workflow는 실행하지만 merge를 막지 않는다.
2. **Qualification**: 관련 PR 성공, 의도적 실패, 무관 경로, workflow-only 변경,
   timeout/cancel을 검증한다.
3. **Stabilization**: 대표 변경에서 최소 5회 연속 정상 동작하고 flake와 비용을 기록한다.
4. **Enforcement**: 그 뒤에만 `Blabee PR Gate`를 ruleset/branch protection의 필수
   check로 지정한다.

[GitHub protected branch](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

## 7. Workflow B — `main` 내부 artifact 설계

### 7.1 목적

`main`의 특정 commit에서 소스와 대응하는 내부 테스트용 DMG를 재현하고, DMG와
checksum을 임시 보관한다. GitHub Release를 만들거나 외부에 공개하지 않는다.

### 7.2 제안 파일과 trigger

- 미래 파일: `.github/workflows/blabee-internal-artifact.yml`
- 표시 이름: `Blabee Internal Artifact`
- Trigger:
  - 초기: `workflow_dispatch`로 shadow 실행
  - 안정화 후: 기본 branch의 Blabee 관련 push

이 workflow는 merge 필수 check가 아니므로 안정화 후 workflow-level path filter를
사용할 수 있다. Blabee source뿐 아니라 workflow 자체 변경도 trigger에 포함한다.

### 7.3 Job 흐름

```text
정확한 main commit checkout
  → 자동 CI-safe Node/Swift 검증 재실행
  → AppPackaging 전체 검증
  → fresh internal DMG 생성
  → `.sha256` 독립 재검증
  → build metadata 생성
  → DMG + checksum + metadata artifact 업로드
```

현재 고수준 `build:internal-dmg`가 앱 조립과 DMG 검증을 포함하므로, 별도
`build:macos-app`을 선행해 다른 바이너리를 섞지 않는다. fresh builder가 checkpoint
commit에 포함된 뒤 그 단일 진입점을 사용한다.

출력은 빌더가 허용하는 canonical system temporary directory에서 매 실행 고유한 이름으로
생성한다. GitHub의 임의 환경 변수가 빌더의 경로 정책을 만족한다고 가정하지 말고
qualification에서 확인한다.

### 7.4 Artifact 내용

```text
Blabee-internal-<full-or-short-commit>-<run-number>.dmg
Blabee-internal-<...>.dmg.sha256
build-metadata.json
```

`build-metadata.json`에는 비밀이 아닌 다음 사실만 기록한다.

- full commit SHA
- workflow run ID와 attempt
- Node, npm, Xcode, Swift 버전
- runner OS와 architecture
- DMG SHA-256
- 자동 테스트별 `passed / failed / not_run`
- `app_signing=adhoc`
- `dmg_signing=unsigned`
- `notarized=false`
- `public_distribution_ready=false`

권장 보관 기간의 시작값은 14일이다. 실제 내부 테스트 주기와 저장소 정책을 확인한 뒤
조정한다. Actions가 제공하는 업로드 digest와 별개로 외부 전달 확인용 `.sha256`은 계속
유지한다.

### 7.5 공개 방지 조건

- 먼저 저장소가 private인지 확인한다.
- public 저장소라면 artifact 접근 정책이 확정되기 전 내부 DMG 업로드를 중단한다.
- source snapshot, 임시 Keychain, 로그 전체, secret은 업로드하지 않는다.
- GitHub Release를 자동 생성하지 않는다.
- 웹사이트, 업데이트 feed 또는 불특정 사용자에게 전달하지 않는다.
- 앱 실행, `/Applications` 복사, Plugin 설치, SMAppService 등록을 workflow에서 하지
  않는다.

### 7.6 실패와 재시도

- Node/Swift/AppPackaging 실패: DMG 생성과 업로드를 중단한다.
- DMG 빌드 실패: artifact를 게시하지 않는다.
- checksum 불일치: artifact를 게시하지 않는다.
- artifact 업로드 실패: workflow 전체를 실패로 처리한다.
- `hdiutil` 실패는 자동 재시도하지 않는다.
- main 실행은 초기에는 `cancel-in-progress: false`로 두어 각 commit의 증거를 보존한다.

## 8. Workflow C — 수동 공개 Release/CD 설계

### 8.1 현재 구현하지 않는 이유

현재 패키징은 ad-hoc/unsigned/unnotarized/internal-only 계약이다. 이 계약에 public mode를
몰래 추가하거나 main artifact를 사후 재서명하지 않는다. 공개 릴리스에는 별도의
패키징 계약과 테스트가 먼저 필요하다.

권장 미래 구조:

```text
build-internal-dmg.mjs
 └─ 계속 ad-hoc / unsigned / internal-only

새 public release builder
 └─ Developer ID / hardened runtime / notarized release candidate
```

### 8.2 Trigger와 입력

- 미래 파일: `.github/workflows/blabee-release.yml`
- 초기 trigger: `workflow_dispatch`만 사용
- 입력: 이미 생성된 `blabee-vX.Y.Z+build.N` 형식의 정확한 tag
  ([앱 업데이트 확인 계약](../features/APP_UPDATES.md)의 버전·빌드 번호와 일치)
- workflow가 확인할 조건:
  - tag가 존재하고 움직이지 않는다.
  - tag가 기본 branch에 포함된 commit을 가리킨다.
  - 입력 version, bundle version/build, tag가 일치한다.
  - 요구되는 CI와 main artifact 결과가 그 SHA에서 성공했다.

`workflow_dispatch`는 workflow가 기본 branch에 있어야 GitHub UI에서 사용할 수 있다.

[GitHub 수동 workflow 실행](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

### 8.3 권한을 나눈 job 구조

```text
release-preflight
  └─ contents: read, secret 없음

sign-and-notarize
  └─ protected environment 승인 후 Apple secret 사용

create-draft-release
  └─ Apple secret 없음, 이 job만 contents: write
```

Workflow 전체에 쓰기 권한을 주지 않는다. Draft Release를 만드는 마지막 job에만 필요한
권한을 부여한다.

### 8.4 보호 Environment

제안 이름은 `blabee-public-release`다.

- release tag만 허용한다.
- 가능하면 required reviewer를 둔다.
- 운영 인원이 여러 명이면 self-review를 금지한다.
- Developer ID와 notarization credential은 environment secret으로 제한한다.
- 승인되기 전 job은 secret에 접근할 수 없어야 한다.

Required reviewer와 private 저장소 지원 범위는 GitHub 요금제에 따라 달라질 수 있다.
혼자 운영하면서 self-review를 금지하면 승인자가 없어질 수도 있다. 저장소 visibility와
요금제를 확인한 뒤 실제 승인 모델을 정한다. 기능을 사용할 수 없더라도 수동 실행과
draft-only 생성, 별도 Publish 클릭이라는 두 사람/두 단계 논리는 유지한다.

[GitHub deployments와 environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)

### 8.5 Apple 배포 신뢰 사슬

공개 후보의 목표 순서는 다음과 같다.

```text
fresh release build
  → nested executable을 안쪽부터 Developer ID 서명
  → main app을 마지막에 서명
  → hardened runtime + secure timestamp 확인
  → app signature/entitlement 검증
  → read-only DMG 생성·서명
  → `notarytool submit --wait`
  → Accepted와 notarization log 확인
  → 최종 DMG에 ticket staple
  → staple/Gatekeeper/checksum 검증
  → draft Release
```

- 서명은 `--deep` 한 번으로 대신하지 않고 nested code를 안쪽부터 수행한다.
- `codesign --deep --strict`는 검증에 사용할 수 있다.
- 공증 timeout 뒤 같은 파일을 즉시 재제출하지 않는다. submission ID로 기존 상태를
  먼저 확인해 중복 요청을 피한다.
- 인증서는 job 전용 임시 Keychain에 import한다.
- 성공·실패와 관계없이 임시 Keychain과 credential 파일을 정리한다.
- notarization submission ID와 비밀을 제외한 log를 보존한다.

[Apple Developer ID 인증서](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)

[Apple macOS 공증](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

[Apple Hardened Runtime](https://developer.apple.com/documentation/xcode/configuring-the-hardened-runtime/)

[GitHub에서 Apple 인증서 설치](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)

### 8.6 Draft까지만 자동화

Workflow는 다음 파일을 draft Release에 붙인다.

- Developer ID 서명·공증·stapling이 완료된 DMG
- SHA-256
- build/release metadata
- 공개 가능한 release note 초안

Workflow는 Publish를 누르지 않는다. 사람이 아래 clean-Mac 검증을 완료하고 exact DMG
hash와 draft asset이 같음을 확인한 뒤 GitHub UI에서 공개한다.

[GitHub Release 관리](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)

## 9. 자동 증거와 사람 승인의 계층

| 단계 | 증명하는 것 | 증명하지 못하는 것 |
|---|---|---|
| 정적 구성 | workflow 문법·권한 설계 | 명령이 실제 runner에서 성공함 |
| PR 자동 테스트 | 해당 commit의 자동 계약 | DMG 설치와 실제 사용자 경험 |
| main 내부 DMG | ad-hoc 내부 산출물의 구조·checksum | 공개 개발자 신원과 공증 |
| Developer ID·공증 | Apple 배포 신뢰 사슬 | Pet·Plugin·SMAppService 실사용 성공 |
| clean-Mac 검사 | 특정 실제 환경의 설치·왕복 | 모든 OS·기기에서의 무결점 |
| 사람이 Publish | 공개 승인 결정 | 기존 설치의 자동 rollback |

CI 결과에 `passed`, `failed`, `not_run`을 구분한다. 실행하지 않은 검증을 성공으로
표시하지 않는다.

## 10. Clean-Mac 사람 승인 계약

공개 전 최소한 다음을 실제 사람이 확인한다.

### 10.1 시험 환경 기록

- tag와 full commit SHA
- 앱 version/build
- DMG SHA-256
- macOS version과 Mac architecture
- Codex version
- notarization submission ID
- 각 항목의 `통과 / 실패 / 실행하지 않음`

비밀번호, API key, 전체 Keychain, 대화 원문이나 journal 원문은 수집하지 않는다.

### 10.2 설치와 Gatekeeper

1. 다운로드한 DMG의 SHA-256을 확인한다.
2. DMG를 열고 `/Applications`에 복사한다.
3. `xattr` 삭제나 Gatekeeper 비활성화 없이 정상 실행되는지 확인한다.
4. 메뉴바 아이콘과 설정 UI를 확인한다.

### 10.3 서비스와 상태

1. SMAppService 등록·해제를 실제로 수행한다.
2. System Settings의 로그인 항목 상태를 확인한다.
3. 앱 종료·재실행을 확인한다.
4. 로그아웃·로그인 또는 재부팅 뒤 coordinator 시작을 확인한다.
5. sleep/wake 뒤 상태를 확인한다.
6. signed Keychain 경로를 확인한다.

### 10.4 Codex와 Pet 왕복

1. 앱에서 Codex Plugin을 연결한다.
2. 새 Codex 세션의 `/hooks`에서 네 Hook을 사람이 직접 검토한다.
3. 실제 Codex 작업을 완료한다.
4. Pet 카드가 표시되는지 확인한다.
5. 선택이 같은 Codex 세션의 새 턴으로 정확히 전달되는지 확인한다.
6. `Pet 전달 완료`와 `실제 후속 작업 성공`을 별도로 기록한다.
7. 권한 요청의 허용·거절 경로를 확인한다.
8. Plugin 연결 해제와 SMAppService 해제를 확인한다.

### 10.5 호환성과 복구

- 이전 버전에서 upgrade
- 지원하는 경우 downgrade
- 앱 제거와 사용자 데이터 보존
- 이전 known-good 릴리스 재설치 rehearsal

기존 내부 설치 경계는 [`INTERNAL_TEST_INSTALL_GUIDE.md`](../guides/INTERNAL_TEST_INSTALL_GUIDE.md)를
함께 따른다.

## 11. 실패·flake·재시도 정책

| 상황 | CI/CD 해석 | 기본 처리 |
|---|---|---|
| `npm ci` 실패 | lockfile/설치 계약 미충족 | 이후 단계 중단 |
| 필수 테스트 실패 | 자동 계약 미충족 | PR Gate 실패 |
| timeout 또는 취소 | 통과 증거 없음 | 실패 처리 |
| 무관한 경로 변경 | Blabee 검사 불필요 | 명시적 Not applicable 성공 |
| DMG 빌드 실패 | 배포 후보 생성 실패 | artifact 없음 |
| checksum 불일치 | 산출물 무결성 실패 | artifact 없음 |
| artifact 업로드 실패 | 보관 증거 실패 | main workflow 실패 |
| notarization 거부 | 공개 배포 자격 실패 | draft/publication 중단 |
| clean-Mac 실패 | 자동 검사는 통과했지만 제품 불합격 | draft 유지, 공개 금지 |

정책 원칙:

- 자동 retry로 실패를 숨기지 않는다.
- 수동 재실행 시 최초 실패와 재실행 결과를 함께 기록한다.
- known flake에는 owner, 원인, 만료 조건이 있어야 한다.
- `continue-on-error`를 필수 gate에 사용하지 않는다.
- managed 실행이나 공증이 timeout되면 이미 실행됐을 가능성을 먼저 조사한다.
- `hdiutil` 실패 뒤 남은 mount·lock·transaction을 확인하지 않고 반복하지 않는다.

## 12. 공급망과 비밀정보 보안

### 12.1 PR과 main

- 기본 `GITHUB_TOKEN` 권한은 `contents: read`다.
- Apple secret을 PR/main workflow에 두지 않는다.
- fork PR의 코드를 release secret과 함께 실행하지 않는다.
- `pull_request_target`을 사용하지 않는다.
- action은 검토된 full commit SHA로 고정한다.
- third-party action 추가가 필요하면 별도 dependency 결정과 보안 검토를 거친다.
- npm cache에 secret이나 `node_modules`를 넣지 않는다.

### 12.2 공개 릴리스

- Developer ID private key와 비밀번호는 저장소에 넣지 않는다.
- notarization credential은 protected environment에서만 제공한다.
- signing job은 저장소 쓰기 권한이 없다.
- draft 생성 job은 Apple secret을 받지 않는다.
- 임시 Keychain과 credential 파일은 항상 정리한다.
- secret 값을 stdout/stderr, artifact 또는 build metadata에 기록하지 않는다.

### 12.3 Artifact provenance

Artifact attestation은 workflow와 산출물의 관계를 추가로 증명할 수 있지만 Developer ID나
Apple 공증을 대신하지 않는다. 공개 릴리스가 안정된 뒤 선택적으로 검토한다.

[GitHub artifact attestation](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)

## 13. 비용과 실행시간 정책

- macOS runner는 Linux보다 비용과 대기 부담이 클 수 있다.
- scope job과 순수 Node test는 자격이 확인되면 Ubuntu에서 실행한다.
- macOS 전용 테스트와 Swift는 한 개 또는 소수의 macOS job으로 묶는다.
- 같은 PR의 오래된 run은 취소한다.
- main과 release 산출물 생성은 초기에 취소하지 않는다.
- 처음에는 Swift build cache를 사용하지 않고 깨끗한 결정성을 확인한다.
- Node cache는 lockfile 기준 npm 다운로드 cache만 사용하고 `npm ci`는 유지한다.
- shadow 기간에 실제 시간과 비용을 측정한 뒤 job 병렬화·cache를 결정한다.
- 비공개 저장소의 macOS runner 과금과 조직 사용 한도를 구현 전에 확인한다.

[GitHub Node.js CI](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)

[GitHub dependency caching](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching)

## 14. Rollback 설계

현재 자동 updater가 없으므로 rollback은 서버가 앱을 자동 복원하는 기능이 아니다.

- 실패한 draft는 공개하지 않는다.
- tag와 공개 asset을 같은 이름으로 덮어쓰지 않는다.
- 마지막 known-good DMG와 checksum을 보존한다.
- 공개 후 결함은 일반 revert PR과 새 patch version으로 수정한다.
- 필요하면 결함 버전을 최신 권장판에서 내리고 안내한다.
- 이전 DMG 재설치 전 DB, Keychain, Plugin, service 설정의 downgrade 호환성을 확인한다.
- 앱 바이너리 rollback과 저장 데이터 rollback을 같은 것으로 취급하지 않는다.
- 앱 삭제만으로 사용자 DB/Keychain을 자동 삭제하지 않는다.

## 15. 단계별 도입 계획

| ID | 작업 | 의존성 | 완료 기준 | 위험 |
|---|---|---|---|---|
| CI-00 | 이 설계 승인 | 없음 | 범위·원칙·미결정 항목 합의 | 낮음 |
| CI-01 | 현재 디버깅 작업 checkpoint | CI-00 | 필요한 package/fresh builder/test가 한 commit에 있고 SHA 기록 | 높음 |
| CI-02 | 별도 worktree/branch 준비 | CI-01 | 활성 checkout 무변경, exact checkpoint 기반 | 낮음 |
| CI-03 | PR workflow shadow | CI-02 | 원격 runner에서 scope와 테스트 결과 표시 | 중간 |
| CI-04 | workflow 자격 시험 | CI-03 | 성공·의도적 실패·무관 경로·workflow-only·취소 시나리오 확인 | 중간 |
| CI-05 | 필수 check 활성화 | CI-04 | 안정된 `Blabee PR Gate`만 ruleset에 등록 | 높음 |
| CD-01 | main 내부 artifact | CI-04, fresh builder commit | exact SHA의 DMG·checksum·metadata 생성, 공개 없음 | 중간 |
| CD-02 | artifact 전달 rehearsal | CD-01 | 다른 사람이 checksum 확인 후 내부 설치 가능 | 중간 |
| REL-00 | 공개 릴리스 계약 | CD-02 | version·architecture·OS·entitlement·rollback 결정 | 높음 |
| REL-01 | public packager와 테스트 | REL-00 | internal 경로 유지, public 경로 별도 자격 | 높음 |
| REL-02 | 보호 environment와 secrets | REL-01 | 최소 권한·승인·임시 Keychain rehearsal | 높음 |
| REL-03 | draft Release workflow | REL-02 | Accepted 공증·stapling 후 draft만 생성 | 높음 |
| REL-04 | clean-Mac acceptance | REL-03 | 설치·SMAppService·Keychain·Hook·Pet 왕복 통과 | 높음 |
| REL-05 | 수동 Publish와 rollback drill | REL-04 | 사람이 공개하고 이전판 복구 절차 확인 | 높음 |

각 작업의 완료는 다음 작업을 자동 승인하지 않는다. 특히 `CI-00` 설계 승인은 workflow
구현, push, GitHub 설정 변경 또는 Apple secret 등록 권한을 포함하지 않는다.

## 16. 미래 구현 시 안전한 작업 순서

1. 현재 디버깅 세션이 제공한 exact checkpoint commit SHA를 확인한다.
2. 활성 checkout의 미커밋 파일을 복사·stage·stash하지 않는다.
3. monorepo root에서 새 branch와 별도 worktree를 만든다.
4. 첫 PR에서는 `.github/workflows/blabee-ci.yml`만 추가하는 것을 원칙으로 한다.
5. 현재 미추적 Blabase workflow를 가져오거나 수정하지 않는다.
6. 다른 세션이 활성인 동안 로컬 Swift·DMG·dogfood 테스트를 실행하지 않는다.
7. workflow diff에 합의한 파일 외 변경이 없는지 확인한다.
8. 사용자 승인 후에만 branch를 push한다.
9. GitHub-hosted runner의 shadow 결과를 검토한다.
10. 별도 승인 후 required check를 켠다.
11. main artifact와 public release는 각각 독립된 후속 PR로 진행한다.

Worktree는 파일과 Git index 충돌을 줄이고, GitHub-hosted runner는 `/tmp`, Keychain,
Application Support와 실행 프로세스 충돌을 막는다. 둘 다 사용해야 현재 디버깅 세션과
충분히 분리된다.

## 17. 미래에 추가·수정될 가능성이 있는 파일

### 17.1 PR CI 단계

추가 후보:

```text
.github/workflows/blabee-ci.yml
```

GitHub 외부 설정:

```text
main ruleset 또는 branch protection
```

선택적 후속 변경:

```text
apps/blabee/package.json        # CI-safe test group 이름 추가
```

CI 자체는 Swift/Pet/coordinator 제품 소스 변경을 요구하지 않는다.

### 17.2 내부 artifact 단계

추가 후보:

```text
.github/workflows/blabee-internal-artifact.yml
```

Fresh builder 변경이 이미 별도 checkpoint로 확정돼 있어야 한다. CI 작업이 그 변경을
대신 완성하거나 수정하지 않는다.

### 17.3 공개 릴리스 단계

추가·수정 후보:

```text
.github/workflows/blabee-release.yml
apps/blabee/scripts/<public-release-builder>.mjs
apps/blabee/Tests/AppPackaging/<public-release-tests>.test.mjs
apps/blabee/Packaging/macos/<release-entitlements-or-signing-inputs>
apps/blabee/package.json        # release command
공개 release·clean-Mac·rollback runbook
```

Developer ID/Hardened Runtime 적용 뒤 entitlement, Keychain 또는 SMAppService 문제가
발견되면 제품 변경을 이 작업에 섞지 않는다. 별도의 원인 분석과 승인된 제품 PR로
분리한다.

## 18. 구현 전 사람이 결정해야 할 항목

- GitHub 저장소가 public인지 private인지
- GitHub 요금제에서 필요한 protected environment 승인을 지원하는지
- 실제 default branch가 `main`인지
- macOS Actions 비용·사용량 한도
- 사용할 runner OS major, Xcode와 architecture
- 고정할 Node 22 patch version
- CI-safe test group을 workflow에 적을지 `package.json`에 추가할지
- 실제 Codex 호환성 job에서 지원할 Codex 버전과 설치 provenance
- artifact 보존 기간을 14일로 시작할지
- 내부 DMG를 GitHub artifact에 보관해도 되는 접근 정책인지
- 공개 최초 version과 build number의 단일 기준
- Apple Silicon 전용인지 Universal Binary인지
- Developer ID Application 인증서와 공증 credential 보유 여부
- 필요한 entitlement와 signing order
- 최소 macOS 13 및 현재 macOS를 시험할 clean Mac
- release 승인자와 clean-Mac 담당자
- dSYM 보관 위치와 기간
- upgrade, downgrade, rollback 및 사용자 데이터 보존 정책
- merge queue 사용 계획

## 19. 설계 수용 기준

이 설계는 다음 조건을 모두 만족해야 구현 준비 완료로 본다.

- 현재 디버깅 checkout과 미커밋 파일을 건드리지 않는다.
- GitHub-hosted runner만 사용하고 사용자 Mac을 runner로 사용하지 않는다.
- GitHub에 올라간 exact commit만 검사한다.
- required workflow가 무관한 monorepo PR을 `Pending`으로 막지 않는다.
- PR CI에 secret과 repository 쓰기 권한이 없다.
- 빠른 계약, macOS 런타임, 실제 Codex, 패키징 테스트를 구분한다.
- 실행하지 않은 검증을 성공으로 표시하지 않는다.
- main artifact가 Release 또는 공개 배포로 오인되지 않는다.
- internal DMG와 public DMG가 별개의 계약과 경로를 가진다.
- Developer ID secret은 보호 승인 뒤에만 제공된다.
- signing job과 draft 생성 job의 권한이 분리된다.
- 공증 성공과 Pet·Plugin·SMAppService 실사용 성공을 별도 증거로 다룬다.
- 공개는 exact draft artifact의 clean-Mac 검증 뒤 사람만 수행한다.
- workflow 구현 중 제품 소스 수정 필요가 발견되면 자동 수정하지 않고 중단한다.
- commit, push, ruleset, secret 등록, tag, Release는 각각 명시적 승인 뒤 수행한다.

## 20. 공식 참고 문서

- [GitHub Actions 기본 개념](https://docs.github.com/en/actions/get-started/understand-github-actions)
- [Workflow trigger](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Workflow concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data)
- [Protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [Secure use of GitHub Actions](https://docs.github.com/en/actions/reference/security/secure-use)
- [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Manual workflow runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
- [Apple Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)
- [Apple distribution-signed macOS code](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/)
- [Apple Hardened Runtime](https://developer.apple.com/documentation/xcode/configuring-the-hardened-runtime/)
- [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [GitHub의 Apple signing certificate 설치 가이드](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)

## 21. 현재 상태

- 설계 문서: 작성 완료
- Workflow 구현: 시작하지 않음
- 테스트·빌드 실행: 하지 않음
- GitHub 설정 변경: 하지 않음
- 제품 소스 변경: 하지 않음
- Apple secret 등록: 하지 않음
- commit/push: 하지 않음
