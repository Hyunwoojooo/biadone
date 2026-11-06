# Biadone 시각 방향 비교 1차

상태: 사용자 미선택. 세 방향 모두 애매하고 평범하다는 피드백을 받아 2차 시안으로 넘어갔다. 1차 자료는 비교 기록으로 보존한다.

## 적용 우선순위

1. 회사 소개 홈페이지
2. Biadone Edu 강의자료와 소개서
3. 유튜브와 SNS 콘텐츠
4. 서비스 화면 또는 앱 UI

## 비교 범위

회사 소개 홈페이지의 첫 화면을 동일한 문구와 정보 순서로 비교한다. 각 시안은 헤더, 비전을 소개하는 첫 화면, 프로젝트 소개의 시작 부분을 포함한다. 제작된 이미지는 시각 방향 검토용이며 웹 구현과 사용성 검증은 선택 후 진행한다.

## 공통 문구 초안

- 제목: 하고 싶은 일을, / 해낼 수 있도록.
- 설명: 생각과 생활, 작업을 이해하는 / 나의 분신을 만듭니다.
- 행동: 서비스 살펴보기
- 서명: Before I ask, Done.
- 프로젝트: Blabee, Biadone Edu
- 교육 설명과 상태: AI · AX · 자동화 교육 / 준비 중

사용자에게 확인한 비전을 바탕으로 작성한 시안용 문구다. 현재 제품이 장기 비전을 이미 구현했다는 주장은 포함하지 않는다.

## 생성 방식

내장 image_gen 도구를 사용한다. 아래 색상은 생성 지시를 위한 제안값이며, 이미지에서 색상이 정확히 재현되었거나 최종 토큰으로 승인되었다는 의미는 아니다. 서체는 현재 성격만 비교하며 실제 글꼴은 이후 한국어 조판과 사용 조건을 확인해 선정한다.

## 검토 기록

- 세 결과물을 모두 PNG, 1536 × 1024로 확인하고 프로젝트 폴더에 저장했다.
- 세 이미지를 시각적으로 검토했다. 주요 문구, Biadone, Blabee, Biadone Edu에서 눈에 띄는 오탈자나 잘림은 없었다.
- 색감과 조형의 차이를 통해 세 방향을 구분할 수 있으며, 방향 선택용 자료로 사용할 수 있다.
- 실제 홈페이지 문구를 확정할 때는 장기 비전의 시점, Blabee의 현재 역할 설명, 행동 문구를 함께 다듬는다. 현재 문구는 시각 비교용 초안이다.
- 사용자의 방향 선택, 실제 웹 구현, 모바일 검증은 다음 단계다.

## A 정돈된 신뢰

밝은 바탕과 깊은 블루, 정교한 정렬에 부드러운 곡선을 더한 방향.

제안 팔레트: #F5F7FA · #142136 · #3659E3 · #F3B59B

이미지: [A 정돈된 신뢰](a-clear-trust.png)

### 생성 프롬프트

```text
Use case: ui-mockup.
Asset type: high-fidelity brand direction study using a Korean corporate homepage first viewport. This is an early visual comparison, not a shipped website.
Primary request: Design one beautiful, believable, professionally art-directed desktop homepage opening for Biadone, a company whose name means "Before I ask, Done." Its long-term vision is an AI companion and worker that deeply understands an individual's thoughts, life and work. Audience: curious people who enjoy building many things and pursuing multiple challenges. Brand personality: competent, dependable, trustworthy, flexible, approachable; avoid rigid bureaucracy.
Composition: one straight-on flat webpage screenshot, landscape 3:2, approximately 1536x1024. Show a complete compact header, a generous hero, and a readable opening projects strip below. No browser/device frame, no presentation border, no A/B labels within the webpage. Keep the hero headline at left and ONE distinctive sculptural brand visual at right; a projects strip across the bottom. Consistent content and information hierarchy are essential for fair comparison with other directions.
Text (verbatim, keep the exact spelling and Korean):
Wordmark: "Biadone"
Navigation: "비전" "서비스" "문의"
Hero headline, exactly two lines: "하고 싶은 일을," / "해낼 수 있도록."
Hero supporting copy, exactly two lines: "생각과 생활, 작업을 이해하는" / "나의 분신을 만듭니다."
Hero primary action: "서비스 살펴보기"
Small brand signature near the bottom of the hero, NOT above the headline: "Before I ask, Done."
Projects heading: "우리가 만드는 것"
Project 1 name: "Blabee"
Project 2 name: "Biadone Edu"
Project 2 description: "AI · AX · 자동화 교육"
Project 2 status: "준비 중"
Typography: polished Korean sans-serif with strong legible hierarchy, carefully balanced Korean glyphs, large short headline, generous line spacing and dark/light contrast. Header and project strip text must remain readable. Crisp typography, vector-like geometry, excellent spacing and optical alignment.
Constraints: same headline, subcopy, project names and nav in every direction. Only the listed text, no invented proof, customer logos, user counts, performance metrics, testimonials, launch announcements or already-working digital-twin product claims. Use an original exploratory abstract paired/twin-form logo mark next to the wordmark. No robots, brains, star sparkle icons, cartoon faces, fake dashboards, app screenshot cards, nested cards, default bento grids, pills, badges, eyebrow above the headline, excessive gradients or decorative UI widgets. Do not make a full brand manual or a collage. Create a single homepage screen. The two projects at the bottom should be an elegant open typographic strip separated by a fine rule, not rounded marketing cards.

Art direction A: clear trust. Airy near-white #F5F7FA canvas, deep ink-navy #142136 typography, controlled cobalt-blue #3659E3 accent, tiny warm peach #F3B59B counterpoint. Calm engineering precision with a humane softness. Headline is a confident contemporary Korean grotesk in dark navy, left aligned, large, with the second line cobalt. Quiet header with well-spaced nav. A compact cobalt filled CTA with a restrained 10px radius. On the right, one museum-quality matte sculptural object made from two complementary interlocking rounded upright forms, one cobalt and one soft warm-white, representing a person and their capable twin; tactile finish, subtle grounded shadow, integrated into the bright background, no glowing sci-fi. Small original paired-form monogram as logo. Open whitespace, fine cool-gray rules. Maintain the warmth in soft geometry rather than adding friendly illustrations. The bottom project strip is white with navy labels and a small blue directional detail. This should feel dependable, clear, modern, flexible and quietly distinctive.
```

