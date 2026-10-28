import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../design-system');
const output = path.join(here, 'public');
const version = 'v0.1';
const releaseDate = '2026-10-27';
const origin = 'https://brand.biadone.com';
const archiveName = `biadone-brand-kit-${version}.zip`;
const generated = new Set();

const runtimeFiles = [
  'biadone.css', 'fonts.css', 'tokens.css', 'tokens.json', 'logo.css',
  'screen-style.tokens.css', 'screen-style.tokens.json',
  'components.css', 'components.tokens.css', 'components.tokens.json', 'guide.css',
  'assets/fonts/PretendardVariable.woff2', 'assets/fonts/Pretendard-LICENSE.txt',
  'assets/fonts/SUITE-Variable.woff2', 'assets/fonts/SUITE-LICENSE.txt',
  'assets/logo/biadone-symbol.svg', 'assets/logo/biadone-symbol-white.svg', 'assets/logo/biadone-symbol-ink.svg',
  'templates/company/index.html', 'templates/company/style.css',
  'templates/company/company.tokens.json', 'templates/company/company.tokens.css',
  'templates/edu/index.html', 'templates/edu/layout.css', 'templates/edu/renderer.js',
  'templates/edu/content.json', 'templates/edu/edu.tokens.json', 'templates/edu/edu.tokens.css'
];
const generatedFiles = ['index.html', 'docs.css', '404.html', 'robots.txt', 'manifest.json',
  'guides/foundations/index.html', 'guides/screen-style/index.html',
  'guides/components/index.html', 'guides/templates/index.html', `downloads/${archiveName}`, '_headers'];
const permitted = new Set([...runtimeFiles, ...generatedFiles]);

