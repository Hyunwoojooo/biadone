# 디렉터리 정리: 동작 보존 단계

기준: `24ab36a75ce94e85ffca5932216c650fd2df1848` (2026-09-20).
구현·검증은 원본 체크아웃과 분리한 worktree에서 수행했다. 후속 검증을 마친 소스는
원본 체크아웃에 반영했으며, 설치 앱과 실행 중인 세션은 유지했다.

이 문서는 최초 이동 결과와 후속 오류 수정을 구분한다. 최신 결과는 문서 마지막의
‘후속 검증과 원본 반영’에서 확인한다.

## 단계

1. 소스 책임을 분류하고 old/new/기존 target 이동표를 기록한다.
2. 기존 모듈·제품·접근 제한을 유지하며 파일과 manifest 경로를 변경한다.
3. 테스트·Plugin 소스·배포 snapshot 입력·문서 링크를 함께 수정한다.
4. 이전/이후 자동 검사 결과를 비교하고, 내부 앱 조립 및 snapshot 격리를 확인한다.

모듈: CoordinatorSwift, ClaudeCoreAdapter, BlabeeProductSupport, BlabeeCoordinator.
실행 제품: blabee-coordinator. 기존 테스트/helper target 이름도 유지한다.

## 이동 분류

- engine: 의미·라우팅·저장·계약 검증.
- bridges/codex: Hook·MCP·작업 전달·관리형 세션 및 Codex Plugin 소스.
- bridges/claude: 공통 엔진 adapter·host와 제품용 JS bridge.
- app: UI·조정·서비스·계정·진단·업데이트·실행 조립.
- dev: 독립 Claude 검증 앱·디자인/촬영 데모·기술 실험.
- Tests: 기존 회귀, Node 참조 코어, Claude fixture. 제품에 기존부터 포함된
  테스트 지원 Swift 파일은 기존 target 소속을 유지하고 이동표에 표시한다.
- docs: 현재 설계·기능·운영 안내와 과거 검증 기록을 구분한다.
- account-web, supabase, Contracts, Fixtures, Packaging은 각 역할을 유지한다.

`swift-file-moves.json`, `claude-file-moves.json`, `packaging-file-moves.json`,
`documentation-file-moves.json`에서 개별 대응을 확인한다.

## 보존 조건

- 파일 위치 변경은 Swift target 분리나 API 재설계가 아니다.
- CoordinatorOperationalApplication, PetViewModel, main, UnixDomainSocketTransport
  등의 혼합 책임은 후속 분리 대상으로 남긴다. 검증 지연 수정도 별도 작업이다.
- Contracts/v1 내용·저장 schema·Keychain 식별자·bundle ID·서비스 식별자 유지.
- 소스 Plugin 경로는 옮겨도 번들 내부 Contents/Resources/Plugin/blabee와
  marketplace 상대 경로는 유지한다.
- 배포 snapshot은 root 전체를 복사하지 않는다. manifest와 명시된 필요한 입력만
  복사하고 입력 변경 감지·파일 수/크기 제한·symlink 거부를 유지한다.
- 생성물·캐시·기존 runtime 데이터와 비밀 환경 파일을 이동/복사하지 않는다.
- 현재 Claude 코드 존재와 설치 앱의 모든 provider 통합 완료를 구분한다.

## 검증 기준

- 모든 tracked Swift 소스가 정확히 한 기존 target에 포함된다.
- 코드/계약 변경은 경로 참조와 테스트 fixture 계산에 한정된다.
- Node 계약·Plugin·저장·운영·패키징 회귀, Swift 회귀, Claude 공통/독립 검증.
- 격리된 release source snapshot에서 빌드 가능하고 번들 조립 계약을 보존한다.
- baseline 실패는 별도로 기록하고 이동으로 새로 생긴 실패와 구분한다.
- 실제 설치·공증·Codex/Claude 사용자 대화 실행은 자동 테스트와 별도 검증이다.

## 1차 이동 구현 — 2026-09-20

구조 정리는 `/private/tmp/blabee-layout-20260920/apps/blabee` worktree에 구현했다.
원본 `/Users/joo/BiaDone/apps/blabee`의 tracked 파일과 설치 앱은 변경하지 않았다.
commit, push, merge도 수행하지 않았다.

