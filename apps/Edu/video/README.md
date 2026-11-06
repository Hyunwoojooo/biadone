# BiaDone Edu · 커리큘럼 소개 영상

## 투명 배경 캐릭터와 주현우 목소리 · v5

사용 중인 세 캐릭터의 회색 배경을 투명 PNG로 바꾸고, 도입의 ‘내 사업의 실제 업무’ 문구를 삭제했습니다. 같은 시각 수정을 적용한 두 버전을 비교할 수 있습니다.

- [주현우 목소리 MP4 · 2분 24.8초](out/BiaDone-Edu-Curriculum-v5-Juhyunwoo.mp4)
- [기존 June 목소리 MP4 · 2분 50.5초](out/BiaDone-Edu-Curriculum-v5.mp4)
- [배경·문구 수정 장면](out/BiaDone-Edu-Curriculum-v5-character-frames.png)
- [주현우 버전 한국어 자막](out/BiaDone-Edu-Curriculum-v5-Juhyunwoo.ko.srt)
- [누끼 PNG·프롬프트·검사 기록](content/cutout-character-sources-v5.json)

누끼는 built-in imagegen을 세 번 사용해 배경만 제거했습니다. 실제 RGBA 파일은 `public/character/cutout-v5/`에 있으며, 원본 컬러 PNG와 이전 MP4는 보존합니다. 기존 `line`·`color` 구성은 유지하고, 새 `cutout` 구성에서만 투명 이미지를 사용합니다.

주현우 버전은 사용자가 지정한 ElevenLabs `OPFjzL0JpsgltRkDljyO` 목소리로 동일한 대본 12장면·1180자를 새로 생성했습니다. [문자별 타임스탬프 API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)를 사용해 실제 발화 길이에 맞춰 4344프레임으로 구성하고 자막도 갱신했습니다. 기존 5115프레임 타임라인과 June 음성은 수정하지 않았습니다. API 키는 저장하거나 출력하지 않습니다. 음성 제작 기록은 `content/voice-juhyunwoo-production.json`, 새 타임라인은 `content/timeline-juhyunwoo.json`에 있습니다.

Studio의 `CurriculumClean`은 June 버전, `CurriculumJuhyunwoo`는 주현우 버전입니다. `npm run v5:master` → `npm run v5:stills` → `npm run v5:render` → `npm run v5:verify`로 확인합니다. 원본 보존과 실제 MP4 배경 검사는 `python3 scripts/verify-cutout-voice-v5.py`로 실행합니다. 검증 기록은 `out/work/cutout-voice-v5/`에 저장합니다.

## 컬러 캐릭터 교체 · v4

기존 `BiaDone-Edu-Curriculum-v3.mp4`를 바탕으로 캐릭터가 나오는 도입·학습 흐름·마무리 세 장면을 새 컬러 원본 이미지로 교체한 버전입니다. 도입은 생각하는 표정, 설명은 손짓, 마무리는 엄지 척 포즈를 사용합니다.

- [컬러 캐릭터 v4 MP4](out/BiaDone-Edu-Curriculum-v4.mp4)
- [교체한 세 장면](out/BiaDone-Edu-Curriculum-v4-character-frames.png)
- [한국어 자막](out/BiaDone-Edu-Curriculum-v4.ko.srt)
- [원본 이미지 복사·매핑 기록](content/color-character-sources-v4.json)

사용자가 제공한 1254×1254 RGB PNG 8장을 `public/character/color-v4/`에 바이트 그대로 복사했습니다. 재생성·흑백 변환·색 보정·배경 제거 없이 원본 배경까지 표시하며, 손짓과 얼굴 전체가 들어오게 비율을 유지해 배치합니다. 기존 내레이션은 v3 AAC 비트스트림을 그대로 복사합니다. 나머지 장면은 v3에서 가져오며, 전체 170.5초·5115프레임을 유지합니다. v3와 이전 영상 파일은 보존합니다.

새 구성은 Studio의 `CurriculumColor`이며, 기존 `CurriculumIntro`는 기본 흑백 캐릭터 경로를 유지합니다. `npm run color:stills` → `npm run color:render` → `npm run color:verify`로 출력·확인합니다. 검증 기록과 이전 `Actor.tsx` 사본은 `out/work/color-characters-v4/`에 있습니다.

