import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { isStrictRfc3339DateTime } from "./rfc3339.mjs";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CONTRACT_ROOT = path.join(PROJECT_ROOT, "Contracts", "v1");
export const FIXTURE_ROOT = path.join(PROJECT_ROOT, "Fixtures", "v1");

function assertManifest(condition, message) {
  if (!condition) throw new Error(`manifest_error: ${message}`);
}

async function resolveDeclaredFile(root, declaredFile, label) {
  assertManifest(typeof declaredFile === "string" && declaredFile.length > 0, `${label}.file must be non-empty`);
  assertManifest(!path.isAbsolute(declaredFile), `${label}.file must be relative`);
  const resolvedRoot = await realpath(root);
  const resolvedFile = await realpath(path.resolve(root, declaredFile));
  const relative = path.relative(resolvedRoot, resolvedFile);
  assertManifest(relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `${label}.file escapes its manifest root`);
  return resolvedFile;
}

export async function readJson(filename) {
  let source;
  try {
    source = await readFile(filename, "utf8");
  } catch (error) {
    throw new Error(`cannot_read_json: ${filename}: ${error.message}`, { cause: error });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`invalid_json: ${filename}: ${error.message}`, { cause: error });
  }
}

export async function loadContractManifest() {
  const manifestPath = path.join(CONTRACT_ROOT, "manifest.json");
  const manifest = await readJson(manifestPath);
  assertManifest(manifest?.schema_version === "1.0", "contract schema_version must be 1.0");
  assertManifest(manifest?.draft === "2020-12", "contract draft must be 2020-12");
  assertManifest(Array.isArray(manifest.contracts) && manifest.contracts.length > 0, "contracts must be non-empty");

  const names = new Set();
  const ids = new Set();
  const files = new Set();
  const contracts = [];
  for (const [index, entry] of manifest.contracts.entries()) {
    const label = `contracts[${index}]`;
    assertManifest(entry && typeof entry === "object" && !Array.isArray(entry), `${label} must be an object`);
    assertManifest(typeof entry.name === "string" && entry.name.length > 0, `${label}.name must be non-empty`);
    assertManifest(typeof entry.id === "string" && entry.id.length > 0, `${label}.id must be non-empty`);
    assertManifest(!names.has(entry.name), `${label}.name is duplicated: ${entry.name}`);
    assertManifest(!ids.has(entry.id), `${label}.id is duplicated: ${entry.id}`);
    assertManifest(!files.has(entry.file), `${label}.file is duplicated: ${entry.file}`);
    names.add(entry.name);
    ids.add(entry.id);
    files.add(entry.file);

    const filename = await resolveDeclaredFile(CONTRACT_ROOT, entry.file, label);
    const schema = await readJson(filename);
    assertManifest(schema?.$schema === "https://json-schema.org/draft/2020-12/schema", `${entry.name} must declare Draft 2020-12`);
    assertManifest(schema?.$id === entry.id, `${entry.name} manifest id does not match schema $id`);
    contracts.push(Object.freeze({ ...entry, filename, schema }));
  }
  return Object.freeze({ ...manifest, contracts: Object.freeze(contracts) });
}

export async function loadFixtureManifest() {
  const manifestPath = path.join(FIXTURE_ROOT, "manifest.json");
  const manifest = await readJson(manifestPath);
  assertManifest(manifest?.schema_version === "1.0", "fixture schema_version must be 1.0");
  assertManifest(Array.isArray(manifest.cases) && manifest.cases.length > 0, "fixture cases must be non-empty");

  const names = new Set();
  const files = new Set();
  const cases = [];
  for (const [index, entry] of manifest.cases.entries()) {
    const label = `cases[${index}]`;
    assertManifest(entry && typeof entry === "object" && !Array.isArray(entry), `${label} must be an object`);
    assertManifest(typeof entry.name === "string" && entry.name.length > 0, `${label}.name must be non-empty`);
    assertManifest(!names.has(entry.name), `${label}.name is duplicated: ${entry.name}`);
    assertManifest(!files.has(entry.file), `${label}.file is duplicated: ${entry.file}`);
    assertManifest(typeof entry.schema === "string" && entry.schema.length > 0, `${label}.schema must be non-empty`);
    assertManifest(typeof entry.valid === "boolean", `${label}.valid must be boolean`);
    if (!entry.valid) {
      assertManifest(typeof entry.expected_error_code === "string" && entry.expected_error_code.length > 0, `${label}.expected_error_code is required for invalid cases`);
    }
    names.add(entry.name);
    files.add(entry.file);
    const filename = await resolveDeclaredFile(FIXTURE_ROOT, entry.file, label);
    cases.push(Object.freeze({ ...entry, filename, value: await readJson(filename) }));
  }
  return Object.freeze({ ...manifest, cases: Object.freeze(cases) });
}

