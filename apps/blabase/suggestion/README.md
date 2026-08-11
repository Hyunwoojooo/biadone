# blabase Suggestion Prototype

GitHub와 Codex를 중심으로 개발자의 실행 상태를 Work Cockpit에 보여주고,
현재 근거로 확인 가능한 “지금 개입할 한 가지”를 제안하는 로컬 프로토타입입니다.
Notion과 Google Calendar는 project/schedule context를 제공하며, 기존 ChatGPT
공유 대화 기반 `suggestion-engine-v0.3`은 `/legacy`의 별도 경로로 유지합니다.

## 현재 설계 문서 시작점

- 현재 단계, 확정한 제품 결정과 남은 결정:
  `docs/CROSS_SOURCE_SUGGESTION_IMPLEMENTATION_PLAN.md`
- observation/candidate/no-action의 규범 정의:
  `docs/CROSS_SOURCE_ATTENTION_DEFINITION.md`
- GitHub·Codex Developer Work Ledger와 Candidate Funnel:
  `docs/DEVELOPER_SIGNAL_INTELLIGENCE.md`
- 평가 dataset, baseline과 해석 제한:
  `docs/CROSS_SOURCE_EVALUATION_GUIDE.md`
- 구현별 버전, run ID, 개인정보, rollback 기록:
  `docs/ENGINE_CHANGE_RECORD.md`
- macOS launcher와 작업 재개 안전 경계:
  `docs/LOCAL_LAUNCHER_CONTRACT.md`, `docs/WORK_RESUMPTION_CONTRACT.md`

다른 세션은 위 순서로 읽으면 현재 제품 결정과 최신 구현 상태를 복원할 수 있다.

## 로컬 실행

프로젝트 루트에서 사용하는 LLM 환경변수를 그대로 쓸 수 있습니다. 기본 provider는
Gemini입니다.

```text
BLABASE_SUGGESTION_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.1-flash-lite
```

이미 별도의 비공개 env 파일에 키를 관리하고 있다면 복사하지 않고 해당 파일을
읽을 수 있습니다. `suggestion/.env.local`에는 비공개 파일의 경로만 둡니다.

```text
BLABASE_SHARED_ENV_PATH=/absolute/path/to/private.env
```

이 방식은 suggestion 실행에 필요한 LLM 및 ChatGPT fetcher 환경변수만 읽으며,
이미 프로세스에 설정된 값은 덮어쓰지 않습니다.

ChatGPT 직접 요청이 차단되는 환경에서는 기존 fetcher 설정도 사용할 수 있습니다.

```text
CHATGPT_SHARE_FETCHER_URL=...
CHATGPT_SHARE_FETCHER_SECRET=...
```

```bash
cd suggestion
npm run dev
```

브라우저에서 `http://localhost:3102`를 엽니다. Google, Notion, GitHub의
OAuth callback 주소와 쿠키 기준 주소가 일치해야 하므로 연결 중에는
`127.0.0.1` 대신 `localhost`를 사용합니다.

## macOS 메뉴바 launcher beta

Phase 4C launcher는 Work Cockpit과 별도인 native 메뉴바 앱이다. `⇧ Space`를
누르면 기존 Active Attention이 고른 “지금 개입할 한 가지”만 표시하고,
대시보드는 별도 URL로 연다. 추천을 다시 만들거나 임의 prompt/command를 Codex에
보내지 않는다.

개발용 `.app`과 DMG는 Node runtime과 Local Agent를 함께 포함한다.

```bash
cd suggestion
BLABASE_NODE_BINARY=/absolute/path/to/node npm run launcher:package
```

산출물은 Git에서 제외된 `.local/build/macos/` 아래 생성된다. ad-hoc 서명된 local
development beta이므로 외부 배포 전에는 Developer ID 서명과 Apple notarization이
필요하다. 기존 `suggestion/.local` 연결 데이터를 사용하려면 native first-run에서
`기존 데이터 사용`을 선택하고 `suggestion/` root를 직접 확인·저장한다. 저장된
existing root는 source read-only mode로 열어 기존 웹 coordinator가 동기화한
snapshot을 표시하되 같은 store를 동시에 갱신하지 않는다.
`BLABASE_LAUNCHER_DATA_ROOT`는 설정이 전혀 없을 때 보여주는 legacy migration
candidate일 뿐 자동 적용되지 않는다. 설치, 검증, 데이터 경계와 release 명령은
`desktop/macos/README.md`, IPC와 실행 안전 경계는
`docs/LOCAL_LAUNCHER_CONTRACT.md`를 따른다.

