import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { checkGenerated, loadBlockedVersions, loadRecords, renderReleases, validateBlockedVersions, validateRecord } from '../../scripts/codex/qualification.mjs';

const root = new URL('../../', import.meta.url);

test('generated Codex qualification Swift sources match the reviewed JSON records', async () => {
  assert.deepEqual(await checkGenerated(), [], 'run: npm run codex:qualification -- generate');
});

test('each reviewed release keeps its fixtures and catalog in agreement', async () => {
  const records = await loadRecords();
  assert.ok(records.length >= 30);
  for (const fixture of await readdir(new URL('Fixtures/codex/', root))) {
    const record = records.find(r => r.version === fixture);
    assert.ok(record?.catalog, `fixture ${fixture} has a catalog record`);
    const data = await readFile(new URL(`Fixtures/codex/${fixture}/voice-runtime.json`, root));
    assert.equal(createHash('sha256').update(data).digest('hex'),
      record.catalog.file_digests['codex-resources/voice/runtime.json'], fixture);
  }
  for (const record of records.filter(r => r.capabilities.includes('serverOwnedWorkspaceRoots'))) {
    assert.ok(record.capabilities.includes('managedAppServer'), record.version);
  }
});

test('qualification records reject ranges, unknown capabilities and malformed digests', () => {
  const valid = { schema: 'blabee.codex-qualification.v1', version: '0.200.0', target: 'aarch64-apple-darwin',
    capabilities: ['pluginCLI'], hook_cdhash: 'a'.repeat(40), catalog: null, notes: [] };
  assert.doesNotThrow(() => validateRecord(valid, '0.200.0.json'));
  for (const change of [
    { version: '0.200' }, { version: '0.200.0-alpha.1' }, { capabilities: ['everything'] }, { capabilities: [] },
    { hook_cdhash: 'A'.repeat(40) }, { target: 'x86_64-apple-darwin' }, { extra: true },
    { catalog: { signing_team: '2DC432GLL2', fingerprint: 'f'.repeat(64), file_digests: { '../bin/codex': 'a'.repeat(64) } } },
    { catalog: { signing_team: '2DC432GLL2', fingerprint: 'f'.repeat(64), file_digests: { 'bin/other': 'a'.repeat(64) } } },
  ]) assert.throws(() => validateRecord({ ...valid, ...change }, '0.200.0.json'), JSON.stringify(change));
  assert.throws(() => validateRecord(valid, '0.201.0.json'));
});

test('registration builds a record only from measured official facts', async () => {
  const { buildRecord, parseArguments, parseCodesign } = await import('../../scripts/codex/register-version.mjs');
  assert.deepEqual(parseArguments(['--version', '0.200.0', '--download']).download, true);
  for (const argv of [['--version', '0.200'], ['--version', '0.200.0'], ['--version', '0.200.0', '--download', '--archive', '/x'],
    ['--version', '0.200.0', '--download', '--capabilities', 'everything']]) assert.throws(() => parseArguments(argv));
  const codesign = parseCodesign('Executable=/x/bin/codex\nCDHash=' + 'b'.repeat(40) + '\nTeamIdentifier=2DC432GLL2\n');
  assert.deepEqual(codesign, { cdhash: 'b'.repeat(40), team: '2DC432GLL2' });
  const probe = { version: '0.200.0', target: 'aarch64-apple-darwin', exec_server: 'bin/codex-exec-server',
    executable_teams: ['2DC432GLL2'], fingerprint: 'c'.repeat(64),
    file_digests: { 'bin/codex-exec-server': 'e'.repeat(64), 'bin/codex': 'd'.repeat(64) } };
  const archive = { sha256: 'a'.repeat(64), bytes: 10, publishedAt: '2026-11-10T00:00:00Z' };
  const record = buildRecord({ version: '0.200.0', capabilities: ['updateLifecycle', 'pluginCLI'], probe, codesign, archive,
    notarization: true, date: '2026-11-13' });
  assert.deepEqual(record.capabilities, ['pluginCLI', 'updateLifecycle']);
  assert.deepEqual(Object.keys(record.catalog.file_digests), ['bin/codex', 'bin/codex-exec-server']);
  assert.equal(record.hook_cdhash, 'b'.repeat(40));
  assert.match(record.notes[0], /sha256:a{64}/);
  for (const bad of [{ probe: { ...probe, version: '0.199.0' } }, { codesign: { ...codesign, team: 'XXXXXXXXXX' } },
    { probe: { ...probe, executable_teams: ['2DC432GLL2', 'OTHERTEAM1'] } }, { codesign: { ...codesign, cdhash: undefined } }]) {
    assert.throws(() => buildRecord({ version: '0.200.0', capabilities: ['pluginCLI'], probe, codesign, archive,
      notarization: false, date: '2026-11-13', ...bad }));
  }
});

