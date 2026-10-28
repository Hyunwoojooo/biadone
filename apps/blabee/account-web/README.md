# Blabee account web

독립 정적 계정 웹입니다. TypeScript + Vite로 빌드하고 `@supabase/supabase-js`가 브라우저에서 Supabase Auth에 연결합니다. Next.js, SSR, 자체 웹 서버는 배포에 필요하지 않습니다. 기존 macOS 앱·Coordinator·마케팅 사이트와 별도 패키지입니다.

## 실행

Node.js 22.12 이상에서 이 디렉터리를 작업 디렉터리로 사용합니다.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

이미 `.env.local`이 있으면 복사하지 않고 기존 설정을 사용합니다. 로컬 주소는 `http://127.0.0.1:4321/`입니다. `localhost`와 `127.0.0.1`은 로그인 저장소가 다른 origin이므로 혼용하지 않습니다.

설정 변수:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me
```

Vite의 `VITE_` 변수는 빌드된 브라우저 코드에 포함됩니다. URL과 publishable key만 사용합니다. `sb_secret_`, `service_role`, DB 비밀번호, Paddle 비밀키는 넣지 않습니다. `.env.local`은 Git에서 제외되며 `.env.example`만 공유합니다. 변수를 바꾼 뒤에는 개발 서버를 재시작하거나 배포 산출물을 다시 빌드합니다.

## Supabase 대시보드 설정

1. **Authentication → URL Configuration**에서 개발 프로젝트의 Site URL을 `http://127.0.0.1:4321/`로 설정하고 같은 주소를 Redirect URLs에 등록합니다. 실제 운영 URL은 운영 프로젝트에 정확한 HTTPS origin으로 별도 등록합니다.
2. 아래 Google·GitHub OAuth 애플리케이션을 등록한 뒤 **Authentication → Sign In / Providers**에서 각각 활성화하고 Client ID와 Client Secret을 저장합니다.
3. 신규 고객을 받으려면 **Allow new users to sign up**을 켭니다. 처음 소셜 로그인에 성공하면 Supabase가 계정을 만듭니다.
4. 두 공급자의 실제 로그인을 확인한 뒤 Email provider를 끄면 서버에서도 이메일 로그인을 차단할 수 있습니다. 화면에서 이메일 버튼을 제거하는 것만으로 서버 설정이 바뀌지는 않습니다. 이 두 소셜 로그인에는 SMTP가 필요하지 않습니다.

OAuth Client Secret은 Google/GitHub에서 발급하여 **Supabase 대시보드에만** 저장합니다. `.env.local`, `VITE_` 변수, 소스 코드, 채팅에 넣지 않습니다. 프런트엔드는 기존 Supabase URL과 publishable key만 사용합니다.

### 등록 주소

현재 Supabase 프로젝트 기준으로 다음 두 주소를 구분합니다.

| 설정 위치 | 주소 |
| --- | --- |
| Google의 **Authorized redirect URIs**, GitHub의 **Authorization callback URL** | `https://vulnkqyqqbucvbhwjswr.supabase.co/auth/v1/callback` |
| Supabase의 **Site URL / Redirect URLs** (로컬 개발) | `http://127.0.0.1:4321/` |

Google/GitHub는 Supabase로 돌아오고, Supabase가 다시 계정 웹으로 보냅니다. 운영 계정 웹 주소가 정해지면 Supabase에 정확한 HTTPS 주소를 등록하고 운영 Site URL로 사용합니다. 운영 프로젝트에는 개발 주소를 남기지 않습니다.

### Google

