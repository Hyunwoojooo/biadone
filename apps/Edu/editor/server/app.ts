import express, {type ErrorRequestHandler, type NextFunction, type Request, type Response} from 'express';
import multer from 'multer';
import {randomUUID} from 'node:crypto';
import {access, lstat, mkdir, readFile, realpath, rename, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import {z, ZodError} from 'zod';
import {commandSchema, renderOptionsSchema} from '../src/shared/schemas';
import {parseCaptions, toSrt, toVtt} from '../src/domain/captions';
import type {Asset} from '../src/shared/types';
import {HttpError, errorMessage} from './errors';
import {audioWaveform, probeMedia, systemStatus} from './media';
import {JobManager} from './jobs';
import {projectQuality} from './quality';
import {ProjectStore, safeChild} from './storage';
import {GENERATION_LIMITS, type CodexAdapter} from './codex';

const expectedRevisionSchema = z.number().int().nonnegative();
const captionImportSchema = z.object({text: z.string().max(8_000_000), format: z.enum(['srt', 'vtt', 'json']), regroup: z.boolean().optional(), expectedRevision: expectedRevisionSchema}).strict();
const projectOptionsSchema = z.object({title: z.string().trim().min(1).max(180).optional(), durationSeconds: z.number().positive().max(4 * 3600).optional(), demo: z.boolean().optional()}).strict();

function parameter(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== 'string') throw new HttpError(400, '요청 경로가 올바르지 않습니다.');
  return value;
}

function localRequestOnly(request: Request, response: Response, next: NextFunction): void {
  const allowed = new Set(['127.0.0.1', 'localhost', '[::1]']);
  try {
    const host = new URL(`http://${request.headers.host ?? ''}`);
    if (!allowed.has(host.hostname)) throw new Error('host');
    const assetPath = /^\/api\/(?:projects|jobs)\/[A-Za-z0-9_-]+\/assets\/[A-Za-z0-9_-]+$/.test(request.path);
    const preflightMethod = request.get('Access-Control-Request-Method')?.toUpperCase();
    const assetRead = assetPath && (request.method === 'GET' || request.method === 'HEAD'
      || request.method === 'OPTIONS' && (preflightMethod === 'GET' || preflightMethod === 'HEAD'));
    if (request.headers.origin) {
      const origin = new URL(request.headers.origin);
      if (!allowed.has(origin.hostname) || !['http:', 'https:'].includes(origin.protocol)) throw new Error('origin');
      // Remotion serves its bundle on an ephemeral loopback port. Only immutable
      // media reads may cross that origin; project data and writes stay private.
      if (origin.origin !== host.origin && !assetRead) throw new Error('origin');
      if (assetRead) {
        response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
        response.vary('Origin');
        response.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Range, Content-Length');
        if (request.method === 'OPTIONS') {
          const headers = (request.get('Access-Control-Request-Headers') ?? '').split(',').map((header) => header.trim().toLowerCase()).filter(Boolean);
          if (headers.some((header) => header !== 'range')) throw new Error('headers');
          response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD');
          response.setHeader('Access-Control-Allow-Headers', 'Range');
          response.setHeader('Access-Control-Max-Age', '600');
          response.status(204).end();
          return;
        }
      }
    }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    next();
  } catch {next(new HttpError(403, '이 컴퓨터의 에디터에서만 요청할 수 있습니다.'));}
}

