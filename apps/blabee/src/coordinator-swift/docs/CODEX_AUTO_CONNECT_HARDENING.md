# Codex 자동 연결 안정화 설계

- 상태: v3 소스 구현, 자동 회귀 검증 및 실제 설치 dogfood 왕복 완료
- 작성일: 2026-08-28
- 대상: `BlabeeCoordinator`의 Codex 자동 연결 기능
- 근거: `CodexAutoConnect.swift`, `DoctorApplication.swift`, `PetCodexAutoConnect.swift`, `PetViewModel.swift` 직접 검토

## 1. 목표와 범위

사용자가 일반적인 `codex` 및 `codex resume` 명령만 사용해도 Blabee 관리형 실행기로 안전하게 연결되도록 한다. 자동 연결을 켜거나 끄는 과정에서 사용자 셸 설정을 잃지 않아야 하며, Finder에서 실행한 Pet과 다양한 Codex 설치 방식에서도 상태가 정확히 갱신되어야 한다.

이번 작업은 아래 일곱 가지 리뷰 항목을 해결한다.

1. 지원하지 않는 Codex 버전의 활성화 차단
2. `.zshrc` 검증과 교체 사이의 데이터 손실 경쟁 조건 제거
3. 변경할 파일이 없는 `disable`도 공통 잠금으로 직렬화
4. `ZDOTDIR`가 지정한 실제 `.zshrc` 처리
5. GUI 환경의 제한된 `PATH`에서도 안전한 Codex 탐색
6. Pet 새로고침과 활성화 시 Codex 재탐색
7. 일반 Homebrew `0775` 설치를 매 실행 신뢰 확인으로 제한적으로 지원

원격 셸, zsh 이외의 셸, 임의의 버전 자동 호환, 사용자 셸 초기화 스크립트 실행은 이번 범위에 포함하지 않는다.

## 2. 문제와 사용자 영향

| 우선순위 | 문제 | 현재 근거 | 사용자 영향 |
| --- | --- | --- | --- |
| P1 | 지원 버전을 확인하지 않고 활성화 | 자동 연결은 실행 파일과 inode를 검증하지만 Doctor의 버전 정책을 적용하지 않는다. | 구버전 Codex에서 일반 `codex`와 `codex resume`이 모두 관리형 경로로 전환된 뒤 즉시 실패할 수 있다. |
| P1 | `.zshrc`의 검증 후 일반 `rename` | 목적지 검증과 교체가 분리되어 있어 그 사이 외부 편집기의 저장을 덮어쓸 수 있다. | 사용자가 방금 저장한 셸 설정이 소리 없이 유실될 수 있다. |
| P2 | 빈 상태의 `disable`이 잠금 전에 반환 | 파일이 없거나 관리 표식이 없으면 공통 파일 잠금을 얻기 전에 성공한다. | 동시에 대기 중이던 `enable`이 나중에 완료되어, 끄기 요청과 반대로 최종 상태가 켜질 수 있다. |
| P2 | `$HOME/.zshrc`만 수정 | `ZDOTDIR`를 반영하지 않고 항상 홈 디렉터리의 파일을 대상으로 한다. | 실제 zsh가 읽지 않는 파일을 수정한 뒤 UI는 활성화된 것으로 잘못 표시할 수 있다. |
| P2 | GUI 프로세스의 `PATH`만 중심으로 탐색 | Finder나 로그인 항목에서 실행하면 nvm, asdf, Volta 등의 사용자 경로가 `PATH`에 없을 수 있다. | 터미널에서는 Codex가 실행되지만 Pet은 설치되지 않은 것으로 표시할 수 있다. |
| P2 | 시작 시 탐색 결과를 계속 재사용 | 앱 시작 때 발견한 Codex URL을 manager가 고정해서 보관한다. | Pet 실행 후 Codex를 설치·업데이트해도 앱을 재시작하기 전까지 상태가 복구되지 않는다. |

## 3. 설계 결정

### 3.1 Doctor와 자동 연결이 하나의 버전 정책을 사용한다

