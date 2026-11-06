# Codex 0.166.0 호환성 갱신

2026-11-04, macOS 27.0.1 arm64. 설치 r89의 `codex_native_version_unqualified`는
지원 목록이 0.164.0까지인 상태에서 Codex가 0.166.0으로 변경되어 발생했다.
버전 조회의 exit 0은 Plugin 검사의 성공이 아니다. 해당 실패에서는 요청한
Plugin 명령을 시작하지 않았으며 Hook 신뢰·선택 전달도 검사하지 않았다.

## 변경

- 일반 Plugin CLI·관리형 App Server, 서버 소유 workspace 라우팅, 업데이트
  lifecycle 목록에 정확한 0.166.0을 추가했다. 0.165.0·0.166.1·alpha는 추가하지 않았다.
- 0.166.0 arm64의 `execServer: "bin/codex-exec-server"` 선언과 실행 파일을
  필수로 검사한다. 이 버전의 다른 target, 누락·추가 파일, 잘못된 경로·null·중복
  manifest 필드는 허용하지 않는다. 구버전에 새 실행 파일을 섞어도 거부한다.
- 새 실행 파일을 전체 digest·서명 검사, private copy·seal·재검증, 중단된 복사
  정리에 포함했다. 선언이 없는 기존 패키지는 v1 fingerprint를 그대로 사용하며,
  새 선언이 있는 패키지는 v2 도메인과 별도 필드로 바인딩한다.
- 실제 Hook 호출자의 정확한 primary `codex` CDHash만 일회성 승인 profile에
  등록했다. `codex-exec-server`를 Hook 호출자로 신뢰하지 않는다.
- 실패 캐시의 정책 revision은 기존대로 Plugin 지원 목록에서 계산한다.
  사용자 DB를 지우거나 실패 기록을 수동으로 초기화하지 않는다.

## 공식 근거

