# Biadone 색감과 서체 비교 기록

상태: 사용자가 A 맑은 블루와 Pretendard를 선택했다. 선택된 기초는 ../../design-system/FOUNDATIONS.md에 정리했다. 3차는 색감과 서체를 비교하는 자료로 보존하며, 홈페이지 구성과 로고는 이어서 결정한다.

## 반영한 사용자 피드백

- 2차 세 로고를 모두 선호하지 않는다.
- 세 화면 모두 칙칙하며 주된 원인은 색감이다.
- Pretendard는 읽기 좋지만 딱딱하게 느껴진다.
- 유능함, 신뢰, 유연함이라는 회사의 성격은 유지한다.

## 비교 방법

색감 비교는 같은 Pretendard, 같은 크기·굵기·문구·구성에서 팔레트만 바꾼다. 대표 색상을 넓은 면에 적용해 명확하게 볼 수 있도록 했다.

서체 비교는 선택한 같은 팔레트에서 제목 600, 본문 400, 같은 크기와 문구를 사용한다. Pretendard는 기존 가독성의 기준으로 남기고 Wanted Sans와 SUITE를 실제 파일로 비교한다.

색감과 서체의 선택은 아래 조합 미리보기에 반영된다. 주소의 #sky-wanted 같은 값으로 조합을 다시 열 수 있다. 클릭은 비교 상태이며 브랜드 최종 승인이나 파일 저장을 뜻하지 않는다.

로고는 별도 탐색 중이므로 이름만 임시 표기했다. 거절한 I 심벌을 재사용하지 않는다.

## 팔레트 후보

| 후보 | 대표 색상 | 밝은 바탕 | 대표 색상 위 글자 |
| --- | --- | --- | --- |
| A 맑은 블루 | #2858F0 | #EEF5FF | #FFFFFF |
| B 생기 있는 민트 | #17D2A4 | #EBFFF7 | #124438 |
| C 밝은 코랄 | #FF846B | #FFF1E8 | #4A241C |

본문의 기준 글자색은 #23314D다. 대표 색상 위의 글자는 팔레트별 대비에 맞춰 정했다. 원시값, 용도, 컴포넌트의 세 층을 tokens.json에 기록하고 설치된 design-system 스크립트로 tokens.css를 생성한다.

## 세 스킬 적용

- design-system: 색상과 글꼴의 원시값, 용도별 별칭, 팔레트·버튼 컴포넌트 토큰을 연결했다.
- ui-ux-pro-max: 색상 검색의 첫 쿼리는 일치 항목이 없었다. 재검색의 Productivity Tool 항목에서 밝은 바탕과 청록 계열의 역할을 참고했으며, 개발 도구의 어두운 팔레트와 학습 도구의 보라 팔레트는 채택하지 않았다. 위 세 팔레트는 사용자 피드백에 맞춰 별도로 설계했다. 가독성, 키보드 포커스, 터치 영역, 반응형과 대비를 점검한다.
- frontend-design: 로고·레이아웃·서체·색을 한꺼번에 바꿔 판단을 어렵게 만들던 비교 방법을 정리했다. 색과 글자 각각의 인상을 확인할 수 있게 통제하고, 큰 입체 장식과 I 로고를 제거했다.

## 서체 출처와 사용 범위

### Pretendard

기존 프로젝트의 원본 WOFF2와 SIL OFL 1.1 라이선스를 복사했다. 비교의 기준과 누락 글리프의 대체 서체로 사용한다.

### Wanted Sans Variable

- 공식 프로젝트: https://github.com/wanteddev/wanted-sans
- 고정 커밋: 02c9b822349c188ada95f9e2d90c2ed18f853235
- 공식 소개와 라이선스: https://github.com/wanteddev/wanted-sans/blob/02c9b822349c188ada95f9e2d90c2ed18f853235/packages/wanted-sans/README.md
- 실제 파일: assets/fonts/wanted-sans-variable.woff2
- 내부 버전: 1.003
- 실제 지원 굵기: 400–1000. 비교에 사용하는 400과 600을 지원한다.
- 한글 완성형: 11,172/11,172. 비교 문구와 영문·숫자 표본의 누락이 없었다.
- 라이선스: SIL OFL 1.1. 원본 파일을 변경하지 않고 프로젝트 CSS 별칭 BrandWanted로 불러온다.
- SHA-256: 4259e7e9a172e634c2cb419d793b84148990316341e910443e5d10965b2c8f16

### SUITE Variable

- 공식 프로젝트: https://github.com/sun-typeface/SUITE
- 고정 커밋: a114fec078bfcbdc93a7b2190510ab83de2a2d40
- 공식 라이선스: https://github.com/sun-typeface/SUITE/blob/a114fec078bfcbdc93a7b2190510ab83de2a2d40/LICENSE
- 실제 파일: assets/fonts/suite-variable.woff2
- 내부 버전: 2.040
- 실제 지원 굵기: 300–900. 비교에 사용하는 400과 600을 지원한다.
- 한글 완성형: 2,668/11,172. 이번 비교 문구와 영문·숫자 표본의 누락은 없었다.
- 브랜드 제목의 성격을 비교하는 후보로 사용한다. 긴 본문에는 누락 글리프가 생길 수 있어 Pretendard 대체 서체를 유지한다.
- 라이선스: SIL OFL 1.1. 원본 파일을 변경하지 않고 프로젝트 CSS 별칭 BrandSuite로 불러온다.
- SHA-256: fc5e0648d5413b55b79ebbab0f50de561a026574cba3a9c8eb03d5bddd432263

새 서체의 원본 라이선스는 폰트 파일과 같은 폴더에 보존했다. 사용자 OS에 글꼴을 설치하거나 npm 의존성을 추가하지 않았다.

## 열어보기

index.html을 직접 열거나 로컬 서버에서 /round-03/를 연다.

```sh
python3 -m http.server 4326 --bind 127.0.0.1 --directory /Users/joo/BiaDone/brand/concepts
```

토큰을 수정할 때는 아래 명령으로 CSS를 다시 생성한다.

```sh
node /Users/joo/.agents/skills/design-system/scripts/generate-tokens.cjs --config /Users/joo/BiaDone/brand/concepts/round-03/tokens.json -o /Users/joo/BiaDone/brand/concepts/round-03/tokens.css
```