- 지원 버전 목록, 알파 기준 버전, 버전 문자열 파싱 및 판정 결과를 공용 정책으로 분리한다.
- 판정 결과는 최소 `supported`, `actionRequired`, `unsupported`, `unavailable`을 구분한다.
- UI의 활성화 가능 여부와 `enable()`의 실제 실행 직전 검증에 같은 정책을 적용한다.
- `enable()`은 캐시된 판정을 신뢰하지 않고 현재 실행 파일의 identity와 `codex --version`을 다시 확인한다.
- 이미 설치된 관리 설정의 새로고침은 버전 프로세스 없이 identity와 권한을 재검증한다. 변경을 발견하면 `repairRequired`로 표시하고, 다음 실제 실행에서 전체 버전 검증을 수행한다.
- 버전 조회와 프로세스 실행은 MainActor 밖에서 수행한다.

### 3.2 `.zshrc` 변경은 목적지를 원자적으로 확보한 뒤 검증한다

기존의 “검증 후 교체” 순서를 “원자 교체로 기존 목적지를 확보한 후 확보한 inode 검증”으로 바꾼다.

1. 같은 파일 시스템에 고유한 임시 파일을 만들고 내용과 디렉터리를 동기화한다.
2. 기존 목적지가 있으면 macOS의 `renameatx_np(..., RENAME_SWAP)`으로 목적지와 임시 파일을 원자적으로 교환한다.
3. 교환으로 임시 경로에 밀려난 기존 inode가 작업 시작 시 예상한 파일과 동일한지 검증한다.
4. 일치하면 밀려난 파일을 안전하게 제거하고 작업을 확정한다.
5. 불일치하면 역교환하여 외부 작성자의 파일을 복원한다. 역교환으로 밀려난 파일도 다시 검증하고, 그 사이 또 다른 외부 저장이 있었다면 새 파일을 삭제하지 않은 채 최신 파일을 복원하거나 관련 파일을 모두 격리한다.
6. 기존 목적지가 없으면 `RENAME_EXCL`로 “여전히 없음”을 원자적으로 보장한다.

`RENAME_SWAP`을 사용할 수 없거나 안전한 복원을 보장할 수 없는 환경에서는 일반 `rename`으로 폴백하지 않고 실패 처리한다. 관리 표식 제거도 검증 후 `unlink`하는 방식 대신 동일한 원자 확보 원칙을 적용한다. 검증되지 않은 inode는 성공·충돌·복구 어느 경로에서도 삭제하지 않는다.

### 3.3 `enable`과 `disable`의 모든 분기를 같은 잠금으로 보호한다

- `disable()`은 파일 존재 여부나 관리 표식 여부를 확인하기 전에 공통 프로세스 간 잠금을 획득한다.
- no-op 판단, 파일 다시 읽기, 변경, 최종 검증까지 잠금 안에서 수행한다.
- `enable()`과 `disable()`은 동일하고 안정적인 잠금 파일을 사용한다.
- 잠금 파일은 동작마다 제거하지 않는다. 제거하면 서로 다른 inode를 잠그는 split-lock 경쟁 조건이 생길 수 있다.
- 단위 테스트는 실제 `flock` 선점으로 lock 경합을 검증한다. `Tests/LocalDogfood/codex-auto-connect-concurrency.test.mjs`는 별도 coordinator 프로세스 여섯 개의 enable/disable을 실제로 겹쳐 실행하고, 최종 상태와 `.zshrc`·관리 파일이 일관되며 임시·복구 파일이 남지 않는지 확인한다.

### 3.4 실제 zsh 시작 파일을 안전하게 결정한다

- 프로세스 환경의 `ZDOTDIR`가 비어 있지 않고 절대 경로이면 `$ZDOTDIR/.zshrc`를 사용한다.
- `ZDOTDIR`가 없으면 `$HOME/.zshrc`를 사용한다.
- 명시적 절대 `ZDOTDIR`가 있어도 zsh가 그보다 먼저 또는 함께 읽는 시스템 `.zshenv`와 초기 `$ZDOTDIR/.zshenv`를 검사한다. 주석·빈 줄 이외의 실행 가능한 내용이 있으면 경로가 실행 중 바뀌지 않는다고 증명할 수 없으므로 실패 폐쇄한다.
- 상대 경로, 동적 셸 계산, 해석이 모호한 `.zshenv` 설정 등 실제 경로를 안전하게 확정할 수 없는 경우 `unavailable`로 실패 폐쇄한다.
- 탐색을 위해 `zsh -lic`, `.zshenv`, `.zprofile`, `.zshrc` 등 사용자 셸 초기화 코드를 자동 실행하지 않는다.
- 활성화 시 실제 대상 `.zshrc` 경로를 관리 메타데이터에 기록하고, 비활성화는 현재 환경이 아니라 기록된 경로를 우선 사용한다.
- 기존 메타데이터에 경로가 없는 레거시 설치는 정확한 관리 표식과 파일 identity를 확인한 경우에만 `$HOME/.zshrc` 대상으로 마이그레이션한다.

