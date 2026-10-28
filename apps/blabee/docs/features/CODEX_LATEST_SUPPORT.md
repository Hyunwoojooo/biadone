# Codex 버전별 지원·검증 기록

## 2026-10-24: 0.164.0 지원과 Hook 신뢰 진단 보완

공식 macOS arm64 Codex 0.164.0의 일반 Plugin·Hook·MCP·queue, Pet 일회성 승인,
관리형 App Server와 업데이트 저장·복원 지원 정보를 소스에 반영했다. 버전·CDHash·
41파일 runtime catalog·workspace 라우팅·lifecycle 및 회귀 기대값을 함께 갱신했다.
`hooks/list`가 기존 신뢰 정보를 이전할 수 있어, Hook 진단의 읽기 전용·실패 시
무변경 보장을 제거하고 검사 전·진행 중·실패 안내와 문서를 보완했다.
[공식 근거와 검증 기록](CODEX_0164_QUALIFICATION.md).

Node/Python 회귀 **233/233**, 공식 패키지의 **69개 native smoke**를 통과했다.
별도 격리 검사에서도 MCP 초기화·목록·호출, 저장·종료·cold resume·압축 기록 복원과
mode·uid/gid·macOS ACL 보존, 기본 설정 변경 뒤 저장된 read-only 권한 유지를 확인했다.
inert Plugin의 Hook 신뢰 정보 이전·부분 이전·내용 변경 감지·공식 재승인 검사도 통과했다.
Swift 컴파일·테스트와 앱 빌드·설치, 설치된 앱의 Hook/Pet/queue 및 업데이트 왕복은
실행하지 않았다. 이번 소스 변경은 설치된 앱에 아직 반영하지 않았다.

## 2026-10-16: 0.163.0 지원과 공식 패키지 구성 변경

공식 최신 안정 버전 0.163.0의 일반 Plugin·Hook·MCP·queue, Pet 일회성 승인,
관리형 App Server와 업데이트 저장·복원 지원 정보를 소스에 추가했다. 공식
패키지에서 patched `zsh`가 제거된 41파일 구성을 정확한 버전·target에만 적용하고,
CDHash·전체 fingerprint·workspace 라우팅·lifecycle 목록과 회귀 검사를 갱신했다.
[공식 근거와 검증 기록](CODEX_0163_QUALIFICATION.md).

Node/Python 회귀 **228/228**, 공식 패키지의 **69개 native smoke**를 통과했다.
추가 격리 검사에서도 저장·정상 종료·cold resume·압축 기록 복원, 기본 설정 변경
후 저장된 read-only 권한 유지와 tools-only MCP 초기화·목록·호출을 확인했다.
Swift 컴파일·테스트와 앱 빌드·설치, 설치된 앱의 Hook/Pet/queue 및 업데이트
왕복은 실행하지 않았다. 설치된 앱에는 아직 이번 소스 변경을 반영하지 않았다.

## 2026-10-11: 0.162.1까지 전체 지원 등록과 종료 지연 경고 수정

공식 macOS arm64 Codex 0.160.1·0.161.0·0.162.0·0.162.1의 일반 Plugin 연결,
Pet 일회성 승인, 관리형 App Server와 업데이트 저장·복원 지원을 소스에 반영했다.
정확한 CDHash·전체 패키지 fingerprint·workspace 라우팅·lifecycle 목록을 함께 갱신했다.
0.162의 정상 종료 지연 경고를 영구 저장 실패로 오인하던 판정도 고쳤다.
[공식 근거와 검증 기록](CODEX_0162_QUALIFICATION.md).

Node/Python 회귀 **223/223 통과**. 직전 격리 검토에서 네 공식 패키지의 각
**71개 native smoke**, 저장·종료·재개·압축 기록 복원 및 MCP 초기화·목록·호출을
통과했다. Swift 컴파일·테스트와 앱 빌드·설치, 설치된 앱의 Hook/Pet/queue 및
업데이트 왕복은 실행하지 않았다. 설치된 앱 반영과 실사용 검증은 남아 있다.

