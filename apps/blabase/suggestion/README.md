# blabase Suggestion Prototype

동일 사용자의 ChatGPT 공유 대화 3~10개를 복원하고, 사용자가 지금 가장 먼저
처리할 task 한 개를 제안하는 독립 로컬 프로토타입입니다.

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

## Google Calendar 로컬 연결 — 운영자 설정

Calendar 연결은 로컬 개발 서버에서만 활성화되며, 기본 캘린더를 읽기 전용으로
가져옵니다. 제안 엔진에는 아직 Calendar 일정을 입력하지 않고 연결과 수집 결과만
확인합니다. 아래 설정은 앱 운영자가 최초 한 번 수행하며, 실제 사용자는 화면의
`Google Calendar 연결` 버튼과 Google 동의 화면만 사용합니다.

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
본문·사용자 이메일·원시 속성은 저장하지 않습니다. 제안 엔진 입력에는 아직
Notion 데이터를 사용하지 않습니다.

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
읽기 전용으로 확인합니다. 코드·이슈/PR 본문·댓글은 저장하지 않으며, 제안 엔진
입력에는 아직 GitHub 데이터를 사용하지 않습니다.

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
5. Repository permissions는 `Metadata`, `Issues`, `Pull requests`만
   `Read-only`로 두고 나머지 권한은 `No access`로 둡니다.
6. `Where can this GitHub App be installed?`에서는
   `Only on this account`를 선택한 뒤 앱을 만듭니다.
7. 생성된 앱의 Client ID, 새로 발급한 Client secret, App slug를 Git 밖의
   비공개 env 파일에 설정합니다.

```text
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_APP_SLUG=...
GITHUB_APP_REDIRECT_URI=http://localhost:3102/api/connectors/github/callback
```

8. 로컬 서버를 다시 시작한 뒤 blabase 화면에서 `GitHub 연결`을 누릅니다.
   사용자 승인이 끝났는데 아직 App 설치가 없으면 저장소 선택 화면으로 자동
   이동합니다. `Only select repositories`를 고르고 테스트에 필요한 저장소만
   선택합니다.

GitHub 연결 화면에는 연결된 login, 선택된 저장소 수, 담당 이슈·리뷰 요청·내
열린 PR 수와 최대 3개의 미리보기만 표시됩니다. `GitHub 새로고침`은 GitHub에서
현재 상태를 다시 읽고, `연결 해제`는 GitHub 사용자 승인을 폐기하도록 요청한 뒤
로컬 token과 미리보기 데이터를 삭제합니다. GitHub App 설치 자체를 제거하려면
GitHub의 `Settings > Applications > Installed GitHub Apps`에서 별도로
uninstall해야 합니다.

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

## 동작 경계

- 복원에 성공한 고유 대화가 3개 미만이면 LLM을 호출하지 않습니다.
- URL은 3~10개를 받으며 중복 URL은 한 개로 계산합니다.
- 입력한 대화들이 동일 사용자의 것인지는 사용자가 확인합니다.
- 이 버전은 제안만 하며 task를 자동 실행하지 않습니다.
- 원본 URL과 대화 전문을 제안 결과에 저장하지 않습니다.
- Calendar, Notion, GitHub 연결 결과는 현재 제안 엔진의 입력에 포함하지
  않습니다.