### 3.5 Codex 탐색은 안전한 후보만 결정적으로 검사한다

후보 우선순위는 다음과 같다.

1. 현재 프로세스 `PATH`의 절대 경로 항목 순서
2. 절대 경로인 `NVM_BIN`
3. 알려진 정적 사용자 설치 위치: `~/.local/bin/codex`
4. `~/.nvm/versions/node/*/bin/codex`의 결정적 정렬 결과
5. `/opt/homebrew/bin/codex`, `/usr/local/bin/codex`

모든 후보는 버전 명령을 실행하기 전에 이름 경로와 최종 target, 상위 디렉터리의 소유권·쓰기 권한·심볼릭 링크·실행 가능 여부를 통과해야 한다. 이름 경로의 shim이나 alias 자체를 직접 실행하지 않고, 안정된 이름 경로와 canonical target을 함께 승인 기록에 보관한다. world-writable 경로와 임의의 group-writable 경로는 거부한다. 예외는 정확히 `/opt/homebrew/bin/codex` 또는 `/usr/local/bin/codex`가 해당 Homebrew의 `Cellar`/`Caskroom` target을 가리키는 경우뿐이다. 이 예외도 target 자체의 group/world-write와 권한을 확대하는 `allow` ACL을 계속 거부하고, 매 실행마다 경로 identity를 다시 확인한다. macOS 홈의 표준 deny-only ACL처럼 권한을 줄이는 ACL은 허용한다. 사용자 로그인 셸을 실행해 `command -v codex`를 얻는 방식은 사용하지 않는다. 여러 후보가 통과하면 후보 우선순위와 안정적인 정렬 규칙으로 항상 같은 파일을 선택한다.

asdf 및 Volta의 shim은 현재 프로젝트에 따라 실제 실행 파일이 달라질 수 있으므로 자동 후보로 실행하거나 저장하지 않는다. 기본 `~/.asdf/shims`, `~/.volta/bin`뿐 아니라 절대 `ASDF_DATA_DIR/shims`, `VOLTA_HOME/bin`도 shim root로 인식하고, 제외 이유와 실제 실행 파일이 필요하다는 오류를 표시한다. live manager는 같은 root 목록을 기존 managed metadata 검증에도 재사용하므로, 이전 빌드가 custom shim 경로를 저장했더라도 버전 명령을 실행하지 않고 `repairRequired`로 전환하며 비활성화만 허용한다. 명시적 실행 파일 선택 UI는 아직 구현되지 않은 후속 과제다. NVM의 버전별 실제 `bin/codex`는 경로가 고정되어 있으므로 안전 검사를 통과한 경우만 후보로 사용한다.

### 3.6 Pet 새로고침과 활성화는 비동기로 재탐색한다

- 앱 시작 결과를 영구 스냅샷으로 사용하지 않는다.
- 설정 화면 진입, 사용자의 새로고침, `enable()` 시작 시점마다 resolver가 Codex와 실제 `.zshrc`를 다시 탐색한다.
- 탐색, 버전 조회, 파일 검증은 전용 worker에서 실행하고 MainActor에는 완성된 상태 스냅샷만 전달한다.
- 한 번의 새로고침에서는 하나의 qualification 결과로 `state`와 `canEnable`을 함께 계산한다. 두 값을 따로 조회해 서로 다른 버전 판정을 섞지 않는다.
- `enable()`은 UI 스냅샷과 별개로 잠금 안에서 최신 실행 파일 identity와 지원 버전을 다시 확인한다.
- 변경 작업의 성공과 실패 모두에서 작업에 사용한 manager를 재사용하지 않고 새 manager를 만들어 결과 스냅샷을 계산한다. 탐색 때 지원되던 버전이 실행 직전 미지원으로 바뀌면 UI도 즉시 `unavailable`, `canEnable=false`로 갱신한다.
- 새로고침 중에는 이전 상태를 “확인된 최신 상태”로 표시하지 않고 별도의 loading 상태를 사용한다.
- Codex가 설치·제거·업데이트되면 앱 재시작 없이 다음 새로고침에서 상태가 바뀌어야 한다.

