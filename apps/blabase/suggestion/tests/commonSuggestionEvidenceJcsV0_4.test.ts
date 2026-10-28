import { describe, expect, it } from "vitest";
import { types as nodeUtilTypes } from "node:util";

import {
  canonicalizeCommonSuggestionEvidenceGraphInternalV0_4,
  createCommonSuggestionEvidenceParentValidatedGraphHandleFromTrustedParentInternalV0_4,
  type CommonSuggestionEvidenceJcsResultInternalV0_4,
  type CommonSuggestionEvidenceParentValidatedGraphHandleV0_4,
} from "../src/evaluation/dayflowAblation/commonSuggestionEvidenceJcsV0_4.internal";

const DEFAULT_DOCUMENT_CAP = 5_242_880;
const DEFAULT_STRING_CAP = 5_242_880;

const structuralHandleCandidate = {};
// @ts-expect-error Common handles are nominal and cannot be plain objects.
const structurallyAssignedHandle: CommonSuggestionEvidenceParentValidatedGraphHandleV0_4 =
  structuralHandleCandidate;
void structurallyAssignedHandle;

function recursivelyFreezeFixtureGraph(root: unknown): unknown {
  const pending: unknown[] = [root];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (
      (typeof value !== "object" && typeof value !== "function") ||
      value === null ||
      nodeUtilTypes.isProxy(value) ||
      seen.has(value)
    ) {
      continue;
    }
    seen.add(value);
    const names = Object.getOwnPropertyNames(value);
    for (let index = 0; index < names.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, names[index]);
      if (
        descriptor !== undefined &&
        Object.prototype.hasOwnProperty.call(descriptor, "value")
      ) {
        pending.push(descriptor.value);
      }
    }
    try {
      Object.freeze(value);
    } catch {
      // Some branded invalid fixtures, such as non-empty TypedArrays, cannot freeze.
    }
  }
  return root;
}

function trustedHandle(
  value: unknown,
): CommonSuggestionEvidenceParentValidatedGraphHandleV0_4 {
  return createCommonSuggestionEvidenceParentValidatedGraphHandleFromTrustedParentInternalV0_4(
    recursivelyFreezeFixtureGraph(value),
  );
}

function canonicalizeHandle(
  handle: CommonSuggestionEvidenceParentValidatedGraphHandleV0_4,
  maximumCanonicalUtf8Bytes = DEFAULT_DOCUMENT_CAP,
  maximumStringUtf8Bytes = DEFAULT_STRING_CAP,
): CommonSuggestionEvidenceJcsResultInternalV0_4 {
  return canonicalizeCommonSuggestionEvidenceGraphInternalV0_4(
    handle,
    maximumCanonicalUtf8Bytes,
    maximumStringUtf8Bytes,
  );
}

function canonicalize(
  value: unknown,
  maximumCanonicalUtf8Bytes = DEFAULT_DOCUMENT_CAP,
  maximumStringUtf8Bytes = DEFAULT_STRING_CAP,
): CommonSuggestionEvidenceJcsResultInternalV0_4 {
  return canonicalizeHandle(
    trustedHandle(value),
    maximumCanonicalUtf8Bytes,
    maximumStringUtf8Bytes,
  );
}

function expectSuccess(
  result: CommonSuggestionEvidenceJcsResultInternalV0_4,
): asserts result is Extract<
  CommonSuggestionEvidenceJcsResultInternalV0_4,
  { valid: true }
> {
  expect(result.valid).toBe(true);
  if (!result.valid) throw new Error("expected canonicalization success");
  expect(Object.isFrozen(result)).toBe(true);
}

function expectGraphInvalid(
  result: CommonSuggestionEvidenceJcsResultInternalV0_4,
): void {
  expect(result).toEqual({ valid: false, failure: "graph_invalid" });
  expect(Object.isFrozen(result)).toBe(true);
}

function expectResourceFailure(
  result: CommonSuggestionEvidenceJcsResultInternalV0_4,
): void {
  expect(result).toEqual({
    valid: false,
    failure: "resource_limit_exceeded",
  });
  expect(Object.isFrozen(result)).toBe(true);
}

