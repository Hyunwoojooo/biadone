import {spawn} from 'node:child_process';
import {access, readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import type {AssetKind, SystemStatus} from '../src/shared/types';
import {HttpError} from './errors';
import {codexAvailability, type CodexAvailability} from './codex';

export interface ProcessResult {stdout: Buffer; stderr: string}

export function runProcess(command: string, args: string[], options: {signal?: AbortSignal; timeout?: number; maxOutput?: number} = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe'], signal: options.signal, windowsHide: true});
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => child.kill('SIGTERM'), options.timeout ?? 30_000);
    const fail = (error: Error) => {if (!settled) {settled = true; clearTimeout(timeout); reject(error);}};
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > (options.maxOutput ?? 16 * 1024 * 1024)) {child.kill('SIGTERM'); fail(new Error('처리 결과가 허용 크기를 초과했습니다.'));}
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {stderr = (stderr + chunk.toString()).slice(-64_000);});
    child.on('error', fail);
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) resolve({stdout: Buffer.concat(chunks), stderr});
      else reject(new Error(options.signal?.aborted ? '작업이 취소되었습니다.' : `미디어 처리에 실패했습니다 (${code ?? signal}). ${stderr.slice(-700)}`));
    });
  });
}

export async function binaryAvailable(binary: string): Promise<boolean> {
  try {await runProcess(binary, ['-version'], {timeout: 5000, maxOutput: 8192}); return true;} catch {return false;}
}

export function ffmpegBinary(): string {return process.env.STUDIO_FFMPEG ?? 'ffmpeg';}
export function ffprobeBinary(): string {return process.env.STUDIO_FFPROBE ?? 'ffprobe';}

const extensions: Record<string, AssetKind> = {
  '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.aac': 'audio', '.flac': 'audio', '.ogg': 'audio',
  '.mp4': 'video', '.mov': 'video', '.m4v': 'video', '.webm': 'video',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.avif': 'image',
};

export async function probeMedia(file: string, originalName: string): Promise<{kind: AssetKind; duration?: number; width?: number; height?: number}> {
  let kind = extensions[path.extname(originalName).toLowerCase()];
  if (!kind) throw new HttpError(415, '지원하는 오디오·영상·이미지 파일을 선택해 주세요.');
  try {
    const result = await runProcess(ffprobeBinary(), ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], {timeout: 15_000});
    const data = JSON.parse(result.stdout.toString()) as {format?: {duration?: string}; streams?: {codec_type?: string; width?: number; height?: number; duration?: string}[]};
    const streams = data.streams ?? [];
    const visual = streams.find((stream) => stream.codec_type === 'video');
    const sound = streams.find((stream) => stream.codec_type === 'audio');
    if (path.extname(originalName).toLowerCase() === '.webm' && !visual && sound) kind = 'audio';
    if (kind === 'audio' && !sound || kind !== 'audio' && !visual) throw new Error('파일 종류와 미디어 스트림이 일치하지 않습니다.');
    const duration = Number(data.format?.duration ?? visual?.duration ?? sound?.duration);
    return checkedMetadata(kind, duration, visual?.width, visual?.height);
  } catch { /* Fallback also verifies codecs; extensions alone are never trusted. */ }
  const result = await runProcess(ffmpegBinary(), ['-hide_banner', '-nostdin', '-i', file, '-t', '0', '-f', 'null', '-'], {timeout: 20_000, maxOutput: 4096});
  const hasVideo = /Stream[^\n]*Video:/.test(result.stderr);
  const hasAudio = /Stream[^\n]*Audio:/.test(result.stderr);
  if (path.extname(originalName).toLowerCase() === '.webm' && !hasVideo && hasAudio) kind = 'audio';
  if (kind === 'audio' && !hasAudio || kind !== 'audio' && !hasVideo) throw new HttpError(415, '파일에 필요한 미디어 스트림이 없습니다.');
  const durationMatch = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(result.stderr);
  const duration = durationMatch ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]) : NaN;
  const dimensions = /Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(result.stderr);
  return checkedMetadata(kind, duration, dimensions ? Number(dimensions[1]) : undefined, dimensions ? Number(dimensions[2]) : undefined);
}

function checkedMetadata(kind: AssetKind, duration: number, width?: number, height?: number) {
  if (kind !== 'image' && (!Number.isFinite(duration) || duration <= 0 || duration > 4 * 3600)) throw new HttpError(415, '오디오·영상 길이는 0초 초과, 4시간 이하여야 합니다.');
  if (kind !== 'audio' && (!width || !height || width > 16384 || height > 16384)) throw new HttpError(415, '이미지·영상 크기를 확인할 수 없거나 너무 큽니다.');
  return {kind, ...(Number.isFinite(duration) && kind !== 'image' ? {duration} : {}), ...(width && height ? {width, height} : {})};
}

export async function audioWaveform(file: string, signal?: AbortSignal): Promise<number[]> {
  const {stdout} = await runProcess(ffmpegBinary(), ['-v', 'error', '-nostdin', '-i', file, '-vn', '-ac', '1', '-ar', '80', '-f', 'f32le', 'pipe:1'], {signal, timeout: 60_000, maxOutput: 6 * 1024 * 1024});
  const count = Math.floor(stdout.length / 4);
  const bins = Math.min(1200, Math.max(1, count));
  const peaks = Array.from({length: bins}, () => 0);
  for (let index = 0; index < count; index++) {
    const bin = Math.min(bins - 1, Math.floor(index / count * bins));
    peaks[bin] = Math.max(peaks[bin], Math.abs(stdout.readFloatLE(index * 4)));
  }
  const maximum = Math.max(...peaks, 0.001);
  return peaks.map((value) => Math.round(Math.min(1, value / maximum) * 1000) / 1000);
}

export interface TranscriptionSetup {python: string; model: string; available: boolean; reason?: string}

export async function transcriptionSetup(appDirectory: string): Promise<TranscriptionSetup> {
  const legacy = path.resolve(appDirectory, '..', '.video-build');
  const python = process.env.STUDIO_PYTHON ?? path.join(legacy, 'venv', 'bin', 'python');
  let model = process.env.STUDIO_WHISPER_MODEL ?? '';
  if (!model) {
    try {
      const snapshots = path.join(legacy, 'models', 'models--Systran--faster-whisper-small', 'snapshots');
      const entries = await readdir(snapshots);
      model = entries.length ? path.join(snapshots, entries.sort()[0]) : '';
    } catch { /* Report setup, never download models automatically. */ }
  }
  try {
    await access(python, constants.X_OK);
    await access(path.join(model, 'model.bin'), constants.R_OK);
    return {python, model, available: true};
  } catch {return {python, model, available: false, reason: '로컬 한국어 음성 모델이 준비되지 않았습니다. SRT·VTT·전사 JSON을 가져와 편집할 수 있습니다.'};}
}

export async function systemStatus(appDirectory: string, dataDirectory: string, codexState?: CodexAvailability): Promise<SystemStatus> {
  const [ffmpeg, ffprobe, setup, codex] = await Promise.all([binaryAvailable(ffmpegBinary()), binaryAvailable(ffprobeBinary()), transcriptionSetup(appDirectory), codexState ?? codexAvailability()]);
  return {ffmpeg, ffprobe, transcription: setup.available && ffmpeg, transcriptionReason: setup.available ? undefined : setup.reason, codex: codex.available, codexReason: codex.reason, dataDirectory, appDirectory, version: '0.1.0'};
}