### 3.7 v3 실행 경계는 빠른 확인과 변경 시 재승인을 분리한다

- 활성화할 때 `0600` 권한의 `codex-runtime-approval.json`에 안정된 이름 경로, canonical target, 파일 identity, 상위 디렉터리의 보안 identity, 승인된 버전과 정책 버전을 기록한다.
- 이후 모든 `codex` 호출은 셸에서 공식 Codex를 바로 실행하지 않고 `blabee-coordinator codex-launch -- ...`를 통과한다.
- 실행 파일과 경로가 승인 기록과 같으면 파일 메타데이터와 ACL만 확인하고 `codex --version`을 다시 실행하지 않는다.
- Homebrew 업데이트 등으로 identity가 바뀌면 공통 파일 잠금 안에서 다시 확인한 뒤 전체 버전 호환성 검사를 한 번 수행하고 승인 기록을 원자적으로 갱신한다.
- 새 target이 미지원이거나 검증 중 다시 바뀌면 실행하지 않으며 이전 target으로 우회하지 않는다.
- 일반 passthrough 명령은 최종 확인 후 `execv`하여 현재 작업 디렉터리, TTY, 표준 입출력, signal과 종료 상태를 Codex에 그대로 넘긴다.
- 인자가 없거나 `resume`인 관리형 실행은 app-server와 TUI 시작 직전에 같은 승인 token을 다시 확인한다. 두 프로세스 사이에 target이 바뀌면 TUI를 시작하지 않고 먼저 시작한 app-server를 정리한다.
- coordinator 또는 승인 기록이 없거나 손상되면 공식 Codex를 조용히 직접 실행하지 않고 명시적으로 실패한다.

### 3.8 active-writer 충돌은 관찰만 하고 Codex의 결정을 보존한다

- Blabee는 `thread/resume` 요청과 동일한 typed JSON-RPC ID의 응답만 process-memory에서 제한적으로 연결한다. 문자열 ID와 정수 ID는 서로 다르며, 중복 ID는 해당 bridge 수명 동안 관찰에서 격리한다. 중복 ID와 관찰 한도 초과는 안내만 포기하고 transport는 계속한다.
- `-32600` 코드와 `thread <lowercase canonical UUID> already has an active writer` 전체 문구가 모두 일치할 때만 충돌로 판정한다. raw 오류, thread ID, request ID, PID, 경로는 안내 sink로 전달하지 않는다.
- App Server 응답 원본을 TUI에 먼저 byte-exact로 전달하고 성공한 뒤에만 고정 안내를 비동기로 최대 한 번 출력한다. 관찰 파싱이나 안내 출력 실패는 Codex 연결 실패로 전파하지 않는다.
- Blabee는 이 경로에서 archive/unarchive, writer lock 삭제, 프로세스 종료, 자동 재시도, 성공 응답 합성, Codex 원본 오류의 대체·억제를 하지 않는다.
- 따라서 다른 Codex 클라이언트가 writer를 보유한 동안 재개가 실패하는 것은 Codex의 원래 보호 동작이다. Blabee는 원인을 설명할 뿐 소유권을 넘기거나 보호를 우회하지 않는다.

## 4. 상태 및 오류 계약

자동 연결 UI는 최소 다음 원인을 서로 구분해 표시해야 한다.

- `codexNotFound`: 안전한 후보에서 Codex를 찾지 못함
- `unsupportedCodexVersion`: 발견했지만 공용 정책에서 미지원
- `unsafeCodexExecutable`: 실행 파일 identity 또는 권한 검증 실패
- `zshConfigurationUnresolved`: 실제 `.zshrc`를 안전하게 결정할 수 없음
- `operationBusy`: 다른 프로세스가 잠금을 보유함
- `concurrentExternalEdit`: 원자 교체 과정에서 외부 변경을 감지함
- `recoveryRequired`: 자동 복원 여부를 증명하지 못해 격리 및 수동 확인 필요

오류가 발생하면 UI가 활성화 성공을 표시해서는 안 되며, 사용자 파일 변경 여부와 복구 위치를 진단 정보에 남긴다.

## 5. 수용 기준

### 지원 버전

- Doctor에서 지원되는 버전만 자동 연결을 활성화할 수 있다.
- 미지원 버전은 `enable()` 호출 직전에도 차단되며 `.zshrc`와 관리 파일이 변경되지 않는다.
- Doctor와 자동 연결의 동일 버전 입력 결과가 항상 일치한다.