function canonicalJson(value: unknown): string {
  const result = canonicalize(value);
  expectSuccess(result);
  return result.canonicalJson;
}

function enumerableData(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function nestedArray(depth: number): unknown {
  let value: unknown = 0;
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

function objectWithProperties(count: number): Record<string, number> {
  const value: Record<string, number> = {};
  for (let index = 0; index < count; index += 1) {
    value[`k${String(index).padStart(5, "0")}`] = 0;
  }
  return value;
}

function reverseInterleavedLongPrefixObject(
  count: number,
): Record<string, number> {
  const value: Record<string, number> = {};
  for (let index = count - 1; index >= 0; index -= 1) {
    const interleaved =
      index % 2 === 0 ? index / 2 : count - 1 - (index - 1) / 2;
    value[`common-prefix-${String(interleaved).padStart(5, "0")}`] = 0;
  }
  return value;
}

function distributedPropertyGraph(arrayLength: number): Record<string, number[]> {
  const value: Record<string, number[]> = {};
  for (let index = 0; index < 16; index += 1) {
    value[`k${String(index).padStart(2, "0")}`] = new Array<number>(
      index === 15 ? arrayLength : 1_023,
    ).fill(0);
  }
  return value;
}

describe("Common suggestion evidence JCS V0.4 internal canonicalizer", () => {
  describe("RFC primitives, escaping, and deterministic ordering", () => {
    it("serializes RFC JSON primitives within the Common numeric domain", () => {
      expect(canonicalJson(null)).toBe("null");
      expect(canonicalJson(true)).toBe("true");
      expect(canonicalJson(false)).toBe("false");
      expect(canonicalJson(0)).toBe("0");
      expect(canonicalJson(1.5)).toBe("1.5");
      expect(canonicalJson(Number.MIN_VALUE)).toBe("5e-324");
      expect(canonicalJson("text")).toBe('"text"');
    });

    it("uses unsigned UTF-16 order for the official boundary characters", () => {
      const value: Record<string, number> = {};
      for (const key of ["דּ", "😀", "€", "ö", "\u0080", "1", "\r"]) {
        value[key] = 0;
      }

      expect(canonicalJson(value)).toBe(
        '{"\\r":0,"1":0,"\u0080":0,"ö":0,"€":0,"😀":0,"דּ":0}',
      );
    });

    it("orders a prefix before its extension and sorts nested objects", () => {
      expect(canonicalJson({ b: 0, aa: 0, a: 0 })).toBe(
        '{"a":0,"aa":0,"b":0}',
      );
      expect(
        canonicalJson({ z: { b: 1, a: 2 }, a: [{ d: 4, c: 3 }, 2] }),
      ).toBe('{"a":[{"c":3,"d":4},2],"z":{"a":2,"b":1}}');
    });

    it("preserves array order", () => {
      expect(canonicalJson([3, 1, 2, { b: 1, a: 2 }])).toBe(
        '[3,1,2,{"a":2,"b":1}]',
      );
    });

    it("does not normalize Unicode", () => {
      const composed = "é";
      const decomposed = "e\u0301";
      const value: Record<string, string> = {};
      value[composed] = composed;
      value[decomposed] = decomposed;

      expect(canonicalJson(value)).toBe(
        `{"${decomposed}":"${decomposed}","${composed}":"${composed}"}`,
      );
    });

    it("uses RFC quote, backslash, slash, control, and separator handling", () => {
      expect(canonicalJson('"')).toBe('"\\\""');
      expect(canonicalJson("\\")).toBe('"\\\\"');
      expect(canonicalJson("/")).toBe('"/"');
      expect(canonicalJson("\b\f\n\r\t")).toBe('"\\b\\f\\n\\r\\t"');
      expect(canonicalJson("\u2028\u2029")).toBe('"\u2028\u2029"');
    });

    it("rejects lone surrogate values and keys", () => {
      expectGraphInvalid(canonicalize("\ud800"));
      expectGraphInvalid(canonicalize("\udfff"));
      const value: Record<string, number> = {};
      value["\ud800"] = 1;
      expectGraphInvalid(canonicalize(value));
    });
  });

  describe("strict Common numbers and graph shapes", () => {
    it("accepts safe integers, fractions, and subnormals", () => {
      for (const value of [
        0,
        1,
        -1,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
        1.25,
        -1.25,
        Number.MIN_VALUE,
      ]) {
        expectSuccess(canonicalize(value));
      }
    });

    it("pins strict Common number spellings and unsafe integer-valued rejection", () => {
      expect(canonicalJson(1e-6)).toBe("0.000001");
      expect(canonicalJson(1e-7)).toBe("1e-7");
      expect(canonicalJson(333333333.3333333)).toBe("333333333.3333333");
      for (const value of [1e20, 1e21, Number.MAX_VALUE]) {
        expectGraphInvalid(canonicalize(value));
      }
    });

    it("rejects negative zero, unsafe integer-valued doubles, and non-finite numbers", () => {
      for (const value of [
        -0,
        9_007_199_254_740_992,
        -9_007_199_254_740_992,
        1e30,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ]) {
        expectGraphInvalid(canonicalize(value));
      }
    });

    it("rejects bigint, boxed numbers, and custom coercion without invoking it", () => {
      expectGraphInvalid(canonicalize(1n));
      expectGraphInvalid(canonicalize(new Number(1)));
      let coercionCount = 0;
      const custom = {
        valueOf(): number {
          coercionCount += 1;
          return 1;
        },
        toString(): string {
          coercionCount += 1;
          return "1";
        },
      };

      expectGraphInvalid(canonicalize(custom));
      expect(coercionCount).toBe(0);
    });

    it("rejects accessors, symbols, non-enumerable fields, and exotic prototypes", () => {
      let getterCount = 0;
      const accessor = {};
      Object.defineProperty(accessor, "a", {
        enumerable: true,
        get(): number {
          getterCount += 1;
          return 1;
        },
      });
      const symbol = { a: 1 };
      enumerableData(symbol, Symbol("private"), 2);
      const hidden = { a: 1 };
      Object.defineProperty(hidden, "hidden", { value: 2 });
      class CustomClass {
        readonly a = 1;
      }

      for (const value of [
        accessor,
        symbol,
        hidden,
        Object.create(null),
        Object.create({ inherited: true }),
        new CustomClass(),
        new Date(0),
        new Map(),
        new Set(),
      ]) {
        expectGraphInvalid(canonicalize(value));
      }
      expect(getterCount).toBe(0);
    });

    it("rejects sparse, extra, accessor, and symbol array fields", () => {
      const sparse = new Array<unknown>(2);
      sparse[0] = 1;
      const extra = [1] as unknown[] & { extra?: number };
      extra.extra = 2;
      let getterCount = 0;
      const accessor = [1];
      Object.defineProperty(accessor, "0", {
        enumerable: true,
        get(): number {
          getterCount += 1;
          return 1;
        },
      });
      const symbol = [1];
      enumerableData(symbol, Symbol("private"), 2);

      for (const value of [sparse, extra, accessor, symbol]) {
        expectGraphInvalid(canonicalize(value));
      }
      expect(getterCount).toBe(0);
    });

    it("treats prototype-named own fields as inert data", () => {
      const value = {};
      enumerableData(value, "__proto__", 1);
      enumerableData(value, "constructor", 2);
      enumerableData(value, "prototype", 3);

      expect(canonicalJson(value)).toBe(
        '{"__proto__":1,"constructor":2,"prototype":3}',
      );
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });
  });

  describe("identity, cycles, aliases, and resource caps", () => {
    it("rejects direct, mutual, and array cycles", () => {
      const direct: Record<string, unknown> = {};
      direct.self = direct;
      const left: Record<string, unknown> = {};
      const right: Record<string, unknown> = {};
      left.right = right;
      right.left = left;
      const array: unknown[] = [];
      array[0] = array;

      expectGraphInvalid(canonicalize(direct));
      expectGraphInvalid(canonicalize(left));
      expectGraphInvalid(canonicalize(array));
    });

    it("rejects shared aliases but accepts equal separately allocated graphs", () => {
      const shared = { value: 1 };
      expectGraphInvalid(canonicalize({ a: shared, b: shared }));

      const result = canonicalize({ a: { value: 1 }, b: { value: 1 } });
      expectSuccess(result);
      expect(result.canonicalJson).toBe(
        '{"a":{"value":1},"b":{"value":1}}',
      );
    });

    it("enforces root depth 32 and rejects depth 33", () => {
      expectSuccess(canonicalize(nestedArray(32)));
      expectResourceFailure(canonicalize(nestedArray(33)));
    });

    it("enforces cumulative property count 16384 and 16385", () => {
      const exact = canonicalize(reverseInterleavedLongPrefixObject(16_384));
      expectSuccess(exact);
      expect(exact.canonicalJson.startsWith('{"common-prefix-00000":0')).toBe(
        true,
      );
      expect(exact.canonicalJson.endsWith('"common-prefix-16383":0}')).toBe(
        true,
      );
      expectResourceFailure(canonicalize(objectWithProperties(16_385)));
    });

    it("enforces the cumulative property cap across nested containers", () => {
      expectSuccess(canonicalize(distributedPropertyGraph(1_023)));
      expectResourceFailure(canonicalize(distributedPropertyGraph(1_024)));
    });

    it("enforces array length 1024 and 1025", () => {
      expectSuccess(canonicalize(new Array<number>(1_024).fill(0)));
      expectResourceFailure(canonicalize(new Array<number>(1_025).fill(0)));
    });

    it("enforces per-string and total output byte caps at equality", () => {
      const utf8Value = "é";
      const exactString = canonicalize(utf8Value, 4, 2);
      expectSuccess(exactString);
      expect(exactString.canonicalUtf8ByteLength).toBe(4);
      expectResourceFailure(canonicalize(utf8Value, 4, 1));

      const object = { a: 1 };
      const exactOutput = canonicalize(object, 7, 1);
      expectSuccess(exactOutput);
      expect(exactOutput.canonicalUtf8ByteLength).toBe(7);
      expectResourceFailure(canonicalize(object, 6, 1));
    });

    it("enforces object-key string caps and escaped-control output caps", () => {
      expectSuccess(canonicalize({ é: 0 }, 100, 2));
      expectResourceFailure(canonicalize({ é: 0 }, 100, 1));

      const escapedControl = canonicalize("\n", 4, 1);
      expectSuccess(escapedControl);
      expect(escapedControl.canonicalJson).toBe('"\\n"');
      expect(escapedControl.canonicalUtf8ByteLength).toBe(4);
      expectResourceFailure(canonicalize("\n", 3, 1));
    });

    it("validates primitive limits before handle inspection", () => {
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      const hostileHandle = revoked.proxy as CommonSuggestionEvidenceParentValidatedGraphHandleV0_4;
      for (const [documentCap, stringCap] of [
        [-1, 0],
        [-0, 0],
        [Number.NaN, 0],
        [Number.POSITIVE_INFINITY, 0],
        [1.5, 0],
        [1, 2],
        [5_242_881, 0],
      ] as const) {
        expectResourceFailure(
          canonicalizeHandle(hostileHandle, documentCap, stringCap),
        );
      }
    });
  });

  describe("opaque handles and hostile boundaries", () => {
    it("rejects a mutable graph even when the trusted-parent factory issued its handle", () => {
      const mutableHandle =
        createCommonSuggestionEvidenceParentValidatedGraphHandleFromTrustedParentInternalV0_4(
          { a: 1 },
        );

      expectGraphInvalid(canonicalizeHandle(mutableHandle));
    });

    it("creates frozen null-prototype handles", () => {
      const handle = trustedHandle({ a: 1 });

      expect(Object.getPrototypeOf(handle)).toBeNull();
      expect(Object.isFrozen(handle)).toBe(true);
      expect(canonicalizeHandle(handle).valid).toBe(true);
    });

    it("rejects forged, proxied, and revoked handles without invoking traps", () => {
      const genuine = trustedHandle({ a: 1 });
      const forged = Object.freeze(
        Object.create(null),
      ) as CommonSuggestionEvidenceParentValidatedGraphHandleV0_4;
      let trapCount = 0;
      const proxied = new Proxy(genuine, {
        get(): never {
          trapCount += 1;
          throw new Error("handle get trap invoked");
        },
        getPrototypeOf(): never {
          trapCount += 1;
          throw new Error("handle prototype trap invoked");
        },
      });
      const revoked = Proxy.revocable(genuine, {});
      revoked.revoke();

      expectGraphInvalid(canonicalizeHandle(forged));
      expectGraphInvalid(canonicalizeHandle(proxied));
      expectGraphInvalid(canonicalizeHandle(revoked.proxy));
      expect(trapCount).toBe(0);
    });

    it("rejects retargeted views and frozen branded exotics", () => {
      const typedArray = new Uint8Array(0);
      const dataView = new DataView(new ArrayBuffer(0));
      Object.setPrototypeOf(typedArray, Object.prototype);
      Object.setPrototypeOf(dataView, Object.prototype);
      const candidates: object[] = [
        typedArray,
        dataView,
        new ArrayBuffer(0),
        new Map(),
        new Set(),
        new Date(0),
        /common/u,
        new Number(1),
        new Error("redacted"),
        Promise.resolve(1),
        new WeakMap(),
        new WeakSet(),
      ];
      if (typeof SharedArrayBuffer !== "undefined") {
        const sharedView = new Uint8Array(new SharedArrayBuffer(0));
        Object.setPrototypeOf(sharedView, Object.prototype);
        candidates.push(sharedView, new SharedArrayBuffer(0));
      }

      for (const candidate of candidates) {
        Object.setPrototypeOf(candidate, Object.prototype);
        try {
          Object.freeze(candidate);
        } catch {
          // The production predicate must reject the brand before frozen checks.
        }
        expectGraphInvalid(canonicalize(candidate));
      }
    });

    it("rejects graph proxies and revoked proxies without escaped exceptions", () => {
      let trapCount = 0;
      const graphProxy = new Proxy(
        { a: 1 },
        {
          ownKeys(): never {
            trapCount += 1;
            throw new Error("graph ownKeys trap invoked");
          },
          getPrototypeOf(): never {
            trapCount += 1;
            throw new Error("graph prototype trap invoked");
          },
        },
      );
      const revoked = Proxy.revocable({ a: 1 }, {});
      revoked.revoke();

      expectGraphInvalid(canonicalize(graphProxy));
      expectGraphInvalid(canonicalize(revoked.proxy));
      expect(trapCount).toBe(0);
    });

    it("uses captured intrinsics after global and prototype mutation", () => {
      const handle = trustedHandle({ b: [2, 1], a: "é" });
      const graphFailureHandle = trustedHandle(Symbol("invalid"));
      const resourceFailureHandle = trustedHandle("a");
      const originalStringify = JSON.stringify;
      const originalGetPrototypeOf = Object.getPrototypeOf;
      const originalGetOwnPropertyNames = Object.getOwnPropertyNames;
      const originalJoin = Array.prototype.join;
      const originalSort = Array.prototype.sort;
      const originalNumber = globalThis.Number;
      const originalIsFinite = Number.isFinite;
      const originalCharCodeAt = String.prototype.charCodeAt;
      const trapKey = "__commonSuggestionEvidenceJcsTrapV0_4__";
      const trapDescriptor = Object.getOwnPropertyDescriptor(
        Object.prototype,
        trapKey,
      );
      let result: CommonSuggestionEvidenceJcsResultInternalV0_4 | undefined;
      let graphFailure: CommonSuggestionEvidenceJcsResultInternalV0_4 | undefined;
      let resourceFailure: CommonSuggestionEvidenceJcsResultInternalV0_4 | undefined;

      try {
        JSON.stringify = (() => {
          throw new Error("ambient JSON.stringify invoked");
        }) as typeof JSON.stringify;
        Object.getPrototypeOf = (() => {
          throw new Error("ambient Object.getPrototypeOf invoked");
        }) as typeof Object.getPrototypeOf;
        Object.getOwnPropertyNames = (() => {
          throw new Error("ambient Object.getOwnPropertyNames invoked");
        }) as typeof Object.getOwnPropertyNames;
        Array.prototype.join = (() => {
          throw new Error("ambient Array.prototype.join invoked");
        }) as typeof Array.prototype.join;
        Array.prototype.sort = (() => {
          throw new Error("ambient Array.prototype.sort invoked");
        }) as typeof Array.prototype.sort;
        Number.isFinite = (() => {
          throw new Error("ambient Number.isFinite invoked");
        }) as typeof Number.isFinite;
        globalThis.Number = new Proxy(originalNumber, {
          get(): never {
            throw new Error("ambient Number binding invoked");
          },
        });
        String.prototype.charCodeAt = (() => {
          throw new Error("ambient String.prototype.charCodeAt invoked");
        }) as typeof String.prototype.charCodeAt;
        Object.defineProperty(Object.prototype, trapKey, {
          configurable: true,
          enumerable: true,
          get(): never {
            throw new Error("inherited getter invoked");
          },
        });
        result = canonicalizeHandle(handle);
        graphFailure = canonicalizeHandle(graphFailureHandle);
        resourceFailure = canonicalizeHandle(resourceFailureHandle, 0, 0);
      } finally {
        JSON.stringify = originalStringify;
        Object.getPrototypeOf = originalGetPrototypeOf;
        Object.getOwnPropertyNames = originalGetOwnPropertyNames;
        Array.prototype.join = originalJoin;
        Array.prototype.sort = originalSort;
        globalThis.Number = originalNumber;
        Number.isFinite = originalIsFinite;
        String.prototype.charCodeAt = originalCharCodeAt;
        if (trapDescriptor === undefined) {
          Reflect.deleteProperty(Object.prototype, trapKey);
        } else {
          Object.defineProperty(Object.prototype, trapKey, trapDescriptor);
        }
      }

      expectSuccess(result as CommonSuggestionEvidenceJcsResultInternalV0_4);
      expect(
        (result as Extract<
          CommonSuggestionEvidenceJcsResultInternalV0_4,
          { valid: true }
        >).canonicalJson,
      ).toBe('{"a":"é","b":[2,1]}');
      expect(Object.getOwnPropertyNames(result as object)).toEqual([
        "valid",
        "canonicalJson",
        "canonicalUtf8ByteLength",
      ]);
      expectGraphInvalid(
        graphFailure as CommonSuggestionEvidenceJcsResultInternalV0_4,
      );
      expectResourceFailure(
        resourceFailure as CommonSuggestionEvidenceJcsResultInternalV0_4,
      );
      expect(Object.getOwnPropertyNames(graphFailure as object)).toEqual([
        "valid",
        "failure",
      ]);
      expect(Object.getOwnPropertyNames(resourceFailure as object)).toEqual([
        "valid",
        "failure",
      ]);
      expect(Object.getPrototypeOf(graphFailure as object)).toBeNull();
      expect(Object.getPrototypeOf(resourceFailure as object)).toBeNull();
    });

    it("replays deterministically and reuses frozen failure singletons", () => {
      const handle = trustedHandle({ b: 2, a: [1, 0] });
      const first = canonicalizeHandle(handle);
      const second = canonicalizeHandle(handle);
      expect(first).toEqual(second);
      expectSuccess(first);
      expectSuccess(second);

      const graphFailureA = canonicalize(Symbol("invalid"));
      const graphFailureB = canonicalize(Symbol("invalid"));
      const resourceFailureA = canonicalize("a", 0, 0);
      const resourceFailureB = canonicalize("a", 0, 0);
      expect(graphFailureA).toBe(graphFailureB);
      expect(resourceFailureA).toBe(resourceFailureB);
      expectGraphInvalid(graphFailureA);
      expectResourceFailure(resourceFailureA);
    });
  });
});