test('registration refuses a release whose PermissionRequest schema differs from what the coordinator accepts', async () => {
  const { checkPermissionRequestSchema, PERMISSION_REQUEST_KEYS } = await import('../../scripts/codex/register-version.mjs');
  const official = JSON.parse(await readFile(new URL('../../Fixtures/codex/0.169.0/permission-request.command.input.schema.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => checkPermissionRequestSchema(official));
  const withKey = structuredClone(official); withKey.properties.tool_hook_cwd = { type: 'string' };
  assert.throws(() => checkPermissionRequestSchema(withKey), /new keys: tool_hook_cwd/);
  const open = structuredClone(official); open.additionalProperties = true;
  assert.throws(() => checkPermissionRequestSchema(open), /additionalProperties/);
  const optionalTurn = structuredClone(official); optionalTurn.required = optionalTurn.required.filter(k => k !== 'turn_id');
  assert.throws(() => checkPermissionRequestSchema(optionalTurn), /no longer required: turn_id/);

  // The list mirrors the Swift validator: required + optional keys minus Blabee's qualification marker.
  const swift = await readFile(new URL('../../app/coordination/CoordinatorOperationalApplication.swift', import.meta.url), 'utf8');
  const start = swift.indexOf('private func admitPermissionRequest(_ data: Data)');
  assert.ok(start >= 0, 'admitPermissionRequest moved: update this test');
  const body = swift.slice(start, swift.indexOf('let sessionID = try identifier', start));
  const quoted = text => [...text.matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
  const required = quoted(body.slice(body.indexOf('let requiredKeys'), body.indexOf('let allowedKeys')));
  const optional = quoted(body.slice(body.indexOf('let allowedKeys'), body.indexOf('HookPermissionPolicy.qualificationKey')));
  assert.deepEqual([...required, ...optional].sort(), [...PERMISSION_REQUEST_KEYS].sort());
});

test('check-latest reports only stable releases newer than every registered version', async () => {
  const { unregisteredReleases } = await import('../../scripts/codex/check-latest.mjs');
  const releases = [
    { tag_name: 'rust-v0.167.1', published_at: '2026-11-10T00:00:00Z' },
    { tag_name: 'rust-v0.167.0', published_at: '2026-11-06T00:00:00Z' },
    { tag_name: 'rust-v0.168.0-alpha.1', prerelease: true },
    { tag_name: 'rust-v0.168.0', draft: true },
    { tag_name: 'rust-v0.165.0', published_at: '2026-10-27T00:00:00Z' },
    { tag_name: 'rust-v0.166.0' },
    { tag_name: 'codex-cli-legacy' },
  ];
  assert.deepEqual(unregisteredReleases(releases, ['0.164.0', '0.166.0']).map(r => r.version), ['0.167.0', '0.167.1']);
  assert.deepEqual(unregisteredReleases(releases, ['0.166.0', '0.167.1']), []);
});

test('blocked versions file is strict', async () => {
  const records = await loadRecords();
  const schema = 'blabee.codex-blocked-versions.v1';
  assert.deepEqual(validateBlockedVersions({ schema, blocked: [] }, records), []);
  assert.deepEqual(validateBlockedVersions({ schema, blocked: [
    { version: '0.999.1', reason: 'second' }, { version: '0.999.0', reason: 'first' }] }, records).map(e => e.version),
    ['0.999.0', '0.999.1']);
  const registered = records.find(r => r.capabilities.includes('pluginCLI')).version;
  for (const bad of [
    { schema, blocked: [], extra: true }, { schema: 'other', blocked: [] }, { schema }, { schema, blocked: {} },
    { schema, blocked: [{ version: '0.999', reason: 'x' }] },
    { schema, blocked: [{ version: '0.999.0-alpha.1', reason: 'x' }] },
    { schema, blocked: [{ version: '0.999.0' }] }, { schema, blocked: [{ version: '0.999.0', reason: '' }] },
    { schema, blocked: [{ version: '0.999.0', reason: 'two\nlines' }] },
    { schema, blocked: [{ version: '0.999.0', reason: 'x', extra: 1 }] },
    { schema, blocked: [{ version: '0.999.0', reason: 'x' }, { version: '0.999.0', reason: 'y' }] },
    { schema, blocked: [{ version: registered, reason: 'registered' }] },
  ]) assert.throws(() => validateBlockedVersions(bad, records), JSON.stringify(bad));
  // The reason becomes a `//` comment in generated Swift: anything that ends
  // a line there would turn the rest of the reason into code.
  for (const ending of ['\r', ' ', ' ', '\u0085', '\u000b', '\u000c', '\u0000', '\t']) {
    assert.throws(() => validateBlockedVersions(
      { schema, blocked: [{ version: '0.999.0', reason: `queue changed${ending}let x = 1` }] }, records
    ), /needs a one-line reason/, JSON.stringify(ending));
  }
  // Registering a blocked release is the usual way a block ends, so the
  // message has to say which file to change.
  assert.throws(() => validateBlockedVersions({ schema, blocked: [{ version: registered, reason: 'registered' }] }, records),
    /remove it from blocked-versions\.json/);
  // The shipped file loads and starts without a blocked release that is also registered.
  assert.ok(Array.isArray(await loadBlockedVersions(undefined, records)));
});

test('blocked versions are rendered into the generated release data', async () => {
  const records = await loadRecords();
  const rendered = renderReleases(records, [{ version: '0.999.0', reason: 'queue changed' }, { version: '0.999.1', reason: 'hook changed' }]);
  assert.match(rendered, /static let blockedPluginVersions: Set<String> = \[\n        \/\/ queue changed\n        "0\.999\.0",\n        \/\/ hook changed\n        "0\.999\.1",\n    \]/);
  assert.match(renderReleases(records, []), /static let blockedPluginVersions: Set<String> = \[\]\n/);
  assert.match(renderReleases(records), /static let blockedPluginVersions: Set<String> = \[\]\n/);
});