| 구분 | 새 위치 |
| --- | --- |
| 공통 의미·라우팅·저장·검증 | `engine/{semantic,routing,persistence,validation}` |
| Codex 정책·Hook·MCP·전달·설정·Plugin | `bridges/codex/{swift,plugin}` |
| Claude 어댑터·세션·host·JS bridge | `bridges/claude/{swift,src,launchers}` |
| 공통 앱·UI·서비스·제품 기능 | `app/` |
| 기존 Swift 테스트·fixture helper | `Tests/swift/` |
| Claude 공통·독립 테스트와 실행기 | `Tests/bridges/claude/` |
| 기존 Node 계약 참조 구현 | `Tests/support/reference-engine/` |
| 독립 Claude 앱 | `dev/claude-standalone/` |
| UI·촬영·실험 | `dev/{ui-demos,recording,spikes}` |
| 문서 | `docs/{architecture,features,bridges,development,guides,releases,history}` |

이동표 448행(이전 경로 446개, 새 경로 448개)을 확인했다. Claude의 package/lock은
기존 의존성을 제품/독립 앱 두 곳에서 사용할 수 있도록 복사했으므로 2행이 추가된다.
모든 목적지가 존재하며 ignore에 가려진 이동 파일이나 잃은 실행 권한이 없다.
이전 Swift package의 `.gitignore`는 루트 `.gitignore`로 대체했다.

1차 이동에서는 기존 Swift module/product 이름과 파일별 소속을 보존했고, 제품 Swift 소스 135개와
Codex Plugin 6개 파일의 내용은 원래 HEAD와 동일하다. `Contracts/`, `Fixtures/`,
`Packaging/`에도 내용 변경이 없다. 새 의존성·저장 schema·외부 통신 계약을 추가하지 않았다.

루트 `Package.swift`는 물리적으로 나눈 파일을 기존 target의 명시 목록으로 묶는다.
따라서 현재 단계는 소스 위치 정리다. engine에서 도구별 가정을 완전히 제거하거나
Swift target의 의존 방향을 재설계한 것은 아니다.

독립 Claude 개발 앱은 깊어진 위치에서 기본 소켓이 116바이트로 늘어나 macOS의
103바이트 제한을 초과했다. 개발 빌드·runtime만 루트 `build/claude-standalone/`로
모아 현재 worktree의 기본 소켓을 98바이트로 줄였다. 기존 실행 데이터는 옮기지 않았고
제품 runtime과 socket 검증 제한은 유지했다.

임시 폴더의 Foundation 경로 정규화 차이로 깨진 두 Swift fixture는 디렉터리 생성 후
canonical 경로를 계산하도록 수정했다. 공통 엔진 fixture 76개와 Node 왕복 검사 164개,
metadata fixture 24개(1,000개 replay 검사 포함)가 해당 수정 뒤 통과했다.

## 1차 배포 경로 확인

release snapshot 입력은 루트 manifest, 명시 Swift 소스/테스트 support 디렉터리,
Contracts/v1, Codex Plugin, Packaging/macos만 포함한다. Node 의존성·독립 앱·생성물을
복사하지 않는다. 새 중첩 경로의 중간 symlink가 기존 검사를 빠져나가는 회귀를 발견해
입력 부모 경로 검사와 Codex/Claude 회귀 테스트를 추가했다.

- snapshot/배포 입력 검사: 34 tests 통과.
- 앱 조립 회귀: 38 tests 통과.
- 실제 snapshot: 270 files, 원본과 복사본 fingerprint 일치.
- 해당 snapshot에서 arm64 Release 제품 빌드 성공.
- 임시 `Blabee.app` 조립과 ad-hoc 서명, `codesign --verify --deep --strict` 성공.
- 마지막 테스트 경로 보정까지 포함해 snapshot fingerprint를 다시 대조하고
  증분 Release 빌드·재조립·서명 검증도 통과했다. 최종 fingerprint는
  `1a1a6e369d1e99f4bde781173259c3b85e7776772ba03f7a1f104572ddd638eb`다.
- 생성 앱은 `/private/tmp/blabee-layout-package-check/final/Blabee.app`에 있으며 설치용 배포본이 아니다.
  기본 build 번호 1의 패키징 검사 산출물로, Developer ID 서명·공증·설치·실행하지 않았다.
- 로그: `/private/tmp/blabee-layout-package-check.log`, `/private/tmp/blabee-layout-package-final.log`.

## 검증 기록과 남은 순서

- [Swift 검증](SWIFT_LAYOUT_VALIDATION.md)
- [Node 검증](NODE_LAYOUT_VALIDATION.md)
- [Claude 검증](CLAUDE_LAYOUT_VALIDATION.md)