1. [Google Auth Platform](https://console.cloud.google.com/auth/overview)에서 Blabee 프로젝트의 Branding과 Audience를 설정합니다. 일반 사용자를 받는 앱이므로 대상은 External로 구성합니다. Testing 상태로 제한되는 경우 테스트 계정을 등록합니다.
2. Data Access에는 로그인에 필요한 `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`을 설정합니다.
3. Clients에서 **Web application** OAuth Client를 만듭니다. Authorized JavaScript origins에는 계정 웹 origin(`http://127.0.0.1:4321`), Authorized redirect URIs에는 위 Supabase callback URL을 등록합니다.
4. 발급된 Client ID와 Client Secret을 Supabase Google provider에 입력하고 활성화합니다. 공개 출시 전 Audience와 공개 앱 설정을 확인합니다.

### GitHub

1. [GitHub Developer settings → OAuth Apps](https://github.com/settings/developers)에서 **New OAuth App**을 선택합니다.
2. Application name은 `Blabee`, Homepage URL은 소유·운영하는 실제 계정 웹 주소, Authorization callback URL은 위 Supabase callback URL로 등록합니다. 운영 도메인이 미정이면 개발 주소를 사용하며, 타인이 소유한 `blabee.com`을 운영 주소로 가정하지 않습니다. Device Flow는 사용하지 않습니다.
3. Client ID를 확인하고 Client Secret을 발급하여 Supabase GitHub provider에 입력하고 활성화합니다.

### 현재 적용 상태 — 2026-09-12

대시보드에 다음 개발용 설정을 적용했고, 공개 `/auth/v1/settings`에서도 공급자 활성화 여부를 확인했습니다.

| 항목 | 적용 값 |
| --- | --- |
| Google / GitHub | 활성화 |
| Email / Apple / 그 외 공급자 | 비활성화 |
| 신규 가입 / 익명 로그인 / 수동 계정 연결 | 허용 / 비허용 / 비허용 |
| Site URL / 유일한 Redirect URL | `http://127.0.0.1:4321/` |
| Google 프로젝트 | `Blabee` (`intense-age-508411-v4`) |
| Google 웹 Client | `Blabee Account Web` |
| Google Audience | External / Testing, 프로젝트 소유자의 Google 계정 1개를 테스트 사용자로 등록 |
| Google Data Access | `openid`, `userinfo.email`, `userinfo.profile` |
| GitHub OAuth App | `Blabee`, 소유자 `Biadone` |

관리 화면: [Supabase 공급자](https://supabase.com/dashboard/project/vulnkqyqqbucvbhwjswr/auth/providers), [Supabase 복귀 주소](https://supabase.com/dashboard/project/vulnkqyqqbucvbhwjswr/auth/url-configuration), [Google Audience](https://console.cloud.google.com/auth/audience?project=intense-age-508411-v4), [GitHub OAuth App](https://github.com/settings/applications/3853358).

실제 브라우저에서 Google 계정 선택 화면과 GitHub의 `Authorize Blabee` 동의 화면까지 연결됨을 확인했습니다. GitHub는 이메일 주소 읽기 권한만 요청하며, 동의 취소 후 계정 웹으로 복귀하고 인증 query/fragment가 제거되는 것도 확인했습니다. 사용자의 계정 선택·동의 이후 코드 교환, 로그인 유지, 로그아웃을 포함한 최종 실제 로그인 검증은 남아 있습니다. 활성화 조회나 공급자 화면 진입만으로 이 최종 검증이 완료된 것은 아닙니다.

Google은 현재 **Testing**이며 일반 고객을 위한 공개 전환은 아직 하지 않았습니다. 공개 출시 시 실제 운영 계정 웹의 HTTPS 주소를 Supabase와 Google Client에 등록하고, Google Branding 설정(홈페이지·개인정보처리방침 등)을 완료한 뒤 Audience를 공개로 전환합니다. 현재 웹은 로컬 개발 서버에서 제공하며 배포하지 않았습니다.

### 후속 확인 — 2026-09-16

- 사용자가 Google·GitHub 각각의 실제 웹 로그인 성공을 확인했습니다. 세션 유지·로그아웃의 세부 결과는 별도로 기록하지 않았습니다.
- 운영 도메인 결정과 계정 웹 배포는 추후 진행합니다. 기존 GitHub 앱의 홈페이지 주소도 실제 운영 주소로 교체해야 합니다.
- macOS 앱 로그인 구현을 위해 Supabase Redirect URLs에 `com.biadone.blabee://auth/callback`을 추가했고, 대시보드에서 기존 `http://127.0.0.1:4321/`과 함께 두 주소가 저장된 것을 확인했습니다. Site URL은 그대로입니다.
- macOS 앱은 AuthenticationServices로 Supabase에 직접 연결합니다. 웹 로그인과 별도의 세션이며 로컬 Vite 서버나 운영 도메인이 필요하지 않습니다. Google/GitHub 쪽 callback은 기존 Supabase HTTPS 주소를 유지합니다.
- 네이티브 구현과 실제 앱 검증 절차는 [ACCOUNT_LOGIN.md](../docs/features/ACCOUNT_LOGIN.md)에 있습니다.

## 로그인 흐름

Google 또는 GitHub 선택 → 공급자 활성화 확인 → `signInWithOAuth` → 해당 서비스에서 로그인·동의 → Supabase callback → 계정 웹의 `/`로 복귀 → `code`를 한 번 교환 → `getUser` 확인 → 계정 표시.

- PKCE 사용, `detectSessionInUrl: false`. 앱이 `exchangeCodeForSession`을 한 번만 실행합니다.
- `skipBrowserRedirect: true`로 SDK가 만든 주소를 받은 뒤, 설정된 Supabase authorize endpoint·공급자·고정 복귀 주소·S256 challenge를 확인하고 같은 탭에서 이동합니다. 추가 Google API나 GitHub 저장소 권한은 요청하지 않습니다.
- 로그인 버튼을 누르면 공개 `/auth/v1/settings`를 조회합니다. 공급자가 꺼져 있거나 연결에 실패하면 현재 화면에 재시도 안내를 표시합니다. 인증 진행 중에는 두 버튼을 모두 잠가 중복 요청을 막습니다.
- 인증용 query/fragment는 시작 시 주소에서 제거합니다. 외부 `next` URL로 이동하지 않습니다.
- PKCE verifier가 원래 브라우저에 있으므로 로그인을 시작한 브라우저와 origin으로 돌아와야 합니다. 브라우저 뒤로 가기로 복원된 페이지는 로그인 상태를 다시 확인합니다.
- SDK가 세션 보관과 토큰 갱신을 담당합니다. 계정 표시는 `getUser`로 확인하며, 원문 서버 오류나 토큰을 화면·로그에 출력하지 않습니다.
- 로그아웃은 `scope: 'local'`로 현재 브라우저에만 적용합니다.
- 이메일과 오류 안내는 `textContent`로 렌더링합니다. 다른 계정으로 바뀌거나 로그아웃하면 이전 사용자 정보가 제거됩니다.

## 범위와 다음 단계

현재 웹 구현은 Google·GitHub 로그인, 세션 복원, 계정 표시, 현재 브라우저 로그아웃입니다. 이메일 로그인·비밀번호 입력·Apple 로그인은 제공하지 않습니다. macOS 앱 복귀·Keychain 연동은 별도 네이티브 모듈에서 구현합니다. 구독·기기 관리 API와 결제는 후속 작업이며 로그인만으로 유료 권한을 부여하지 않습니다.

아직 `profiles` 등 제품 테이블을 생성하지 않습니다. 신규 로그인 계정은 Supabase가 관리하는 `auth.users`에 만들어집니다. 이후 DB 테이블을 추가할 때 RLS를 적용하고, 구독 API에서는 JWT와 사용자 소유권을 서버에서 검증해야 합니다. 정적 계정 페이지 자체는 권한 경계가 아닙니다.

## 검증

```sh
npm test
npm run typecheck
npm run build
npm run preview
```

자동 테스트는 Auth 어댑터와 HTTP 응답을 대체하여 공급자 활성화 확인, 중복 클릭, authorize URL 검증, PKCE 코드 중복 교환, 취소·만료·연결 실패, 세션 복원, 로그아웃 및 비동기 응답 경합을 검사합니다. 실제 사용자를 생성하지 않습니다.

실제 로그인 검증은 설정 완료 후 Google·GitHub 각각 다음 흐름을 확인합니다: 버튼 선택 → 해당 서비스 로그인·동의 → 계정 이메일 표시 → 새로고침 후 로그인 유지 → 로그아웃. 동의 취소 및 브라우저 뒤로 가기 후 다시 시도하는 흐름도 확인합니다. 외부 서비스의 실제 인증 성공은 자동 테스트나 연결 조회와 별도의 검증입니다.

`npm run build`의 `dist/`를 정적 호스팅에 배포합니다. 콜백은 `/`이므로 SPA 경로 재작성은 필요 없습니다. 브라우저 세션을 다루는 페이지이므로 HTTPS로 제공하고, 외부 분석 스크립트는 추가 전 별도 검토합니다. `public/_headers`는 Cloudflare Pages/Netlify의 헤더 형식이며 다른 호스팅에서는 같은 정책을 서버 설정에 적용합니다.

## 공식 참고

- [Supabase Google 로그인](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase GitHub 로그인](https://supabase.com/docs/guides/auth/social-login/auth-github)
- [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Publishable keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Vite 환경 변수](https://vite.dev/guide/env-and-mode)

버튼의 `public/google-g.png`는 [Google 공식 G 원본](https://developers.google.com/static/identity/images/g-logo.png), `public/github-mark-white.svg`는 [GitHub 공식 로고 묶음](https://brand.github.com/GitHub_Logos.zip)의 흰색 Invertocat 원본입니다. 가로세로 비율을 유지합니다. [Google Sans](https://fonts.google.com/specimen/Google+Sans) Medium의 Latin subset은 자체 호스팅하며 라이선스는 `public/google-sans-OFL.txt`에 있습니다. 한글은 시스템 글꼴을 사용합니다. [Google 로그인 버튼 가이드](https://developers.google.com/identity/branding-guidelines)와 [GitHub 브랜드 가이드](https://brand.github.com/foundations/logo)를 참고합니다.