## B 온기 있는 전문성

따뜻한 아이보리와 차콜, 절제된 테라코타로 편안한 신뢰를 표현한 방향.

제안 팔레트: #FAF8F4 · #252F31 · #B65B3D · #CAD9C6

이미지: [B 온기 있는 전문성](b-warm-precision.png)

### 생성 프롬프트

```text
Use case: ui-mockup.
Asset type: high-fidelity brand direction study using a Korean corporate homepage first viewport. This is an early visual comparison, not a shipped website.
Primary request: Design one beautiful, believable, professionally art-directed desktop homepage opening for Biadone, a company whose name means "Before I ask, Done." Its long-term vision is an AI companion and worker that deeply understands an individual's thoughts, life and work. Audience: curious people who enjoy building many things and pursuing multiple challenges. Brand personality: competent, dependable, trustworthy, flexible, approachable; avoid rigid bureaucracy.
Composition: one straight-on flat webpage screenshot, landscape 3:2, approximately 1536x1024. Show a complete compact header, a generous hero, and a readable opening projects strip below. No browser/device frame, no presentation border, no A/B labels within the webpage. Keep the hero headline at left and ONE distinctive sculptural brand visual at right; a projects strip across the bottom. Consistent content and information hierarchy are essential for fair comparison with other directions.
Text (verbatim, keep the exact spelling and Korean):
Wordmark: "Biadone"
Navigation: "비전" "서비스" "문의"
Hero headline, exactly two lines: "하고 싶은 일을," / "해낼 수 있도록."
Hero supporting copy, exactly two lines: "생각과 생활, 작업을 이해하는" / "나의 분신을 만듭니다."
Hero primary action: "서비스 살펴보기"
Small brand signature near the bottom of the hero, NOT above the headline: "Before I ask, Done."
Projects heading: "우리가 만드는 것"
Project 1 name: "Blabee"
Project 2 name: "Biadone Edu"
Project 2 description: "AI · AX · 자동화 교육"
Project 2 status: "준비 중"
Typography: polished Korean sans-serif with strong legible hierarchy, carefully balanced Korean glyphs, large short headline, generous line spacing and dark/light contrast. Header and project strip text must remain readable. Crisp typography, vector-like geometry, excellent spacing and optical alignment.
Constraints: same headline, subcopy, project names and nav in every direction. Only the listed text, no invented proof, customer logos, user counts, performance metrics, testimonials, launch announcements or already-working digital-twin product claims. Use an original exploratory abstract paired/twin-form logo mark next to the wordmark. No robots, brains, star sparkle icons, cartoon faces, fake dashboards, app screenshot cards, nested cards, default bento grids, pills, badges, eyebrow above the headline, excessive gradients or decorative UI widgets. Do not make a full brand manual or a collage. Create a single homepage screen. The two projects at the bottom should be an elegant open typographic strip separated by a fine rule, not rounded marketing cards.

Art direction B: warm precision. Luminous warm-ivory #FAF8F4 canvas, charcoal #252F31 typography, rich muted terracotta #B65B3D accent and a restrained pale-sage #CAD9C6 counterpoint. Contemporary editorial craft and a trustworthy human presence. Same left headline/right hero architecture and exact copy as other directions, but use a more humanist Korean sans serif with generous round counters and strong confident weight, no serif Korean type, no handwritten fonts. First headline line charcoal, second terracotta. Header is calm and refined. CTA is terracotta with a charcoal/ivory readable label and softly eased corners. The right hero visual is one original tactile sculpture of two precisely fitted but gently organic complementary loop forms, one terracotta ceramic and one charcoal matte rubber, a person and their twin working as one, in soft natural studio light. Grounded, cultured, approachable, unpretentious; no cozy lifestyle props, no generic beige minimalism. Bottom open project strip has careful typographic alignment and warm-gray fine rules. Original twin-form logo mark has a human, supple geometry. Preserve large readable Korean text, real corporate credibility, and enough whitespace to breathe.
```