1차 단계 상태는 **구조 구현·제품 빌드 완료, 전체 회귀 검증 미통과**였다.

| 검사 | 최종 확인 범위 |
| --- | --- |
| 루트 Node 전체 | 432 pass / 10 fail / 1 skip. 실패 10개는 기존 HEAD 임시 복사본에서도 같은 범주로 재현 |
| 루트 Swift 전체 | 기존 `hasScheduledTimeWork` 컴파일 오류로 중단. 실제 target/테스트에서 제외하지 않음 |
| Claude 공통 fixture | 경로 보정 뒤 Swift 76개·Node 164개 통과 |
| Swift metadata fixture | 경로 보정 뒤 24개 모두 통과 |
| 독립 Claude Pet | 빌드·서명 검증 및 14개 테스트 통과 |
| Claude native session | 17 pass / 11 host 초기화 fail. 실제 세션 통합 통과로 계산하지 않음 |
| Claude product ingress | client 4 pass / 실제 fixture 6 fail. 대표 startup probe는 `invalid_arguments`; 임시 경로 조건 추가 확인 필요 |

전체 테스트의 실패는 원래 HEAD 비교와 경로/환경 원인을 구분해 각 문서에 기록한다.
실패가 남은 상태를 전체 통과로 표시하지 않는다. 테스트 복사본에서 한 파일을 제외한
실행은 원래 worktree의 target 구성을 변경하지 않는다.

1차 단계에서 남긴 작업은 테스트/구현 불일치를 별도 수정하고 전체 검증을 완료한 뒤
검증된 구조를 활성 작업 경로에 반영하는 것이었다. 선택 검증 지연 수정과 공통 엔진의
도구별 책임 분리는 별도 변경으로 진행한다. 실제 배포·설치와 Git 통합은 별도 단계다.

과거 문서의 경로·버전은 당시 기록으로 표시하고 현행 README/문서 색인을 진입점으로 삼는다.
원래 존재하던 문서 링크 대상 중 이동 때문에 새로 사라진 대상은 확인되지 않았다.
과거 로컬 산출물 링크는 실행 결과를 복사하지 않고 원래 경로를 기록했다. 외부 사이트의
과거 제품 감사 문서 등 Blabee 바깥의 기록은 이번 작업에서 수정하지 않았다.

## 후속 검증과 원본 반영 — 2026-09-20

별도 후속 수정으로 테스트의 현재 만료값·Plugin 버전·lease protocol을 맞추고,
제품 테스트의 authority를 운영 서비스와 격리했다. Swift 기본 테스트의 조건부 컴파일
불일치, 작은 글자 OCR fixture와 연결 상태 fixture도 수정했다.

Claude의 Node `realpath`와 Foundation 경로 표시 차이는 실제 제품 입력 거부의 원인이었다.
활성 프로젝트의 POSIX canonical 검증을 통일하고, 과거 metadata와 Pet 표시용 경로는
문법 검사를 유지한다. 세션·Hook 바인딩, 토큰·역할, HMAC·freshness, 이력의 실행 차단은
유지한다. 이는 단순 이동과 구분한 동작 수정이며 별도 회귀와 코드 검토로 확인했다.

- [Swift 오류 수정과 검증](LAYOUT_FOLLOWUP_SWIFT.md)
- [Node 오류 수정과 검증](LAYOUT_FOLLOWUP_NODE.md)
- [Claude 경로 수정과 검증](LAYOUT_FOLLOWUP_CLAUDE.md)

| 검사 | 후속 결과 |
| --- | --- |
| 루트 Node 전체 | 444 pass / 0 fail / opt-in 1 skip |
| opt-in runtime lease | 새 임시 앱으로 별도 실행, 5/5 pass; 복사·이름 변경·MCP 수명·읽기 전용 DMG 검사 |
| 전체 Swift | XCTest 5/5, CoordinatorSwiftTests 217 tests, BlabeePetTests 1,295 tests / 76 suites, issue 0; 기존 opt-in 3개는 기본 조건대로 skip |
| Claude native session / ingress | 28/28 및 10/10 pass |
| Claude 공통 fixture | Swift 77개 및 Node 164개 pass |
| Claude Registry·Pet fixture | 35 tests / 2 suites pass |
| 새 Release snapshot | 270 files; 원본 입력과 복사본 fingerprint 일치, 빌드 전후 입력 안정성 확인 |
| 새 앱 조립·서명 검사 | arm64 Release 빌드, ad-hoc 서명, deep/strict 검증 pass |

