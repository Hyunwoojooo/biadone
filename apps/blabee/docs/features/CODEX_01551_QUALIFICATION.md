# Codex 0.155.1 Plugin 연결 검증

이 문서는 초기 Plugin 연결 단계의 기록이다. 이후 사용자의 전체 기능 지원 요청과
빌드 금지 조건에 따라 지원을 확장했다. 현재 범위와 별도 검증 결과는
[최신 안정 버전 지원](CODEX_LATEST_SUPPORT.md)을 기준으로 한다. 아래 Swift 실행
결과는 이전 단계에만 해당하며 후속 수정의 컴파일 검증을 뜻하지 않는다.

2026-09-21, macOS 27.0.0 arm64. 설치된 Blabee build 62의
`native_executable / codex_native_version_unqualified` 실패를 조사했다.

## 원인과 수정

`/opt/homebrew/bin/codex`는 공식 Codex 0.155.1을 가리켰고, Blabee의 Plugin CLI
허용 목록은 0.154.0까지만 포함했다. 기존 버전 검사는 정상적인 숫자 버전을 읽어도
목록에 없으면 거부한다. 보고서가 qualification 성공 객체에서만 값을 가져오므로
이 실패에서는 버전·경로가 `unknown`으로 표시된다. 보고서를 위해 추가 실행하지 않았다.

`CodexCompatibility`에 **0.155.1의 Plugin CLI capability만** 추가했다.
0.155.0·0.155.2·0.155.10 등 미검증 버전은 계속 거부한다. managed App Server,
자동 업데이트의 관리 세션 지원 버전, Hook의 일회성 승인 CDHash는 변경하지 않았다.
따라서 이번 변경이 0.155.1의 Pet 일회성 승인을 활성화하지는 않는다.

새 공식 패키지의 voice 리소스를 포함한 정확한 42개 파일 구성을 검사기에 추가했다.
이는 해당 버전의 arm64 구성에만 적용한다. 임의 파일을 허용하거나 패키지 일부를
제거하지 않는다. voice manifest의 37개 hash, 모든 native 파일 30개의 공식 서명과
공증, 매 단계 전후 전체 fingerprint를 확인한다. 음성 기능은 실행하지 않는다.

## 검증 증거

- [공식 0.155.1 release](https://github.com/openai/codex/releases/tag/rust-v0.155.1)의
  `codex-package-aarch64-apple-darwin.tar.gz`를 새 임시 폴더에 내려받았다.
- GitHub release asset의 크기 122,962,085 bytes와 SHA-256
  `e6e08717da9e35b72332eff753527fe79a9ae876081033c5c6820a8e5f58b943`가 일치했다.
  안전하게 압축 해제한 42개 파일은 Homebrew 설치본과 모두 바이트가 일치했다.
- Codex 실행 파일 SHA-256:
  `8eaf1ad12fe6bf89b1710330f58900014322c7c5af677e43be116d8ac5fc0a9e`.
- 계정 없는 실제 검사 결과 `evidenceMode=runtime`, `status=smoke_passed`.
  72개 검사 모두 exit 0. 공식 서명·공증, 정확한 버전, 격리 Plugin 등록·조회·제거,
  queue 도움말 및 저장소 Hook fixture 테스트를 포함한다.
- Codex Swift 회귀: 386 tests / 16 suites 통과. 기본 조건에서 설치본 검사는 skip했고,
  이어서 opt-in 검사 1개를 따로 실행했다.
- 설치된 `/opt/homebrew/bin/codex`를 수정된 Swift native runtime으로 검사:
  서명·공증·identity 재검증과 `--version` 성공, 0.155.1, 총 약 776ms.
  실패 보호 기록은 임시 폴더에 격리했으며 명령·프롬프트·queue는 보내지 않았다.
- 검사기 회귀: 21/21 통과. 기존 5파일 구성과 새 구성, 누락·추가 파일, manifest 변조,
  추가 native 파일의 신뢰 실패, 링크·쓰기 권한·실행 중 변경 거부를 포함한다.

로컬 증거는 `build/codex-tests/0.155.1-20260921/`의 `qualification.json`,
`provenance.json`, `swift-codex-tests.log`, `swift-native-live.log`,
`validated-inputs.json`에 있다. 공식 패키지 원본은
`/private/tmp/blabee-codex-01551-sh8bcb/`에 보관했다.

## 반영 범위와 남은 검증

이번 작업은 Codex 소스·회귀·호환성 검사 수정이다. 설치된 build 62, 실행 중인 앱,
사용자 Plugin 설정, 세션, 운영 DB는 변경하지 않았다. 새 통합 앱의 패키징·서명·설치와
실제 Hook → Pet 선택 → queue 왕복은 아직 검증하지 않았다.
설치본에 반영하려면 기존 Claude runtime과 서명 조건을 보존한 통합 앱을 새로 만들고,
공통 업데이트의 활성 세션 보호 절차를 따라야 한다.

0.155.1은 `SessionStart.source=fork`를 추가했다. 이 단계의 Plugin SessionStart matcher는
기존 source만 매칭한다. 새 세션의 첫 프롬프트에서 등록하는 기존 경로가 있지만,
fork 직후 최초 context 전달은 이번 account-free 검사 범위에 포함하지 않는다.
이후 Plugin 0.1.2에서 fork matcher와 fixture 회귀를 추가했다. 실제 fork 이벤트 전달과
버전 거부 시 보고서의 관측값 보존 개선은 여전히 별도 Codex 후속 검증·작업이다.