### 원자 파일 변경과 잠금

- 목적지 검증 직후 외부 편집기가 `.zshrc`를 교체해도 그 새 내용이 유실되지 않는다.
- 충돌 시 작업 전 상태로 복원되거나, 복원을 증명할 수 없으면 안전한 격리와 오류로 종료된다.
- `RENAME_SWAP` 불가 환경에서 일반 `rename`으로 진행하지 않는다.
- 서로 다른 프로세스의 clean `enable`/`disable` 경합에서 마지막으로 잠금을 획득한 요청의 의도가 최종 상태에 반영된다.

### 경로와 탐색

- 절대 `ZDOTDIR` 환경에서는 해당 디렉터리의 `.zshrc`만 변경한다.
- 실제 경로가 모호하면 어떤 `.zshrc`도 변경하지 않고 unavailable로 표시한다.
- Finder에서 실행한 Pet도 표준 Homebrew 후보, 안전한 NVM 실제 설치 및 `~/.local/bin` 설치를 검사한다. 표준 Homebrew의 `0775` ancestry는 v3 실행 경계에서 매번 감시하는 조건으로만 허용한다.
- 프로젝트별 target이 달라지는 기본·사용자 지정 asdf/Volta shim은 자동 실행하지 않고 shim이 아닌 실제 실행 파일이 필요하다고 표시한다. 실제 경로 선택 UI는 후속 과제다.
- 안전성 또는 지원 버전 검사를 통과하지 못한 후보는 선택하지 않는다.

### 실행 승인과 업데이트

- identity가 같은 반복 실행에서는 추가 버전 probe와 승인 파일 쓰기가 발생하지 않는다.
- 표준 Homebrew symlink가 지원되는 새 target으로 바뀌면 잠금 아래에서 버전 probe와 승인 갱신이 한 번만 일어난다.
- 새 target이 미지원이면 실행, 승인 갱신, 이전 target fallback이 모두 일어나지 않는다.
- coordinator 누락·실패, 승인 파일 누락·손상 시 공식 Codex를 자동 우회 실행하지 않는다.

### 새로고침

- Pet보다 나중에 Codex를 설치해도 새로고침 후 활성화 가능 상태로 바뀐다.
- Codex 제거 또는 미지원 버전 교체도 새로고침 후 즉시 반영된다.
- 탐색과 버전 조회 중 UI가 멈추지 않는다.

## 6. 테스트 매트릭스

| 영역 | 필수 사례 | 기대 결과 |
| --- | --- | --- |
| 버전 정책 | 지원 목록, 알파 기준, 구버전, 파싱 불가, 실행 시간 초과 | Doctor와 자동 연결의 결과가 동일하고 미지원/불명은 변경 전 차단 |
| 실행 직전 재검증 | 상태 조회 후 Codex 실행 파일 또는 버전 교체 | `enable()` 실패, 사용자 파일 무변경 |
| 원자 교체 | 정상 기존 파일, 목적지 없음, swap 미지원 | 정상 확정, `RENAME_EXCL` 성공, 각각 fail closed |
| 외부 편집 경쟁 | 검증 직후 편집기 저장, mismatch 복원 중 재경쟁 | 외부 저장 보존, 안전 복원 또는 격리 |
| 안전 제거 | 표식 검증 직후 파일 교체 | 외부 파일을 삭제하지 않고 충돌 오류 |
| 프로세스 간 잠금 | 별도 프로세스의 clean enable/disable 동시 실행 | 단일 잠금으로 직렬화되고 결정적인 최종 상태 |
| `ZDOTDIR` | 미설정, 절대 경로, 상대 경로, 시스템·초기 ZDOTDIR의 동적 `.zshenv`, 레거시 메타데이터 | 올바른 경로 또는 무변경 unavailable, 안전한 레거시 처리 |
| GUI 탐색 | 축소된 `PATH`, 기본/custom asdf·Volta shim, nvm 복수 버전, `~/.local/bin`, Homebrew | shim은 actionable 오류로 제외하고 안전한 실제 후보만 결정적으로 선택 |
| 악성 후보 | 타 사용자 소유, world-write, 비표준 group-write, 권한을 확대하는 ACL, 위험한 링크, 비실행 파일 | 후보 거부 |
| 실행 빠른 경로 | identity가 같은 반복 호출 | 매번 구조 검증, 버전 probe와 승인 파일 쓰기 0회 |
| Homebrew 업데이트 | stable symlink의 지원/미지원 target 교체, 동시 실행 | 지원 target은 잠금 아래 1회 재승인, 미지원 target은 실행·fallback 없이 차단 |
| 실행 전달 | passthrough argv·환경·cwd·TTY·signal·종료 코드 | coordinator가 검증한 canonical target으로 `execv`, 의미 보존 |
| 관리형 일관성 | app-server와 TUI 사이 target 변경 | TUI 미실행, app-server 정리, 자동 중간 재승인 없음 |
| active-writer 관찰 | exact 충돌, ID 타입 불일치, 중복 ID, 정상 응답, malformed/과대 JSON, 즉시 응답 경쟁 | 원본 양방향 byte-exact 전달, exact 충돌만 고정 안내 1회, 자동 조치·재시도 없음 |
| 재탐색 | 앱 시작 후 설치·제거·업데이트, 명시적 새로고침, enable 성공·실패 직후 | 앱 재시작 없이 fresh manager의 최신 상태 반영 |
| 회귀 | 일반 `codex`, `codex resume`, 비활성화 후 원래 명령 | 관리형 연결 및 원상 복귀가 각각 정상 |

