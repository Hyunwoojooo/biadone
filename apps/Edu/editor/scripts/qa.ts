import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, writeFile, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {chromium, type Page} from 'playwright';
import {createStudioApp} from '../server/app';
import {runProcess, ffmpegBinary} from '../server/media';
import type {Job, Project} from '../src/shared/types';

// A real browser/API integration check in an isolated temporary project store.
// It never alters projects in the normal data directory or uploads source media.
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), 'biadone-studio-qa-'));
const results: {name: string; passed: boolean; detail?: string}[] = [];
const errors: string[] = [];
const {app, jobs} = await createStudioApp({appDirectory: root, dataDirectory: path.join(directory, 'data')});
const dist = process.env.STUDIO_QA_DIST || path.join(root, 'dist');
app.use(express.static(dist));
app.get('/{*splat}', (_request, response) => response.sendFile(path.join(dist, 'index.html')));
const server = createServer(app);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;
jobs.setOrigin(origin);
const browser = await chromium.launch({executablePath: process.env.STUDIO_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true});
const page = await browser.newPage({viewport: {width: 1536, height: 1024}, deviceScaleFactor: 1});
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {if (message.type() === 'error' && !message.text().includes('status of 409')) errors.push(message.text());});

async function json<T>(route: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${origin}/api${route}`, {headers: {'content-type': 'application/json'}, ...options});
  if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}
async function until(test: () => Promise<boolean>, message: string, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {if (await test()) return; await new Promise(resolve => setTimeout(resolve, 150));}
  throw new Error(`Timed out: ${message}`);
}
async function check(name: string, work: () => Promise<void>) {
  const started = Date.now();
  try {await work(); results.push({name, passed: true, detail: `${Date.now() - started} ms`}); console.log(`PASS ${name}`);}
  catch (error) {results.push({name, passed: false, detail: error instanceof Error ? error.message : String(error)}); throw error;}
}
async function saved() {await until(async () => await page.locator('.save-status').innerText() === '저장됨', 'autosave');}
async function field(value: string) {const input = page.getByRole('textbox', {name: '강조 문구', exact: true}); await input.fill(value); await input.press('Tab'); await saved();}
async function current(): Promise<Project> {const id = await page.evaluate(() => localStorage.getItem('biadone-project')); assert(id); return json<Project>(`/projects/${id}`);}
async function step(index: number) {await page.locator('.workflow-nav button').nth(index >= 2 ? index + 1 : index).click();}
async function noOverflow(target: Page) {const sizes = await target.evaluate(() => ({width: document.documentElement.scrollWidth, viewport: innerWidth, height: document.documentElement.scrollHeight, viewportHeight: innerHeight})); assert(sizes.width <= sizes.viewport + 1, JSON.stringify(sizes)); assert(sizes.height <= sizes.viewportHeight + 1, JSON.stringify(sizes));}

try {
  await check('page identity, content, console and desktop layout', async () => {
    await page.goto(origin, {waitUntil: 'networkidle'});
    await page.getByRole('heading', {name: '미리보기', exact: true}).waitFor();
    assert.equal(await page.title(), 'Biadone Studio — 롱폼 영상 에디터');
    assert((await page.locator('body').innerText()).includes('장면 설정'));
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    await page.waitForTimeout(300);
    await noOverflow(page);
    await page.screenshot({path: path.join(directory, 'desktop.png')});
  });
  await check('Codex connection uses the actual app path and dialog keyboard focus', async () => {
    await page.getByRole('button', {name: 'Codex 연결', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'Codex로 편집하기', exact: true});
    await dialog.waitFor();
    const command = await dialog.locator('code').innerText();
    assert(command.includes(`${root.replace(/\/$/, '')}/server/mcp.ts`));
    assert(command.includes(`STUDIO_URL=${origin}`));
    assert(!command.includes(path.join(directory, 'server')));
    await page.keyboard.press('Escape'); await dialog.waitFor({state: 'hidden'});
    assert(await page.getByRole('button', {name: 'Codex 연결', exact: true}).evaluate(button => button === document.activeElement));
  });
  let originalHeading = '';
  await check('edit, autosave, reload, undo and redo', async () => {
    originalHeading = await page.getByRole('textbox', {name: '강조 문구', exact: true}).inputValue();
    await field('내 일에 맞는 세 가지 기준');
    assert((await current()).scenes.some(scene => scene.heading === '내 일에 맞는 세 가지 기준'));
    await page.reload({waitUntil: 'networkidle'});
    await until(async () => await page.getByRole('textbox', {name: '강조 문구', exact: true}).inputValue() === '내 일에 맞는 세 가지 기준', 'saved edit after reload');
    await page.getByRole('button', {name: '실행 취소', exact: true}).click();
    await until(async () => await page.getByRole('textbox', {name: '강조 문구', exact: true}).inputValue() === originalHeading, 'undo');
    await page.getByRole('button', {name: '다시 실행', exact: true}).click();
    await until(async () => await page.getByRole('textbox', {name: '강조 문구', exact: true}).inputValue() === '내 일에 맞는 세 가지 기준', 'redo');
    await page.getByRole('button', {name: '수정 이력', exact: true}).click();
    const history = page.getByRole('dialog', {name: '수정 이력', exact: true});
    await history.waitFor();
    await history.locator('.history-row').last().getByRole('button', {name: '복원', exact: true}).click();
    await history.waitFor({state: 'hidden'});
    await until(async () => await page.getByRole('textbox', {name: '강조 문구', exact: true}).inputValue() === originalHeading, 'history restoration');
  });
  await check('lock, scene split and merge', async () => {
    const lock = page.getByRole('checkbox', {name: '장면 잠금', exact: true});
    await lock.check(); await saved();
    assert(await page.getByRole('textbox', {name: '강조 문구', exact: true}).isDisabled());
    await lock.uncheck(); await saved();
    const before = (await current()).scenes.length;
    await page.getByRole('button', {name: '장면 나누기', exact: true}).click();
    await until(async () => (await current()).scenes.length === before + 1, 'scene split');
    await page.getByRole('button', {name: '다음과 합치기', exact: true}).click();
    await until(async () => (await current()).scenes.length === before, 'scene merge');
  });
  await check('long caption/heading blocks export and can be corrected', async () => {
    await field('가'.repeat(160)); await step(3);
    await page.getByRole('heading', {name: '마지막까지 일정한 퀄리티로'}).waitFor();
    await until(async () => await page.getByRole('button', {name: '영상 내보내기', exact: true}).isDisabled(), 'quality export block');
    assert((await page.locator('.quality-issues').innerText()).includes('수정 필요'));
    await step(2); await field(originalHeading);
    await step(3);
    await until(async () => await page.getByRole('button', {name: '영상 내보내기', exact: true}).isEnabled(), 'corrected quality');
    await step(2);
  });
  await check('preview plays, seeks and selects corresponding scene', async () => {
    const before = await page.locator('.timecode').innerText();
    await page.getByRole('button', {name: '재생', exact: true}).click();
    await page.waitForTimeout(600);
    await page.getByRole('button', {name: '일시 정지', exact: true}).click();
    await page.waitForTimeout(200);
    assert.notEqual(await page.locator('.timecode').innerText(), before);
    const range = page.getByRole('slider', {name: '재생 위치', exact: true});
    const bounds = await range.boundingBox(); assert(bounds);
    await range.click({position: {x: bounds.width * .4, y: 2}});
    await page.waitForTimeout(200);
    const selectedTitle = await page.getByRole('textbox', {name: '장면 제목', exact: true}).inputValue();
    const p = await current(); const numeric = Number(await range.inputValue());
    assert.equal(selectedTitle, p.scenes.find(scene => numeric >= scene.startFrame && numeric < scene.startFrame + scene.durationInFrames)?.title);
  });
  await check('delayed external poll cannot overwrite a newer user edit', async () => {
    const p = await current();
    let release!: () => void; let captured = false; let waiting = false;
    const paused = new Promise<void>(resolve => {release = resolve;});
    const routePath = `**/api/projects/${p.id}`;
    await page.route(routePath, async route => {
      if (route.request().method() !== 'GET' || captured) {await route.continue(); return;}
      captured = true;
      const response = await route.fetch(); waiting = true; await paused;
      await route.fulfill({response});
    });
    await until(async () => waiting, 'intercepted idle project poll', 7000);
    await field('늦은 조회에도 남는 편집');
    release(); await page.waitForTimeout(300);
    assert.equal(await page.getByRole('textbox', {name: '강조 문구', exact: true}).inputValue(), '늦은 조회에도 남는 편집');
    assert((await current()).scenes.some(scene => scene.heading === '늦은 조회에도 남는 편집'));
    await page.unroute(routePath);
  });
  await check('failed conflict rebase preserves the draft until explicit discard', async () => {
    const p = await current();
    const selected = p.scenes.find(scene => scene.heading === '늦은 조회에도 남는 편집');
    assert(selected); const index = p.scenes.indexOf(selected); assert(index > 0);
    let intercepted = false;
    const routePath = `**/api/projects/${p.id}/commands`;
    await page.route(routePath, async route => {
      if (route.request().method() !== 'POST' || intercepted) {await route.continue(); return;}
      intercepted = true;
      await json(`/projects/${p.id}/commands`, {method: 'POST', body: JSON.stringify({expectedRevision: p.revision, command: {type: 'mergeScene', sceneId: p.scenes[index - 1].id}})});
      await route.fulfill({status: 409, contentType: 'application/json', body: JSON.stringify({error: '다른 편집에서 이 장면이 변경되었습니다.'})});
    });
    const input = page.getByRole('textbox', {name: '강조 문구', exact: true});
    await input.fill('사라지면 안 되는 현재 초안'); await input.press('Tab');
    await page.locator('.save-error').waitFor();
    await page.getByRole('button', {name: '내 변경 다시 적용', exact: true}).click();
    await until(async () => (await page.locator('.save-error').innerText()).includes('찾을 수'), 'failed rebase completion message');
    assert.equal(await input.inputValue(), '사라지면 안 되는 현재 초안');
    assert.notEqual(await page.locator('.save-status').innerText(), '저장됨');
    await page.unroute(routePath);
    page.once('dialog', dialog => void dialog.accept());
    await page.getByRole('button', {name: '저장된 상태 불러오기', exact: true}).click();
    await saved(); assert.equal(await page.locator('.save-error').count(), 0);
  });
  await check('responsive laptop and mobile retain editor controls', async () => {
    await page.setViewportSize({width: 1280, height: 800}); await noOverflow(page);
    await page.screenshot({path: path.join(directory, 'laptop.png')});
    await page.setViewportSize({width: 390, height: 844}); await noOverflow(page);
    await page.getByRole('button', {name: '설정', exact: true}).click();
    assert(await page.getByRole('textbox', {name: '장면 제목', exact: true}).isVisible());
    await page.getByRole('button', {name: '설정', exact: true}).click();
    await page.getByRole('button', {name: '장면', exact: true}).click();
    assert(await page.getByRole('heading', {name: /^장면\s/}).isVisible());
    await page.getByRole('button', {name: '장면', exact: true}).click();
    await page.screenshot({path: path.join(directory, 'mobile.png')});
    await page.setViewportSize({width: 1536, height: 1024});
  });

  let sourceProject: Project;
  await check('new project and file input import retain files across async save', async () => {
    await page.getByRole('button', {name: 'Biadone Studio 프로젝트', exact: true}).click();
    await page.getByRole('textbox', {name: '새 프로젝트 제목', exact: true}).fill('실제 나레이션 통합 검증');
    await page.getByRole('button', {name: '만들기', exact: true}).click();
    await page.getByRole('heading', {name: '이야기를 가져오세요'}).waitFor();
    const recording = path.join(root, '..', 'Sources', 'audio', 'ElevenLabs_Untitled_project.mp3');
    const clip = path.join(directory, 'narration-12s.wav');
    await runProcess(ffmpegBinary(), ['-v','error','-nostdin','-y','-i',recording,'-t','12','-ar','16000','-ac','1',clip], {timeout: 30_000});
    await page.locator('.dropzone input[type=file]').setInputFiles(clip);
    await until(async () => (await current()).assets.some(asset => asset.name === 'narration-12s.wav'), 'streamed source upload', 20_000);
    await until(async () => Boolean((await current()).audioAssetId), 'narration binding');
    sourceProject = await current(); assert(Math.abs(sourceProject.durationInFrames / 30 - 12) < .1);
    assert(sourceProject.assets.find(asset => asset.id === sourceProject.audioAssetId)?.waveform?.length);
  });
  await check('local Korean transcription preserves the manual scene arrangement', async () => {
    await page.getByRole('button', {name: '녹음에서 자막 만들기', exact: true}).click();
    let latest: Job|undefined;
    await until(async () => {latest = (await json<Job[]>(`/jobs?projectId=${sourceProject.id}`)).find(job => job.type === 'transcribe'); return !!latest && ['completed','failed','cancelled'].includes(latest.status);}, 'local transcription job', 120_000);
    assert.equal(latest?.status, 'completed', latest?.error);
    assert.equal(latest?.verification?.applied, true);
    assert((await current()).words.length > 0);
    await until(async () => await page.locator('.source-section').last().innerText().then(text => /[1-9]\d*문장/.test(text)), 'transcript visible');
    await step(1); await page.getByRole('heading', {name: '장면마다 원하는 화면을 적으세요'}).waitFor();
    assert((await current()).captions.length > 0);
    await step(2);
  });
  await check('timed subtitle file import and manual caption correction', async () => {
    const p = await current();
    const subtitles = await fetch(`${origin}/api/projects/${p.id}/captions.srt`);
    assert.equal(subtitles.status, 200);
    const file = path.join(directory, 'roundtrip.srt'); await writeFile(file, await subtitles.text());
    await step(0);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', {name: 'SRT · VTT · JSON 가져오기', exact: true}).click()]);
    await chooser.setFiles(file);
    await until(async () => {const value = await current(); return value.revision > p.revision && value.words.length === 0;}, 'subtitle file import');
    await step(2);
    const caption = page.getByRole('textbox', {name: '1번 자막 문구', exact: true});
    const original = await caption.inputValue();
    await caption.fill('직접 수정한 자막을 확인합니다.'); await caption.press('Tab'); await saved();
    assert((await current()).captions.some(value => value.text === '직접 수정한 자막을 확인합니다.'));
    await caption.fill(original); await caption.press('Tab'); await saved();
  });
  await check('image asset selection and actual preview', async () => {
    await step(0);
    const picture = path.join(root, '..', '.pptx-repair', 'brandbook-final-render', 'slide-1.png');
    await page.locator('.dropzone input[type=file]').setInputFiles(picture);
    await until(async () => (await current()).assets.some(asset => asset.kind === 'image'), 'image upload');
    const image = (await current()).assets.find(asset => asset.kind === 'image')!;
    await step(2);
    await page.getByRole('button', {name: '실제 이미지', exact: true}).click(); await saved();
    await page.getByRole('combobox', {name: '화면 자료 선택', exact: true}).selectOption(image.id); await saved();
    await until(async () => await page.locator('.video-frame img').count() > 0, 'actual image preview');
    const loaded = await page.locator('.video-frame img').first().evaluate(imageElement => (imageElement as HTMLImageElement).complete && (imageElement as HTMLImageElement).naturalWidth > 0);
    assert(loaded);
  });
  if (!process.argv.includes('--skip-render')) {
    await check('export UI, live progress, verified MP4 download', async () => {
      await page.getByRole('button', {name: '내보내기', exact: true}).click();
      await page.getByRole('combobox', {name: '해상도', exact: true}).selectOption('720p');
      const acknowledgement = page.locator('.acknowledge input');
      if (await acknowledgement.count()) await acknowledgement.check();
      await until(async () => await page.getByRole('button', {name: '출력 시작', exact: true}).isEnabled(), 'export button');
      await page.getByRole('button', {name: '출력 시작', exact: true}).click();
      let job: Job|undefined;
      await until(async () => {job = (await json<Job[]>(`/jobs?projectId=${sourceProject.id}`)).find(item => item.type === 'render'); return !!job && ['completed','failed'].includes(job.status);}, 'verified MP4', 300_000);
      assert.equal(job?.status, 'completed', job?.error); assert(job?.outputUrl);
      const output = await fetch(`${origin}${job.outputUrl}`); assert.equal(output.status, 200);
      const file = path.join(directory, 'browser-export.mp4'); await writeFile(file, Buffer.from(await output.arrayBuffer()));
      assert((await stat(file)).size > 10_000);
      await page.screenshot({path: path.join(directory, 'export-complete.png')});
    });
    await check('cancel a live renderer and retry without changing the edit', async () => {
      const snapshot = await current();
      const started = await json<Job>(`/projects/${snapshot.id}/render`, {method: 'POST', body: JSON.stringify({resolution: '720p', allowWarnings: true})});
      await until(async () => {const job = await json<Job>(`/jobs/${started.id}`); return job.status === 'running' && job.progress > .1;}, 'actual running render', 60_000);
      const cancelled = await json<Job>(`/jobs/${started.id}/cancel`, {method: 'POST', body: '{}'});
      await until(async () => (await json<Job>(`/jobs/${cancelled.id}`)).status === 'cancelled', 'renderer cancellation', 20_000);
      assert.equal((await current()).revision, snapshot.revision);
      const output = await fetch(`${origin}/api/outputs/${cancelled.id}/video.mp4`); assert.equal(output.status, 409);
      const retry = await json<Job>(`/jobs/${cancelled.id}/retry`, {method: 'POST', body: '{}'});
      let done: Job|undefined;
      await until(async () => {done = await json<Job>(`/jobs/${retry.id}`); return ['completed','failed','cancelled'].includes(done.status);}, 'retry complete', 300_000);
      assert.equal(done?.status, 'completed', done?.error);
      assert.equal((await current()).revision, snapshot.revision);
    });
  }
  await check('30-minute timeline loads and seeks to the end', async () => {
    const p = await json<Project>('/projects', {method: 'POST', body: JSON.stringify({title: '30분 타임라인 검증', durationSeconds: 1800})});
    const captions = Array.from({length: 450}, (_, index) => ({id: `caption_long_${index}`, text: `작업 과정을 차근차근 정리합니다. ${index + 1}번째 설명입니다.`, startFrame: index * 120, endFrame: index * 120 + 110}));
    const long = await json<Project>(`/projects/${p.id}/commands`, {method: 'POST', body: JSON.stringify({expectedRevision: p.revision, command: {type: 'replaceCaptions', captions, regroup: true}})});
    assert(long.scenes.length > 60);
    const longPage = await browser.newPage({viewport: {width: 1536, height: 1024}});
    try {
      await longPage.addInitScript(id => localStorage.setItem('biadone-project', id), long.id);
      await longPage.goto(origin, {waitUntil: 'networkidle'});
      await longPage.getByRole('heading', {name: '미리보기', exact: true}).waitFor();
      const range = longPage.getByRole('slider', {name: '재생 위치', exact: true});
      const bounds = await range.boundingBox(); assert(bounds);
      await range.click({position: {x: bounds.width * .97, y: 2}});
      await until(async () => Number(await range.inputValue()) > 1700 * 30, '30-minute seek');
      await noOverflow(longPage);
      await longPage.screenshot({path: path.join(directory, 'long-timeline.png')});
    } finally {await longPage.close();}
  });
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  await writeFile(path.join(directory, 'report.json'), JSON.stringify({origin, directory, browser: 'Playwright Chromium (Browser plugin not available)', results, errors, status: 'passed'}, null, 2));
  console.log(JSON.stringify({status: 'passed', checks: results.length, directory}, null, 2));
} catch (error) {
  await page.screenshot({path: path.join(directory, 'failure.png')}).catch(() => undefined);
  await writeFile(path.join(directory, 'report.json'), JSON.stringify({origin, directory, results, errors, status: 'failed', error: error instanceof Error ? error.stack : String(error)}, null, 2));
  console.error(JSON.stringify({status: 'failed', directory, error: error instanceof Error ? error.message : String(error)}, null, 2));
  process.exitCode = 1;
} finally {
  for (const job of jobs.list()) if (job.status === 'running' || job.status === 'queued') await jobs.cancel(job.id);
  await browser.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
