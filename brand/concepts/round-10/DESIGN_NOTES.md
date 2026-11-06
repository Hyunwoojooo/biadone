# Biadone 서체 다시 보기

상태: 2026-10-27의 10차 고딕 서체 검토 기록. 당시에는 Pretendard를 공통 서체로 두고 비교했다. 이후 11차에서 SUITE를 공통 제목으로 선택했으며, 본문과 로고는 Pretendard다. 현재 기준은 [공통 기초](../../design-system/FOUNDATIONS.md)를 따른다. 이 기록의 미리보기 조작은 공통 시스템을 다시 변경하지 않는다.

[비교 화면](index.html) · [현재 기본 제작 키트](../../design-system/index.html)

## 비교의 목적

유능하고 든든하며 믿고 일을 맡길 수 있으면서도 지나치게 딱딱하지 않은 브랜드에 맞는 서체를 검토한다. 색상·레이아웃·심벌을 함께 바꾸지 않고 글자의 인상과 읽힘을 비교한다. 인상에 대한 문구는 Biadone의 맥락에 맞춘 디자인 판단이며 보편적인 성능 평가가 아니다.

| 구분 | 서체 | 살펴볼 점 |
| --- | --- | --- |
| 기준 | Pretendard | 익숙한 읽힘과 현재 화면의 인상 |
| A | Wanted Sans | 또렷함과 유연함의 균형, 전체 서체로서의 활용 |
| B | 나눔스퀘어 네오 | 반듯한 제목의 존재감, 긴 본문의 읽힘 |
| C | LINE Seed KR | 친근함과 명확함이 Biadone의 신뢰감에 어울리는지 |

Wanted Sans는 3차의 짧은 글자 표본에서 본 후보지만, 이번에는 확정한 화면과 실제 긴 내용에서 다시 비교한다. SUIT는 UI 본문용 대안으로 조사했으며 이번에는 인상의 차이를 확인할 세 후보로 범위를 좁혔다. SUITE는 이전 파일에서 한글 완성형 일부만 지원하는 것을 확인했으므로, 공통 본문까지 한 서체로 다루는 이번 비교에서는 우선 제외했다.

## 같은 조건과 적용 범위

- 글자 표본은 같은 문구·크기·자간·행간, 제목 700 / 본문 400이다. CSS의 굵기 번호가 같아도 시각적 무게가 같다는 뜻은 아니다. 최종 후보를 정한 다음 광학적인 굵기·자간·줄바꿈을 다듬는다.
- 홈페이지와 Edu는 기본 제작 키트의 원본 페이지를 iframe으로 불러온다. 비교용 CSS는 해당 문서 안에 임시로 넣으며 공통 토큰·원본 HTML/CSS를 다시 쓰지 않는다.
- 실제 화면의 제목·보조 제목은 700으로 통일한다. 기존 A 홈페이지의 제목 650과는 구분되는 비교 조건이다. 로고는 기존 Pretendard 600과 확정된 비율을 유지한다.
- 전체 적용과 제목만 적용을 전환할 수 있다. 제목만 적용하면 본문·표·버튼은 Pretendard를 사용하고 제목·소제목·핵심 문장·짧은 흐름 제목에만 후보를 쓴다.
- Edu는 후보 서체가 로드된 뒤 원문을 다시 렌더링한다. 1600×900, 제목 64px·본문 26px·표 24px를 유지하며 실제 높이로 나눈다. 원문 보존과 넘침 검사에 실패하면 결과를 숨기고 안내한다.
- 글자 표본의 사용자 입력은 textContent로만 반영한다. 실제 화면의 원문은 그대로 비교한다. URL에는 후보·매체·적용 범위·비교 보기 상태만 남긴다.

## 공식 원본과 사용 조건

모든 파일은 원본을 변환하지 않고 CSS 별칭으로 불러온다. OS 글꼴 설치, 외부 CDN 의존성, 새 패키지 추가는 없다. 폰트와 원문 라이선스를 함께 보존한다.

### Pretendard와 Wanted Sans

