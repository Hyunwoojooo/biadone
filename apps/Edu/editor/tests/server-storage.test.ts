import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProjectStore, safeChild} from '../server/storage';

describe('local project persistence', () => {
  let directory: string;
  let store: ProjectStore;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'biadone-storage-'));
    store = new ProjectStore(directory);
    await store.init();
  });
  afterEach(async () => {await rm(directory, {recursive: true, force: true});});

  it('serializes concurrent edits and rejects stale revisions without losing the winner', async () => {
    const project = await store.create({title: '동시 수정 검사', durationSeconds: 30});
    const outcomes = await Promise.allSettled([
      store.command(project.id, {type: 'updateProject', patch: {title: '첫 번째 수정'}}, project.revision),
      store.command(project.id, {type: 'updateProject', patch: {title: '두 번째 수정'}}, project.revision),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const saved = await store.get(project.id);
    expect(saved.title).toBe('첫 번째 수정');
    expect(saved.revision).toBe(project.revision + 1);
    expect(await store.history(project.id)).toHaveLength(2);
  });

  it('keeps content recoverable and revisions monotonic through undo, redo, reload and restore', async () => {
    const project = await store.create({title: '원래 제목', durationSeconds: 30});
    const edited = await store.command(project.id, {type: 'updateProject', patch: {title: '수정한 제목'}}, project.revision);
    const undone = await store.navigate(project.id, edited.revision, 'undo');
    expect(undone.title).toBe('원래 제목');
    expect(undone.revision).toBeGreaterThan(edited.revision);
    const reloaded = new ProjectStore(directory);
    const redone = await reloaded.navigate(project.id, undone.revision, 'redo');
    expect(redone.title).toBe('수정한 제목');
    expect(redone.revision).toBeGreaterThan(undone.revision);
    const history = await reloaded.history(project.id);
    const restored = await reloaded.navigate(project.id, redone.revision, history.at(-1)!.id);
    expect(restored.title).toBe('원래 제목');
    expect((await reloaded.get(project.id)).revision).toBe(restored.revision);
  });

  it('does not expose directory traversal through project IDs or stored file names', async () => {
    await expect(store.get('../../Sources')).rejects.toThrow('식별자');
    expect(() => safeChild(directory, '../audio.mp3')).toThrow('파일 이름');
    expect(() => safeChild(directory, '/etc/passwd')).toThrow('파일 이름');
    expect(safeChild(directory, 'narration.wav')).toBe(path.join(directory, 'narration.wav'));
  });

  it('does not apply background work cancelled while waiting for the project lock', async () => {
    const project = await store.create({title: '취소 전 제목'});
    let release!: () => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {enter = resolve;});
    const hold = store.locked(project.id, () => new Promise<void>((resolve) => {release = resolve; enter();}));
    await entered;
    const controller = new AbortController();
    const pending = store.command(project.id, {type: 'updateProject', patch: {title: '취소된 분석 결과'}}, project.revision, '분석 적용', {signal: controller.signal});
    controller.abort();
    release();
    await expect(pending).rejects.toThrow();
    await hold;
    const saved = await store.get(project.id);
    expect(saved.title).toBe('취소 전 제목');
    expect(saved.revision).toBe(project.revision);
    expect(await store.history(project.id)).toHaveLength(1);
  });

  it('checks cancellation at the prepared-file commit boundary before changing current content', async () => {
    const project = await store.create({title: '반영 전 제목'});
    const controller = new AbortController();
    await expect(store.command(project.id, {type: 'updateProject', patch: {title: '반영하면 안 되는 분석'}}, project.revision, '분석 적용', {
      signal: controller.signal,
      onCommit: () => controller.abort(),
    })).rejects.toThrow();
    const saved = await store.get(project.id);
    expect(saved.title).toBe('반영 전 제목');
    expect(saved.revision).toBe(project.revision);
    expect(await store.history(project.id)).toHaveLength(1);
  });
});
