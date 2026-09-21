# Blabee landing page

2026년 9월 21일 공유 페이지와 동일한 정적 HTML/CSS/JavaScript 소스입니다. 최신 Blabee 패널 UI, 실제 시연 영상, 영문 내레이션·배경 음악, 영문·한국어 정책 초안을 포함합니다.

- 공개 미리보기: https://blabee-real-demo.cada-official.chatgpt.site/
- 소스 기준: 공유 사이트 커밋 `e32f8ace1975f1a2fd5e9cd27c90ef7ae25499d5`
- 작업 브랜치: `blabee-landing-page` (Git 브랜치 이름에는 공백을 사용할 수 없습니다.)

## 로컬 실행

Node.js 20 이상이 필요합니다. GSAP과 ScrollTrigger는 `js/vendor/`에 포함되어 있어 별도 패키지 설치 없이 실행할 수 있습니다.

```sh
git clone --branch blabee-landing-page --single-branch https://github.com/Hyunwoojooo/biadone.git
cd biadone/sites/blabee.com
npm run check
npm test
npm run build:public
npm run preview
```

http://127.0.0.1:4174/ 에서 확인합니다. 포트가 사용 중이면 `BLABEE_PREVIEW_PORT=4180 npm run preview`로 변경합니다. `/liquid-glass/light/`에서도 동일한 랜딩페이지를 제공합니다. 로컬 서버는 영상 탐색을 위한 HTTP byte range 요청을 지원합니다.

## 파일 위치

| 위치 | 내용 |
| --- | --- |
| `index.html` | 기본 영문 랜딩페이지 |
| `liquid-glass/light/index.html` | 기존 공유 경로와 호환되는 동일 페이지 |
| `css/panel-current.css`, `js/main.js` | 최신 패널 예시와 선택 → 전송 → 자동 닫힘 동작 |
| `assets/demo/` | 랜딩페이지에 삽입된 영문 시연 영상, 포스터, WebVTT 자막 |
| `media/promos/2026-09-21/` | 15초 한국어·영어 홍보 영상 MP4 및 SRT 자막 |
| `policies/` | 영문·한국어 정책 페이지 및 다운로드용 Markdown 초안 |
| `scripts/` | 공개 파일 빌드와 로컬 미리보기 |

## 배포 및 연결 상태

`npm run build:public`은 허용된 공개 파일만 `dist/`에 복사합니다. 정적 호스팅의 배포 디렉터리는 `dist/`입니다. 홍보용 별도 영상, README, 테스트, 스크립트는 공개 빌드에 포함하지 않습니다. 도메인 루트에 배포하는 구조입니다.

- 이번 브랜치는 현재 공유 페이지를 옮긴 것입니다. 운영 도메인을 변경할 때 canonical·OG URL 및 `robots.txt`의 검색 차단 설정을 함께 검토해야 합니다.
- 히어로 패널은 웹에서 재현한 동작 예시이며 실제 Codex에 명령을 보내지 않습니다. 실제 시연은 `#real-demo`에서 재생합니다.
- 베타 신청 폼의 `data-endpoint`는 비어 있습니다. 운영 접수 API를 연결하기 전에는 신청 정보가 저장되지 않습니다.
- 정책 문서는 초안입니다. 서비스 제공자·이전받는 업체 등 미확정 사항은 문서 표시를 유지했습니다. 비공개 작업 중인 후속 정책 초안은 이 브랜치에 포함하지 않았습니다.
- 자체 호스팅 라이브러리의 고지와 라이선스 링크는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요.