Pretendard는 현재 design-system의 로컬 파일을 그대로 사용한다. Wanted Sans는 [공식 프로젝트](https://github.com/wanteddev/wanted-sans)의 3차 고정 파일을 재사용한다.

- Wanted 고정 커밋: `02c9b822349c188ada95f9e2d90c2ed18f853235`.
- 파일: `../round-03/assets/fonts/wanted-sans-variable.woff2`.
- 버전: 1.003. 지원 굵기 400–1000.
- SHA-256: `4259e7e9a172e634c2cb419d793b84148990316341e910443e5d10965b2c8f16`.
- 라이선스: `../round-03/assets/fonts/WantedSans-LICENSE.txt` (SIL OFL 1.1).

### 나눔스퀘어 네오

[공식 소개](https://campaign.naver.com/nanumsquare_neo/) · [제작사 설명](https://www.sandoll.co.kr/NanumsquareNEO) · [공식 다운로드](https://campaign.naver.com/nanumsquare_neo/download/NaverNanumSquareNeo.zip) · [라이선스 원문 출처](https://help.naver.com/service/30016/contents/18088?osType=PC&lang=ko)

공식 ZIP의 `NanumSquareNeo/웹폰트/woff2/`에서 추출했다.

| 파일 | 굵기 | SHA-256 |
| --- | --- | --- |
| assets/fonts/NanumSquareNeoTTF-bRg.woff2 | Regular 400 | d13846b612acc829078aff4f91c272c637c08441b409d46bb1a4c802eb2967c3 |
| assets/fonts/NanumSquareNeoTTF-cBd.woff2 | Bold 700 | 97dfe9720fbed813fc988fcedbcf741e97eef9353515b2043717484ec0b90aa1 |

공식 ZIP 동봉 TTF의 OS/2 굵기는 400/700이고 내부 버전은 1.000이다. 라이선스 전문과 저작권 안내는 `assets/fonts/NanumSquareNeo-LICENSE.txt`에 보존했다.

공식 가변형의 축은 100–900이지만 named instance는 Light 100 / Regular 300 / Bold 500 / ExtraBold 700 / Heavy 900이다. 통상적인 CSS 굵기와 혼동하지 않도록 이번에는 정적 Regular/Bold를 사용한다. 가변형을 300–900의 일반적인 Regular/Bold 대응으로 간주하지 않는다.

### LINE Seed KR

[공식 소개·사용 안내](https://seed.line.me/index_kr.html) · [공식 다운로드](https://seed.line.me/src/images/fonts/LINE_Seed_Sans_KR.zip) · [공식 라이선스](https://github.com/line/seed/blob/main/OFL.txt)

공식 ZIP의 `LINE_SeedKR_2023.09.06/Web/woff2/`에서 추출했다.

| 파일 | 굵기 | SHA-256 |
| --- | --- | --- |
| assets/fonts/LINESeedKR-Rg.woff2 | Regular 400 | 709275188a8ef23040274490cd1fa048a02e9c441a238a4252837258cf8a43df |
| assets/fonts/LINESeedKR-Bd.woff2 | Bold 700 | 57f95a6c2ce2ff6fa84e28f96bc5d29dcf5a7e308c9a25ed9541eacff3edfa56 |

동봉 TTF의 굵기는 400/700, 내부 버전은 1.000이다. 원본은 Thin·Regular·Bold를 제공하며 이번 비교에서는 Regular/Bold만 사용한다. 중간 굵기를 임의로 합성하지 않는다. `assets/fonts/LINESeedKR-LICENSE.txt`에 OFL 1.1 전문과 저작권 고지를 보존했다.

## 자산 확인의 범위

Neo와 LINE은 공식 ZIP에 함께 있는 TTF의 name·OS/2·cmap 테이블을 확인했다. 네 TTF 모두 한글 완성형 11,172자와 출력 가능한 ASCII 95자를 지원한다. 이 수치는 WOFF2 자체를 디코딩해서 얻은 값은 아니다. 웹에서는 실제 비교 문구에 사용된 플랫폼 폰트를 Chromium CDP로 확인하여 제목·본문이 각 원본 서체로 그려지는지 별도로 확인했다.

원본 ZIP과 이번에 사용하지 않는 Neo 가변형은 `/tmp/biadone-round10/font-sources/`에 연구용으로 보관했다. 작업 폴더에는 실제 사용하는 WOFF2 네 파일과 라이선스만 추가했다.

로컬 Chromium에서 웹 4서체×2화면 폭, Edu 4서체의 원문 보존·넘침·로고 고정, 제목만 적용, 나란히 보기, 사용자 문구·복원, 장면 선택·빠른 전환·URL 복원, 폰트 로드 실패 안내를 확인했다. 검토 페이지는 320–1600px의 6개 너비에서 가로 넘침 없이 표시됐다. 이번 샘플의 Edu는 모든 서체에서 글자 크기를 유지하며 7장으로 나뉜다. 다른 원고·브라우저·출력 매체는 적용 시 다시 확인한다.

## 다음 판단

한글 제목의 첫인상, 긴 본문·표의 읽힘, 한글과 영문·숫자의 조화를 함께 본다. 전체 교체와 제목만 교체 중 어느 쪽이 좋은지 고른 뒤 홈페이지·Edu의 굵기와 줄바꿈을 다듬는다. 로고 이름의 서체 변경은 현재 확정한 조합에 영향을 주므로 별도 예시를 보고 결정한다.