[공식 release](https://github.com/openai/codex/releases/tag/rust-v0.166.0)의
`codex-package-aarch64-apple-darwin.tar.gz`를 사용했다. 공개 시각은
2026-10-29 19:47:53 UTC이며, GitHub 자산 metadata와 로컬 archive의 크기·해시를 대조했다.

| 항목 | 값 |
| --- | --- |
| archive 크기 | 165,951,869 bytes |
| archive SHA-256 | `55a440cb579f970abe7c79ab181e54b0ea4c419be99f333bbd868eebac9c21f0` |
| primary `bin/codex` SHA-256 | `39acf979729dd290f9a24ee38b2914e036c91b65952872e28ae2a6b88a7db7c1` |
| primary `bin/codex` CDHash | `0b4f0c8e07400d2beb156987f9af592071ee78f4` |
| `bin/codex-exec-server` CDHash | `a327b12738269e6e2b282f2526c689469a1984f9` |
| signing Team ID | `2DC432GLL2` |
| managed v2 fingerprint | `e34cede97a151936ae1e2ec7af1ae38cc145857d6571981ddbab0723d7f86214` |

패키지는 42파일·8디렉터리이며 native 30개 모두 arm64다. 실행 권한이 있는
voice `runtime.json`은 이전과 동일하게 정확한 catalog digest에 한해서 데이터로
분류한다. 과거 19개 catalog record는 변경하지 않았다.

공식 0.164.0/0.166.0 소스 비교로 다음 계약을 확인했다.

- `--thread`·`--message` queue 인자와 receipt는 유지된다. 새 `--resume` 옵션은
  추가하지 않았으며 실패한 작업을 자동 재전송하지 않는다.
  [queue](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/cli/src/queue_cmd.rs).
- 로컬 Plugin Hook은 기존 shell spawn 경로를 사용한다. `Allow`는 여전히
  일회성 `Approved`로 변환된다.
  [Hook 실행](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/engine/command_runner.rs),
  [승인 변환](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/tools/approvals.rs).
- 별도 실행 파일은 새 배포 구성이다. 일반 시작 경로에서 사용하는 새로운
  `CODEX_EXEC_SERVER_PATH` override는 발견하지 못했다. 기존 원격 환경 URL 설정을
  로컬 실행 파일의 경로로 해석하지 않는다.
  [패키징](https://github.com/openai/codex/blob/rust-v0.166.0/scripts/codex_package/layout.py),
  [실행 환경](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/exec-server/src/environment_provider.rs).
- thread start/resume/unsubscribe/closed 및 명령 승인 JSON schema는 두 tag에서
  동일하다. unsubscribe ACK만으로 종료됐다고 판단하지 않으며 해당 thread/closed,
  stdout·stderr EOF와 exit 0을 계속 요구한다.

## 검증

- Node 패키지 검사기 회귀 **96/96 통과**. 정확한 새 구성, manifest 모호성,
  변조·누락·권한·서명·공증 실패, x64의 구형 구성 위장도 후보 실행 전에 거부한다.
- 계약·Plugin Hook fixture·native lifecycle 입력 회귀 **165/165 통과**.
  위 패키지 검사기와 합계 **261/261**이며 실제 사용자 Hook 실행 횟수가 아니다.
- 공식 패키지 native 30개에 대한 **60개 서명·공증 검사 통과**.
- 공식 런타임의 **71개 smoke 통과**. 위 60개 검사가 포함되며 정확 버전,
  빈 임시 프로필의 Plugin 조회·설치·제거, queue 도움말을 확인했다.
- 별도 native lifecycle 검사에서 임시 세션 생성·저장·정상 종료·동일 UUID/cwd
  cold resume와 재종료를 확인했다. 두 단계 모두 closed·두 EOF·exit 0이며
  강제 정리 없이 완료됐다. 모델 turn은 0건이다.
- 실제 런타임 검사는 OS에서 네트워크와 사용자 홈 읽기를 차단하고 쓰기를
  임시 검사 디렉터리로 제한했다. 사용자 로그인·세션·운영 DB는 사용하지 않았다.
- Swift 집중 회귀 **353개·5개 suite 통과**. 공식 0.166.0 artifact를 필수 입력으로
  지정하여 Swift inspector의 전체 catalog·v2 fingerprint 일치를 실제 확인했다.
  고정 fixture의 v1 fingerprint, 기존 seal/staging 호환, 새 실행 파일 복사·변조·
  중단 복구, 정확한 Hook 호출자, Plugin·workspace·종료 경계도 포함한다.
  저장소 공통 잠금·단일 job·직렬 테스트를 사용했고 Keychain/netrc와 live opt-in을
  제외한 임시 설정·캐시 환경에서 실행했다. 배포용 앱 패키징은 하지 않았다.

증거 디렉터리: `/private/tmp/blabee-codex166-20261104-qrwp7jeu/`.
`official-release.json`, `package-inspection.json`, `native-signatures.json`,
`native-qualification.json`, `blabee-native-update-contract-qjghmz4l/result.json`,
`contract-regression.tap`, `swift-focused-approved.log`에
원본 해시·검사·종료 근거가 있다. 처음 도구 sandbox 안에서 실패한 서명/Swift
실행은 성공 증거에 포함하지 않는다.

## 남은 경계

이 변경은 설치된 r89에 자동으로 적용되지 않는다. 새 앱 빌드·공증·설치와
설치 앱의 실제 Hook → Pet 승인·선택 → queue 전달은 별도 단계다.
음성 기능, 실제 모델 응답, 실제 앱 업데이트 왕복은 이 검사에 포함되지 않는다.

0.166.0의 PermissionRequest `cwd`는 실제 명령 폴더이고, Hook 프로세스는
별도 `tool_hook_cwd`에서 실행된다. 서로 다른 폴더의 명령은 현재 Blabee의 독립
세션 경로 검사 때문에 Codex 기본 승인으로 돌아갈 수 있다. 이번 버전 등록에서
동일성 조건을 제거하거나 명령 폴더를 덮어쓰지 않았다. 이를 지원하려면 검증한
Hook에서 별도 routing cwd를 전달하는 내부 계약과 회귀 검사가 필요하다.
[공식 cwd 처리](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/hooks/src/events/permission_request.rs).
