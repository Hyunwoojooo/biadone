import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";

import {
  parseCommonCanonicalJsonBytesInternalV0_4,
  type CommonCanonicalJsonParseResultInternalV0_4,
} from "../src/evaluation/dayflowAblation/commonSuggestionEvidenceCanonicalJsonV0_4.internal";

const textEncoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function limits(
  maximumCanonicalUtf8Bytes = 1_000_000,
  maximumStringUtf8Bytes = 1_024,
): readonly [number, number] {
  return [maximumCanonicalUtf8Bytes, maximumStringUtf8Bytes] as const;
}

function parseBytes(
  value: unknown,
  trustedLimits = limits(),
): CommonCanonicalJsonParseResultInternalV0_4 {
  return parseCommonCanonicalJsonBytesInternalV0_4(
    value,
    trustedLimits[0],
    trustedLimits[1],
  );
}

function parseText(
  value: string,
  trustedLimits = limits(),
): CommonCanonicalJsonParseResultInternalV0_4 {
  return parseBytes(bytes(value), trustedLimits);
}

function expectSourceBindingFailure(
  result: CommonCanonicalJsonParseResultInternalV0_4,
): void {
  expect(result).toEqual({
    valid: false,
    failureCode: "SOURCE_BINDING_INVALID",
    failureDetail: "source_bundle_invalid",
  });
  expect(Object.isFrozen(result)).toBe(true);
}

function expectResourceFailure(
  result: CommonCanonicalJsonParseResultInternalV0_4,
): void {
  expect(result).toEqual({
    valid: false,
    failureCode: "RESOURCE_LIMIT_EXCEEDED",
    failureDetail: "invocation_resource_limit_exceeded",
  });
  expect(Object.isFrozen(result)).toBe(true);
}

function canonicalObjectWithProperties(count: number): string {
  const properties: string[] = [];
  for (let index = 0; index < count; index += 1) {
    properties[properties.length] = `"k${String(index).padStart(5, "0")}":0`;
  }
  return `{${properties.join(",")}}`;
}

function canonicalArrayWithLength(count: number): string {
  return `[${new Array<string>(count).fill("0").join(",")}]`;
}

function nestedArray(depth: number): string {
  return `${"[".repeat(depth)}0${"]".repeat(depth)}`;
}