## C 차분한 추진력

깊은 청록과 밝은 민트의 대비, 유연한 흐름으로 안정감과 실행력을 표현한 방향.

제안 팔레트: #103F43 · #F3F8F5 · #D9EDB0 · #A8D6CF

이미지: [C 차분한 추진력](c-quiet-confidence.png)

### 생성 프롬프트

```text
Use case: ui-mockup.
Asset type: high-fidelity brand direction study using a Korean corporate homepage first viewport. This is an early visual comparison, not a shipped website.
Primary request: Design one beautiful, believable, professionally art-directed desktop homepage opening for Biadone, a company whose name means "Before I ask, Done." Its long-term vision is an AI companion and worker that deeply understands an individual's thoughts, life and work. Audience: curious people who enjoy building many things and pursuing multiple challenges. Brand personality: competent, dependable, trustworthy, flexible, approachable; avoid rigid bureaucracy.
Composition: one straight-on flat webpage screenshot, landscape 3:2, approximately 1536x1024. Show a complete compact header, a generous hero, and a readable opening projects strip below. No browser/device frame, no presentation border, no A/B labels within the webpage. Keep the hero headline at left and ONE distinctive sculptural brand visual at right; a projects strip across the bottom. Consistent content and information hierarchy are essential for fair comparison with other directions.
Text (verbatim, keep the exact spelling and Korean):
Wordmark: "Biadone"
Navigation: "비전" "서비스" "문의"
Hero headline, exactly two lines: "하고 싶은 일을," / "해낼 수 있도록."
Hero supporting copy, exactly two lines: "생각과 생활, 작업을 이해하는" / "나의 분신을 만듭니다."
Hero primary action: "서비스 살펴보기"
Small brand signature near the bottom of the hero, NOT above the headline: "Before I ask, Done."
Projects heading: "우리가 만드는 것"
Project 1 name: "Blabee"
Project 2 name: "Biadone Edu"
Project 2 description: "AI · AX · 자동화 교육"
Project 2 status: "준비 중"
Typography: polished Korean sans-serif with strong legible hierarchy, carefully balanced Korean glyphs, large short headline, generous line spacing and dark/light contrast. Header and project strip text must remain readable. Crisp typography, vector-like geometry, excellent spacing and optical alignment.
Constraints: same headline, subcopy, project names and nav in every direction. Only the listed text, no invented proof, customer logos, user counts, performance metrics, testimonials, launch announcements or already-working digital-twin product claims. Use an original exploratory abstract paired/twin-form logo mark next to the wordmark. No robots, brains, star sparkle icons, cartoon faces, fake dashboards, app screenshot cards, nested cards, default bento grids, pills, badges, eyebrow above the headline, excessive gradients or decorative UI widgets. Do not make a full brand manual or a collage. Create a single homepage screen. The two projects at the bottom should be an elegant open typographic strip separated by a fine rule, not rounded marketing cards.

Art direction C: quiet confidence with forward motion. Deep confident teal #103F43 is the full header and hero background; warm-white #F3F8F5 type, restrained light-pear #D9EDB0 action accent, mist-mint #A8D6CF supporting detail. The bottom projects strip transitions cleanly to warm-white with dark-teal type. Dark does not mean black or neon cyberpunk. The same large left-aligned two-line Korean headline is warm white; emphasize only one meaningful phrase using a very subtle light-pear detail, no highlight pill. Use a precise but rounded modern Korean sans serif, confident thick weight and spacious line rhythm. Header wordmark and nav warm-white. Primary CTA is a compact light-pear button with deep-teal text and 10px radius. On the right create one sophisticated three-dimensional double-ribbon sculpture: two broad, gently bending matte mint and pear ribbons travel together into a calm joined form, evoking an individual's capable twin and effortless momentum. No many tiny lines, no particle clouds, no glowing infinity symbol. Subtle directional fluidity with a strong stable base. Original twin-strand logo mark. It should feel quietly powerful, composed, trustworthy and flexible, never corporate stiff, never flashy. Keep all the same exact webpage content as other directions.
```

