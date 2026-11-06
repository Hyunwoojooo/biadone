# Blabee 전용 GitHub 저장소 검토

2026-10-18. 초기 README·브랜드 자산 작업과 이후 사용자 승인에 따른 부분 공개 기록이다.
현재 공개 저장소는 `Biadone/blabee`, 기존 전체 앱 소스 저장소는
`Biadone/blabee-private`에 비공개로 보존했다. 통합 저장소의 제품 소스·앱 업데이트 주소는
변경하지 않았다.

## 현재 공개 상태

| 구분 | 결과 |
| --- | --- |
| 공개 주소 | [`Biadone/blabee`](https://github.com/Biadone/blabee), Public, repository ID `1424304415` |
| 공개 커밋 | [`04e8b3dac80d8cf6c83bdd6d9e72f5fd6385d6eb`](https://github.com/Biadone/blabee/commit/04e8b3dac80d8cf6c83bdd6d9e72f5fd6385d6eb), 새 root commit 1개 |
| 공개 범위 | Codex plugin, 현행 Claude JavaScript MCP·Hook client 15개, v1 계약, 합성 fixture, 관련 Node 검사·예제, 제품 소개·기여/보안 안내 등 112개 파일 |
| 라이선스 | 이번 공개 구성요소에 MIT. 별도 배포 앱·과거 다른 위치의 소스에 소급 적용하지 않는다. |
| 비공개 보관 | [`Biadone/blabee-private`](https://github.com/Biadone/blabee-private), 기존 repository ID `1360953126`, main `8582e08019817988dc350aaf4d1cdd9c394394c2`와 r15 릴리스·첨부 asset ID 보존 |
| 소개·공유 | 영어·한국어 README, 기존 배너 2개, About·website·topics 10개, 실제 Social preview 이미지 등록 |
| 제보 | 버그·기능 이슈 양식과 private vulnerability reporting 활성화 |

기존 저장소를 단순히 Public으로 바꾸면 과거 전체 앱 소스 이력도 노출된다.
따라서 기존 저장소를 비공개 이름으로 옮기고, 검토한 파일만 새 공개 저장소의 별도 이력에
commit·push했다. 기존 브랜치·태그 삭제나 이력 재작성은 하지 않았다.
작업 소유의 이전 clone·mirror origin도 비공개 보관 주소로 갱신해 공개 주소로 잘못
push하는 것을 방지했다. 현재 제품 작업 폴더의 origin은 계속 `Hyunwoojooo/biadone`이다.

GitHub는 이전 이름을 새 저장소가 재사용하면 옛 주소의 redirect를 유지하지 않는다.
옛 r15 소스를 사용하는 다른 clone은 `Biadone/blabee-private`로 origin을 갱신해야 한다.
[GitHub 이름 변경 조건](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository).

### 재현 가능한 공개 묶음

- 허용 파일 목록: `Packaging/PublicIntegrations/manifest.json`. 디렉터리 전체를 무검토 복사하지 않는다.
- 공개 문서·검사 도구 원본: `docs/github/public/`.
- 내보내기: `node scripts/export-public-integrations.mjs --output <새 빈 경로>`.
  출력 경로는 아직 존재하지 않아야 한다. 심볼릭 링크·경로 탈출·범위 밖 소스를 거부한다.
- 공개 결과의 `PUBLIC_SOURCES.json`은 자기 자신을 제외한 111개 파일의 SHA-256·권한·출처
  분류를 기록한다. `npm run verify:sources`는 누락·변조·추가·금지 경로를 검출한다.
- 공개 소비자 검사: macOS + Node 22 이상, `npm ci --ignore-scripts`, `npm test`.
  Swift 앱 빌드·설치본 실행·실사용 DB·Keychain·모델 계정 없이 가상 상대만 사용한다.

계약 검사의 JavaScript 의미 assertion·claim 참조 helper도 포함되지만 제품 권위 Engine은
아니다. Swift `engine/`, `app/`, provider Swift adapter, 운영 backend, 계정/사용권한,
제품 packaging/signing 입력, 구형 Claude Channels entrypoint와 개발 launcher는 제외했다.

### 이번 검증과 한계

- 범위 검증기 회귀 75개, 계약 검사 129개, Codex plugin 검사 15개, Claude client 검사
  166개: **385개 통과**. JavaScript·JSON 91개와 shell launcher 문법 검사 통과.
- 최초 `npm test`의 Claude 37건은 sandbox의 임시 UDS `listen EPERM`으로 실패했다.
  실패한 Claude 묶음만 같은 격리 환경으로 sandbox 밖에서 재실행해 166개 모두 통과했다.
  최초 실패 로그를 성공으로 덮어쓰지 않았으며 전체 명령이 최초부터 통과했다고 해석하지 않는다.
- 개인 경로·이메일과 대표 credential signature의 내용 패턴 검사에서 발견 항목 없음.
  상대 링크·이미지 40개 유효. 이는 모든 종류의 비밀값 부재나 제품 보안감사 증명은 아니다.
- 로그인·쿠키·Authorization 없이 GitHub HTML 200, repo Public·MIT, 원격 112개 blob의
  바이트·실행 권한·커밋 일치를 확인했다. 비공개 보관 저장소는 익명 404다.
- Chrome 실제 화면의 Public·1 Commit·현재 커밋을 확인했고 Social preview에 준비한
  1280×640 PNG가 표시됐다. GraphQL `usesCustomOpenGraphImage: true`로 저장도 재확인했다.
- 제품 Swift 소스 변경·빌드·공증·설치·운영 앱 재시작·실제 세션 실행은 하지 않았다.
  이번 결과는 공개 연동 패키지의 증거이며 실사용 안정성이나 새 CLI 호환성의 추가 검증은 아니다.

기존 공개 r85 릴리스에는 이미 `r85-source.patch`가 있다. 조사한 patch header 69개 중
`app/` 22개·`engine/` 1개 등이 포함된다. 이번 공개 범위 제한이 이전 공개물을 비공개로
회수했다는 뜻은 아니며, 해당 릴리스·다운로드·기존 앱의 업데이트 주소는 유지했다.
다음 릴리스에서는 전체 제품 변경을 담은 source patch를 공개 자산으로 관성적으로 올리지
않는다. 재현용 전체 source 증거는 비공개 보관하고, 공개 소스 첨부는 이 허용 목록의
integration snapshot을 기준으로 검토한다. 앱 updater 저장소 이동과 기존 릴리스 자료
정리는 이번 변경에 포함하지 않았으며 별도 전환 검증이 필요하다.

로컬 근거와 전체 private Git backup bundle:
`build/github-public-20261018-t5domwo1/`. 공개 zip의 SHA-256은
`d3441492d3f68a4695e0cf5226ead6355acf612d8688cf3b4e33a65885cce086`이다.
전체 private history bundle 검증을 통과했으며 이 bundle·증거·운영 자료는 공개 저장소에 없다.

## 초기 검토 방향 — 부분 공개 적용 전

사용자가 알려준 기존 [`Biadone/blabee`](https://github.com/Biadone/blabee)를 우선
활용한다. 새 이름을 제안하기 전에 기존 저장소를 확인하지 못했던 초기 분리안을 수정했다.
현재 BiaDone 통합 저장소는 다른 제품과 기존 Blabee 공개 릴리스를 유지한다.

`Biadone/blabee`에는 과거 앱 소스와 이력이 이미 있으므로 공개 범위를 먼저 결정한다.
소스도 공개한다면 기존 이력을 보존하면서 검토한 최신 소스·README를 반영한 뒤
공개 전환한다. 소개·문서·DMG만 공개한다면 기존 비공개 소스 저장소를 그대로 Public으로
바꾸지 않고, 기존 저장소를 보존할 경로와 별도 공개 배포 공간을 정한다.

초기 조회 시 두 저장소의 GitHub license 값은 `null`이었다. 첫 README 작업에서는
라이선스를 추가하지 않았고, 이후 이번 공개 구성요소에 한해 MIT를 적용했다.

## 꾸미기 반영 전 기존 저장소 상태

2026-10-18 GitHub API와 로컬 소스에서 읽기 전용으로 확인했다.

| 구분 | 확인 결과 |
| --- | --- |
| 기존 전용 저장소 | `Biadone/blabee`, **Private**, 기본 브랜치 `main`, 현재 인증 계정은 관리자 권한 보유 |
| 최근 commit | `0937fa333249d2d0c310cc2d5c487410c00decca`, 2026-09-08, 내부 테스터 배포 안내 수정 |
| 기존 릴리스 | `v0.1.0-internal.15`, r15 내부 테스트, prerelease, DMG·체크섬·내부 안내 첨부 |
| 기존 코드 배치 | `src/`, `Plugin/`, `spikes/` 등 이동 전 구조. 현재 `engine/`, `bridges/`, `app/` 트리와 다름 |
| 현재 작업 폴더의 Git remote | `origin = https://github.com/Hyunwoojooo/biadone.git` |
| 현재 앱의 업데이트 설정 | `Packaging/macos/Info.plist`와 `scripts/build-macos-app.mjs` 모두 `Hyunwoojooo/biadone` |

GitHub 계정이 저장소에 접근할 수 있다는 사실, 로컬 작업의 Git 연결, 배포 앱의
업데이트 주소는 별개다. 현재 최신 코드와 공개 r85가 `Biadone/blabee`로 자동 동기화되는
구성은 확인되지 않았다. 기존 저장소의 전체 코드·이력 공개 적합성 검사는 아직 하지 않았다.

## 첫 화면 구성

- `README.md`: 영어 소개, 다운로드, 설치·연결, 지원 범위, 단축키, FAQ, 개발 문서.
- `README.ko.md`: 같은 구성의 한국어 안내.
- `docs/github/blabee-hero-{light,dark}.svg`: 실제 메뉴바 마크를 사용한 제품 일러스트.
- GitHub About의 description·website·topics와 Social preview는 공개 대상 저장소에서 설정한다.

참조한 [AI Job Search](https://github.com/MadsLorentzen/ai-job-search)와
[ECC](https://github.com/affaan-m/ECC)의 명확한 소개, 빠른 설치 경로, 기능·문서 탐색을
참고했다. 수치·후원·라이선스·지원 도구는 각 프로젝트의 정보이므로 가져오지 않았다.

### About 입력안

| 항목 | 값 |
| --- | --- |
| Repository | `Biadone/blabee` — 기존 비공개 저장소 |
| Description | `A macOS companion for Codex and Claude Code. Review next steps, make a choice, and continue in the original session.` |
| Website | `https://biadone.com/blabee/` |
| Topics | `macos`, `swift`, `swiftui`, `codex`, `claude-code`, `mcp`, `developer-tools`, `productivity`, `menu-bar`, `ai-agents` |
| Social preview | 라이트 배너의 [1280×640 PNG](../github/blabee-social-preview.png) |

초기 조회에서 두 저장소의 About 설명·홈페이지와 topics는 비어 있었다. 이후 사용자 요청으로
`Biadone/blabee`에 위 Description·Website와 Topics 10개를 반영했다.
`Hyunwoojooo/biadone`의 설정은 바꾸지 않았다.

## 소스 분리 시 확인한 경계

| 대상 | 관측과 필요한 작업 |
| --- | --- |
| Swift 코드·계약·제품 리소스 | `Package.swift`의 target/source 경로와 기본 앱 조립 경로가 현재 앱 디렉터리를 기준으로 한다. 조사한 경로에서 sibling 제품 소스가 필수인 부분은 찾지 못했다. 독립 checkout 빌드는 별도 검증이 필요하다. |
| Node 패키지 | 루트와 Claude bridge·독립 앱의 lockfile을 각각 유지한다. `node_modules`는 복사하지 않는다. |
| Claude runtime | 준비된 runtime·라이선스·manifest가 별도 입력이다. 기존 사용자 프로필이나 인증정보를 복사해 대체하지 않는다. |
| CI | `Packaging/CI/codex-compatibility.yml`은 비활성 설치 템플릿이며 `working-directory: apps/blabee`를 사용한다. 새 저장소에 맞게 검토한 뒤 `.github/workflows`에 별도로 추가한다. 단순 복사로 CI 통과를 주장하지 않는다. |
| 사이트·데모 | 기존 사이트와 공개 영상은 `sites/biadone.com/blabee`에 있다. 계속 기존 사이트를 연결할 수 있다. 이번 README의 배너는 앱 폴더 안에 있어 독립 이동이 가능하다. |
| 제품 식별자 | bundle ID, 서비스·Keychain 식별자, schema, 계약, 세션 연결 규칙을 저장소 이동과 함께 변경하지 않는다. |
| 기존 이력·미커밋 변경 | 전용 저장소의 r15 이력을 보존하고 최신 소스를 반영할 방법을 정한다. 현재 dirty checkout에서 단순 `git archive HEAD`만 쓰면 r85에 포함된 수정이 빠진다. 검토한 정확한 파일 목록을 별도 checkout으로 옮겨 비교한다. |
| 공개 파일 | 제품·개발 소스와 문서는 검토해 포함하고, 빌드 생성물·개인 로그·캐시·인증정보·비밀 환경 파일·실사용 DB·임시 실험은 제외한다. 제외는 원본 삭제를 뜻하지 않는다. |

## 업데이트와 다운로드를 끊지 않는 순서

1. 기존 `Biadone/blabee`의 공개 범위·이력·라이선스를 결정하고 공개할 파일을 준비한다.
2. 공개 대상 저장소의 README와 링크를 그 실제 주소에 맞게 바꾼다. 비공개 저장소를
   외부 다운로드·이슈 주소로 안내하지 않는다. 이 단계까지 기존 `biadone` 링크를 유지한다.
3. 독립 checkout의 경로·검증·패키징 입력을 검사한다. 소스 이동만으로 새 빌드의
   서명·공증·실사용 검증까지 완료됐다고 보지 않는다.
4. 대상 저장소의 공개 상태와 익명 다운로드를 확인한 뒤 다음 전환 릴리스를 준비한다.
   전환 릴리스는 `Hyunwoojooo/biadone`에도 올린다. 이전 설치본은 그 저장소를 조회하므로
   새 공개 위치에만 올리면 해당 사용자에게 전환 버전이 보이지 않는다.
5. 새 앱의 `BlabeeUpdateRepository`를 새 공개 위치로 변경하려면 plist·조립기의 고정값과
   릴리스/체크섬 URL 검증 계약·관련 회귀 검사를 함께 갱신한다. 현재 값은
   `Hyunwoojooo/biadone`이다. 파일명·태그·빌드 번호·자산 검증 규칙은 유지한다.
6. 이전 앱 → 전환 앱 → 새 저장소의 다음 앱 순서로 업데이트 조회·다운로드를 검증한다.
   같은 공증 DMG를 양쪽에 올린다면 해시가 일치하는지 확인한다.
7. 웹사이트 다운로드·이슈 안내를 새 주소로 전환하고 기존 릴리스는 보존한다.

이 작업에서는 업데이트 저장소 주소와 출시된 앱을 바꾸지 않았다. README의 다운로드는
공개된 r85 자산으로 연결하며, `latest`가 다른 제품 릴리스를 가리킬 가능성을 피하려고
버전을 명시했다. 새 Blabee 릴리스마다 배지·다운로드 버전을 함께 갱신해야 한다.

## 공개 전 확인

- 공개 대상 저장소의 상태·실제 주소, About, README 언어 링크·상대 경로와 이미지 확인.
- 앱/DMG의 버전·서명·공증·체크섬 및 다운로드 경로 확인.
- 기존 설치본의 업데이트 연속성 확인.
- LICENSE와 실제 공개 파일 범위 결정. 사용자 약관·개인정보 문서는 코드 라이선스와
  별개이며 이 README 작업으로 준비된 것은 아니다.

첫 꾸미기 작업의 완료 범위는 소개 문서·그림·분리 검토와 기존 비공개 전용 저장소의 README·About
반영이다. 최신 소스 이동, 독립 빌드, 저장소 공개 전환과 설치 앱 업데이트의 실사용 확인은
이후 별도 실행 단계다.

## 이번 문서 검증

- 영어·한국어 README를 GitHub Markdown API로 렌더했다. 두 문서의 내부 링크·이미지
  참조 50개에 누락이 없으며, 각각 표 5개와 접기 영역 6개를 확인했다.
- Chrome에서 라이트·다크, 한국어·영어 전환, 390px 콘텐츠 폭, 설치 안내 이동과 FAQ
  펼침을 확인했다. 로컬 미리보기의 CSS는 GitHub UI의 완전한 복제는 아니다.
- 한국어 링크·코드 뒤 조사 때문에 굵게 표시하는 별표가 노출되던 두 곳을 고쳤다.
- SVG XML, PNG 1280×640 크기, 실제 공개 r85 자산 URL, 변경 범위의 whitespace를
  검사했다. 배너는 제품 일러스트이며 이전 제품 스크린샷을 현재 화면으로 사용하지 않았다.
- 문서·이미지 변경이므로 제품 빌드·Swift 테스트·설치·앱 재시작은 실행하지 않았다.

## Biadone/blabee 반영 결과

- commit: [`8582e08019817988dc350aaf4d1cdd9c394394c2`](https://github.com/Biadone/blabee/commit/8582e08019817988dc350aaf4d1cdd9c394394c2)
  — `docs: refresh Blabee GitHub presentation`, `main`에 반영했다.
- 변경 파일은 `README.md`, `README.ko.md`, `docs/github/`의 SVG 2개·PNG 1개, 총 5개다.
  현재 앱 폴더의 README를 그대로 복사하지 않고, 대상 저장소의 실제 r15 경로와
  r85 공개 다운로드의 차이를 명시했다. 기존 README는 이전 commit의 고정 링크로 연결한다.
- README 각각 내부 링크·이미지 참조 17개, 표 6개, FAQ 접기 5개를 GitHub Markdown
  렌더러로 검사했다. Chrome의 실제 GitHub 화면에서 배너·영문 소개·한국어 전환을 확인했다.
- GitHub API의 커밋·tree를 다시 읽어 파일 5개의 blob hash와 준비본을 대조했다.
  원래 README 이외 기존 파일 206개와 r15 릴리스·첨부 자산 목록은 그대로다.
- About의 소개·홈페이지·검색 태그 10개를 반영했다. 저장소는 **Private**를 유지한다.
- r85 다운로드 버튼은 기존 공개 저장소를 사용하며 익명 HTTP HEAD 조회에서 200을 확인했다.
- 공유용 PNG는 저장소에 준비했다. GitHub는 Public 저장소 또는 기존 이미지를 업로드한
  Private 저장소에서만 Social preview 이미지 업로드를 허용하므로, 이 비공개 저장소에
  새 이미지를 등록하지 못했다. [GitHub 공식 조건](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).
- 제품 소스·앱 바이너리·업데이트 설정·사용자 세션·인증정보는 변경하지 않았다.
