# 앱 설치 위치 복구

작성일: 2026-09-09
상태: 소스 구현·자동 테스트 및 r19 DMG 제작 완료. 실제 설치 안내·사용 중 차단은 확인했고,
기존 앱 사용 프로세스를 보존해 교체·새 설치본 실행 성공 경로는 미검증이다.
r18 배포 파일은 보존한다. 최신 진행 기록: [r19 설치 검증](R19_INSTALLATION_ACCEPTANCE_KO.md).

## 해결할 문제

DMG나 다운로드 폴더에서 앱을 바로 열면 Codex 검사 전에
`codex_plugin_setup_nonstandard_app_location`으로 중단된다. 이 위치 제한은 유지하되,
일반 서비스 시작보다 먼저 설치 안내를 보여 준다. Codex 자체는 변경하지 않는다.

## 사용자 흐름

1. 설치되지 않은 앱을 열면 `응용 프로그램에 설치하고 시작`을 안내한다.
2. 실행 중인 원본과 복사할 앱의 서명·빌드, 설치 경로를 검사한다.
3. 기존 앱이 없다면 앱 전체를 임시 위치에 복사·검증하고 `/Applications/Blabee.app`에 게시한다.
4. 기존 앱이 같거나 더 최신이면 `설치된 Blabee 열기`를 제공한다.
   교체가 필요한 경우 버전과 백업 안내를 보여 주고 명시적으로 확인받는다.
5. 설치본을 지정해서 실행하고, 반환된 프로세스의 위치·identity를 확인한다.
   실행 실패 시 설치본과 백업은 그대로 두고 Finder 안내·수동 재시도를 제공한다.

## 안전 경계

- 원본 위치에서는 Pet lease, 상태 폴링, 서비스, Codex 연결 검사를 시작하지 않는다.
- 전체 번들·서명·quarantine을 보존한다. 관리자 권한 우회, 서명 수리, Codex 복사,
  shell/PATH 설정 변경, 기존 프로세스 강제 종료는 하지 않는다.
  quarantine은 macOS 복사 API로 전달한다. OS가 복사 때 보안 플래그·출처 문자열을
  정규화할 수 있으므로 원본 문자열을 목적지에 강제로 다시 쓰지 않는다.
- 기존 앱을 사용하는 Pet·서비스·MCP 프로세스가 있거나 확인이 불가능하면 자동 교체하지 않는다.
  최초 설치는 대상이 없음을 재검사하고 exclusive 게시하므로 전역 프로세스 검사를 요구하지 않는다.
  검사 이후 외부 앱이 생기면 덮어쓰지 않고 설치를 중단한다.
- 설치 대상·상위 폴더의 identity와 symlink를 검사하고, private staging과 exclusive rename을 쓴다.
- 기존 앱 교체는 두 번의 rename으로 이루어진 **복구 가능한 작업**이지 crash-atomic updater가 아니다.
  외부 Finder/설치기의 동시 변경을 완전히 배제할 수 없다. 이동한 앱을 다시 검증하고,
  충돌 시 덮어쓰거나 자료를 삭제하지 않고 복구 위치를 표시한다.
- 실행 요청 이후에는 자동 롤백하지 않는다. 늦게 앱이 실행될 가능성이 있기 때문이다.
- 동일 경로의 구형 프로세스를 새 앱 실행으로 오인하지 않도록 반환 PID의 실행 코드도 검증한다.
- 복사 전 파일 수·크기·깊이와 단계별 경과 시간을 제한한다. 단일 OS 복사 호출을
  강제로 중단하는 hard timeout은 아니며, 복사 중 강제 종료한 경우 임시 자료가 남을 수 있다.
- macOS의 App Management/Gatekeeper 확인은 사용자가 처리한다. 권한이 부족하면 Finder로 안내한다.
- 앱 실행 확인은 서비스 연결·Hook 신뢰·카드 선택 반환의 성공을 의미하지 않는다.

## 작업 분리

- 설치 core: 검사·복사·교체·복구와 독립 fixture 테스트.
- platform: 실행 중인 설치본 검사, 정확한 설치 앱 열기와 주입형 테스트.
- UI/entry: 암시적 앱 시작의 설치 분기, 확인·진행·오류·수동 안내와 상태 테스트.
- QA: focused/full Swift 검사, 기존 Node 회귀, 별도 안전성 검토.

구현 위치:

- [AppInstallation.swift](src/coordinator-swift/Sources/BlabeeCoordinator/AppInstallation.swift): 전체 앱 검사·복사·백업·게시·복구.
- [AppInstallationPlatform.swift](src/coordinator-swift/Sources/BlabeeCoordinator/AppInstallationPlatform.swift): 프로세스 확인·설치본 실행·Finder 안내.
- [AppInstallationUI.swift](src/coordinator-swift/Sources/BlabeeCoordinator/AppInstallationUI.swift): 설치 화면·확인·상태·재시도.
- [ProductInvocation.swift](src/coordinator-swift/Sources/BlabeeProductSupport/ProductInvocation.swift)와
  [main.swift](src/coordinator-swift/Sources/BlabeeCoordinator/main.swift): 기존 CLI와 설치 안내 분리.
- 회귀 테스트: `src/coordinator-swift/Tests/BlabeePetTests/AppInstallation*Tests.swift`, `ProductInvocationTests.swift`.

## 실사용 승인 후 확인할 항목

- DMG 직접 실행, Downloads 실행, 이름이 바뀐 앱의 설치 안내.
- 최초 설치, 기존 동일/구버전/신버전 앱, 실행 중인 서비스 또는 MCP.
- 쓰기 권한 거절, App Management 확인, quarantine/전위 실행, 설치·실행 실패.
- 새 설치본의 정상 메뉴바 시작과 연결·선택·반환. 기존 Codex 실행과 대화 보존.
- 새 DMG/ZIP 제작, 실제 설치본 교체, commit/push는 각각 후속 승인 범위다.

## 구현 중 확인한 사항

- Foundation의 경로 정규화만으로 `/var` 별칭이 제거되지 않았다. 원본의 상위 경로는
  native `realpath`로 확인하고, 설치 대상의 symlink 거절·디렉터리 FD 검사는 유지했다.
- macOS 26.6.2의 격리 fixture에서 FileManager, ditto, copyfile 모두 quarantine을
  `0081;00000000;BlabeeInstallationFixture;` → `0281;00000000;;`로 변환했다.
  원본은 바뀌지 않았고 일반 중첩 xattr도 유지됐다. 이 OS 정규화를 오류로 간주해
  보안 속성을 다시 쓰지 않는다. `0x0200`의 의미나 Gatekeeper 실행 성공을 추정하지 않는다.
  [Apple copyfile 구현](https://github.com/apple-oss-distributions/copyfile/blob/main/copyfile.c#L1504).
- 로컬 읽기 전용 process smoke에서 893개 중 6개는 실행 파일 경로 조회가 `ENOENT`였다.
  UID나 이름으로 안전하다고 추측하지 않는다. 기존 앱 교체는 이 경우 Finder 수동 안내로
  종료할 수 있으며, 모든 Mac에서 자동 교체된다고 보장하지 않는다.

## 검증 기록 — 2026-09-09

- 최종 Swift Testing **788개**, XCTest **5개** 통과. 기존 Node 회귀 **360개** 통과.
- arm64 `blabee-coordinator` 릴리스 빌드와 `git diff --check` 통과. 앱 번들/DMG 제작과는 별개다.
- 자동 검사: 암시적 GUI/명시적 CLI 분리, 이름이 바뀐 앱, 원본/대상 symlink,
  복사·게시·복구 충돌, 보안 메타데이터 전달, 교체 확인, 중복 클릭,
  실행 실패 후 재설치 없는 재시도, 반환 PID의 구형/알 수 없는 코드 거부.
- 최초 실패의 `/var` 경로 처리와 fixture의 디렉터리 URL 표현을 보완했다.
  quarantine 문자열 일치 실패는 네이티브 API 네 가지의 동일 동작을 확인한 뒤
  원본 불변·목적지 정책 유지 검사로 수정했다. 보안 플래그를 재작성하지 않았다.
- 기본 sandbox의 Swift 캐시 접근 실패와 승인된 전체 테스트 실행을 구분했다.
- 별도 읽기 전용 QA의 실행 PID identity 누락 Medium 1건을 수정하고 재검토했다.
  최종 검토 범위에서 미해결 High/Medium은 없었다.
- 실제 `/Applications` 교체, 앱/서비스/Codex 재시작, DMG/ZIP 갱신, commit/push는 하지 않았다.
  실제 macOS 확인 창·설치·실행 및 다른 Mac 검증은 위 실사용 항목으로 남아 있다.
