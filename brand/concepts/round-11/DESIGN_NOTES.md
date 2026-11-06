# 성격이 다른 다섯 가지 제목 서체

상태: 2026-10-27 사용자가 **A · SUITE**를 공통 제목 서체로 선택했다. 다섯 후보의 비교 자료는 기록으로 보존한다.

[다섯 가지 비교](index.html) · [한 장으로 보기](overview.html)

이전 고딕 후보들이 비슷하게 느껴진다는 피드백을 반영했다. 이번에는 형태가 다른 다섯 서체를 제목에 적용한다. 본문과 로고는 Pretendard로 고정하여 제목이 만드는 인상을 본다.

## 다섯 후보

| 구분 | 서체 | 제목 굵기 | 비교할 인상 |
| --- | --- | --- | --- |
| A | SUITE | 700 | 부드러운 기하학적 형태 |
| B | Gmarket Sans | 500 | 넓고 또렷한 형태 |
| C | 마루 부리 | 700 | 부리와 획 굵기 변화에서 오는 차분함 |
| D | 고운돋움 | 400 | 손의 움직임이 느껴지는 유연한 획 |
| E | 도현 | 400 | 힘 있는 획과 각진 사각형 구조 |

이 인상은 Biadone에 적용한 디자인 판단이다. 다섯 후보가 모두 공통 본문 서체에 적합하다는 뜻은 아니다. 먼저 제목의 방향을 고른 뒤 실제 매체에서 조판을 다듬는다.

글자 표본은 같은 문구·크기·자간·행간으로 비교한다. 각 서체의 실제 제공 굵기를 사용하며, CSS 번호를 일률적으로 맞추거나 가짜 굵기를 합성하지 않는다. 서로 다른 서체의 같은 번호가 같은 시각적 무게를 뜻하지는 않는다.

## 실제 화면

홈페이지·Edu의 기존 원본을 iframe으로 불러와 제목·소제목·핵심 문장·단계 제목에 후보를 임시 적용한다. 본문·표·행동 버튼은 Pretendard다. 로고 조판과 심벌·색상은 기존 기준을 유지한다. Edu는 해당 제목 서체를 로드한 뒤 원문 보존·넘침을 검사하며 다시 나눈다.

10차 뷰어의 구성을 재사용하되 실험용 엔진은 이 폴더에 분리했다. 기존 10차의 서체 비교와 공통 시스템의 원본은 바꾸지 않는다. `font-manifest.json`은 이 화면에 쓰는 별칭·실제 굵기의 목록이다. `overview.js`는 한 장 보기에서도 로드 성공 전 표본을 숨기고, 실패하면 안내하여 대체 글꼴을 후보로 오인하지 않도록 한다.

## 원본과 라이선스

모든 파일은 원본을 변환하지 않고 로컬에서 불러온다. OS 설치나 새 패키지를 추가하지 않았다.

### A · SUITE

