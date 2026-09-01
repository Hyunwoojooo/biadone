# 관리형 Codex 실행 신뢰 경계

- 상태: 현재 계약
- 최종 개정: 2026-09-01
- 대상: 사용자가 명시적으로 실행하는 `blabee-codex`

## 원칙

Blabee는 일반 `codex` 명령, `.zshrc`, alias 또는 shell function을 변경하지 않는다.
Plugin/Hook 통합은 Codex가 원래 제공하는 플러그인 경로를 사용한다. App Server 기반
권한 중계는 사용자가 `blabee-codex`를 직접 선택한 호출에만 적용한다.

## 실행 순서

1. `blabee-codex` 진입 wrapper는 coordinator를 `exec`하기 전에 `DYLD_*`,
   `__XPC_DYLD_*`, `LD_*` 동적 로더 override를 검사하고 값은 출력하지 않은 채 관리형
   호출만 실패 폐쇄한다. 검사 결과는 명시적인 no-match일 때만 통과하며 검사 도구 오류도
   같은 방식으로 거부한다. coordinator도 같은 prefix와 실행 환경으로 직렬화될 수 없는
   이름·값을 다시 거부한 뒤 관리형 인자와 socket을 검증한다. 일반 `codex` 환경은 바꾸지
   않는다.
2. 절대 PATH 항목, `NVM_BIN`, `~/.local/bin`, 안전한 NVM 설치 및 표준 Homebrew
   이름 경로에서 Codex 후보를 찾는다. 없는 경로만 건너뛰며, 첫 번째로 존재하는
   후보가 실패하면 뒤의 다른 설치를 자동 선택하지 않는다.
3. asdf·Volta처럼 프로젝트에 따라 target이 달라지는 shim은 버전 프로세스를
   실행하기 전에 거부한다.
4. 후보의 이름 경로와 canonical target, 모든 상위 디렉터리의 소유권·모드·ACL을
   검사한다. 실행 중인 Blabee와 같은 file object인 후보, interpreter script와
   네이티브 Mach-O가 아닌 파일은 이 단계에서 거부한다.
5. canonical target을 `O_NOFOLLOW`로 열고 검사한 device·inode와 같은지 확인한다.
   pin parent도 canonical current-user directory, group·other 비쓰기, grant ACL 없음과
   생성 전후 동일 identity를 확인한 뒤 그 아래 `0700` 폴더와 `0500` 파일로 복사한다.
6. 이 비공개 고정 복사본으로만 `codex --version`을 한 번 실행한다. probe는 검증한
   관리형 환경 snapshot, 별도
   session/process group, CLOEXEC 기본값과 비차단 64 KiB stdout·stderr 상한을 사용한다.
   정상 종료와 timeout·출력 초과 모두 남은 group을 TERM→KILL하고 direct child를
   reap하며, descendant가 pipe를 잡고 있어도 EOF를 기다리지 않는다. 원래
   package-manager 경로는 프로세스로 실행하지 않는다.
7. App Server, TUI, 보조 세션과 첫 자식 전 fallback은 모두 같은 고정 복사본과
   검증한 환경 snapshot만
   사용한다. 첫 App Server의 `Process.run()` 직전과 이후 모든 spawn 경계에서
   복사본의 exact identity·모드·ACL·네이티브 형식을 다시 확인하고, 변경되면 새
   후보를 승인하지 않고 실패 폐쇄한다.

승인 파일이나 원래 Codex 경로를 영속 상태로 저장하지 않는다. 고정 복사본은 현재
관리형 process tree에만 속하고 정상 종료 시 제거한다. `exec` fallback이 프로세스를
교체한 경우에는 상속한 lease가 실행 중 복사본을 보호하며, 다음 명시적 호출이 종료된
lease의 exact owned 파일만 제한적으로 정리한다. 별도의 `blabee-codex` 프로세스는
매번 위 전체 검사를 다시 수행한다.

## 네이티브 보존과 fallback

실행 파일 탐색, trust 또는 지원 버전 확인이 실패하면 네이티브 Codex로 fallback하지
않는다. 안전한 fallback target이 아직 확정되지 않았기 때문이다. 비공개 고정
복사본을 확정한 뒤 token 또는 listener 준비가 첫 관리형 자식 시작 전에 실패한
경우에만, identity를 한 번 더 확인하고 같은 argv로 그 복사본을 정확히 한 번 실행할 수
있다. fallback은 Blabee 내부 변수 다섯 개를 제거한 snapshot을 `execve`에 명시해
qualification 뒤 ambient 환경 변화가 끼어들지 못하게 한다. 자식이 하나라도 시작된
뒤에는 자동 재실행하지 않는다.

일반 경로에는 Blabee가 만든 native passthrough가 없다. 사용자는 공식 `codex`를
직접 실행하며 Blabee는 그 argv와 환경을 변경하지 않는다.

## 제거한 구형 경로

2026-08-31 정리에서 다음 전역 셸 통합은 제품 소스에서 제거했다.

- Pet의 Codex 자동 연결 설정 카드
- `.zshrc` marker와 versioned source 설치·복구 코드
- stable launcher와 디스크 approval record
- `codex-auto-connect` 및 `codex-launch` 내부 명령
- v1~v4 셸 generator와 전용 테스트

로컬 dogfood에 이미 설치되어 있던 owned marker와 관리 파일은 삭제 전에 마지막
구형 빌드의 검증된 `disable` 경로로 복원한다. 다른 사용자 배포 전에 과거 공개
버전이 존재한다면 별도의 전환용 uninstaller가 필요하다.

## 검증 기준

- unsafe path와 dynamic shim은 버전 프로세스를 실행하지 않는다.
- 진입 wrapper의 동적 로더 override는 coordinator를, 내부 검증에서 발견한 override는
  version probe나 관리형 자식을 실행하지 않는다.
- 명시적 관리형 호출 하나당 버전 probe는 고정 복사본에서 한 번이다.
- 같은 process tree의 반복 provider 호출은 probe 없이 고정 복사본 identity만 재검증한다.
- 원본 또는 고정 복사본 drift는 같은 process tree 안에서 재승인되지 않는다.
- 첫 자식 전 native fallback 직전에도 같은 고정 복사본을 재검증한다.
- probe의 정상 종료·timeout·출력 flood에서 forked descendant가 남지 않는다.
- 실제 test-harness process가 live provider의 pin을 `execve` fallback으로 상속하고,
  argv·cwd·검증된 환경·종료 상태를 보존한다. fallback이 살아 있는 동안 aged pin의
  lease가 회수를 막고, 종료 뒤 다음 자격 검사에서 exact pin이 회수된다.
- 일반 `codex`, `resume`, `fork`, `exec`, `plugin`의 의미는 Blabee가 바꾸지 않는다.