describe("Common suggestion evidence canonical JSON V0.4 internal parser", () => {
  describe("byte ownership and typed-array boundaries", () => {
    it("accepts a genuine Uint8Array and retains no caller-owned bytes", () => {
      const candidate = bytes('{"a":"original"}');
      const result = parseBytes(candidate);
      candidate.fill(0);

      expect(result.valid).toBe(true);
      if (!result.valid) {
        throw new Error("expected canonical input to succeed");
      }
      expect(result.value).toEqual({ a: "original" });
      expect(result.canonicalUtf8ByteLength).toBe(16);
    });

    it("accepts subclasses, Buffer, cross-realm, and nonzero-offset views", () => {
      class DerivedUint8Array extends Uint8Array {}
      const candidate = new DerivedUint8Array(bytes('{"a":1}'));
      expect(parseBytes(candidate).valid).toBe(true);

      const payload = bytes('{"offset":"owned"}');
      const backing = new Uint8Array(payload.byteLength + 8);
      backing.set(payload, 4);
      const offsetView = backing.subarray(4, 4 + payload.byteLength);
      const offsetResult = parseBytes(offsetView);
      backing.fill(0);
      expect(offsetResult.valid).toBe(true);
      if (!offsetResult.valid) {
        throw new Error("expected nonzero-offset input to succeed");
      }
      expect(offsetResult.value).toEqual({ offset: "owned" });

      const crossRealm = runInNewContext(
        `new Uint8Array([${Array.from(bytes('{"realm":1}')).join(",")}])`,
      ) as Uint8Array;
      expect(parseBytes(crossRealm).valid).toBe(true);

      const bufferConstructor = (
        globalThis as typeof globalThis & {
          Buffer?: { from(value: Uint8Array): Uint8Array };
        }
      ).Buffer;
      if (bufferConstructor !== undefined) {
        expect(parseBytes(bufferConstructor.from(bytes('{"buffer":1}'))).valid).toBe(
          true,
        );
      }
    });

    it("rejects every other view brand, spoof, proxy, and revoked proxy", () => {
      const candidates: unknown[] = [
        new Int8Array(8),
        new Uint8ClampedArray(8),
        new Int16Array(8),
        new Uint16Array(8),
        new Int32Array(8),
        new Uint32Array(8),
        new Float32Array(8),
        new Float64Array(8),
        new DataView(new ArrayBuffer(8)),
        Array.from(bytes('{"a":1}')),
        {
          [Symbol.toStringTag]: "Uint8Array",
          buffer: new ArrayBuffer(8),
          byteLength: 8,
          byteOffset: 0,
        },
        Object.create(Uint8Array.prototype),
        new Proxy(bytes('{"a":1}'), {}),
      ];
      const bigintGlobals = globalThis as typeof globalThis & {
        BigInt64Array?: new (length: number) => object;
        BigUint64Array?: new (length: number) => object;
      };
      if (bigintGlobals.BigInt64Array !== undefined) {
        candidates.push(new bigintGlobals.BigInt64Array(8));
      }
      if (bigintGlobals.BigUint64Array !== undefined) {
        candidates.push(new bigintGlobals.BigUint64Array(8));
      }

      const revoked = Proxy.revocable(bytes('{"a":1}'), {});
      revoked.revoke();
      candidates.push(revoked.proxy);

      for (const candidate of candidates) {
        expectSourceBindingFailure(parseBytes(candidate));
      }
    });

    it("rejects a detached ArrayBuffer view when transfer is available", () => {
      const clone = globalThis.structuredClone as
        | ((
            value: ArrayBuffer,
            options: { transfer: ArrayBuffer[] },
          ) => ArrayBuffer)
        | undefined;
      if (clone === undefined) {
        return;
      }

      const payload = bytes('{"a":1}');
      const buffer = new ArrayBuffer(payload.byteLength);
      const candidate = new Uint8Array(buffer);
      candidate.set(payload);
      clone(buffer, { transfer: [buffer] });

      expectSourceBindingFailure(
        parseBytes(candidate),
      );
    });

    it("rejects SharedArrayBuffer-backed input when available", () => {
      if (typeof SharedArrayBuffer === "undefined") {
        return;
      }

      const payload = bytes('{"a":1}');
      const buffer = new SharedArrayBuffer(payload.byteLength);
      const candidate = new Uint8Array(buffer);
      candidate.set(payload);

      expectSourceBindingFailure(
        parseBytes(candidate),
      );
    });

    it("rejects a resizable ArrayBuffer-backed view when available", () => {
      type ResizableArrayBuffer = ArrayBuffer & {
        readonly resizable?: boolean;
      };
      type ResizableArrayBufferConstructor = new (
        byteLength: number,
        options: { maxByteLength: number },
      ) => ResizableArrayBuffer;

      const payload = bytes('{"a":1}');
      let buffer: ResizableArrayBuffer;
      try {
        buffer = new (ArrayBuffer as unknown as ResizableArrayBufferConstructor)(
          payload.byteLength,
          { maxByteLength: payload.byteLength + 8 },
        );
      } catch {
        return;
      }
      if (buffer.resizable !== true) {
        return;
      }

      const candidate = new Uint8Array(buffer);
      candidate.set(payload);
      expectSourceBindingFailure(
        parseBytes(candidate),
      );
    });

    it("uses captured byte and JSON intrinsics after module import", () => {
      const originalSet = Uint8Array.prototype.set;
      const originalParse = JSON.parse;
      let result: CommonCanonicalJsonParseResultInternalV0_4 | undefined;

      try {
        Uint8Array.prototype.set = function tamperedSet(): void {
          throw new Error("mutated Uint8Array.prototype.set was invoked");
        };
        JSON.parse = function tamperedParse(): never {
          throw new Error("mutated JSON.parse was invoked");
        };
        result = parseText('{"a":1}');
      } finally {
        Uint8Array.prototype.set = originalSet;
        JSON.parse = originalParse;
      }

      expect(result?.valid).toBe(true);
    });
  });

  describe("UTF-8, BOM, grammar, and duplicate keys", () => {
    it("rejects a UTF-8 BOM and partial invalid BOM sequences", () => {
      const payload = bytes('{"a":1}');
      const withBom = new Uint8Array(payload.byteLength + 3);
      withBom.set([0xef, 0xbb, 0xbf]);
      withBom.set(payload, 3);

      expectSourceBindingFailure(
        parseBytes(withBom),
      );
      expectSourceBindingFailure(
        parseBytes(new Uint8Array([0xef])),
      );
      expectSourceBindingFailure(
        parseBytes(new Uint8Array([0xef, 0xbb])),
      );
    });

    it("rejects fatal UTF-8 decoding failures", () => {
      for (const candidate of [
        new Uint8Array([0xc0, 0xaf]),
        new Uint8Array([0xe2, 0x82]),
        new Uint8Array([0x80]),
        new Uint8Array([0xed, 0xa0, 0x80]),
      ]) {
        expectSourceBindingFailure(
          parseBytes(candidate),
        );
      }
    });

    it("rejects valid JSON whitespace and every final newline as noncanonical", () => {
      for (const candidate of [
        ' {"a":1}',
        '{"a":1} ',
        '{ "a":1}',
        '{"a" :1}',
        '{"a": 1}',
        '{"a":1}\n',
        '{"a":1}\r\n',
        '{"a":1}\t',
      ]) {
        expectSourceBindingFailure(parseText(candidate));
      }
    });

    it("rejects plain, escaped-equivalent, nested, and prototype-name duplicates", () => {
      for (const candidate of [
        '{"a":1,"a":2}',
        '{"a":1,"\\u0061":2}',
        '{"outer":{"a":1,"a":2}}',
        '{"__proto__":1,"\\u005f_proto__":2}',
      ]) {
        expectSourceBindingFailure(parseText(candidate));
      }
    });

    it("rejects malformed JSON grammar without repairing it", () => {
      for (const candidate of [
        "",
        "{",
        "[1,]",
        '{"a":}',
        '{"a" 1}',
        "01",
        "true false",
        '"\\uZZZZ"',
      ]) {
        expectSourceBindingFailure(parseText(candidate));
      }
    });
  });

  describe("trusted limits and resource boundaries", () => {
    it("accepts an exact document cap and rejects one byte over it", () => {
      const candidate = bytes('{"a":1}');

      expect(
        parseCommonCanonicalJsonBytesInternalV0_4(
          candidate,
          candidate.byteLength,
          candidate.byteLength,
        ).valid,
      ).toBe(true);
      expectResourceFailure(
        parseCommonCanonicalJsonBytesInternalV0_4(
          candidate,
          candidate.byteLength - 1,
          candidate.byteLength - 1,
        ),
      );
    });

    it("enforces exact string UTF-8 byte boundaries", () => {
      const candidate = '"é"';

      expect(parseText(candidate, limits(bytes(candidate).byteLength, 2)).valid).toBe(
        true,
      );
      expectResourceFailure(
        parseText(candidate, limits(bytes(candidate).byteLength, 1)),
      );
      expect(parseText('""', limits(2, 0)).valid).toBe(true);
    });

    it("uses root container depth one at the 32 and 33 boundaries", () => {
      expect(parseText(nestedArray(32)).valid).toBe(true);
      expectResourceFailure(parseText(nestedArray(33)));
    });

    it("keeps deep over-limit scans iterative and syntax-first", () => {
      const depth = 4_096;
      expectResourceFailure(parseText(nestedArray(depth)));
      expectSourceBindingFailure(
        parseText(`${"[".repeat(depth)}0${"]".repeat(depth - 1)}}`),
      );
    });

    it("enforces cumulative enumerable property boundaries", () => {
      const exact = canonicalObjectWithProperties(16_384);
      const over = canonicalObjectWithProperties(16_385);

      expect(
        parseText(exact, limits(bytes(exact).byteLength, 32)).valid,
      ).toBe(true);
      expectResourceFailure(
        parseText(over, limits(bytes(over).byteLength, 32)),
      );
    });

    it("detects late plain and escaped duplicates after property overflow", () => {
      const over = canonicalObjectWithProperties(16_385);
      const prefix = over.slice(0, -1);
      const plainDuplicate = `${prefix},"k00000":1}`;
      const escapedDuplicate = `${prefix},"\\u006b00000":1}`;

      expectSourceBindingFailure(
        parseText(plainDuplicate, limits(bytes(plainDuplicate).byteLength, 32)),
      );
      expectSourceBindingFailure(
        parseText(
          escapedDuplicate,
          limits(bytes(escapedDuplicate).byteLength, 32),
        ),
      );
    });

    it("enforces array length boundaries", () => {
      const exact = canonicalArrayWithLength(1_024);
      const over = canonicalArrayWithLength(1_025);

      expect(
        parseText(exact, limits(bytes(exact).byteLength, 1)).valid,
      ).toBe(true);
      expectResourceFailure(
        parseText(over, limits(bytes(over).byteLength, 1)),
      );
    });

    it("keeps malformed suffixes ahead of array and string cap failures", () => {
      const arrayOver = canonicalArrayWithLength(1_025);
      const malformedArray = `${arrayOver.slice(0, -1)},]`;
      const malformedString = `"${"a".repeat(1_025)}"x`;

      expectSourceBindingFailure(
        parseText(malformedArray, limits(bytes(malformedArray).byteLength, 1)),
      );
      expectSourceBindingFailure(
        parseText(
          malformedString,
          limits(bytes(malformedString).byteLength, 1_024),
        ),
      );
    });

    it("rejects invalid primitive limits before candidate inspection", () => {
      const revoked = Proxy.revocable(bytes("0"), {});
      revoked.revoke();
      const invalidLimits: readonly (readonly [number, number])[] = [
        [-1, 0],
        [-0, 0],
        [Number.NaN, 0],
        [Number.POSITIVE_INFINITY, 0],
        [1.5, 0],
        [10, -1],
        [10, 11],
        [5_242_881, 1],
      ];

      for (const [maximumDocumentBytes, maximumStringBytes] of invalidLimits) {
        expectResourceFailure(
          parseCommonCanonicalJsonBytesInternalV0_4(
            revoked.proxy,
            maximumDocumentBytes,
            maximumStringBytes,
          ),
        );
      }
      expectResourceFailure(
        parseCommonCanonicalJsonBytesInternalV0_4(
          bytes("0"),
          "10" as unknown as number,
          1,
        ),
      );
    });
  });

  describe("Unicode, numbers, and exact JCS bytes", () => {
    it("accepts Unicode scalar pairs and rejects lone escaped surrogates", () => {
      expect(parseText('{"emoji":"😀"}').valid).toBe(true);
      expectSourceBindingFailure(parseText('{"emoji":"\\ud83d"}'));
      expectSourceBindingFailure(parseText('{"emoji":"\\ude00"}'));
      expectSourceBindingFailure(parseText('{"\\ud83d":1}'));
    });

    it("rejects negative zero, unsafe integers, and non-finite parse results", () => {
      for (const candidate of [
        "-0",
        "-0.0",
        "-0e0",
        "9007199254740992",
        "-9007199254740992",
        "1e400",
      ]) {
        expectSourceBindingFailure(parseText(candidate));
      }
    });

    it("accepts canonical fractions and rejects noncanonical number spellings", () => {
      expect(parseText("1.5").valid).toBe(true);
      expect(parseText("0").valid).toBe(true);
      expectSourceBindingFailure(parseText("1.0"));
      expectSourceBindingFailure(parseText("1e0"));
    });

    it("enforces canonical key order and canonical string escaping", () => {
      expect(parseText('{"a":1,"b":2}').valid).toBe(true);
      expect(parseText('{"😀":1,"":2}').valid).toBe(true);
      expect(parseText('{"a":"\\n"}').valid).toBe(true);
      expectSourceBindingFailure(parseText('{"b":2,"a":1}'));
      expectSourceBindingFailure(parseText('{"":2,"😀":1}'));
      expectSourceBindingFailure(parseText('{"\\u0061":1}'));
      expectSourceBindingFailure(parseText('{"a":"\\/"}'));
      expectSourceBindingFailure(parseText('{"emoji":"\\ud83d\\ude00"}'));
    });

    it("rejects a one-byte mutation of otherwise canonical JCS", () => {
      const candidate = bytes('{"a":1}');
      candidate[candidate.byteLength - 1] = 0x5d;
      expectSourceBindingFailure(
        parseBytes(candidate),
      );
    });

    it("keeps prototype-named keys as inert own data", () => {
      const result = parseText('{"__proto__":{"polluted":true}}');

      expect(result.valid).toBe(true);
      if (!result.valid || typeof result.value !== "object" || result.value === null) {
        throw new Error("expected a parsed object");
      }
      expect(Object.prototype.hasOwnProperty.call(result.value, "__proto__")).toBe(
        true,
      );
      expect(
        ({} as { polluted?: boolean }).polluted,
      ).toBeUndefined();
    });
  });

  describe("frozen results, precedence, and replay", () => {
    it("deep-freezes every accepted container and the success result", () => {
      const result = parseText('{"a":[{"b":"c"}]}');

      expect(result.valid).toBe(true);
      if (!result.valid) {
        throw new Error("expected canonical input to succeed");
      }
      const root = result.value as Readonly<{
        a: readonly Readonly<{ b: string }>[];
      }>;
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(root)).toBe(true);
      expect(Object.isFrozen(root.a)).toBe(true);
      expect(Object.isFrozen(root.a[0])).toBe(true);
    });

    it("returns deterministic independent success graphs", () => {
      const first = parseText('{"a":[1,2]}');
      const second = parseText('{"a":[1,2]}');

      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      if (!first.valid || !second.valid) {
        throw new Error("expected canonical inputs to succeed");
      }
      expect(first.value).not.toBe(second.value);
    });

    it("reuses frozen closed failure singletons", () => {
      const firstSourceFailure = parseText("{");
      const secondSourceFailure = parseText("{");
      const oversized = bytes('{"a":1}');
      const firstResourceFailure =
        parseCommonCanonicalJsonBytesInternalV0_4(
          oversized,
          oversized.byteLength - 1,
          oversized.byteLength - 1,
        );
      const secondResourceFailure =
        parseCommonCanonicalJsonBytesInternalV0_4(
          oversized,
          oversized.byteLength - 1,
          oversized.byteLength - 1,
        );

      expect(firstSourceFailure).toBe(secondSourceFailure);
      expect(firstResourceFailure).toBe(secondResourceFailure);
      expectSourceBindingFailure(firstSourceFailure);
      expectResourceFailure(firstResourceFailure);
    });

    it("gives syntax and duplicate rejection precedence over scanned caps", () => {
      expectSourceBindingFailure(
        parseText('{"a":1,"a":2}', limits(100, 0)),
      );
      expectSourceBindingFailure(
        parseText(`${"[".repeat(33)}}`, limits(100, 1)),
      );
    });

    it("gives the raw document cap precedence before syntax", () => {
      expectResourceFailure(parseText("{", limits(0, 0)));
    });

    it("ignores post-import Object and Array prototype pollution", () => {
      const objectKey = "__commonCanonicalEnumerableTrapV0_4__";
      const arrayKey = "__commonCanonicalHiddenTrapV0_4__";
      const objectDescriptor = Object.getOwnPropertyDescriptor(
        Object.prototype,
        objectKey,
      );
      const arrayDescriptor = Object.getOwnPropertyDescriptor(
        Array.prototype,
        arrayKey,
      );
      const iteratorDescriptor = Object.getOwnPropertyDescriptor(
        Object.prototype,
        Symbol.iterator,
      );
      let result: CommonCanonicalJsonParseResultInternalV0_4 | undefined;

      try {
        Object.defineProperty(Object.prototype, objectKey, {
          configurable: true,
          enumerable: true,
          get(): never {
            throw new Error("inherited Object getter was invoked");
          },
        });
        Object.defineProperty(Array.prototype, arrayKey, {
          configurable: true,
          enumerable: false,
          get(): never {
            throw new Error("inherited Array getter was invoked");
          },
        });
        Object.defineProperty(Object.prototype, Symbol.iterator, {
          configurable: true,
          enumerable: false,
          get(): never {
            throw new Error("inherited iterator was invoked");
          },
        });
        result = parseText('{"a":[{"b":1}]}');
      } finally {
        if (objectDescriptor === undefined) {
          Reflect.deleteProperty(Object.prototype, objectKey);
        } else {
          Object.defineProperty(Object.prototype, objectKey, objectDescriptor);
        }
        if (arrayDescriptor === undefined) {
          Reflect.deleteProperty(Array.prototype, arrayKey);
        } else {
          Object.defineProperty(Array.prototype, arrayKey, arrayDescriptor);
        }
        if (iteratorDescriptor === undefined) {
          Reflect.deleteProperty(Object.prototype, Symbol.iterator);
        } else {
          Object.defineProperty(
            Object.prototype,
            Symbol.iterator,
            iteratorDescriptor,
          );
        }
      }

      expect(result?.valid).toBe(true);
    });
  });
});