새 snapshot fingerprint는 `c53a0ea2b1d056cd7ecc1580fb957010403c3c402375baabecaa00641d57d688`이다.
검사 앱은 `/private/tmp/blabee-layout-followup-package-check/Blabee.app`이며 build 번호 1의
검증 전용 산출물이다. 배포용 서명·공증·GitHub 업로드·설치본 교체는 수행하지 않는다.

전체 검증 후 `/Users/joo/BiaDone/apps/blabee` 원본에 495개 파일을 반영하고 이전
tracked 경로 447개를 제거했다. 새로 작성한 파일, 기존 위치에서 수정한 파일,
이동표의 목적지를 모두 포함하며 파일 내용과 권한을 대조했다.
`demo-site/`, `output/pdf/`, `tmp/` 등 별도 작업과 기존 생성물은 보존했다.

변경 전 백업과 정확한 적용 목록은
`/private/tmp/blabee-layout-source-backup-awz_xbe6/{files-before,plan.json}`에 있다.
원본의 배포 입력 270개 fingerprint도 검증한 snapshot과 동일하다. 원본 경로의
Swift package에서 모듈·소스 목록을 다시 확인했고 경고나 대상 누락이 없었다.
Claude 제품/독립 개발 package의 새 경로에는 기존 lockfile로 의존성을 준비했다.
버전·lockfile 변경 없이 설치 스크립트는 실행하지 않았으며, 원본에서 JavaScript 30개
문법 검사와 SDK import 경로 확인도 통과했다.

소스 구조 적용은 완료했다. 커밋·push·merge·설치 앱 교체는 수행하지 않았다.

전체 Swift는 `/private/tmp/blabee-layout-followup-swift-full.log`에 기록했다.
테스트 파일 제외 없이 실행했고 검증 전후 Swift와 manifest 246개 입력 해시가 동일했다.
기존 opt-in은 사용자 Keychain 복구, SQLite benchmark, 설치된 Codex의 실제 검증이다.
자동 회귀 성공을 실제 사용자 대화의 왕복 성공으로 해석하지 않는다.

## 옛 Claude 검증 기록 보관 — 2026-09-20

제품 소스 이관 이후 옛 `claude/`에는 `build/`와 `node_modules/`의 파일만 남아 있다.
Git 기준 옛 Claude 파일 92개의 목적지와 CP-04 변경 파일 34개의 현재 위치를 확인했다.
추가 제품 소스 복사 없이, 필요한 검증 기록·작업 기준점·수동 선택 결과를
`build/claude-tests/history/2026-09-20-pre-layout/`에 보관했다.

보관 파일은 740개, 20,850,748 bytes이며 각 원본과 복사본의 SHA-256이 일치한다.
문서가 직접 참조하는 실재 기록 66개를 포함하고, 제품·브릿지·테스트 소스 398개의
보관 전후 해시가 동일했다. 상세 목록과 위치는
[Claude 기록 보관 색인](../history/claude/PRE_LAYOUT_ARTIFACTS.md)을 따른다.

원본 파일과 실행 중인 옛 앱·Coordinator, runtime·session 데이터는 그대로 유지했다.
자격·DB·앱 번들과 의존성·컴파일 캐시를 새 제품 경로에 복사하지 않았다.
이번 작업은 기록 보관이며 기능 테스트 재실행·설치 변경·Git 게시를 포함하지 않는다.

## 옛 Claude 폴더 제거 — 2026-09-20

추가 삭제 요청에 따라 옛 개발 앱·소유 Coordinator의 정상 종료와 경로 사용 해제를
확인한 후 `claude/`를 제거했다. 설치된 Blabee·Codex 세션·Claude 데스크톱 앱은 유지했다.
일반 파일 61,126개와 디렉터리·심볼릭 링크를 전체 압축 보관하고, 파일별 SHA-256·권한·
링크 대상과 백업 전후 원본 일치를 검증했다. 테스트용 Unix 소켓 4개만 백업에서 제외했다.
제품·브릿지·테스트 소스 398개는 삭제 전후 동일하며 소스 경로·구현을 추가 변경하지 않았다.

복구본과 삭제 결과는 [Claude 기록 보관 색인](../history/claude/PRE_LAYOUT_ARTIFACTS.md)의
삭제 완료 항목을 따른다. 복구본은 로컬 Git 제외 경로이며 새 runtime으로 자동 사용하지 않는다.