async function filesAt(dir, prefix = '') {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not a publish input: ${prefix}${entry.name}`);
    if (entry.isDirectory()) files.push(...await filesAt(path.join(dir, entry.name), `${prefix}${entry.name}/`));
    else files.push(`${prefix}${entry.name}`);
  }
  return files.sort();
}
for (const relative of await filesAt(output)) {
  if (!permitted.has(relative)) throw new Error(`Unexpected public file; preserved for review: ${relative}`);
}

async function put(relative, contents) {
  if (!permitted.has(relative)) throw new Error(`Output is not allowlisted: ${relative}`);
  const destination = path.join(output, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
  generated.add(relative);
}
function cleanTokenDescriptions(value) {
  if (Array.isArray(value)) return value.map(cleanTokenDescriptions);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, child]) => key !== '$description' || !/round[- ]?\d|\d+차|concepts\/|\/Users\//i.test(String(child)))
    .map(([key, child]) => [key, cleanTokenDescriptions(child)]));
}
function stripComments(text) { return text.replace(/<!--[^]*?-->/g, ''); }
function htmlMeta(html, canonical) {
  return html.replace('</head>', `  <meta name="robots" content="noindex, nofollow">\n  <link rel="canonical" href="${origin}${canonical}">\n</head>`);
}
for (const relative of runtimeFiles) {
  if (relative.endsWith('content.json')) {
    const data = JSON.parse(await readFile(path.join(source, relative), 'utf8'));
    data.meta.source = 'Biadone · 보고서 자동화 교육 예시';
    data.summary.sources = [
      { title: '예시 내용', path: 'Biadone Edu · 보고서 자동화', note: '본문 6개 문단 · 비교표 7행 × 4열 · 과정 6개 단계' },
      { title: '레이아웃 기준', path: `Biadone 공통 제작 기준 ${version}`, note: '정돈된 구조 · 유연한 정보 영역과 여백의 브랜드 표현' }
    ];
    await put(relative, JSON.stringify(data, null, 2) + '\n');
  } else if (relative.endsWith('.json')) {
    const data = JSON.parse(await readFile(path.join(source, relative), 'utf8'));
    await put(relative, JSON.stringify(cleanTokenDescriptions(data), null, 2) + '\n');
  } else if (relative.endsWith('.html')) {
    let html = stripComments(await readFile(path.join(source, relative), 'utf8'));
    if (relative === 'templates/company/index.html') {
      html = html.replace('<title>Biadone</title>', '<title>Biadone · 회사 소개 템플릿</title>')
        .replace('<p class="biadone-source">Biadone</p>', '<p class="biadone-source"><a href="../../">Biadone 제작 키트</a> · 회사 소개 템플릿 예시</p>');
    }
    await put(relative, htmlMeta(html, `/${relative.replace(/index\.html$/, '')}`));
  } else {
    const destination = path.join(output, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(source, relative), destination);
    generated.add(relative);
  }
}

const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const logo = (base = '') => `<span class="biadone-logo" role="img" aria-label="Biadone"><span class="biadone-logo__symbol"><img src="${base}assets/logo/biadone-symbol.svg" width="64" height="64" alt=""></span><span class="biadone-logo__name" aria-hidden="true">Biadone</span></span>`;
const paragraph = text => `<p class="biadone-body">${text}</p>`;
const code = text => `<pre><code>${escape(text)}</code></pre>`;
const list = items => `<ul class="docs-list biadone-body">${items.map(text => `<li>${text}</li>`).join('')}</ul>`;
const table = (caption, headings, rows) => `<div class="biadone-table-scroll" role="region" aria-label="${escape(caption)}" tabindex="0"><table class="biadone-table"><caption>${caption}</caption><thead><tr>${headings.map(text => `<th scope="col">${text}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((text, i) => `<${i ? 'td' : 'th scope="row"'}>${text}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const section = (title, body, id = '') => `<section class="docs-section"${id ? ` id="${id}"` : ''}><h2 class="biadone-section-title">${title}</h2>${body}</section>`;
function documentPage(title, description, body, slug) {
  const base = '../../';
  return `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="description" content="${escape(description)}"><link rel="canonical" href="${origin}/guides/${slug}/"><title>Biadone · ${title}</title><link rel="stylesheet" href="${base}biadone.css"><link rel="stylesheet" href="${base}guide.css"><link rel="stylesheet" href="${base}docs.css"></head><body class="biadone-theme"><header class="biadone-site-header biadone-page"><a href="${base}" aria-label="Biadone 제작 키트 처음으로">${logo(base)}</a><nav class="biadone-nav" aria-label="제작 가이드"><a href="${base}#foundations">기초 자산</a><a href="${base}#templates">템플릿</a><a href="${base}#downloads">다운로드</a></nav></header><main class="biadone-page docs-main"><div class="docs-intro"><p class="biadone-source">공통 제작 기준 · ${version} · ${releaseDate}</p><h1 class="biadone-title">${title}</h1><p class="biadone-lead">${description}</p></div>${body}</main><footer class="biadone-page kit-footer"><p class="biadone-source">Biadone · 공통 제작 키트 ${version}</p><a class="biadone-link" href="${base}">제작 키트로 돌아가기</a></footer></body></html>\n`;
}
const rawTokens = JSON.parse(await readFile(path.join(source, 'tokens.json'), 'utf8'));
const palette = rawTokens.primitive.color;
const foundations = section('색상의 역할', table('공통 팔레트', ['역할', '색상', '사용'], [
  ['대표 블루', palette.blue.$value, '핵심 행동·브랜드 식별·단계의 시작'],
  ['밝은 블루 바탕', palette.blueTint.$value, '내용의 구분과 화면 전환'],
  ['기본 글자', palette.ink.$value, '제목·본문·정보'],
  ['기본 바탕', palette.white.$value, '넓고 밝은 화면·블루 위의 글자']
])) + section('서체와 정보 위계', table('서체의 역할', ['역할', '서체·굵기', '적용'], [
  ['제목', 'SUITE 700', '큰 제목·구획 제목·소제목·핵심 문장·흐름과 단계 제목'],
  ['본문·정보', 'Pretendard 400 / 강조 600', '본문·표·출처·메뉴·버튼'],
  ['로고 이름', 'Pretendard 600', 'Biadone 균형형 로고']
]) + paragraph('한글과 영문에 같은 역할을 적용합니다. SUITE에 포함되지 않은 문자는 Pretendard로 보완합니다. 폰트 원본은 웹용 WOFF2이며, 각 라이선스를 함께 보존합니다.')) +
  section('심벌과 로고 조합', paragraph('맞물린 두 면의 심벌은 원본 SVG의 비율을 유지합니다. 내부 사선의 수직 간격은 원본 좌표에서 약 2.83이며 심벌과 함께 비례 확대·축소합니다.') + list([
    'SVG 캔버스는 64×64, 실제 도형 외곽은 48×48 정사각형입니다.',
    '로고 이름은 Pretendard 600, 자간 −0.04em입니다.',
    '심벌 외곽 높이는 이름 글자 크기의 11/12, 심벌과 이름 상자의 거리는 1/3입니다.',
    '블루 바탕에는 흰색 심벌과 흰색 이름을 조합합니다. 단색 표시는 ink 원본을 사용합니다.'
  ]) + code(`<span class="biadone-logo" role="img" aria-label="Biadone">\n  <span class="biadone-logo__symbol"><img src="assets/logo/biadone-symbol.svg" width="64" height="64" alt=""></span>\n  <span class="biadone-logo__name" aria-hidden="true">Biadone</span>\n</span>`)) +
  section('필요한 원본', paragraph('<a href="../../#downloads">다운로드 영역</a>에서 심벌 SVG, 웹폰트와 라이선스, 토큰과 HTML/CSS 제작 키트를 받을 수 있습니다. 심벌 파일과 HTML/CSS 로고 조합은 각각의 용도에 맞게 사용합니다.'));
await put('guides/foundations/index.html', documentPage('공통 기초', '색상·서체·심벌과 로고 조합을 같은 기준으로 사용합니다.', foundations, 'foundations'));

const screen = section('화면을 구성하는 원칙', list([
  '넓은 흰 바탕에 제목·설명·행동·보조 정보를 정렬합니다. 한 화면의 중심 메시지를 먼저 보여줍니다.',
  '관련 정보는 정렬·여백·얇은 구분선으로 묶습니다. 작은 모서리 곡률을 유지합니다.',
  '과정은 작은 정사각형 시작점과 직선으로 이어갑니다. 넓은 화면은 가로, 좁은 화면은 세로로 전환합니다.',
  '본문·표·과정의 크기는 내용량을 따릅니다. 심벌의 윤곽에 맞춰 내용을 자르거나 글자를 줄이지 않습니다.',
  '접합 모티프는 여백·경계·머리말에서 사용합니다. 모티프가 정보 영역을 제한하지 않게 합니다.',
  '웹은 세로로 늘어나고, 고정 슬라이드는 읽기 크기를 유지하며 여러 장으로 나눕니다.'
])) + section('공통 구조값', table('기본 구조', ['용도', '기준'], [
  ['모서리 / 연결선', '4px / 1px'], ['단계 시작점', '12px 정사각형'],
  ['관련 요소 간격 / 웹 열 간격', '24px / 32px'], ['웹 구획 여백', '96px'],
  ['웹 바깥 여백', '데스크톱 48px / 모바일 24px'], ['웹 최대 내용 너비', '1280px'],
  ['Edu 캔버스 / 바깥 여백', '1600×900 / 72px'], ['Edu 단계 열 간격', '48px']
])) + section('매체별 조판', table('읽는 환경별 기본 크기', ['요소', '웹', 'Edu'], [
  ['큰 제목', '48–84px / 모바일 32–48px', '64px'], ['본문', '18px / 모바일 16px', '26px'],
  ['단계 제목', '20px', '32px'], ['표·단계 본문', '18px / 모바일 본문 16px', '24px'],
  ['출처', '14px', '18px']
]) + paragraph('글자 크기는 읽는 환경을 기준으로 적용합니다. 긴 내용은 영역이나 장 수를 늘려 처리합니다. 실제 문구와 자료를 넣은 뒤 휴대폰·표·줄바꿈을 확인합니다.'));
await put('guides/screen-style/index.html', documentPage('화면 스타일', '정보는 유연하게 담고, 여백과 정렬에서 브랜드를 드러냅니다.', screen, 'screen-style'));

const components = section('공통 스타일 불러오기', paragraph('HTML에 공통 스타일을 연결하고 body에 biadone-theme를 지정합니다. 템플릿은 페이지의 구성과 반응형 배치를 담당합니다.') + code('<link rel="stylesheet" href="biadone.css">\n<body class="biadone-theme">\n  <main class="biadone-page">…</main>\n</body>')) +
  section('반복 요소', table('반복 요소의 사용', ['요소', '클래스', '길어진 내용 처리'], [
    ['큰 제목', '<code>.biadone-title</code>', '자연스럽게 줄바꿈'],
    ['구획·소제목', '<code>.biadone-section-title</code> / <code>.biadone-subtitle</code>', '문장에 맞춰 높이 확장'],
    ['본문·도입', '<code>.biadone-body</code> / <code>.biadone-lead</code>', '문단 단위로 확장'],
    ['핵심 문장', '<code>.biadone-message</code>', '한 화면의 중심 문장 하나'],
    ['비교표', '<code>.biadone-table-scroll</code> / <code>.biadone-table</code>', '웹은 표만 가로 스크롤, 슬라이드는 행 단위 분할'],
    ['짧은 흐름 / 단계 설명', '<code>.biadone-flow</code> / <code>.biadone-steps</code>', '웹은 세로 확장, 슬라이드는 실제 높이로 분할'],
    ['출처', '<code>.biadone-source</code>', '자료명·기관·기준 시점·원문 링크'],
    ['주요·보조 행동', '<code>.biadone-button</code> / <code>.biadone-link</code>', '이동은 링크, 동작은 버튼']
  ])) + section('표와 키보드', paragraph('표의 열과 행에 맞는 머리말을 사용합니다. 가로 스크롤 래퍼에는 tabindex="0", role="region", 내용을 설명하는 aria-label을 붙여 키보드에서도 접근할 수 있게 합니다. 행동 요소의 포커스 표시를 유지합니다.')) +
  section('토큰과 원본 수정', paragraph('색상·서체·로고는 tokens.json, 구조값은 screen-style.tokens.json, 반복 요소는 components.tokens.json에 있습니다. JSON의 원시값 → 의미 → 컴포넌트 참조를 기준으로 생성 CSS를 함께 갱신합니다. 로고·본문·제목의 서체 역할을 구분합니다.') + paragraph('본문 원고는 홈페이지 HTML 또는 Edu content.json에서 편집합니다. 페이지 배치는 각 템플릿의 CSS에 있습니다. <a href="../templates/">템플릿 편집 안내</a>를 참고하세요.'));
await put('guides/components/index.html', documentPage('반복 요소 사용법', '같은 요소를 가져와 내용과 배치에 맞게 조합합니다.', components, 'components'));

const templates = section('회사 소개 홈페이지', paragraph('비전·프로젝트·교육 사업을 소개하는 HTML/CSS 기본형입니다. <a href="../../templates/company/">예시 보기</a>에서 배치를 확인합니다. 회사 문구와 프로젝트 정보는 실제 내용에 맞게 편집합니다.') + list([
  '<code>templates/company/index.html</code>: 제목·소개·프로젝트·현재 상태를 편집합니다.',
  '<code>templates/company/style.css</code>: 해당 페이지의 배치를 관리합니다.',
  '공통 색상·서체·로고는 공통 스타일을 사용합니다. 확인되지 않은 기능·성과·후기는 추가하지 않습니다.',
  'Biadone Edu의 현재 예시는 준비 중 상태입니다. 실제 상태가 바뀌면 문구도 함께 바꿉니다.'
]), 'company') + section('Biadone Edu 강의자료', paragraph('1600×900 고정 캔버스의 HTML/CSS 템플릿입니다. <a href="../../templates/edu/">예시 보기</a>에서 표지·본문·비교표·과정·요약을 확인합니다. PPTX나 Figma 편집 파일은 이 키트에 포함되어 있지 않습니다.') + list([
  '<code>templates/edu/content.json</code>의 표지·본문 문단·표 행·단계·요약·출처를 편집합니다.',
  '페이지는 제목과 본문의 실제 서체가 준비된 뒤 높이를 측정해 나눕니다. 제목은 SUITE 700, 본문은 Pretendard입니다.',
  '본문은 문단과 문장, 표는 행, 과정은 단계 단위로 나눕니다. 표 머리말과 단계 번호를 유지합니다.',
  '한 항목도 들어가지 않으면 원문을 유지하고 편집 필요 안내를 표시합니다. 원고의 구조를 나눠 해결합니다.',
  '이전·다음, 페이지 선택, 화살표·Home·End, 원본 크기·전체 보기를 사용할 수 있습니다.'
  ]), 'edu') + section('내려받은 키트 열기', paragraph('ZIP을 풀면 전체 폴더 구조를 함께 사용합니다. 웹폰트 WOFF2와 라이선스가 포함되어 있습니다. Edu는 JSON을 불러오므로 로컬 HTTP 서버에서 확인합니다.') + code('python3 -m http.server 8080') + paragraph('키트 폴더에서 위 명령을 실행한 뒤 브라우저에서 http://localhost:8080/ 을 엽니다. 파일 위치에 맞게 HTML·CSS의 상대 경로를 유지합니다.'));
await put('guides/templates/index.html', documentPage('템플릿 편집 안내', '홈페이지와 Edu의 실제 원고를 바꾸는 위치와 확인 방법입니다.', templates, 'templates'));

await put('docs.css', `/* Public guide layout. Shared visual values come from biadone.css. */
.docs-intro { padding-block:var(--ui-space-xl) var(--ui-space-section); }
.docs-intro h1 { margin-block:var(--ui-space-md); }
.docs-section { padding-block:var(--ui-space-xl); border-top:var(--screen-line) solid var(--ui-line-color); }
.docs-section > * + * { margin-top:var(--ui-space-md); }
.docs-section .biadone-table { min-width:var(--ui-table-min); }
.docs-list { padding-left:1.3em; }
.docs-list li + li { margin-top:var(--ui-space-xs); }
.docs-main code { font-size:.9em; overflow-wrap:anywhere; }
.docs-main pre { max-width:100%; overflow-x:auto; padding:var(--ui-space-md); background:var(--color-background-tint); border-radius:var(--screen-radius); font-size:var(--ui-body-mobile-size); line-height:1.7; }
.kit-download-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--ui-space-sm) var(--ui-space-lg); list-style:none; padding:0; margin-top:var(--ui-space-lg); }
.kit-download-list a { text-underline-offset:.25em; }
@media (max-width:45em) { .kit-download-list { grid-template-columns:minmax(0,1fr); } .docs-intro { padding-top:var(--ui-space-lg); } }
`);

let home = stripComments(await readFile(path.join(source, 'index.html'), 'utf8'));
home = home.replace('<link rel="stylesheet" href="guide.css">', '<link rel="stylesheet" href="guide.css">\n  <link rel="stylesheet" href="docs.css">');
home = home.replace('<a href="#foundations">기초 자산</a>', '<a href="#foundations">기초 자산</a><a href="#downloads">다운로드</a>');
home = home.replace('기본 제작 키트 · v0.1</p>', `기본 제작 키트 · ${version} · ${releaseDate}</p>`);
home = home.replace('회사 홈페이지 보기', '홈페이지 예시 보기');
home = home.replaceAll('templates/company/README.md', 'guides/templates/#company').replaceAll('templates/edu/README.md', 'guides/templates/#edu');
home = home.replaceAll('FOUNDATIONS.md', 'guides/foundations/').replaceAll('SCREEN_STYLE.md', 'guides/screen-style/').replaceAll('COMPONENTS.md', 'guides/components/');
home = home.replace(/\s*· <a href="\.\.\/BRAND_BRIEF\.md">브랜드 브리프<\/a>/g, '');
home = home.replace(/\s*<p class="biadone-source kit-note">[^\n]*\.\.\/concepts\/[^\n]*<\/p>/g, '');
home = home.replace(/(<a href="assets\/logo\/[^\"]+\.svg")>/g, '$1 download>');
home = home.replace('</main>', `<section class="biadone-section kit-section" id="downloads" aria-labelledby="downloads-title"><h2 class="biadone-section-title" id="downloads-title">제작에 필요한 원본</h2><p class="biadone-body kit-section-copy">공통 스타일·웹폰트와 라이선스·심벌·홈페이지와 Edu HTML/CSS 원본을 함께 받습니다.</p><div class="kit-actions"><a class="biadone-button" href="downloads/${archiveName}" download>HTML/CSS 키트 내려받기</a><a class="biadone-link" href="guides/templates/">편집 방법 읽기</a></div><ul class="kit-download-list biadone-body"><li><a href="assets/logo/biadone-symbol.svg" download>블루 심벌 SVG</a></li><li><a href="assets/logo/biadone-symbol-white.svg" download>흰색 심벌 SVG</a></li><li><a href="assets/logo/biadone-symbol-ink.svg" download>단색 심벌 SVG</a></li><li><a href="tokens.json" download>기초 토큰 JSON</a> / <a href="tokens.css" download>CSS</a></li><li><a href="assets/fonts/SUITE-Variable.woff2" download>SUITE 웹폰트 WOFF2</a> / <a href="assets/fonts/SUITE-LICENSE.txt">라이선스</a></li><li><a href="assets/fonts/PretendardVariable.woff2" download>Pretendard 웹폰트 WOFF2</a> / <a href="assets/fonts/Pretendard-LICENSE.txt">라이선스</a></li></ul><p class="biadone-source kit-note">버전 ${version} · ${releaseDate}. 폰트는 웹용 WOFF2입니다. PPTX·Figma 편집 파일과 데스크톱 설치용 폰트는 이 묶음에 포함되지 않습니다.</p></section>\n  </main>`);
await put('index.html', htmlMeta(home, '/'));

await put('404.html', `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Biadone · 페이지를 찾을 수 없습니다</title><link rel="stylesheet" href="/biadone.css"><link rel="stylesheet" href="/guide.css"></head><body class="biadone-theme"><header class="biadone-site-header biadone-page"><a href="/" aria-label="Biadone 제작 키트로 이동">${logo('/')}</a></header><main class="biadone-page kit-intro"><h1 class="biadone-title">페이지를 찾을 수 없습니다.</h1><p class="biadone-lead kit-intro-copy">주소가 바뀌었거나 제공하지 않는 페이지입니다.</p><div class="kit-actions"><a class="biadone-button" href="/">제작 키트로 돌아가기</a></div></main></body></html>\n`);
await put('robots.txt', 'User-agent: *\nDisallow: /\n');
await put('_headers', await readFile(path.join(here, '_headers')));

const kitReadme = `# Biadone HTML/CSS 제작 키트 ${version}\n\n기준일: ${releaseDate}\n공통 기준: ${origin}/\n\n제목은 SUITE 700, 본문·표·조작 요소는 Pretendard, 로고 이름은 Pretendard 600입니다.\n\n## 포함된 원본\n\n- 공통 HTML/CSS와 색상·서체·구조 토큰 JSON/CSS.\n- 블루·흰색·단색 심벌 SVG와 HTML/CSS 로고 조합.\n- SUITE·Pretendard 웹용 WOFF2 및 각 원본 라이선스.\n- 회사 소개·Edu HTML/CSS 템플릿과 예시 content.json.\n- 공통 기초·화면 스타일·반복 요소·템플릿 편집 HTML 가이드.\n\n## 사용\n\n폴더 구조를 유지해서 편집합니다. Edu는 JSON을 불러오므로 키트 폴더에서 로컬 서버를 실행합니다.\n\n    python3 -m http.server 8080\n\n브라우저에서 http://localhost:8080/ 을 열어 기준을 확인합니다. 회사 소개는 templates/company/index.html, Edu 원고는 templates/edu/content.json에서 편집합니다. 내용이 길어져도 글자를 임의로 줄이지 않고 영역 또는 장 수를 늘립니다.\n\n웹폰트는 WOFF2입니다. PPTX·Figma 편집 파일과 데스크톱 설치용 폰트는 포함하지 않습니다. 로고·색상·서체의 역할을 유지하고, 폰트와 함께 각 라이선스를 보존합니다. 예시 문구를 실제 원고로 바꿀 때 상태·출처도 함께 확인합니다.\n`;
const kitFiles = [...generated].filter(relative => !['_headers', 'robots.txt', '404.html'].includes(relative)).sort();
const kitIndex = home.replace(`href="downloads/${archiveName}" download>HTML/CSS 키트 내려받기`, 'href="README.md">키트 사용 안내 읽기');
const zipProgram = `import json, pathlib, sys, zipfile\ndata=json.load(sys.stdin)\nbase=pathlib.Path(data['root'])\nwith zipfile.ZipFile(data['archive'],'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n for name in data['files']:\n  info=zipfile.ZipInfo(name,(2026,10,27,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16\n  content=data['index'].encode('utf-8') if name=='index.html' else (base/name).read_bytes()\n  z.writestr(info,content)\n info=zipfile.ZipInfo('README.md',(2026,10,27,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16\n z.writestr(info,data['readme'].encode('utf-8'))\nwith zipfile.ZipFile(data['archive']) as z:\n assert z.testzip() is None\n assert all(not n.startswith('/') and '..' not in pathlib.PurePosixPath(n).parts for n in z.namelist())\nprint(len(data['files'])+1)\n`;
await mkdir(path.join(output, 'downloads'), { recursive: true });
const zipped = spawnSync('python3', ['-c', zipProgram], { input: JSON.stringify({ root: output, archive: path.join(output, `downloads/${archiveName}`), files: kitFiles, index: kitIndex, readme: kitReadme }), encoding: 'utf8' });
if (zipped.status !== 0) throw new Error(zipped.stderr || 'Could not create source kit ZIP.');
generated.add(`downloads/${archiveName}`);

const hashes = {};
for (const relative of [...generated].sort()) hashes[relative] = createHash('sha256').update(await readFile(path.join(output, relative))).digest('hex');
await put('manifest.json', JSON.stringify({ version, date: releaseDate, url: origin, files: hashes }, null, 2) + '\n');
const publicFiles = await filesAt(output);
for (const relative of publicFiles) {
  if (!permitted.has(relative)) throw new Error(`Unexpected publish file: ${relative}`);
  if (/\.(html|css|js|json|txt|md)$/.test(relative) && !relative.includes('LICENSE')) {
    const text = await readFile(path.join(output, relative), 'utf8');
    if (/\/Users\/|BRAND_BRIEF|AGENTS\.md|concepts\//.test(text)) throw new Error(`Private or workspace reference in ${relative}`);
  }
}
console.log(JSON.stringify({ version, publicFiles: publicFiles.length, sourceKitFiles: Number(zipped.stdout.trim()), archive: `downloads/${archiveName}`, output: 'site/public/' }, null, 2));
