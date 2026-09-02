# 관리형 Codex 런타임 신뢰 경계

- 상태: 구현 및 자격 검증 중
- 최종 개정: 2026-09-02
- 대상: 사용자가 명시적으로 실행하는 `blabee-codex`

## 원칙

Blabee는 일반 `codex` 명령, 공식 Codex 설치 파일, `PATH`, `.zshrc`, alias 또는
shell function을 변경하지 않는다. Plugin/Hook 통합은 Codex가 원래 제공하는 플러그인
경로를 사용한다. App Server 기반 권한 중계는 사용자가 `blabee-codex`를 직접 선택한
호출에만 적용한다.

관리형 실행이 호환성 또는 신뢰 검사에서 실패해도 Blabee는 공식 Codex를 수정,
다운그레이드, 자동 롤백하거나 다른 Codex 설치로 자동 전환하지 않는다. 관리형 기능만
실패 폐쇄하고 사용자는 공식 `codex`를 그대로 실행할 수 있다.

## 승인 단위

Codex는 단일 실행 파일이 아니다. 관리형 실행은 다음 official package 구조를 하나의
원자적 런타임 단위로 취급한다.

```text
codex-package.json
bin/codex
bin/codex-code-mode-host
codex-path/rg
codex-resources/...
```

`codex-package.json`의 `layoutVersion`, `version`, `target`, `variant`, `entrypoint`,
resource/path directory를 제한된 스키마로 읽는다. 절대 경로, `..` 탈출, symlink,
특수 파일, 허용하지 않은 hardlink, 잘못된 owner·mode·ACL, 아키텍처·서명 불일치,
파일 수·크기·깊이 상한 초과는 관리형 자식을 시작하기 전에 거부한다.

본체만 복사하거나 다른 설치·버전의 `codex-code-mode-host`를 섞지 않는다. host 환경
override는 관리형 환경에서 제거하고, 검증한 private bundle의 exact host만 사용한다.

버전 allowlist와 production bundle 자격은 서로 다른 승인이다. allowlist는 Codex
프로토콜을 검토한 semantic version 후보를 뜻한다. production bundle 자격은 같은 Team
ID나 version 문자열만 믿지 않고 manifest의 모든 필드와 package tree 전체의 경로,
종류, digest, 실행 비트, 서명 Team ID와 아키텍처를 묶은 canonical fingerprint가
검토된 release catalog와 정확히 일치함을 뜻한다.

2026-09-02 현재 catalog에 등록된 production bundle은 official Homebrew Codex
`0.151.0` Apple Silicon(`aarch64-apple-darwin`) 하나다. `0.149.1`과 `0.150.1`은
semantic allowlist에 남아 있지만 현재 production bundle 자격은 등록되지 않았다.
`0.152.0`, Intel target과 그 밖의 미등록 version·target 조합도 관리형 실행 자격이 아니다.
이 경우는 `qualification_required`, 이미 등록된 version·target인데 전체 fingerprint가
다른 bundle은 mismatch로 실패 폐쇄한다. catalog 일치만으로 code-mode live 자격까지
통과한 것으로 보지는 않는다.

## 실행 순서

1. `blabee-codex` 진입 wrapper는 coordinator를 `exec`하기 전에 `DYLD_*`,
   `__XPC_DYLD_*`, `LD_*` 동적 로더 override를 검사하고 값은 출력하지 않은 채 관리형
   호출만 실패 폐쇄한다. coordinator도 같은 prefix와 실행 환경으로 직렬화될 수 없는
   이름·값을 다시 거부한다. 일반 `codex` 환경은 바꾸지 않는다.
2. 절대 PATH 항목, `NVM_BIN`, `~/.local/bin`, 안전한 NVM 설치 및 표준 Homebrew 이름
   경로에서 official package 후보를 찾는다. 첫 번째로 존재하는 후보가 실패하면 뒤의
   다른 설치를 자동 선택하지 않는다. asdf·Volta처럼 target이 프로젝트에 따라 변하는
   shim은 자식 실행 전에 거부한다.
3. 후보의 package root를 descriptor 기반으로 열고 bounded manifest를 검사한다. package
   root와 허용된 하위 경로를 `O_NOFOLLOW`로 순회하며 본체, host, `rg`와 resources의
   identity·digest를 수집한다.
4. canonical current-user directory 아래에 process-local staging root를 `0700`으로
   만든다. root descriptor를 기준으로 source와 destination을 열어 정확한 byte를
   복사하고, directory는 `0700`, 실행 파일은 `0500`, data file은 `0400`으로 제한한다.
   source identity를 복사 전후 재확인하고 destination digest와 manifest를 다시 검증한
   뒤에만 private runtime을 원자 게시한다. 복사 전에 bounded recovery plan을 임시
   파일에 쓰고 fsync한 뒤 원자 게시하므로, 프로세스가 중간에 종료돼도 다음 실행이
   exact identity와 lease를 확인한 항목만 회수할 수 있다.
5. 이 private bundle의 `bin/codex --version`을 한 번 실행한다. probe는 검증한 관리형
   환경 snapshot, 별도 session/process group, CLOEXEC 기본값과 bounded stdout·stderr를
   사용한다. 정상 종료와 timeout·출력 초과 모두 남은 group을 TERM→KILL하고 direct
   child를 reap한다.
