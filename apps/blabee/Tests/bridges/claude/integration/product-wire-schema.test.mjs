import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { compileContracts, formatAjvErrors } from '../../../Contracts/contract-harness.mjs';

const contractRoot = new URL('../../../../Contracts/bridge/', import.meta.url);
const fixturePath = new URL('../fixtures/product-wire/cases.json', import.meta.url);
const families = ['claude-owner.v1', 'claude-session.v2', 'pet-provider.v1'];
const allowedFiles = new Set([...families, 'common.v1', 'pet-directory.v1'].map(name => `${name}.json`));
const files = (await readdir(contractRoot)).filter(name => name.endsWith('.json')).sort();
assert(files.every(name => allowedFiles.has(name)), 'unexpected bridge contract file');
for (const family of families) assert(files.includes(`${family}.json`), `missing ${family}`);

const contracts = await Promise.all(files.map(async file => {
  const schema = JSON.parse(await readFile(new URL(file, contractRoot), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.$id, `https://schemas.blabee.local/contracts/bridge/${file}`);
  return { name: file.slice(0, -5), id: schema.$id, schema };
}));
const compiled = compileContracts({ contracts });
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'));
assert.equal(fixtures.schema_version, 'blabee.product-wire.fixtures.v1');
assert(Array.isArray(fixtures.cases) && fixtures.cases.length > 0);
const names = new Set();
for (const fixture of fixtures.cases) {
  assert.equal(typeof fixture.name, 'string');
  assert(fixture.name.length > 0 && !names.has(fixture.name), 'fixture names must be unique');
  names.add(fixture.name);
  assert(families.includes(fixture.contract), `unknown contract: ${fixture.contract}`);
  assert.equal(typeof fixture.valid, 'boolean');
  assert(fixture.value && typeof fixture.value === 'object' && !Array.isArray(fixture.value));
}

function validate(family, value) {
  const validator = compiled.validatorsByName.get(family);
  const valid = validator(value);
  return { valid, errors: formatAjvErrors(validator.errors) };
}

test('each bridge family has shared positive and negative object fixtures', () => {
  for (const family of families) {
    for (const valid of [true, false]) {
      assert(fixtures.cases.some(fixture => fixture.contract === family && fixture.valid === valid),
        `${family} has no ${valid ? 'positive' : 'negative'} fixture`);
    }
    for (const kind of ['request', 'response']) {
      assert(fixtures.cases.some(fixture => fixture.contract === family && fixture.valid && fixture.value.kind === kind),
        `${family} has no valid ${kind}`);
    }
  }
});

for (const fixture of fixtures.cases) {
  test(`product wire schema: ${fixture.name}`, () => {
    const result = validate(fixture.contract, fixture.value);
    assert.equal(result.valid, fixture.valid, `${fixture.name}: ${result.errors}`);
  });
}

test('new envelopes reject legacy versions and unknown top-level fields', () => {
  for (const family of families) {
    for (const kind of ['request', 'response']) {
      const fixture = fixtures.cases.find(item => item.contract === family && item.valid && item.value.kind === kind);
      const legacy = structuredClone(fixture.value);
      legacy.schema_version = 'blabee.claude-session.v1';
      assert.equal(validate(family, legacy).valid, false);
      const extended = structuredClone(fixture.value);
      extended.auth_token = 'synthetic-not-a-live-credential';
      assert.equal(validate(family, extended).valid, false);
    }
  }
});

test('responses cannot mix success and error variants or carry request payloads', () => {
  for (const family of families) {
    const fixture = fixtures.cases.find(item => item.contract === family && item.valid
      && item.value.kind === 'response' && item.value.ok === true);
    assert(fixture, `${family} needs a success fixture`);
    const both = structuredClone(fixture.value);
    both.error = { code: 'invalid_request' };
    assert.equal(validate(family, both).valid, false);
    const mismatchedFlag = structuredClone(fixture.value);
    mismatchedFlag.ok = false;
    assert.equal(validate(family, mismatchedFlag).valid, false);
    const requestBody = structuredClone(fixture.value);
    requestBody.payload = {};
    assert.equal(validate(family, requestBody).valid, false);
  }
});

test('UInt64 renewal sequence is lossless and rejects noncanonical or overflowing input', () => {
  const fixture = fixtures.cases.find(item => item.contract === 'claude-owner.v1' && item.valid
    && item.value.kind === 'request' && item.value.operation === 'renew');
  assert(fixture, 'renew request fixture is required');
  const inputs = [
    ['1', true], ['18446744073709551615', true],
    ['0', false], ['18446744073709551616', false], ['99999999999999999999', false],
    ['01', false], ['+1', false], ['-1', false], ['1e3', false], ['1.0', false],
    [' 1', false], ['1\n', false], ['', false], [1, false], [true, false], [null, false],
  ];
  for (const [sequence, expected] of inputs) {
    const value = structuredClone(fixture.value);
    value.payload.renewal_sequence = sequence;
    assert.equal(validate('claude-owner.v1', value).valid, expected, `sequence ${JSON.stringify(sequence)}`);
  }
});

test('schemas are explicit about role separation', () => {
  for (const fixture of fixtures.cases.filter(item => item.valid && item.value.kind === 'request')) {
    const value = structuredClone(fixture.value);
    const role = value.role;
    for (const wrongRole of ['owner', 'hook', 'bridge', 'selector', 'control', 'unknown'].filter(item => item !== role)) {
      value.role = wrongRole;
      assert.equal(validate(fixture.contract, value).valid, false, `${fixture.name} accepted ${wrongRole}`);
    }
  }
});

test('decimal range patterns agree with BigInt at magnitude boundaries', () => {
  const fixture = fixtures.cases.find(item => item.contract === 'claude-owner.v1' && item.valid
    && item.value.kind === 'request' && item.value.operation === 'renew');
  const maximum = (1n << 64n) - 1n;
  const values = new Set([0n, 1n, maximum - 1n, maximum, maximum + 1n]);
  for (let exponent = 1n; exponent <= 21n; exponent++) {
    const power = 10n ** exponent;
    for (const offset of [-1n, 0n, 1n]) values.add(power + offset);
  }
  for (const sequence of values) {
    const value = structuredClone(fixture.value);
    value.payload.renewal_sequence = sequence.toString();
    assert.equal(validate('claude-owner.v1', value).valid, sequence > 0n && sequence <= maximum,
      `sequence ${sequence}`);
  }
});

// Ajv sees parsed objects. Duplicate keys, malformed UTF-8, frame limits,
// correlation, and registered secret values are exercised by the Swift codec.