현재 connection onboarding은 internal dogfood 흐름이다.

1. 위 `npm run dev`로 `localhost:3102` Work Cockpit을 실행한다.
2. launcher 설정에서 그 Work Cockpit이 소유하는 `suggestion/`을 `기존 데이터`로
   선택하고 저장한다.
3. 설정의 GitHub, Codex, Notion, Google Calendar row를 눌러 웹 `/sources`의 해당
   연결 카드로 이동한다.
4. launcher는 이동 전에 opaque root ID와 persisted sync revision을 두 번 확인하며
   다른 root, stale revision, 응답 오류에서는 링크를 열지 않는다.

GitHub·Notion·Google OAuth 등록/credential은 아직 운영자가 준비해야 하며 Codex는
로컬 프로젝트를 찾는 방식이라 별도 OAuth가 없다. 기본 `managed` root를 소유하는
Connection Hub, product-owned OAuth broker, exclusive writer lease와 signed/notarized
배포는 external beta 후속 범위다. 따라서 현재 artifact는 신규 사용자의 zero-config
연결 흐름으로 배포하지 않는다.

## Google Calendar 로컬 연결 — 운영자 설정

Calendar 연결은 로컬 개발 서버에서만 활성화되며, 기본 캘린더를 읽기 전용으로
가져옵니다. 수집한 일정은 `supporting-source-adapter-v0.3`의
`schedule_context_only` 입력으로 Attention의 시간 제약과 coverage에 사용하며 직접
행동 후보를 만들지는 않습니다. 아래 설정은 앱 운영자가 최초 한 번 수행하며,
실제 사용자는 화면의 `Google Calendar 연결` 버튼과 Google 동의 화면만 사용합니다.

1. Google Cloud 프로젝트에서 Google Calendar API를 활성화합니다.
2. OAuth consent screen을 Testing으로 설정하고 사용할 Google 계정을 Test user로
   추가합니다.
3. OAuth Client를 `Web application`으로 만들고 다음 Redirect URI를 정확히
   등록합니다.

```text
http://localhost:3102/api/connectors/google-calendar/callback
```

4. 내려받은 Web OAuth JSON을 다음 위치에 저장합니다.

```text
suggestion/.local/connectors/google-calendar/credentials.json
```

다른 위치를 사용하려면 비공개 env 파일에 절대 경로를 지정할 수 있습니다.

```text
GOOGLE_CALENDAR_CREDENTIALS_PATH=/absolute/path/to/credentials.json
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3102/api/connectors/google-calendar/callback
```

연결 후 token과 최소 일정 snapshot은 같은 `.local/connectors/google-calendar/`
폴더에 `0600` 권한으로 저장되며 Git에서 제외됩니다. 연결 해제를 누르면 두 파일을
로컬에서 삭제하고 Google token 폐기도 요청합니다.

## Notion 로컬 연결 — 운영자 설정

Notion 연결도 로컬 개발 서버에서만 활성화됩니다. 사용자는 OAuth 화면에서
blabase에 보여줄 페이지와 데이터베이스를 직접 선택합니다. 이 프로토타입은
선택해 공유된 범위에서 페이지·데이터 소스의 제목과 수정 시각만 가져오며,
본문·사용자 이메일·원시 속성은 저장하지 않습니다. 수집 결과는
`supporting-source-adapter-v0.3`의 `project_context_only` 입력으로 Attention의
project context와 coverage에 사용하며, mapped task property 계약이 구현되기 전에는
직접 행동 후보를 만들지 않습니다.

1. Notion Developer portal에서 `Public connection`을 만듭니다.
2. Installation scope는 테스트할 워크스페이스에 맞게 선택합니다.
3. Capabilities에서는 `Read content`만 켜고 Insert/Update content 및
   사용자 정보 권한은 끕니다.
4. 다음 Redirect URI를 정확히 등록합니다.

```text
http://localhost:3102/api/connectors/notion/callback
```

5. Client ID와 Client Secret을 Git 밖의 비공개 env 파일에 설정합니다.

```text
NOTION_OAUTH_CLIENT_ID=...
NOTION_OAUTH_CLIENT_SECRET=...
NOTION_OAUTH_REDIRECT_URI=http://localhost:3102/api/connectors/notion/callback
```

