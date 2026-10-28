import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {createStudioApp} from './app';

const appDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.STUDIO_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('STUDIO_PORT는 1024~65535 사이여야 합니다.');
const {app, jobs} = await createStudioApp({appDirectory, dataDirectory: process.env.STUDIO_DATA_DIRECTORY});
const server = createServer(app);
jobs.setOrigin(`http://127.0.0.1:${port}`);
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(appDirectory, 'dist')));
  app.get('/{*splat}', (_request, response) => response.sendFile(path.join(appDirectory, 'dist', 'index.html')));
} else {
  const {createServer: createViteServer} = await import('vite');
  const vite = await createViteServer({root: appDirectory, server: {middlewareMode: true, hmr: {server}}, appType: 'spa'});
  app.use(vite.middlewares);
}
server.listen(port, '127.0.0.1', () => console.log(`Biadone Studio: http://127.0.0.1:${port}`));
server.on('error', (error) => {console.error(`에디터를 시작하지 못했습니다: ${error.message}`); process.exitCode = 1;});

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    void Promise.all([closed, jobs.shutdown()]).then(() => process.exit(0)).catch((error: unknown) => {
      console.error(`작업 기록 저장 후 종료하지 못했습니다: ${error instanceof Error ? error.message : '저장 오류'}`);
      process.exit(1);
    });
    setTimeout(() => process.exit(1), 15_000).unref();
  });
}
