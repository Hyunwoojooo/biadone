import assert from 'node:assert/strict';
import { fixtureValidator, loadV1ContractSuite } from '../Tests/Contracts/contract-harness.mjs';

// Only synthetic repository fixtures are read. Nothing is sent to a service.
const suite = await loadV1ContractSuite();
const fixture = suite.fixtureManifest.cases.find(entry => entry.valid
  && /decision[-_]proposal/.test(entry.schema));
assert.ok(fixture, 'A valid synthetic decision proposal must be present.');
const validator = fixtureValidator(suite.compiled, fixture);
assert.equal(typeof validator, 'function', 'The proposal validator must be available.');
assert.equal(validator(fixture.value), true, 'The synthetic proposal must satisfy the frozen contract.');
console.log('Synthetic proposal validated locally. No action submitted or executed.');