Notion 공식 문서에는 localhost HTTP callback 허용 여부가 명시되어 있지 않습니다.
Developer portal에서 위 주소 등록이 거부되면 HTTPS tunnel 주소를 Redirect URI와
환경변수에 동일하게 등록해야 합니다.

연결 후 token과 최소 snapshot은 `.local/connectors/notion/`에 각각 `0600`
권한으로 저장되며 Git에서 제외됩니다. 연결 해제를 누르면 로컬 파일을 삭제하고
Notion access token 폐기도 요청합니다. Notion 검색 인덱스 반영이 늦을 수 있으므로
OAuth 직후 항목이 보이지 않으면 화면의 `Notion 새로고침`을 다시 누릅니다.

## GitHub 로컬 연결 — 운영자 설정

GitHub 연결도 로컬 개발 서버에서만 활성화됩니다. 사용자가 설치 과정에서 직접
선택한 저장소만 대상으로 담당 이슈, 리뷰 요청, 본인이 연 PR의 제목과 상태를
확인하고, 사용자 본인의 push·브랜치·이슈·PR·리뷰 활동을 읽기 전용으로
수집합니다. 코드·commit 내용·이슈/PR 본문·댓글 본문은 저장하지 않으며, 제안
엔진은 담당 이슈·리뷰 요청과 본인이 연 PR의 검증된 actionability만 사용합니다.

1. GitHub의 `Settings > Developer settings > GitHub Apps`에서
   `New GitHub App`을 선택합니다.
2. Homepage URL은 `http://localhost:3102`로 설정하고 다음 Callback URL과
   Setup URL을 정확히 등록합니다.

```text
Callback URL: http://localhost:3102/api/connectors/github/callback
Setup URL: http://localhost:3102/api/connectors/github/installed
```

3. `Expire user authorization tokens`는 켜고,
   `Request user authorization (OAuth) during installation`은 끕니다.
   `Redirect on update`는 켭니다. blabase가 사용자 승인과 저장소 선택을
   각각 올바른 GitHub 흐름으로 시작하고, 설치나 저장소 변경 뒤 다시
   동기화하기 위한 설정입니다.
4. 이 로컬 프로토타입은 webhook을 사용하지 않으므로 Webhook의 `Active`를
   끕니다.
5. Repository permissions는 `Metadata`, `Issues`, `Pull requests`, `Checks`,
   `Commit statuses`를 `Read-only`로 두고 나머지 권한은 `No access`로 둡니다.
   Checks와 Commit statuses는 본인이 연 PR의 실패한 검사 여부만 집계하기 위한
   권한입니다.
6. Account permissions의 `Events`를 `Read-only`로 둡니다. 선택한 저장소와
   교집합인 사용자 활동을 확인하기 위한 권한이며, `Contents` 권한은 요청하지
   않습니다.
7. `Where can this GitHub App be installed?`에서는
   `Only on this account`를 선택한 뒤 앱을 만듭니다.
8. 생성된 앱의 Client ID, 새로 발급한 Client secret, App slug를 Git 밖의
   비공개 env 파일에 설정합니다.

```text
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_APP_SLUG=...
GITHUB_APP_REDIRECT_URI=http://localhost:3102/api/connectors/github/callback
```

9. 로컬 서버를 다시 시작한 뒤 blabase 화면에서 `GitHub 연결`을 누릅니다.
   사용자 승인이 끝났는데 아직 App 설치가 없으면 저장소 선택 화면으로 자동
   이동합니다. `Only select repositories`를 고르고 테스트에 필요한 저장소만
   선택합니다.

GitHub 연결 화면에는 연결된 login, 선택된 저장소 수, 담당 이슈·리뷰 요청·내
열린 PR 수와 최대 3개의 미리보기만 표시됩니다. `GitHub 새로고침`은 GitHub에서
현재 상태를 다시 읽고, `연결 해제`는 GitHub 사용자 승인을 폐기하도록 요청한 뒤
로컬 token과 미리보기 데이터를 삭제합니다. GitHub App 설치 자체를 제거하려면
GitHub의 `Settings > Applications > Installed GitHub Apps`에서 별도로
uninstall해야 합니다. 기존 App에 `Events: Read-only`를 나중에 추가했다면
기존 설치와 사용자 승인을 다시 확인해야 할 수 있습니다. GitHub Events API는
실시간 스트림이 아니며 최대 최근 30일·300개 범위에서 지연되어 반영될 수
있습니다. 기존 App에 `Checks`나 `Commit statuses`를 추가했다면 설치 소유자가
변경 권한을 다시 승인해야 합니다. 승인 전에는 PR actionability가 partial 또는
unavailable로 표시되며 unknown 상태를 추천으로 추정하지 않습니다. check 이름과
출력, reviewer identity, commit SHA와 branch는 로컬 snapshot에 저장하지 않습니다.