## 2026-10-10: 0.162.0·0.162.1 Hook 일회성 승인

실행 중인 Codex daemon이 CLI 경로와 별도로 0.162.1로 업데이트돼도,
검증된 공식 0.162.0·0.162.1의 일반 Hook 요청은 Pet에서 이번 요청만 승인할 수
있도록 정확한 서명 profile을 추가했다. 설치 r80에는 이 정보가 없어서 승인이
비활성화됐다. [원인·공식 근거·검증 범위](CODEX_0162_HOOK_APPROVAL.md).

당시에는 Hook 승인만 등록했으며 전체 Plugin CLI·관리형 App Server·업데이트
지원 목록은 0.160.0까지였다. 전체 등록 후속 작업은 위의 10월 11일 기록을 따른다.

## 2026-10-05: 0.159.3·0.160.0 지원

당시 대상은 공식 macOS arm64 Codex **0.160.0까지**였다. 새 안정 버전 0.159.3·0.160.0의
Plugin·Hook·MCP·queue 연결, Pet 일회성 명령 승인, 관리형 App Server와 업데이트
저장·복원 지원을 소스에 추가했다. 정확한 CDHash, 42파일 digest·52entry fingerprint,
서버 소유 workspace 라우팅과 별도 lifecycle 지원 목록을 함께 등록했다.
[0.159.3·0.160.0 검증 기록](CODEX_0160_QUALIFICATION.md)에 공식 근거와 제한을 기록했다.

빌드 없는 Node/Python 회귀 **207개**, 두 공식 패키지의 각 **71개 smoke**를 통과했다.
네트워크·사용자 홈을 차단한 native 검사에서도 두 버전의 저장·정상 종료·동일 UUID/cwd
재개와 압축 기록 복원, workspace 정책 보존을 확인했다. Swift 컴파일·테스트,
앱 빌드·설치 및 설치된 앱의 실제 Hook/Pet/queue 왕복은 실행하지 않았다.

같은 작업 중 발생한 `application network permission was revoked`는 Codex가
`Too many open files`로 요구 정책 파일을 읽지 못한 로그와 연결됐다. 이 환경 오류가
이번 버전 등록으로 해결됐다고 판단하지 않는다. 핸들 증가 원인은 별도 추적 대상이며
실행 중인 앱·세션 재시작이나 시스템 한도 변경은 하지 않았다.

## 2026-09-30: 0.158.0·0.159.0·0.159.1·0.159.2 지원 기록

당시 대상은 공식 macOS arm64 Codex 0.159.2까지다. 이전 지원 이후 발표된
0.158.0·0.159.0·0.159.1·0.159.2의 일반 Plugin 연결, Pet 일회성 명령 승인,
관리형 App Server 및 업데이트 저장·복원 지원을 소스에 추가했다. 정확한 실행 파일
CDHash, 전체 패키지 digest·fingerprint, workspace 설정 전달도 함께 반영했다.
상세 근거와 검증 범위는 [0.158·0.159 지원 기록](CODEX_0159_QUALIFICATION.md)에 있다.

빌드 없는 Node/Python 회귀 199개와 공식 네 패키지의 각 71개 smoke 검사를 통과했다.
최신 0.159.2는 네트워크·사용자 홈을 차단한 native 저장·종료·재개 및 압축 기록 복원도
통과했다. 나머지 세 버전의 해당 추가 검사는 결과를 확보하지 못해 실행 통과로 집계하지 않는다.
Swift 컴파일·테스트, 앱 빌드·설치 및 설치된 앱의 Hook/Pet/queue 왕복은 이번에
실행하지 않았다. 0.158부터 기본 활성화된 터미널 입력 승인은 기존 정책대로 Codex
기본 승인으로 전달하며, Pet의 Bash 명령 승인으로 확대 해석하지 않는다.

## 2026-09-28: 0.157.0·0.157.1 지원 기록