## 방 안으로 들어가는 연출 샘플

HTML 화면 구성을 옮긴 캠퍼스 투어와 별도로, 주인공의 뒤통수에서 시작해 실제 문턱을 통과하고 AI 직원들이 기획·제작·검수하는 방을 보여주는 30초 `RoomFilmStudy` 시안입니다. 전체 2~3분 안내 영상으로 확장하기 전, 첫 방의 카메라와 작업 동작을 확인하는 범위입니다.

- [30초 MP4](out/BiaDone-Edu-Room-Film-Study.mp4)
- [장면 모음](out/BiaDone-Edu-Room-Film-Study-frames.png)
- [한국어 자막](out/BiaDone-Edu-Room-Film-Study.ko.srt)
- [연출 구성](content/room-film-direction.md)
- [검증 기록](out/room-film/verification.json)

세트·주인공·직원은 새로 만든 프레임 기반 3D 시안입니다. 원본 캠퍼스 지도와 정보 패널을 사용하지 않습니다. Remotion 4.0.538의 `@remotion/three`, React 19와 호환되는 `@react-three/fiber` 9, Three.js를 추가했습니다. 폰트와 두 개의 내레이션 구간은 기존 파일을 재사용하고, 발소리·타이핑·종이·짧은 음악은 로컬에서 합성합니다. 새 유료 생성 API 호출은 없습니다. 기존 HTML·이전 MP4·사용자 캐릭터 원본은 보존합니다.

`npm run room:audio` → `npm run room:stills` → `npm run room:render` → `npm run room:verify` 순서로 확인합니다. 소스는 `src/room-film/`이며, 카메라 경로는 `story.ts`, 전체 구성은 `RoomFilm.tsx`, 세트는 `StudioRoom.tsx`, 캐릭터 동작은 `Characters.tsx`에 있습니다.

## 캠퍼스 투어 영상

기존 HTML 캠퍼스를 바탕으로 **캐릭터 이동 → 방 확대 → 실습 내용과 결과물 안내**를 이어 붙인 별도 `CampusTour` 영상입니다. 이전 선화 영상은 그대로 보존합니다.

