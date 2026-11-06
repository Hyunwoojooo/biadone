import assert from "node:assert/strict";
import test from "node:test";

import { validateReleaseLegalMetadata } from "../../scripts/build-macos-app.mjs";

const metadata = Object.freeze({
  BlabeeTermsURL: "https://biadone.com/legal/blabee/terms",
  BlabeePrivacyURL: "https://biadone.com/legal/blabee/privacy",
  BlabeeLegalDocumentVersion: "2026-09-23",
});

test("public legal metadata requires all three keys and never invents defaults", () => {
  for (const key of Object.keys(metadata)) {
    for (const value of [undefined, null, false, 123, "", " ", "\n", "x".repeat(2_049)]) {
      assert.throws(() => validateReleaseLegalMetadata({ ...metadata, [key]: value }), /public release/u);
    }
  }
  assert.throws(() => validateReleaseLegalMetadata({}), /BlabeeTermsURL/u);
  assert.throws(() => validateReleaseLegalMetadata({ BlabeeLegalDocumentsDeferred: false }), /BlabeeTermsURL/u);
});

test("explicitly deferred documents carry no invented URLs or consent revision", () => {
  const result = validateReleaseLegalMetadata({ BlabeeLegalDocumentsDeferred: true, ignored: "not copied" });
  assert.deepEqual(result, { BlabeeLegalDocumentsDeferred: true });
  assert.equal(Object.isFrozen(result), true);
});

test("deferred documents reject mistyped flags and any conflicting document metadata", () => {
  for (const value of [undefined, null, 0, 1, "true", "false", {}, []]) {
    assert.throws(() => validateReleaseLegalMetadata({ ...metadata, BlabeeLegalDocumentsDeferred: value }), /BlabeeLegalDocumentsDeferred must be a boolean/u);
  }
  for (const key of Object.keys(metadata)) {
    for (const value of [metadata[key], undefined, null, ""]) {
      assert.throws(() => validateReleaseLegalMetadata({ BlabeeLegalDocumentsDeferred: true, [key]: value }), /cannot be combined/u);
    }
  }
  assert.throws(() => validateReleaseLegalMetadata({ ...metadata, BlabeeLegalDocumentsDeferred: true }), /cannot be combined/u);
  assert.deepEqual(validateReleaseLegalMetadata({ ...metadata, BlabeeLegalDocumentsDeferred: false }), metadata);
});

test("public legal URLs reject credentials, local or reserved hosts, placeholders and malformed values", () => {
  for (const key of ["BlabeeTermsURL", "BlabeePrivacyURL"]) {
    for (const value of [
      "http://biadone.com/terms", "/terms", "not-a-url", " https://biadone.com/terms",
      "https://user:password@biadone.com/terms", "https://localhost/terms",
      "https://127.0.0.1/terms", "https://[::1]/terms", "https://terms.local/terms",
      "https://blabee.test/terms", "https://blabee.invalid/terms", "https://example.com/terms",
      "https://legal.example.org/terms", "https://example.com./terms", "https://terms/terms",
      "https://.com/terms", "https://legal_name.biadone.com/terms", "https://legal.internal/terms",
      "https://biadone.com/draft/terms", "https://biadone.com/%64ummy/terms",
      "https://biadone.com/terms\n", "https:\\biadone.com\\terms", "https://biadone.com/%ZZ",
    ]) {
      assert.throws(() => validateReleaseLegalMetadata({ ...metadata, [key]: value }), /public release/u, value);
    }
  }
});

test("public legal revisions reject dummy or mutable labels", () => {
  for (const version of [
    "draft-onboarding-v1", "DUMMY", "legal-placeholder-v1", "example-v1", "test-2026-09-23",
    "preview-v1", "todo", "TBD", "internal-v1", "temporary", "latest", "current", "unknown",
    "2026 09 23", "v1\n", "v".repeat(129),
  ]) {
    assert.throws(() => validateReleaseLegalMetadata({ ...metadata, BlabeeLegalDocumentVersion: version }), /public release/u, version);
  }
});

test("published-shaped metadata is returned unchanged as an immutable snapshot without a network probe", () => {
  const supplied = { ...metadata, BlabeeLegalDocumentVersion: "legal-2026.09.23-v1", ignored: "not copied" };
  const result = validateReleaseLegalMetadata(supplied);
  supplied.BlabeeTermsURL = "https://elsewhere.invalid/changed";
  assert.deepEqual(result, { ...metadata, BlabeeLegalDocumentVersion: "legal-2026.09.23-v1" });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(validateReleaseLegalMetadata({ ...metadata, BlabeeTermsURL: "https://biadone.dev/terms" }).BlabeeTermsURL,
    "https://biadone.dev/terms");
});