export async function createStudioApp(options: {appDirectory: string; dataDirectory?: string; codexAdapter?: CodexAdapter}) {
  const appDirectory = path.resolve(options.appDirectory);
  const dataDirectory = path.resolve(options.dataDirectory ?? path.join(appDirectory, 'data'));
  const store = new ProjectStore(dataDirectory);
  const jobs = new JobManager(store, appDirectory, {codexAdapter: options.codexAdapter});
  await store.init();
  await jobs.init();
  const temporaryDirectory = path.join(dataDirectory, 'uploads');
  await mkdir(temporaryDirectory, {recursive: true});
  const upload = multer({dest: temporaryDirectory, limits: {fileSize: 2 * 1024 * 1024 * 1024, files: 1, fields: 5}});
  const importUpload = multer({dest: temporaryDirectory, limits: {fileSize: 8 * 1024 * 1024, files: 1, fields: 2}});
  const app = express();
  app.disable('x-powered-by');
  app.use(localRequestOnly);
  app.use(express.json({limit: '8mb'}));

  app.get('/api/system', async (_request, response) => response.json(await systemStatus(appDirectory, dataDirectory, await jobs.codexStatus())));
  app.get('/api/projects', async (_request, response) => response.json(await store.list()));
  app.post('/api/projects', async (request, response) => response.status(201).json(await store.create(projectOptionsSchema.parse(request.body ?? {}))));

  app.post('/api/projects/import', importUpload.single('file'), async (request, response) => {
    if (!request.file) throw new HttpError(400, '프로젝트 JSON 파일을 선택해 주세요.');
    try {
      const project = await store.import(JSON.parse(await readFile(request.file.path, 'utf8')));
      response.status(201).json(project);
    } finally {await rm(request.file.path, {force: true});}
  });

  app.get('/api/projects/:id', async (request, response) => response.json(await store.get(parameter(request, 'id'))));
  app.post('/api/projects/:id/commands', async (request, response) => {
    const body = z.object({command: commandSchema, expectedRevision: expectedRevisionSchema}).strict().parse(request.body);
    response.json(await store.command(parameter(request, 'id'), body.command, body.expectedRevision));
  });
  app.get('/api/projects/:id/history', async (request, response) => response.json(await store.history(parameter(request, 'id'))));
  app.post('/api/projects/:id/undo', async (request, response) => {
    const body = z.object({expectedRevision: expectedRevisionSchema}).strict().parse(request.body);
    response.json(await store.navigate(parameter(request, 'id'), body.expectedRevision, 'undo'));
  });
  app.post('/api/projects/:id/redo', async (request, response) => {
    const body = z.object({expectedRevision: expectedRevisionSchema}).strict().parse(request.body);
    response.json(await store.navigate(parameter(request, 'id'), body.expectedRevision, 'redo'));
  });
  app.post('/api/projects/:id/restore', async (request, response) => {
    const body = z.object({historyId: z.string().min(1).max(101), expectedRevision: expectedRevisionSchema}).strict().parse(request.body);
    response.json(await store.navigate(parameter(request, 'id'), body.expectedRevision, body.historyId));
  });

  app.post('/api/projects/:id/assets', upload.single('file'), async (request, response) => {
    const projectId = parameter(request, 'id');
    if (!request.file) throw new HttpError(400, '가져올 자료 파일을 선택해 주세요.');
    let destination: string | undefined;
    let committed = false;
    try {
      await store.get(projectId);
      const originalName = decodeFileName(request.file.originalname);
      const metadata = await probeMedia(request.file.path, originalName);
      const id = randomUUID();
      const extension = path.extname(originalName).toLowerCase();
      const fileName = `${id}${extension}`;
      const name = stripControl(path.basename(originalName)).slice(0, 180) || `자료${extension}`;
      const waveform = metadata.kind === 'audio' ? await audioWaveform(request.file.path) : undefined;
      const asset: Asset = {id, name, fileName, ...metadata, ...(waveform ? {waveform} : {})};
      await mkdir(store.assetsDirectory(projectId), {recursive: true});
      destination = safeChild(store.assetsDirectory(projectId), fileName);
      await rename(request.file.path, destination);
      const current = await store.get(projectId);
      const project = await store.command(projectId, {type: 'addAsset', asset}, current.revision);
      committed = true;
      response.status(201).json({project, asset});
    } finally {
      await rm(request.file.path, {force: true});
      if (destination && !committed) await rm(destination, {force: true});
    }
  });

  app.get('/api/projects/:id/assets/:assetId', async (request, response) => {
    const project = await store.get(parameter(request, 'id'));
    const asset = project.assets.find((item) => item.id === parameter(request, 'assetId'));
    if (!asset) throw new HttpError(404, '자료를 찾을 수 없습니다.');
    await sendAsset(response, project.id, asset);
  });

  app.get('/api/jobs/:jobId/assets/:assetId', async (request, response) => {
    const {projectId, asset} = jobs.snapshotAsset(parameter(request, 'jobId'), parameter(request, 'assetId'));
    await sendAsset(response, projectId, asset);
  });

  async function sendAsset(response: Response, projectId: string, asset: Asset): Promise<void> {
    const file = safeChild(store.assetsDirectory(projectId), asset.fileName);
    try {
      await access(file);
      const actualDirectory = await realpath(store.assetsDirectory(projectId));
      if ((await lstat(file)).isSymbolicLink() || !(await realpath(file)).startsWith(`${actualDirectory}${path.sep}`)) throw new Error('unsafe asset');
    } catch {throw new HttpError(404, '자료 파일이 없습니다. 다시 가져와 주세요.');}
    response.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    response.sendFile(file);
  }

  app.post('/api/projects/:id/captions', async (request, response) => {
    const body = captionImportSchema.parse(request.body);
    const project = await store.get(parameter(request, 'id'));
    const result = parseCaptions(body.text, body.format, project.settings.fps);
    response.json(await store.command(project.id, {type: 'replaceCaptions', ...result, regroup: body.regroup ?? true}, body.expectedRevision));
  });
  app.get('/api/projects/:id/captions.srt', async (request, response) => {
    const project = await store.get(parameter(request, 'id'));
    response.type('text/plain; charset=utf-8').attachment(`${safeDownloadName(project.title)}.srt`).send(toSrt(project));
  });
  app.get('/api/projects/:id/captions.vtt', async (request, response) => {
    const project = await store.get(parameter(request, 'id'));
    response.type('text/vtt; charset=utf-8').attachment(`${safeDownloadName(project.title)}.vtt`).send(toVtt(project));
  });
  app.get('/api/projects/:id/download', async (request, response) => {
    const project = await store.get(parameter(request, 'id'));
    response.type('application/json; charset=utf-8').attachment(`${safeDownloadName(project.title)}.biadone.json`).send(`${JSON.stringify(project, null, 2)}\n`);
  });
  app.get('/api/projects/:id/quality', async (request, response) => {
    const project = await store.get(parameter(request, 'id'));
    response.json(await projectQuality(store, project));
  });

  app.get('/api/jobs', (request, response) => {
    const projectId = typeof request.query.projectId === 'string' ? request.query.projectId : undefined;
    response.json(jobs.list(projectId));
  });
  app.get('/api/jobs/:id', (request, response) => response.json(jobs.get(parameter(request, 'id'))));
  app.get('/api/jobs/:id/plan', async (request, response) => response.json(await jobs.generationPlan(parameter(request, 'id'))));
  app.post('/api/jobs/:id/apply', async (request, response) => {
    const body = z.object({expectedRevision: expectedRevisionSchema}).strict().parse(request.body);
    response.json(await jobs.applyGeneration(parameter(request, 'id'), body.expectedRevision));
  });
  app.post('/api/projects/:id/generate', async (request, response) => {
    const body = z.object({expectedRevision: expectedRevisionSchema, sceneIds: z.array(z.string().min(1).max(100)).min(1).max(GENERATION_LIMITS.maxScenes)}).strict().parse(request.body);
    response.status(202).json(await jobs.createGeneration(parameter(request, 'id'), body.expectedRevision, body.sceneIds));
  });
  app.post('/api/projects/:id/transcribe', async (request, response) => {
    const body = z.object({expectedRevision: expectedRevisionSchema}).strict().parse(request.body);
    response.status(202).json(await jobs.createTranscription(parameter(request, 'id'), body.expectedRevision));
  });
  app.post('/api/projects/:id/render', async (request, response) => response.status(202).json(await jobs.createRender(parameter(request, 'id'), renderOptionsSchema.parse(request.body))));
  app.post('/api/jobs/:id/cancel', async (request, response) => response.json(await jobs.cancel(parameter(request, 'id'))));
  app.post('/api/jobs/:id/retry', async (request, response) => response.status(202).json(await jobs.retry(parameter(request, 'id'))));
  app.get('/api/outputs/:jobId/:fileName', async (request, response) => {
    const job = jobs.get(parameter(request, 'jobId'));
    if (job.status !== 'completed') throw new HttpError(409, '작업이 완료된 뒤 결과 파일을 받을 수 있습니다.');
    const fileName = parameter(request, 'fileName');
    if (!/\.(mp4|json|srt|vtt|png)$/i.test(fileName)) throw new HttpError(404, '출력 파일을 찾을 수 없습니다.');
    const file = safeChild(jobs.outputDirectory(job.id), fileName);
    try {if (!(await stat(file)).isFile()) throw new Error('not file');} catch {throw new HttpError(404, '출력 파일이 아직 준비되지 않았습니다.');}
    response.download(file, fileName);
  });

  app.use('/api', (_request, _response, next) => next(new HttpError(404, '요청한 기능을 찾을 수 없습니다.')));
  const handleError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (response.headersSent) {next(error); return;}
    if (error instanceof HttpError) {response.status(error.status).json({error: error.message}); return;}
    if (error instanceof ZodError) {response.status(400).json({error: `입력값을 확인해 주세요. ${error.issues[0]?.message ?? ''}`}); return;}
    if (error instanceof multer.MulterError) {response.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({error: error.code === 'LIMIT_FILE_SIZE' ? '파일이 허용 크기를 초과했습니다.' : '파일을 가져오지 못했습니다.'}); return;}
    if (error instanceof SyntaxError) {response.status(400).json({error: 'JSON 형식이 올바르지 않습니다.'}); return;}
    const status = typeof error === 'object' && error && 'status' in error && error.status === 413 ? 413 : 422;
    response.status(status).json({error: errorMessage(error).slice(0, 1800)});
  };
  app.use(handleError);
  return {app, store, jobs, dataDirectory};
}

function safeDownloadName(value: string): string {
  return stripControl(value).replace(/[<>:"/\\|?*]/g, '_').slice(0, 100) || 'Biadone-project';
}

function stripControl(value: string): string {return [...value].filter((character) => character.codePointAt(0)! >= 32).join('');}

function decodeFileName(value: string): string {
  if ([...value].some((character) => character.codePointAt(0)! > 255)) return value;
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? value : decoded;
}