## 7. 구현 및 출시 순서

1. Doctor와 자동 연결의 공용 버전 정책 및 계약 테스트
2. 공통 잠금 범위 확대와 실제 다중 프로세스 경쟁 테스트
3. `RENAME_SWAP` 기반 원자 교체·제거 및 충돌 복구 테스트
4. `ZDOTDIR` 대상 결정과 관리 메타데이터 경로 기록
5. 안전한 사용자 설치 위치 탐색과 결정적 후보 선택
6. Pet의 비동기 재탐색 및 상태 갱신
7. v3 runtime approval, `codex-launch`, Homebrew monitored trust 적용
8. 전체 Swift 테스트, literal `codex`/`codex resume` dogfood, 축소된 GUI `PATH` 및 Homebrew 업데이트 dogfood

각 단계는 앞 단계의 테스트가 통과한 뒤 진행한다. 새 운영 의존성은 추가하지 않는다.

## 8. 마이그레이션과 롤백

- 새 관리 파일은 v3 스키마 표식과 실제 `.zshrc` 경로를 기록하고, 실행 승인은 별도의 `0600` JSON 파일에 보관한다.
- 기존 v1/v2 관리 파일은 정상 `enabled`로 간주하지 않고 `repairRequired`로 표시한다. 정확한 관리 표식을 확인한 경우 안전한 비활성화 또는 명시적 재활성화로 v3에 올린다.
- 경로가 누락되거나 대상·표식을 정확히 확인할 수 없는 레거시 설치는 자동 수정하지 않고 `recoveryRequired`로 전환한다.
- 미지원 Codex가 이미 연결된 경우 정상 활성 상태로 표시하지 않되, 기록된 `.zshrc` 경로를 이용한 안전한 비활성화 경로는 제공한다.
- 롤백은 기록된 대상에서 Blabee가 추가한 정확한 관리 구간만 제거한다. 사용자 변경을 발견하면 삭제·덮어쓰기 대신 중단한다.
- 새 빌드 배포 전 기존 자동 연결을 안전하게 끄고, 새 빌드에서 다시 활성화하는 dogfood 절차를 검증한다.

## 9. 남은 위험과 후속 과제