현재 대상은 공식 macOS arm64 Codex 0.157.0·0.157.1이다. 일반 Plugin 연결,
Pet 일회성 승인, 관리형 App Server, 업데이트 저장·복원의 지원 정책과 정확한
실행 파일 검증 데이터를 추가했다. 관리형 workspace 설정 전달에도 두 버전을 적용한다.
지원 범위와 검증 결과는 [0.157 지원 기록](CODEX_0157_QUALIFICATION.md)을 기준으로 한다.

빌드 없는 Node/Python 회귀 183개를 통과했고, 수정한 검사기로 두 공식 패키지의
서명·공증·Plugin 동작을 각각 71개 검사했다. 앞선 검토에서 같은 패키지의 격리된
저장·종료·재개 및 압축 기록 복원도 확인했다. Swift 컴파일·테스트와 앱 빌드·설치,
실제 Hook/Pet/queue 왕복 검증은 하지 않았다.

0.157의 기본 daemon도 primary `bin/codex` 패키지를 사용하며, Blabee의 명시적
remote 실행은 자동 daemon 시작에서 제외된다. 기존 daemon 재사용 시 실제 Hook 호스트와
전경 CLI 버전이 다를 수 있다는 점, tool Hook cwd와 세션 cwd가 다른 경우의 승인
fallback은 별도 통합 검증 대상으로 남긴다. 신뢰·세션 경로 일치 조건은 유지한다.

## 2026-09-23: 0.156.0·0.156.1 지원 기록

당시 대상은 공식 macOS arm64 Codex 0.156.0·0.156.1이다. 일반 Plugin 연결,
Pet 일회성 승인, 관리형 App Server, 업데이트 저장·복원의 지원 정책과 정확한
실행 파일 검증 데이터를 추가했다. 지원 범위와 검증 결과는
[0.156 지원 기록](CODEX_0156_QUALIFICATION.md)을 기준으로 한다.

관리형 0.156 실행은 `sandbox_workspace_write` CLI 설정을 원문 그대로 소유한
App Server에 전달한다. native remote 모드가 허용하지 않는 `--add-dir`·`--no-daemon`,
workspace override와 `--profile`의 조합은 App Server·TUI 시작 전에 안내 오류로 거부한다.
`--add-dir`를 기존 roots를 덮어쓰는 설정으로 임의 변환하지 않는다.

빌드 없는 회귀 175개, 두 공식 패키지의 각 72개 smoke 검사, 격리된 저장·종료·재개와
압축 기록 복원을 확인했다. Swift 컴파일·테스트, 앱 빌드·설치, 실제 Hook/Pet/queue
왕복 검증은 하지 않았다.

## 2026-09-21: 0.155.0·0.155.1 지원 기록