- [캠퍼스 투어 MP4](out/BiaDone-Edu-Campus-Tour.mp4)
- [장면 모음](out/BiaDone-Edu-Campus-Tour-frames.png)
- [한국어 자막](out/BiaDone-Edu-Campus-Tour.ko.srt)
- [미리보기 Studio](http://localhost:4340/CampusTour)

1920×1080, 30fps, 170.5초, H.264(yuv420p)/AAC 형식입니다. 최종 출력 단계에서 브라우저 JPEG 프레임의 전체 색상 범위를 표준 영상 범위로 변환합니다. 기초·A–E·심화의 7개 방과 전 과정 공통 안내를 다루며, 실습 52개 항목과 결과물 16개를 표시합니다. 상세 목록은 처음부터 모두 보이며 각 안내 화면을 11초 이상 유지합니다. A–E에는 목적별 선택 과정임을 표시합니다.

원본 `output/biadon-edu-campus/`의 지도와 걷기 스프라이트를 복사하고, 기존 복도 연결 그래프를 따라 이동을 자동화했습니다. 원본 HTML의 버튼·방향키 조작은 그대로 유지하며 수정하지 않았습니다. 영상은 재생만으로 탐색을 볼 수 있게 별도로 연출합니다.

기존에 검증한 ‘비아던 에듀’ 내레이션을 재사용합니다. 이번 투어 영상에서는 음성·이미지 생성 API를 호출하지 않았습니다. 결과물은 상세 패널의 제목 아래 부제로 표시하며, 삭제했던 ‘남는 결과물’ 하단 푸터와 교육 시간·회차 표기는 넣지 않았습니다.

| 명령 | 용도 |
| --- | --- |
| `npm run campus:check` | 동선 연결·읽기 시간·원본 에셋 일치 확인 |
| `npm run campus:stills` | 방별 상세 화면과 이동 장면 확인 |
| `npm run campus:render` | 캠퍼스 영상 렌더 및 기존 내레이션 연결 |
| `npm run campus:verify` | 완성 MP4 전체 디코딩과 화면·오디오 검증 |

주요 소스는 `src/campus-tour/CampusTour.tsx`(장면 구성), `tour-state.ts`(동선·카메라), `MapStage.tsx`(지도·캐릭터), `RoomBoard.tsx`(상세 패널), `campus-data.ts`(커리큘럼·지도 데이터)입니다. 검증 기록은 `out/campus-tour/`에 저장합니다.

## 선화 소개 영상

최신 커리큘럼으로 제작한 **2분 50.5초 소개 영상 1차본**입니다. 1920×1080, 30fps, H.264/AAC 형식이며 12개 장면으로 구성했습니다. 흰 바탕·검은 선화·짧은 강조 문장과 한국어 남성 내레이션을 사용합니다. 실제 화면 녹화와 교육 시간·회차 표기는 없습니다.

- [완성 MP4](out/BiaDone-Edu-Curriculum.mp4)
- [한국어 자막 SRT](out/BiaDone-Edu-Curriculum.ko.srt) — 필요한 플레이어에서 별도로 불러올 수 있습니다.
- [실제 MP4에서 추출한 장면 모음](out/BiaDone-Edu-Curriculum-frames.png)
- [대본](content/narration.ko.txt) · [장면 구성](content/storyboard.md)
- [파일 검증 결과](out/verification.json)

기초 → 목적별 선택 A–E → AI 업무팀 → 공통 운영 순서로 소개합니다. A–E는 필요한 업무에 맞춘 선택 과정이며, 필수 이수 순서로 표현하지 않았습니다.

v2에서는 모든 장표 하단의 ‘남는 결과물’ 라벨과 결과물 설명 줄을 삭제했습니다. 내레이션과 장면 길이는 유지했습니다. 이전 MP4와 렌더 파일은 `out/work/before-footer-removal/`에 보존합니다.

v3에서는 반복 화살표가 ‘고칩니다’ 아래에서 시작하도록 옮기고, 선택 과정의 공통 수평선과 C 분기선 높이를 맞췄습니다. 공통 선은 한 번만 그려 접점의 겹침을 없앴습니다. 해당 두 장면만 다시 렌더링했으며 기존 AAC 음성은 그대로 복사했습니다.

## 실행

Remotion과 공식 패키지는 기존 에디터와 같은 `4.0.538`로 고정했습니다. Node.js 22.12 이상을 사용합니다. 다른 컴퓨터에서 처음 준비할 때는 이 폴더에서 `npm ci`로 동일한 의존성을 설치합니다.

이 폴더에서 실행합니다.

```sh
cd /Users/joo/BiaDone/apps/Edu/video
npm run studio
```

`npm run dev`도 같은 미리보기를 실행합니다. 브라우저에서 [http://localhost:4340/CurriculumIntro](http://localhost:4340/CurriculumIntro)을 엽니다. 설치 확인용 `SetupCheck`도 보존했습니다.

## 확인과 출력

| 명령 | 용도 |
| --- | --- |
| `npm run typecheck` | TypeScript 확인 |
| `npm run versions` | Remotion 패키지 버전 일치 확인 |
| `npm run compositions` | 등록된 영상 구성 확인 |
| `npm run render` | 본편 렌더 → 실제 음성 배치 → 음량 정리 → 최종 MP4 |
| `npm run stills` | 장면별 확인 이미지 출력 |
| `python3 scripts/verify-video.py` | 완성 MP4 전체 디코딩·화면/음성/자막 확인 |
| `npm run render:check` | `out/setup-check.mp4` 출력 |
| `npm run still:check` | `out/setup-check.png` 정지 화면 출력 |

설치 확인용 구성은 `1920×1080`, `30fps`, `90프레임`입니다. 움직임은 프레임 번호를 기준으로 계산하므로 미리보기와 렌더링에서 같은 시간에 같은 화면을 만듭니다.

2026-10-27 설치 후 TypeScript 검사, Remotion 패키지 버전 일치, 컴포지션 조회와 실제 H.264 MP4 출력을 확인했습니다. FFmpeg 전체 디코딩으로 3초·90프레임을 확인했습니다. 이 Mac에서는 `remotion.config.ts`가 설치된 Google Chrome을 사용하며, 다른 Chrome 경로가 필요하면 실행할 때 `REMOTION_BROWSER_EXECUTABLE`을 지정할 수 있습니다.

로컬 Studio에서도 `SetupCheck`의 한국어 표시와 재생에 따른 프레임 변화를 확인했습니다. 콘솔·실행 오류와 실패한 리소스 요청은 없었습니다.

## 제작 방향과 자료

- 깨끗한 흰 바탕, 검은 선화, 넓은 여백과 절제된 포인트색.
- 상단의 짧은 문장과 핵심 단어의 굵기 강조.
- 선화·도식·결과물의 등장과 확대를 사용해 음성 설명을 보조.
- 첫 커리큘럼 영상에는 실제 화면 녹화를 넣지 않으며 Screen Studio 도입은 보류.
- 교육 시간·횟수 표기는 영상 화면에서 제외.
- ElevenLabs의 June — Calm, Clear and Steady 목소리와 Multilingual v2 모델로 생성한 한국어 내레이션.
- 브랜드 발음은 사용자가 확인한 **비아던 에듀**. 처음 생성한 음성과 발음 수정본을 모두 보존했습니다.
- 사용자가 제공한 캐릭터 PNG 5개를 원본 그대로 복사하고, 같은 얼굴·표정을 유지한 선화 파생본을 사용했습니다. `content/character-sources.json`에서 원본과 복사본의 해시 일치를 확인할 수 있습니다.
- 도식의 상품·가격·계산 예시는 설명을 위한 가상 자료입니다.

내레이션과 문자별 타이밍은 `public/audio/curriculum/`에 있습니다. `content/voice-production.json`에는 사용한 목소리·모델·설정과 최종 음성 경로가 기록되어 있습니다. API 키는 프로젝트에 저장하지 않습니다. 생성 스크립트는 실행 시 표시되지 않는 입력으로 키를 받고 프로세스 메모리에서만 사용합니다.

`scripts/build-timing.mjs`는 실제 음성 길이를 읽어 장면과 자막을 만듭니다. 이번 발음 수정은 `--keep-scenes`로 기존 장면 위치를 유지했고, 수정한 음성이 구간 안에 들어가는지도 확인했습니다. 음성이 장면보다 길면 중단합니다.

완성본은 장면 시작 후 8프레임에 음성을 배치하고, 전체 음량을 약 -16 LUFS로 정리했습니다. 원본 Remotion 렌더와 정리 전후 오디오 마스터는 `out/work/`에 보존합니다. 배경음악은 사용하지 않았습니다.

텍스트 수정은 `src/curriculum/scenes.ts`, 도식 수정은 `StoryArt.tsx`와 `StoryShapes.tsx`, 화면 구성은 `CurriculumIntro.tsx`에서 합니다. 대사를 바꾸면 기존 음성을 그대로 재사용하지 않도록 새 버전으로 생성하고 타이밍을 갱신해야 합니다. `npm run content`는 대사를 음성 작업용 JSON으로 내보냅니다.

음성 생성은 ElevenLabs 공식 [타임스탬프 API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)를 사용합니다. 기존 `editor/`, `Docs/`, `Sources/`와 HTML 캠퍼스 결과물은 수정하지 않았습니다.

## 파일 구성

- `src/index.ts`: Remotion 진입점.
- `src/Root.tsx`: 영상 등록과 크기·프레임 설정.
- `src/SetupCheck.tsx`: 설치 확인용 모션.
- `src/fonts.ts`: 로컬 Pretendard Variable 글꼴 로드.
- `public/fonts/`: 글꼴 파일과 OFL 라이선스.
- `src/curriculum/`: 본편 장면·도식·캐릭터·실제 음성 타이밍.
- `public/character/`: 사용자 캐릭터 원본과 선화 파생본.
- `public/audio/`: 생성된 내레이션과 문자별 타이밍.
- `content/`: 대본·장면 구성·제작 기록.
- `scripts/`: 음성 생성·타이밍·렌더 검수·최종 출력.
- `out/`: 출력 파일.