## Codex 로컬 연결

Codex 연결은 로컬 개발 서버에서만 활성화되며 OAuth나 별도 API key가 필요하지
않습니다. 화면에서 `Codex 프로젝트 찾기`를 누르면 이 컴퓨터에 설치된 Codex의
App Server를 로컬 프로세스로 실행해 최근 30일 동안 활동한 프로젝트 후보를
찾습니다. 사용자는 blabase가 확인할 프로젝트를 체크박스로 직접 선택할 수
있습니다.

기본 수집·저장 범위는 프로젝트 표시명, 세션 식별용 비가역 ID,
생성·활동 시각과 App Server가 목록 조회에서 반환한 로드 상태뿐입니다. 프로젝트
선택 화면에서 `Codex 작업 설명 표시`를 명시적으로 켜면 `thread/list`의
사용자용 작업 제목을 사용하고, 제목이 없을 때는 첫 요청의 앞부분을 최대
200자로 줄여 민감정보 패턴을 가린 뒤 로컬 snapshot과 타임라인에 저장합니다.
이 문구는 작업 요청의 단서이며 완료 결과를 뜻하지 않습니다.

기본 모드는 세션 메타데이터만 수집합니다. 사용자가
`conversation_and_execution` 범위와 7일 보관에 명시적으로 동의한 경우에만
`thread/read`로 bounded prompt·answer·execution manifest를 만들며 reasoning,
원문 명령 출력과 전체 파일 diff는 제외합니다. 동의를 철회하거나 7일이 지나면
conversation store와 snapshot excerpt를 제거합니다. App Server의 로드 상태는
다른 Codex 프로세스의 전역 실시간 실행·승인 대기 상태를 뜻하지 않으므로 업무
상태로 해석하지 않습니다. 제안 엔진은 이 과거 내용을 현재 행동으로 사용하지
않고 OpenLoopClaim 맥락으로만 보관하며, 현재성 검증 전에는 후보 자격 단계에서
제외합니다.

Codex 실행 파일은 `PATH`, `~/.local/bin`, 일반적인 Homebrew 경로, macOS Codex
앱 경로에서 자동으로 찾습니다. 특수한 위치에 설치해 자동 탐색이 실패할 때만
Git 밖의 비공개 env 파일에 절대 경로를 지정합니다.

```text
BLABASE_CODEX_BINARY_PATH=/absolute/path/to/codex
```

선택한 프로젝트의 전체 경로는 로컬 조회 범위를 유지하기 위한 비공개 설정
파일에만 저장되고 화면이나 snapshot에는 노출되지 않습니다. 연결 설정과 최소
snapshot은 `.local/connectors/codex/`에 제한된 파일 권한으로 보관됩니다.
연결 중인 화면은 보이는 동안 60초마다 최근 활동 메타데이터를 다시 확인하며,
`Codex 새로고침`으로 즉시 갱신할 수도 있습니다. 이는 실시간 스트리밍이
아닙니다. `연결 해제`를 누르면 해당 로컬 설정과 snapshot을 삭제합니다.

### Work Cockpit에서 Codex 작업 이어가기

Work Cockpit의 현재 제안을 기존 Codex 작업과 사용자가 직접 연결한 뒤,
`Codex에서 작업 이어가기`를 누르면 해당 세션을 macOS Terminal에서 다시 열 수
있습니다. 웹 화면과 별도로 다음 Companion을 계속 실행해 둡니다.

```bash
cd suggestion
npm run companion:work-resumption
```

화면에 `Companion 실행 중`이 표시된 뒤에만 재개 요청을 만들 수 있습니다. 처음
실행할 때 macOS가 Terminal 제어 권한을 요청하면 허용해야 합니다. 재개 버튼을
누르면 Companion이 전에 연 같은 작업의 Terminal이 아직 실행 중인 경우 그 창을
앞으로 가져오고, 그렇지 않으면 새 Terminal에서 고정된
`codex resume <thread-id>` 흐름만 실행합니다.

이 기능은 다음 안전 경계를 갖습니다.

- 추천과 Codex 작업은 제목 유사도로 자동 연결하지 않으며 사용자가 직접
  선택해야 합니다.