아래는 이전 지원 단계의 기록이다. 대상은 macOS arm64와 공식 안정 버전이며 당시 최신 버전은
[Codex 0.155.1](https://github.com/openai/codex/releases/tag/rust-v0.155.1)이다.
0.155.0·0.155.1의 일반 연결, Pet 일회성 승인, 관리형 App Server, 업데이트 시
세션 저장·복원 지원을 소스에 반영했다. 이번 작업에서는 빌드하지 않았다.

## 반영한 기능

| 기능 | 0.155.0·0.155.1 변경 | 확인한 근거 |
| --- | --- | --- |
| Plugin·Hook·MCP·queue | Plugin CLI 버전 등록, Plugin 0.1.2, `SessionStart.source=fork` 등록 | 격리 Plugin 등록·조회·제거, queue CLI 표면, Hook fixture와 공식 소스 비교 |
| Pet 일회성 승인 | 버전과 공식 arm64 CDHash 조합 추가 | 공식 PermissionRequest·승인 처리 소스 동일성, 기존 교차 조합 회귀에 새 profile 포함 |
| 관리형 App Server | 버전 등록과 공식 42파일 runtime catalog 추가 | archive SHA-256, 파일별 digest, 30개 native 파일의 서명·공증, 승인 schema와 remote CLI 계약 |
| 업데이트 저장·복원 | 독립 lifecycle profile에 두 버전 추가 | 격리 AppServer의 저장·정상 종료·동일 UUID/cwd 재개 |

일반 Plugin 지원 목록에서 빠졌던 0.153.0·0.153.1·0.153.3도 추가했다.
따라서 일반 연결은 0.151.0부터 0.155.1까지 발표된 안정 버전 11개를 명시적으로
허용한다. 이전 버전의 관리형 실행·승인·업데이트 지원 범위는 별도로 유지한다.
미발표 버전이나 prerelease를 범위 비교로 자동 허용하지 않는다.

최신 패키지의 `codex-resources/voice/runtime.json`은 JSON이지만 archive에서 0755다.
기존 관리형 검사는 이 권한만으로 native 실행 파일이라고 판단하여 거부했다.
정확한 경로와 공식 파일 SHA-256이 모두 일치할 때만 데이터로 분류하도록 고쳤다.
원본 bytes·권한은 보존하고 private 사본은 기존 정책에 따라 0400으로 봉인한다.
전체 version/target catalog, 사본 digest, 파일 identity와 재검증은 유지한다.

승인은 기존 native `default`/Bash 일회성 허용 범위를 유지한다. 세션·턴·명령·cwd
결합, 호출자 재검증, 거부 우선순위와 지속 권한 확장 거부를 변경하지 않았다.
관리형 승인 adapter의 요청·응답 schema는 0.151.0·0.155.0·0.155.1에서 동일하여
프로토콜 변환 코드는 바꾸지 않았다.

Doctor의 Codex 전용 Plugin 버전·manifest SHA-256·SessionStart matcher 계약도
0.1.2에 맞췄다. 이전 계약을 남겨 새 Plugin이 진단에서 거부되는 문제를 방지한다.

## 공식 패키지 식별

| 버전 | 공식 arm64 archive SHA-256 | native CDHash |
| --- | --- | --- |
| 0.155.0 | `b1411ec00ac410467e05cf8fb5b063cf83632613530201cd4724ef8dd0e9c33f` | `0a319829ccc6ff89160ceee151f1c2e78030f296` |
| 0.155.1 | `e6e08717da9e35b72332eff753527fe79a9ae876081033c5c6820a8e5f58b943` | `0fc5f92c54ae7e1d576cd1d7d8ce979daec5bee2` |

각 catalog는 42개 파일과 10개 디렉터리를 포함한다. 전체 fingerprint는 각각
`115a008c1ab06a4070b7078954189b192c8e1278cf8b49ba5d80920ec5dc6095`,
`91948415ab606b4e7272b60b8f7d53cc10b5eef2d931591ae93e3a27c969856a`다.
기존 0.151.0 fingerprint로 직렬화 방법을 먼저 대조했고, 별도 정적 검토에서도
새 catalog의 파일 digest와 fingerprint를 다시 계산해 일치를 확인했다.

## 이번 검증 결과

- 빌드 없는 Node/Python 회귀 **41/41 통과**: Plugin·Hook 15개,
  패키지 검사기 22개, lifecycle 검사기 4개.
- 공식 0.155.1을 별도 임시 설정으로 실행한 Plugin lifecycle 회귀 **2/2 통과**:
  캐시 갱신을 포함한 설치·업데이트·제거, 제품 Resources marketplace 경로 확인.
  Doctor의 버전·matcher·manifest와 나머지 payload SHA-256도 소스와 대조해 일치했다.
- 공식 Codex 실제 smoke **5개 버전 통과**: 0.153.0·0.153.1·0.153.3은 각 19개,
  0.155.0·0.155.1은 각 71개 검사. 모든 실행에서 Plugin 0.1.2를 사용했다.
  격리 Plugin 설치·조회·제거, 코드 서명·공증, 정확한 버전과 queue 도움말을 확인했다.
- 최신 두 버전의 `--remote`, `--remote-auth-token-env`, `app-server --listen`을
  실제 도움말과 공식 소스에서 확인했다.
- 최신 두 버전의 AppServer lifecycle 통과: 새 테스트 세션 생성, metadata 작업으로
  빈 대화 파일 저장, 구독 해제, `thread/closed`, stdout/stderr EOF와 exit 0,
  새 프로세스에서 같은 UUID/cwd 재개. 네트워크와 사용자 홈 접근을 OS에서 막았고
  모델 턴은 보내지 않았다. 실제 사용자 대화의 내용 보존 검증은 아니다.
- Swift 회귀 소스에 허용·거부 버전, 공식 JSON의 private 복사·봉인·재검증,
  변조·스크립트·다른 경로 거부를 추가했다. **Swift 컴파일과 테스트는 실행하지 않았다.**

```sh
node --test --test-concurrency=1 \
  Tests/CoordinatorOperational/plugin-package.test.mjs \
  Tests/RuntimeQualification/codex-compatibility-qualification.test.mjs \
  Tests/RuntimeQualification/update-managed-codex-native.test.mjs
```

증거 사본은 `build/codex-tests/all-stable-20260921/`에 있다. 이 디렉터리는 검사
보고서·로그 보관용이며 앱 빌드 산출물이 아니다. 원본 패키지와 격리 실행 폴더는
`/private/tmp/blabee-codex-all-stable-9CoDxB/`, 0.155.1 원본은
`/private/tmp/blabee-codex-01551-sh8bcb/`에 있다.

## 변경 파일과 검증 경계

- `bridges/codex/swift/setup/CodexCompatibility.swift`: capability별 버전 목록.
- `bridges/codex/swift/core/HookPermissionPolicy.swift`: 공식 native 승인 profile.
- `bridges/codex/swift/runtime/CodexRuntimeBundle.swift`: catalog·데이터 리소스 분류.
- `bridges/codex/swift/update/UpdateManagedCodexObserver.swift`: lifecycle profile.
- `bridges/codex/plugin/`: Plugin 버전과 fork Hook.
- `app/service/DoctorApplication.swift`: Codex Plugin의 고정 진단 계약만 갱신.
- `scripts/qualify-codex-compatibility.mjs`, `scripts/verify-update-managed-codex-native.py`:
  공식 패키지와 lifecycle 검사기.
- 관련 `Tests/`, `Fixtures/codex/0.155.1/` 및 호환성·업데이트 문서.

소스 구현과 빌드 없는 검증을 완료했다. 설치된 build 62의 연결 문제가 해결됐다는
실사용 판정은 아니다. 실행 중인 앱·Codex 세션·사용자 설정·운영 DB와 Engine·Claude
구현은 변경하지 않았다. 빌드·패키징·서명·설치·commit·push는 수행하지 않았다.

사용자가 빌드를 허용한 뒤에는 Swift 회귀 실행, 실제 관리형 private runtime 실행,
Hook → Pet 승인/선택 → queue 왕복, 설치된 앱의 업데이트와 터미널 복원을 확인해야 한다.
기존 실행 검사에서 거부된 버전·경로가 `unknown`으로 표시되는 문제는
[후속 Codex 디버깅](CODEX_DEBUG_20260921.md)에서 소스를 수정했다.
해당 Swift 변경의 컴파일·실행 검증 역시 아직 하지 않았다.

공식 근거: [0.155.0 release](https://github.com/openai/codex/releases/tag/rust-v0.155.0),
[Hook 승인 처리](https://github.com/openai/codex/blob/be2951ea34f0d295ed0becf97079f92fa5f6950e/codex-rs/core/src/tools/approvals.rs#L492-L500),
[AppServer 승인 schema](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/schema/json/CommandExecutionRequestApprovalParams.json),
[thread lifecycle](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server/src/request_processors/thread_lifecycle.rs).

이전 Plugin 연결 단계의 증거는 [초기 0.155.1 검사 기록](CODEX_01551_QUALIFICATION.md),
검사 방법은 [호환성 검사기](CODEX_COMPATIBILITY_QUALIFICATION.md)와
[업데이트 저장·복원](../AUTOMATIC_UPDATES.md)에 있다.