- `RENAME_SWAP`의 파일 시스템별 지원 차이는 fail-closed 동작과 진단 메시지로 다뤄야 한다.
- 네트워크 홈 디렉터리와 비표준 파일 시스템은 별도 호환성 검증이 필요하다.
- 사용자 정의 설치 경로는 알려진 후보만으로 찾지 못할 수 있으므로 명시적 실행 파일 선택 UI가 후속 과제다. 현재 제품에 이 UI나 명시 경로 입력 기능이 있다고 가정하지 않는다.
- v3는 표준 Homebrew 경로의 group-writable ancestry를 매 실행 재검증해 실용적으로 지원하지만, 같은 로컬 관리 그룹의 다른 계정이 쓰기 가능한 다중 사용자 Mac에서는 단일 사용자 Mac보다 위협 범위가 크다. 더 강한 보장이 필요하면 private pinned executable이 후속 과제다.
- Darwin에는 일반적으로 사용할 수 있는 `fexecve`가 없어 마지막 identity 확인과 canonical path `execv` 사이의 극히 짧은 경로 교체 경쟁을 완전히 제거하지 못한다. 현재 구현은 실행 직전 재확인, 실패 폐쇄, 재시도와 fallback 금지로 이를 줄인다.
- Homebrew 업데이트 직후 첫 실행은 전체 버전 검증만큼 한 번 느려질 수 있다. 변경 없는 실행 hot path에는 Keychain, journal, daemon socket 또는 버전 프로세스를 추가하지 않는다.
- 동일한 미지원 target은 현재 실행 시도마다 다시 버전 검증될 수 있다. 안전성은 유지되지만 반복 지연을 줄이는 거부 identity cache는 후속 최적화다.
- 동적으로 계산되는 `ZDOTDIR`는 셸 코드를 실행하지 않는 원칙상 자동 지원하지 않는다. 명시적 시작 파일 선택 UI가 후속 과제다.
- 명시적 절대 `ZDOTDIR` 유무와 관계없이 시스템 또는 초기 ZDOTDIR의 `.zshenv`에 실행 가능한 설정이 있으면 간접 `source`·`eval`까지 정적으로 증명할 수 없으므로 실패 폐쇄한다.
- 버전 허용 목록과 실제 `--remote`, `app-server --listen stdio://` 기능이 어긋날 수 있으므로 향후에는 버전과 기능 probe를 함께 관리한다.
- 다른 Codex 클라이언트가 보유한 active-writer는 Blabee가 안전하게 인계받을 수 없다. 공식 handoff 계약이 추가되기 전에는 원본 실패를 보존하고 수동으로 소유 클라이언트의 사용을 끝내야 한다.
- 복구 중 프로세스가 비정상 종료되는 경우를 대비해 임시·격리 파일의 수명 주기와 Doctor 복구 안내를 별도 검증한다.
- 일반 편집기 저장과 dotfile 동기화 경쟁은 원자 교체와 inode 검증으로 방어한다. 그러나 현재 사용자와 같은 UID로 디렉터리를 악의적으로 실시간 감시하며 무작위 격리 이름까지 바꾸는 프로세스는 이번 위협 모델에 포함하지 않는다. 그런 정황이 감지되면 자동 삭제보다 파일 보존과 수동 복구를 우선한다.
- 잠금 회귀 테스트는 동일 테스트 프로세스의 실제 `flock` 선점과 별도 coordinator 프로세스들의 동시 enable/disable을 모두 검증한다. 겹쳐 실행된 요청 사이에는 외부에서 관찰 가능한 선후관계가 없으므로 특정 호출 순서를 강제하지 않고, 잠금이 정한 직렬 순서의 마지막 완전한 상태와 부분 설치 부재를 검증한다.

## 10. 자동 검증 결과

- 전체 테스트: Swift Testing 423개와 XCTest 5개, 총 428개 통과 (2026-08-30)
- release 빌드: `swift build -c release` 통과
- 실제 coordinator subprocess: passthrough argv, 작업 디렉터리, 환경 정리, 종료 코드 전달, 변경 없는 승인 fast path 통과
- 별도 프로세스 경쟁: enable/disable 동시 실행과 supported drift 동시 launch 2건 통과
- supported drift 경쟁에서 버전 probe 1회, 두 launch 성공, 완전한 `0600` 승인 JSON, 임시·복구 산출물 0개 확인
- 실제 dogfood 앱·서비스·Pet·플러그인을 `hybrid-runtime-v3` 산출물로 교체하고 자동 연결 v3를 활성화했다.
- 새 로그인 셸의 literal `codex`와 저장된 세션의 literal `codex resume`가 모두 관리형 `codex-launch` 경로를 사용함을 확인했다.
- Pet의 관리형 일회성 승인 3건이 실제 명령 결과로 이어졌고, 수동 프롬프트가 기존 제안 카드를 정리한 뒤 결정·권한·라우팅 대기열이 모두 비어 있음을 확인했다.

## 11. 검증 근거의 한계

코드베이스 그래프의 해당 Blabee 경로는 검토 시점에 `freshness:not_tracked`로 보고되어 구조적 완전성의 근거로 사용하지 않았다. 이 문서의 현재 문제 진술은 위 Swift 소스의 직접 검토와 리뷰 재현 분석을 근거로 하며, 구현 후 변경 파일 전체를 다시 인덱싱하거나 직접 소스 및 테스트로 검증해야 한다.