6. App Server, TUI, 보조 세션과 첫 자식 전 fallback은 같은 private bundle을 사용한다.
   최초 게시 때는 전체 digest·서명을 검사하고, 각 spawn 경계에서는 root·directory·file의
   exact stat identity, mode·owner·ACL·link와 작은 seal digest를 다시 확인한다. 따라서
   수백 MB 전체 payload를 반복해서 해시하지 않으면서도 본체·host·manifest·resource 중
   하나라도 변하면 같은 process tree에서 재승인하지 않고 실패 폐쇄한다.
7. 첫 관리형 자식이 시작되기 전에만 준비 실패를 같은 private bundle의 shell-free
   `execve`로 정확히 한 번 fallback할 수 있다. 자식이 하나라도 시작된 뒤에는 자동
   재실행하거나 native Codex로 전환하지 않는다.

## 수명주기와 정리

승인한 원본 경로나 digest를 영속 신뢰 상태로 저장하지 않는다. private bundle은 현재
관리형 process tree에만 속하며 lease가 살아 있는 동안만 보존한다. 정상 종료 뒤에는
Blabee가 작성한 self-manifest와 exact identity가 모두 일치하는 항목만 bottom-up으로
제거한다.

알 수 없는 파일, symlink, identity drift 또는 사용 중인 lease가 있으면 정리를 중단한다.
누수 또는 격리 상태가 사용자 파일을 잘못 삭제하는 것보다 안전하다. 과거 두 항목
(`.lease`, `codex`)으로 구성된 process-local pin은 기존 exact 규칙에 한해 정리할 수
있다. `~/Library/Application Support/Blabee/codex/<version>` 같은 구형 영구 경로는
소유권 증거 없이 재귀 삭제하지 않는다.

비정상 종료 잔여물도 같은 원칙을 따른다. staging/final UUID 이름, owner-only root,
unlocked lease, recovery plan과 현재 partial tree의 subset 관계가 모두 확인된 경우에만
최소 60초가 지난 항목을 제거한다. 손상된 timestamp, 미래 timestamp, overflow,
unknown third entry, ACL·link·type drift가 있으면 삭제하지 않는다. 공유 임시 디렉터리의
관련 없는 항목 수는 Blabee 관리 항목의 회수 가능 여부에 영향을 주지 않아야 한다.

## Doctor와 버전 자격

정적 Doctor는 read-only다. private pin이나 영속 파일을 만들지 않고 관리형 child도
시작하지 않는다. `codex --version`, `codex plugin list`, App Server
`hooks/list`를 호출하지 않고 launcher와 같은 runtime inspector의 파일 검사와
daemon의 읽기 전용 `doctor_status` UDS만 사용한다. 다음 결과를 분리한다.

- `codex_runtime_layout`: package manifest와 필수 본체·host·resource 구조
- `codex_runtime_identity`: owner·mode·ACL·symlink·아키텍처·서명과 등록 fingerprint 결합
- `codex_runtime_version`: manifest allowlist와 실행 버전 live 자격 필요 여부
- `codex_code_mode_compatibility`: 실제 code-mode live 자격 여부
- `blabee_build_identity`: 실행 중인 앱·service·Plugin locator가 실제로 확인된 경우의
  build 일치 여부. 표준 `/Applications` fallback만으로 Plugin 일치를 추정하지 않는다.

정적 Doctor는 manifest 버전이 allowlist에 있어도 production fingerprint가 미등록이면
`action_required`로 분리하고, 등록 fingerprint와 다르면 실패한다. catalog가 일치해도 실제 binary 버전 일치,
Plugin 설치·활성, Hook 신뢰, code-mode compatibility를 통과로 추정하지
않는다. 이 항목은 `action_required`로 보고하고 새 Codex 버전
qualification에서 실제 version probe, Plugin/Hook 상태, 임시 명령·파일
작업과 lifecycle을 별도로 검증한다.

Codex `0.152.0`과 현재 로컬에서 확인된 `0.152.1`은 2026-09-02 현재 allowlist 밖이다.
동일 official package의 전체 bundle
검사, 실제 code-mode smoke, App Server/TUI/보조 세션 수명주기, orphan·중복 실행 부재와
native Codex 무변경을 확인한 뒤 마지막 단계에서만 추가한다.

## 제거한 구형 경로

2026-08-31 정리에서 Pet의 Codex 자동 연결 카드, `.zshrc` marker, stable launcher,
디스크 approval record, `codex-auto-connect`, `codex-launch`와 v1~v4 shell generator를
제품 소스에서 제거했다. 과거 공개 빌드가 남아 있다면 native Codex를 건드리지 않는
별도 전환용 uninstaller와 소유권 증명이 필요하다.

## 완료 기준

- host 누락, malformed manifest, mixed-version·mixed-build bundle을 자식 시작 전에 거부한다.
- App Server, TUI, 보조 세션, version probe와 pre-child fallback이 같은 bundle identity를
  사용한다.
- source·destination drift, partial copy와 unknown cleanup entry는 안전하게 실패 폐쇄한다.
- 정적 Doctor 실행 전후 persistent artifact가 생기지 않는다.
- 실제 지원 package에서 관리형 로컬 명령과 임시 파일 읽기·쓰기가 성공한다.
- 정상·실패·signal 종료 뒤 orphan 또는 중복 실행이 남지 않는다.
- 깨끗한 다른 Mac에서 설치부터 첫 Pet 결정·관리형 승인까지 통과한다.
- 일반 `codex`, `resume`, `fork`, `exec`, `plugin`의 경로와 의미가 바뀌지 않는다.

마지막 두 실사용 항목과 0.152.0·0.152.1 자격은 자동 단위 테스트만으로 완료 처리하지 않는다.
