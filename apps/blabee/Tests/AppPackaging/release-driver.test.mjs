import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { parseReleaseArguments, runRelease } from '../../scripts/release/release.mjs';

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