- 추천 문구나 새 prompt를 Codex에 자동 입력하지 않습니다.
- 승인 처리, 실패 재시도, 임의 shell 명령과 GitHub·Notion·Calendar 변경을
  수행하지 않습니다.
- 현재는 macOS 기본 Terminal만 지원합니다. 다른 Codex client가 이미 연 창은
  자동으로 찾아 focus하거나 동시 실행을 조정할 수 없습니다.
- Codex 연결을 해제하면 Work Resumption binding과 실행 대기 command도 함께
  제거합니다.
- binding에는 표시 제목과 Codex 프로젝트 경로를 저장하지 않으며, 완료된
  command의 최소 상태 기록은 7일 뒤 제거합니다.

`npm run companion:work-resumption -- --once`는 대기 중인 command를 한 번만
검사하며 Companion을 온라인 상태로 유지하지 않습니다. 개발용
`--dry-run codex:execution:<opaque-id>`는 세션과 실행 파일을 검증할 뿐 Terminal을
열거나 product command를 소비하지 않습니다.

## 연결 데이터 타임라인

네 연결 카드 아래의 `연결 데이터 타임라인`은 각 도구에서 마지막으로 저장한
로컬 snapshot을 한 목록으로 합쳐 날짜 내림차순으로 보여줍니다. 이 화면 자체는
외부 API를 다시 호출하지 않으며, 브라우저가 보이는 동안 60초마다 저장본만 다시
읽습니다.

- Google Calendar 일정은 `startAt`(예정 시각)을 사용합니다.
- Notion 페이지와 데이터 소스는 `lastEditedAt`(수정 시각)을 사용합니다.
- GitHub 사용자 이벤트는 발생 시각을 사용하고, 현재 task는 `updatedAt`
  (업데이트 시각)을 사용합니다. 의미를 알 수 없는 저장소 `updatedAt` 행은
  타임라인에 표시하지 않습니다.
- Codex 세션은 `updatedAt`(마지막 활동 시각)을 사용하고, 동의한 경우 작업
  제목 또는 첫 요청 단서를 함께 표시합니다.

원시 식별자는 타임라인 전용 비가역 ID로 바꾸고, token, Notion workspace ID,
GitHub App/installation ID, Codex 프로젝트 전체 경로와 scope ID는 응답에
포함하지 않습니다. 연결하지 않았거나 아직 동기화하지 않은 도구는 `저장본
없음`으로 구분합니다. 이 타임라인은 수집 결과를 확인하는 미리보기이며 현재
제안 엔진의 입력에는 포함되지 않습니다.

## Cloudflare 배포

운영 배포는 기존 `blabase-app`과 분리된 `blabase-suggestion` Worker를
사용합니다. `suggestion.blabase.com`은 Worker Custom Domain으로 연결되므로
기존 `blabase.com` 및 `www.blabase.com` 라우트에 영향을 주지 않습니다.

로컬 파일 경로인 `BLABASE_SHARED_ENV_PATH`는 운영 Worker에 설정하지 않습니다.
대신 다음 값을 새 Worker에 직접 설정합니다.

```text
GEMINI_API_KEY
GEMINI_MODEL
CHATGPT_SHARE_FETCHER_URL
CHATGPT_SHARE_FETCHER_SECRET
SUGGESTION_ACCESS_PASSWORD
```

임시 공개 주소는 HTTP Basic 인증으로 보호합니다. 사용자 이름은 `blabase`이며,
비밀번호는 Worker secret으로만 관리합니다.

```bash
npm run build:cloudflare
npm run deploy:cloudflare
```

## Legacy `/legacy` 동작 경계

아래 항목은 ChatGPT 공유 대화 기반 `suggestion-engine-v0.3` 경로에만 적용한다.
메인 Work Cockpit의 Cross-source Attention 계약은 위 설계 문서를 따른다.

- 복원에 성공한 고유 대화가 3개 미만이면 LLM을 호출하지 않습니다.
- URL은 3~10개를 받으며 중복 URL은 한 개로 계산합니다.
- 입력한 대화들이 동일 사용자의 것인지는 사용자가 확인합니다.
- 이 버전은 제안만 하며 task를 자동 실행하지 않습니다.
- 원본 URL과 대화 전문을 제안 결과에 저장하지 않습니다.
- Calendar, Notion, GitHub, Codex 연결 결과는 legacy conversation engine의 입력에
  포함하지 않습니다.
