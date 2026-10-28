import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const edu = resolve(root, '../..');
const require = createRequire(join(edu, 'editor/package.json'));
const { chromium } = require('playwright');
const ffmpeg = process.env.BIADON_FFMPEG || '/Users/joo/.local/bin/ffmpeg';
const chrome = process.env.BIADON_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fps = 30, duration = 100, total = fps * duration;
const work = await mkdtemp(join(tmpdir(), 'biadon-curriculum-render-'));
const output = join(root, 'Biadon-Edu-Curriculum-1080p.mp4');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.wav':'audio/wav'};
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    const info = await stat(path);
    if (!info.isFile()) { res.writeHead(404).end(); return; }
    const data=await readFile(path);
    const headers={'Content-Type':mime[extname(path)] || 'application/octet-stream','Accept-Ranges':'bytes'};
    const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if(range){
      const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):data.length-1,data.length-1);
      if(start>end){res.writeHead(416,{'Content-Range':`bytes */${data.length}`}).end();return;}
      res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${data.length}`});
      res.end(data.subarray(start,end+1));
    }else{res.writeHead(200,{...headers,'Content-Length':data.length});res.end(data);}
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/motion.html?render=1`;
console.log(`Rendering ${total} frames at 1920x1080, work: ${work}`);

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, {stdio:['ignore','ignore','pipe']});
    let error=''; child.stderr.on('data', data => {error += data; if (error.length > 12000) error=error.slice(-12000);});
    child.on('error', reject);
    child.on('close', code => code===0 ? resolve() : reject(new Error(`FFmpeg ${code}: ${error}`)));
  });
}

const browser = await chromium.launch({executablePath:chrome, headless:true, args:['--hide-scrollbars','--disable-dev-shm-usage']});
try {
  async function renderChunk(worker, start, end) {
    const context = await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,colorScheme:'light'});
    const page = await context.newPage();
    const failures=[];
    page.on('pageerror', err => failures.push(String(err)));
    await page.goto(url, {waitUntil:'domcontentloaded'});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.MOTION_READY === true);
    if (!await page.evaluate(() => typeof window.renderAt==='function')) throw new Error('Missing renderAt(seconds)');
    await page.evaluate(() => window.renderAt(0));
    const target=join(work, `part-${worker}.mp4`);
    const encoder=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','mjpeg','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-crf','18','-preset','fast','-threads','2','-pix_fmt','yuv420p',target],{stdio:['pipe','ignore','pipe']});
    let encodingError=''; encoder.stderr.on('data', b=>encodingError+=b);
    const done=new Promise((resolve,reject)=>{encoder.on('error',reject);encoder.on('close',code=>code===0?resolve():reject(new Error(encodingError)));});
    const cdp=await context.newCDPSession(page);
    for (let frame=start;frame<end;frame++) {
      await page.evaluate(t=>window.renderAt(t),frame/fps);
      const shot=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:94,fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:true});
      if (!encoder.stdin.write(Buffer.from(shot.data,'base64'))) await once(encoder.stdin,'drain');
      if ((frame-start+1)%150===0) console.log(`Worker ${worker+1}: ${frame-start+1}/${end-start}`);
    }
    encoder.stdin.end(); await done;
    await context.close();
    if (failures.length) throw new Error(failures.join('\n'));
    return target;
  }
  const parts=await Promise.all([renderChunk(0,0,1000),renderChunk(1,1000,2000),renderChunk(2,2000,3000)]);
  const list=join(work,'concat.txt');
  await writeFile(list,parts.map(path=>`file '${path.replaceAll("'","'\\''")}'`).join('\n'));
  await run(['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-i',join(root,'assets/studio-score.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','160k','-ar','44100','-t','100','-movflags','+faststart',output]);
  await run(['-hide_banner','-loglevel','error','-i',output,'-f','null','-']);
  console.log(`Full decode passed. Export: ${output}`);
  await writeFile(join(root,'render-info.json'),JSON.stringify({width:1920,height:1080,fps,duration,frames:total,video:'H.264',audio:'AAC stereo 44.1kHz',fullDecode:true,frameRenderer:'motion.html?render=1 -> window.renderAt(seconds)',originalScore:true},null,2)+'\n');
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