- [공식 프로젝트](https://github.com/sun-typeface/SUITE).
- 3차의 `../round-03/assets/fonts/suite-variable.woff2`와 `SUITE-LICENSE.txt`를 재사용한다.
- 버전 2.040, 가변 굵기 300–900 중 700을 사용한다.
- SHA-256: `fc5e0648d5413b55b79ebbab0f50de561a026574cba3a9c8eb03d5bddd432263`.
- 이전 cmap 조사에는 명시된 한글 완성형이 2,668자로 기록되어 있었으나 이 수치를 실제 렌더링 범위의 상한으로 간주하지 않는다. 채택 시 일반 제목과 추가 표본 `뷁똠힣` 모두 SUITE로 그려지는 것을 확인했다. 실제 제작 문구에서도 글꼴 표시를 확인하며, 지원하지 않는 문자는 Pretendard로 보완한다.

### B · Gmarket Sans

- [공식 소개](https://corp.gmarket.com/fonts/) / [공식 TTF ZIP](https://corp.gmarket.com/fonts/GmarketSansTTF.zip).
- `assets/fonts/GmarketSansTTFMedium.ttf`, 실제 굵기 500, 버전 1.000.
- SHA-256: `c6b9a2c10bfdb55975948ce191f9cf638955b5cfdc99149969add5b579262fc1`.
- 실사용 TTF의 name ID 13에 포함된 라이선스 전문을 `GmarketSans-LICENSE.txt`에 보존했다. 원문에 추가 조건이 있으므로 단순 OFL 요약으로 대체하지 않았다.

### C · 마루 부리

- [네이버 공식 소개](https://hangeul.naver.com/font) / [공식 다운로드](https://hangeul.naver.com/hangeul_static/webfont/zips/maruburi.zip).
- 공식 ZIP 안 `MaruBuriTTF.zip`의 `assets/fonts/MaruBuri-Bold.ttf`, 실제 굵기 700, 버전 1.000.
- SHA-256: `13aa1058c135e8f0b2c41de4e5e7866b18f970a15db2b1a290227e52dc02aba8`.
- [네이버 라이선스 원문](https://help.naver.com/service/30016/contents/18088?osType=PC&lang=ko)을 `MaruBuri-LICENSE.txt`에 보존했다.

Gmarket·Maru의 실사용 TTF에서 OS/2·name·cmap을 확인했다. 두 파일 모두 한글 완성형 11,172자, 출력 가능한 ASCII 95자를 포함한다. ZIP과 미사용 Gmarket Bold는 `/tmp/biadone-round11-font-sources/`에 보관했다.

### D · 고운돋움

- [원작자 프로젝트](https://github.com/yangheeryu/Gowun-Dodum) / [Google Fonts 공식 배포](https://github.com/google/fonts/tree/main/ofl/gowundodum).
- `assets/fonts/GowunDodum-Regular.ttf`, 실제 굵기 400, 버전 2.000.
- SHA-256: `a6e457933227483a11758fd0947bc74422a106d46f0bf057fdaa5af94a30067d`.
- 공식 API의 Git blob ID `2d87cc83583a37bd7828c638eb9bab6df3cf596c`와 다운로드한 파일이 일치했다.
- SIL OFL 1.1 전문은 `GowunDodum-LICENSE.txt`에 보존했다.

### E · 도현

- [Google Fonts 공식 소개](https://fonts.google.com/specimen/Do+Hyeon) / [공식 배포](https://github.com/google/fonts/tree/main/ofl/dohyeon).
- `assets/fonts/DoHyeon-Regular.ttf`, 실제 굵기 400, 버전 1.001.
- SHA-256: `35644be7f28e0a68a447b1f7af351dcde5674b870f24f7b5f43e26d00b4ab653`.
- 공식 API의 Git blob ID `25a2bec000b834f57887fe2b64225cd076b244d3`와 다운로드한 파일이 일치했다.
- SIL OFL 1.1 전문은 `DoHyeon-LICENSE.txt`에 보존했다.

Google 배포 두 파일은 `https://raw.githubusercontent.com/google/fonts/main/ofl/` 아래 각 프로젝트의 실제 API download_url에서 내려받았다. TTF 자체에서 굵기·이름·버전을 확인했다. 글꼴 가족 이름에 별칭을 붙인 것은 CSS 범위이며 폰트 바이너리나 저작권 고지를 수정한 것이 아니다.

## 화면 확인

현재 한글 제목과 영문·숫자 표본은 Chromium에서 실제 사용된 플랫폼 폰트를 확인했다. 도현의 가운뎃점이 대체 글꼴로 그려지는 것을 발견하여, 모든 후보의 영문 표본 구분 기호를 공통으로 ASCII `/`로 바꿨다. 한글 제목의 문구는 그대로다. 변경 후 다섯 후보의 한글과 영문·숫자 표본 모두 원본 서체만 사용한 것을 확인했다.

홈페이지는 5서체×데스크톱·휴대폰, Edu는 각 서체의 원문 보존·고정 크기·넘침과 본문·로고 고정을 확인했다. Edu는 다섯 후보 모두 7장으로 나뉘었다. 비교 페이지 5개 폭과 한 장 보기 4개 폭에서 페이지 가로 넘침이 없었으며, 로드 실패 시 해당 표본을 숨기는 안내도 확인했다. 빠른 전환과 URL 복원도 확인했다. 검증 범위는 이 원고와 로컬 브라우저이며 실제 제작 원고·다른 출력 매체에서는 다시 확인한다.

## 선택 결과

사용자가 SUITE를 선택했다. 제목·소제목·핵심 문장·흐름과 단계 제목을 SUITE 700으로, 본문·표·조작 요소를 Pretendard로 정리했다. 확정 로고의 이름은 Pretendard 600이다. 원본과 라이선스를 design-system/assets/fonts/에 복사하고 공통 토큰·반복 요소·홈페이지·Edu에 연결했다.

현재 기준은 [공통 기초](../../design-system/FOUNDATIONS.md)와 [기본 제작 키트](../../design-system/index.html)를 따른다. 실제 제작 원고를 넣으며 줄바꿈과 정보량을 다듬는다.