export function compileContracts(contractManifest) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: true,
  });
  ajv.addFormat("date-time", { type: "string", validate: isStrictRfc3339DateTime });

  for (const contract of contractManifest.contracts) {
    ajv.addSchema(contract.schema, contract.id);
  }

  const validatorsByName = new Map();
  const contractsByName = new Map();
  for (const contract of contractManifest.contracts) {
    const validator = ajv.getSchema(contract.id);
    if (typeof validator !== "function") throw new Error(`schema_compile_failed: ${contract.name}`);
    validatorsByName.set(contract.name, validator);
    contractsByName.set(contract.name, contract);
  }

  return Object.freeze({ ajv, validatorsByName, contractsByName });
}

export function fixtureValidator(compiled, fixtureCase) {
  const byName = compiled.validatorsByName.get(fixtureCase.schema);
  if (byName) return byName;
  const byId = compiled.ajv.getSchema(fixtureCase.schema);
  if (byId) return byId;

  const normalized = fixtureCase.schema.replace(/\.schema\.json$/, "").replace(/\.json$/, "");
  const fallback = compiled.validatorsByName.get(normalized)
    ?? compiled.validatorsByName.get(normalized.replaceAll("-", "_"))
    ?? compiled.validatorsByName.get(normalized.replaceAll("_", "-"));
  if (fallback) return fallback;
  throw new Error(`fixture_unknown_schema: ${fixtureCase.name} -> ${fixtureCase.schema}`);
}

export function formatAjvErrors(errors) {
  return (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.keyword}: ${error.message}`).join("; ");
}

function hasAjvError(errors, instancePath, keyword, parameter, value) {
  return (errors ?? []).some((error) => (
    error.instancePath === instancePath
    && error.keyword === keyword
    && error.params?.[parameter] === value
  ));
}

const EXPECTED_AJV_ERROR_PREDICATES = Object.freeze({
  selection_identifier_binding_required: (errors) => (
    hasAjvError(errors, "", "additionalProperties", "additionalProperty", "slot")
    && hasAjvError(errors, "", "required", "missingProperty", "selection_id")
    && hasAjvError(errors, "", "required", "missingProperty", "interaction_id")
    && hasAjvError(errors, "", "required", "missingProperty", "option_id")
  ),
  decision_boundary_required: (errors) => (
    hasAjvError(errors, "", "required", "missingProperty", "decision_boundary_id")
    && hasAjvError(errors, "", "required", "missingProperty", "boundary_sequence")
  ),
  disabled_option_payload_forbidden: (errors) => (
    hasAjvError(errors, "/choices/1", "additionalProperties", "additionalProperty", "action")
    && hasAjvError(errors, "/choices/1/action_id", "type", "type", "null")
  ),
  slot_semantics_mismatch: (errors) => (
    hasAjvError(errors, "/choices/0/kind", "const", "allowedValue", "recommended_action")
  ),
  dispatch_mode_mismatch: (errors) => (
    hasAjvError(errors, "/dispatch_mode", "const", "allowedValue", "same_turn_stop")
  ),
  continuation_mode_fields_forbidden: (errors) => (
    ["packet_id", "option_id", "action_id", "action"].every((field) => (
      hasAjvError(errors, "", "additionalProperties", "additionalProperty", field)
    ))
  ),
  timeout_outcome_must_be_unknown: (errors) => (
    hasAjvError(errors, "/payload/work_outcome_status", "const", "allowedValue", "unknown")
  ),
  automatic_retry_forbidden: (errors) => (
    hasAjvError(errors, "/payload/automatic_retry", "const", "allowedValue", false)
  ),
  transport_completion_cannot_claim_work_success: (errors) => (
    hasAjvError(errors, "/payload/work_outcome_status", "const", "allowedValue", "not_recorded")
  ),
  raw_correlation_token_forbidden: (errors) => (
    hasAjvError(errors, "/payload", "additionalProperties", "additionalProperty", "correlation_token")
  ),
});

export function matchesExpectedAjvErrorCode(expectedErrorCode, errors) {
  const predicate = EXPECTED_AJV_ERROR_PREDICATES[expectedErrorCode];
  if (!predicate) throw new Error(`unknown_expected_error_code: ${expectedErrorCode}`);
  return predicate(errors);
}

export async function loadV1ContractSuite() {
  const [contractManifest, fixtureManifest] = await Promise.all([
    loadContractManifest(),
    loadFixtureManifest(),
  ]);
  const compiled = compileContracts(contractManifest);
  return Object.freeze({ contractManifest, fixtureManifest, compiled });
}
