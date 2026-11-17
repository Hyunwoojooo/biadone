import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createReleaseTag, parseReleaseArguments, releaseTagName, runRelease } from '../../scripts/release/release.mjs';

test('release arguments require a known step and a build number', () => {
  assert.deepEqual(parseReleaseArguments(['inspect', '--build', '92']).build, 92);
  assert.throws(() => parseReleaseArguments(['publish', '--build', '92']), /Unknown step/);
  assert.throws(() => parseReleaseArguments(['build']), /--build/);
  assert.throws(() => parseReleaseArguments(['build', '--build', '92', '--surprise', 'x']), /Unknown or incomplete/);
});

for (const step of ['notarize', 'payload', 'build', 'finalize']) {
  test(`${step} refuses to run before the earlier steps have passed`, async t => {
    const output = await mkdtemp(join(tmpdir(), 'blabee-release-gate-'));
    t.after(() => rm(output, { recursive: true, force: true }));
    await assert.rejects(runRelease({ step, build: 9999, output, identity: 'x', teamID: 'VN7AMDG677' }),
      /has not run for r9999/);
    assert.deepEqual(await readdir(output), []);
  });
}

test('README release links move to the new build without touching other text', async () => {
  const { updateReadmeRelease } = await import('../../scripts/release/update-readme.mjs');
  const before = [
    '[![Release r85](https://img.shields.io/badge/release-r85-C4A64C)](https://x/releases/tag/blabee-v0.1.0%2Bbuild.85)',
    '**[Download](https://x/releases/download/blabee-v0.1.0%2Bbuild.85/Blabee-0.1.0-arm64-r85.dmg)**',
    'Download **[Blabee 0.1.0 r85](https://x)** and open it.',
    'The r85 app and DMG are signed. For r85 source reconstruction, see provenance.',
    'r85 앱과 DMG. r85 소스를 재구성하려면.',
    'The r63 development-Channel qualification and macOS 13 stay unchanged.',
  ].join('\n');
  const after = updateReadmeRelease(before, 92);
  assert.doesNotMatch(after, /r85|build\.85/);
  assert.equal((after.match(/r92|build\.92/g) ?? []).length, 10);
  assert.match(after, /r63 development-Channel qualification and macOS 13 stay unchanged/);
  assert.equal(updateReadmeRelease(after, 92), after);
  assert.throws(() => updateReadmeRelease(before, 0));
});

test('finalize tags the build commit and refuses a tag that points elsewhere', async () => {
  const commit = 'a'.repeat(40);
  const calls = [];
  const fakeGit = existing => async args => {
    calls.push(args);
    if (args[0] === 'rev-parse') {
      if (!existing) throw new Error('missing');
      return { stdout: `${existing}\n` };
    }
    return { stdout: '' };
  };
  assert.equal(releaseTagName(92), 'blabee-v0.1.0+build.92');
  assert.deepEqual(await createReleaseTag(92, commit, fakeGit(null)), { name: 'blabee-v0.1.0+build.92', commit, created: true });
  assert.deepEqual(calls.at(-1), ['tag', '-a', 'blabee-v0.1.0+build.92', commit, '-m', 'Blabee 0.1.0 r92']);
  calls.length = 0;
  assert.equal((await createReleaseTag(92, commit, fakeGit(commit))).created, false);
  assert.equal(calls.some(args => args[0] === 'tag'), false);
  await assert.rejects(createReleaseTag(92, commit, fakeGit('b'.repeat(40))), /already points at/);
  await assert.rejects(createReleaseTag(92, null, fakeGit(null)), /full commit id/);
});
