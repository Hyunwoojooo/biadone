import {
  canonicalizeCommonSuggestionEvidenceGraphInternalV0_4,
  createCommonSuggestionEvidenceParentValidatedGraphHandleFromTrustedParentInternalV0_4,
} from "./commonSuggestionEvidenceJcsV0_4.internal";

const safeReflectApply = Reflect.apply;
const safeObjectDefineProperty = Object.defineProperty;
const safeObjectFreeze = Object.freeze;
const safeObjectGetPrototypeOf = Object.getPrototypeOf;
const safeObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const safeObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const safeObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const safeObjectHasOwnProperty = Object.prototype.hasOwnProperty;
const safeObjectIs = Object.is;
const safeArrayIsArray = Array.isArray;
const safeNumberIsFinite = Number.isFinite;
const safeNumberIsInteger = Number.isInteger;
const safeNumberIsSafeInteger = Number.isSafeInteger;
const safeJsonParse = JSON.parse;
const safeStringCharCodeAt = String.prototype.charCodeAt;
const safeStringSlice = String.prototype.slice;
const SafeString = String;
const SafeSet = Set;
const safeSetHas = Set.prototype.has;
const safeSetAdd = Set.prototype.add;
const SafeUint8Array = Uint8Array;
const SafeUint32Array = Uint32Array;
const safeUint8ArraySet = Uint8Array.prototype.set;
const SafeTextDecoder = TextDecoder;
const safeTextDecoderDecode = TextDecoder.prototype.decode;
const SafeTextEncoder = TextEncoder;
const safeTextEncoderEncode = TextEncoder.prototype.encode;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicArrayPrototype = Array.prototype;

const intrinsicTypedArrayPrototype = safeObjectGetPrototypeOf(
  SafeUint8Array.prototype,
);
const intrinsicTypedArrayTagGetter = safeObjectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  Symbol.toStringTag,
)?.get as ((this: object) => string | undefined) | undefined;
const intrinsicUint8ArrayBufferGetter = safeObjectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "buffer",
)?.get as (this: Uint8Array) => ArrayBufferLike;
const intrinsicUint8ArrayByteLengthGetter = safeObjectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteLength",
)?.get as (this: Uint8Array) => number;
const intrinsicUint8ArrayByteOffsetGetter = safeObjectGetOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteOffset",
)?.get as (this: Uint8Array) => number;
const intrinsicArrayBufferByteLengthGetter = safeObjectGetOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get as (this: ArrayBuffer) => number;
const intrinsicArrayBufferResizableGetter = safeObjectGetOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get as ((this: ArrayBuffer) => boolean) | undefined;

const intrinsicFatalUtf8Decoder = new SafeTextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});
const intrinsicUtf8Encoder = new SafeTextEncoder();

const COMMON_MAXIMUM_GRAPH_DEPTH_V0_4 = 32;
const COMMON_MAXIMUM_ENUMERABLE_OWN_PROPERTIES_V0_4 = 16_384;
const COMMON_MAXIMUM_ARRAY_LENGTH_V0_4 = 1_024;
const COMMON_MAXIMUM_CUMULATIVE_PRIVATE_UTF8_BYTES_V0_4 = 5_242_880;

export type ExactJsonObjectV0_4 = Readonly<{
  readonly [key: string]: ExactJsonValueV0_4;
}>;

export type ExactJsonValueV0_4 =
  | null
  | boolean
  | number
  | string
  | readonly ExactJsonValueV0_4[]
  | ExactJsonObjectV0_4;

export type CommonCanonicalJsonParseFailureInternalV0_4 =
  | Readonly<{
      valid: false;
      failureCode: "RESOURCE_LIMIT_EXCEEDED";
      failureDetail: "invocation_resource_limit_exceeded";
    }>
  | Readonly<{
      valid: false;
      failureCode: "SOURCE_BINDING_INVALID";
      failureDetail: "source_bundle_invalid";
    }>;

export type CommonCanonicalJsonParseResultInternalV0_4 =
  | Readonly<{
      valid: true;
      value: ExactJsonValueV0_4;
      canonicalUtf8ByteLength: number;
    }>
  | CommonCanonicalJsonParseFailureInternalV0_4;

const RESOURCE_LIMIT_FAILURE = safeObjectFreeze({
  valid: false,
  failureCode: "RESOURCE_LIMIT_EXCEEDED",
  failureDetail: "invocation_resource_limit_exceeded",
} as const satisfies CommonCanonicalJsonParseFailureInternalV0_4);

const SOURCE_BINDING_FAILURE = safeObjectFreeze({
  valid: false,
  failureCode: "SOURCE_BINDING_INVALID",
  failureDetail: "source_bundle_invalid",
} as const satisfies CommonCanonicalJsonParseFailureInternalV0_4);

type ValidatedLimits = Readonly<{
  maximumCanonicalUtf8Bytes: number;
  maximumStringUtf8Bytes: number;
}>;

type OwnedCandidateBytes = Readonly<{
  bytes: Uint8Array;
  byteLength: number;
}>;

type ScanResult = Readonly<{
  syntaxValid: boolean;
  duplicateKeyDetected: boolean;
  resourceLimitExceeded: boolean;
}>;

const FRAME_KIND_ROOT = 0;
const FRAME_KIND_ARRAY = 1;
const FRAME_KIND_OBJECT = 2;

const ROOT_STATE_VALUE = 0;
const ROOT_STATE_DONE = 1;

const ARRAY_STATE_VALUE_OR_END = 0;
const ARRAY_STATE_VALUE = 1;
const ARRAY_STATE_COMMA_OR_END = 2;

const OBJECT_STATE_KEY_OR_END = 0;
const OBJECT_STATE_KEY = 1;
const OBJECT_STATE_COLON = 2;
const OBJECT_STATE_VALUE = 3;
const OBJECT_STATE_COMMA_OR_END = 4;

const STRING_SCAN_NEXT_OFFSET = 0;
const STRING_SCAN_UTF8_BYTE_LENGTH = 1;

type GraphEntry = Readonly<{
  value: unknown;
  containerDepth: number;
}>;

type GraphValidationResult =
  | Readonly<{
      status: "valid";
      nodesToFreeze: object[];
    }>
  | Readonly<{
      status: "source_invalid";
    }>
  | Readonly<{
      status: "resource_exceeded";
    }>;

function hasOwnDataValue(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
  return (
    descriptor !== undefined &&
    safeReflectApply(safeObjectHasOwnProperty, descriptor, ["value"])
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    safeNumberIsFinite(value) &&
    safeNumberIsSafeInteger(value) &&
    value >= 0 &&
    !safeObjectIs(value, -0)
  );
}

function validateTrustedLimits(
  maximumCanonicalUtf8Bytes: number,
  maximumStringUtf8Bytes: number,
): ValidatedLimits | null {
  if (
    !isNonNegativeSafeInteger(maximumCanonicalUtf8Bytes) ||
    !isNonNegativeSafeInteger(maximumStringUtf8Bytes) ||
    maximumStringUtf8Bytes > maximumCanonicalUtf8Bytes ||
    maximumCanonicalUtf8Bytes >
      COMMON_MAXIMUM_CUMULATIVE_PRIVATE_UTF8_BYTES_V0_4
  ) {
    return null;
  }

  return safeObjectFreeze({
    maximumCanonicalUtf8Bytes,
    maximumStringUtf8Bytes,
  });
}

function snapshotCandidateBytes(
  candidate: unknown,
  maximumCanonicalUtf8Bytes: number,
): OwnedCandidateBytes | "resource_exceeded" | "source_invalid" {
  if (typeof candidate !== "object" || candidate === null) {
    return "source_invalid";
  }

  try {
    if (
      intrinsicTypedArrayTagGetter === undefined ||
      safeReflectApply(intrinsicTypedArrayTagGetter, candidate, []) !==
        "Uint8Array"
    ) {
      return "source_invalid";
    }

    const buffer = safeReflectApply(
      intrinsicUint8ArrayBufferGetter,
      candidate,
      [],
    ) as ArrayBuffer;
    const byteLength = safeReflectApply(
      intrinsicUint8ArrayByteLengthGetter,
      candidate,
      [],
    ) as number;
    const byteOffset = safeReflectApply(
      intrinsicUint8ArrayByteOffsetGetter,
      candidate,
      [],
    ) as number;
    const bufferByteLength = safeReflectApply(
      intrinsicArrayBufferByteLengthGetter,
      buffer,
      [],
    ) as number;

    if (
      !isNonNegativeSafeInteger(byteLength) ||
      !isNonNegativeSafeInteger(byteOffset) ||
      !isNonNegativeSafeInteger(bufferByteLength) ||
      byteOffset + byteLength > bufferByteLength
    ) {
      return "source_invalid";
    }

    if (
      intrinsicArrayBufferResizableGetter !== undefined &&
      safeReflectApply(intrinsicArrayBufferResizableGetter, buffer, []) === true
    ) {
      return "source_invalid";
    }

    if (byteLength > maximumCanonicalUtf8Bytes) {
      return "resource_exceeded";
    }

    const owned = new SafeUint8Array(byteLength);
    safeReflectApply(safeUint8ArraySet, owned, [candidate]);
    return { bytes: owned, byteLength };
  } catch {
    return "source_invalid";
  }
}

function utf8ByteLength(value: string): number | null {
  try {
    const encoded = safeReflectApply(
      safeTextEncoderEncode,
      intrinsicUtf8Encoder,
      [value],
    ) as Uint8Array;
    return safeReflectApply(
      intrinsicUint8ArrayByteLengthGetter,
      encoded,
      [],
    ) as number;
  } catch {
    return null;
  }
}

function charCodeAt(value: string, offset: number): number {
  return safeReflectApply(safeStringCharCodeAt, value, [offset]) as number;
}

function slice(value: string, start: number, end?: number): string {
  return safeReflectApply(safeStringSlice, value, [start, end]) as string;
}

function isJsonWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isDecimalDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isNonZeroDecimalDigit(code: number): boolean {
  return code >= 0x31 && code <= 0x39;
}

function isHexDigit(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
}

function skipJsonWhitespace(value: string, start: number): number {
  let offset = start;
  while (offset < value.length && isJsonWhitespace(charCodeAt(value, offset))) {
    offset += 1;
  }
  return offset;
}

function appendDecodedCodeUnitUtf8Length(
  encodedLength: number,
  codeUnit: number,
): number {
  let byteLength = encodedLength;
  if (byteLength < 0) {
    byteLength = -byteLength - 1;
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return byteLength + 4;
    }
    byteLength += 3;
  }

  if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
    return -byteLength - 1;
  }
  if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
    return byteLength + 3;
  }
  if (codeUnit <= 0x7f) {
    return byteLength + 1;
  }
  if (codeUnit <= 0x7ff) {
    return byteLength + 2;
  }
  return byteLength + 3;
}

function finishDecodedUtf8Length(encodedLength: number): number {
  return encodedLength < 0 ? -encodedLength - 1 + 3 : encodedLength;
}

function hexDigitValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}

function scanJsonString(
  value: string,
  start: number,
  scratch: Uint32Array,
): boolean {
  let offset = start + 1;
  let encodedUtf8ByteLength = 0;
  while (offset < value.length) {
    const code = charCodeAt(value, offset);
    if (code === 0x22) {
      scratch[STRING_SCAN_NEXT_OFFSET] = offset + 1;
      scratch[STRING_SCAN_UTF8_BYTE_LENGTH] = finishDecodedUtf8Length(
        encodedUtf8ByteLength,
      );
      return true;
    }

    if (code < 0x20) {
      return false;
    }

    if (code !== 0x5c) {
      encodedUtf8ByteLength = appendDecodedCodeUnitUtf8Length(
        encodedUtf8ByteLength,
        code,
      );
      offset += 1;
      continue;
    }

    if (offset + 1 >= value.length) {
      return false;
    }

    const escaped = charCodeAt(value, offset + 1);
    let decodedCodeUnit = -1;
    if (escaped === 0x22 || escaped === 0x5c || escaped === 0x2f) {
      decodedCodeUnit = escaped;
    } else if (escaped === 0x62) {
      decodedCodeUnit = 0x08;
    } else if (escaped === 0x66) {
      decodedCodeUnit = 0x0c;
    } else if (escaped === 0x6e) {
      decodedCodeUnit = 0x0a;
    } else if (escaped === 0x72) {
      decodedCodeUnit = 0x0d;
    } else if (escaped === 0x74) {
      decodedCodeUnit = 0x09;
    }

    if (decodedCodeUnit >= 0) {
      encodedUtf8ByteLength = appendDecodedCodeUnitUtf8Length(
        encodedUtf8ByteLength,
        decodedCodeUnit,
      );
      offset += 2;
      continue;
    }

    if (escaped !== 0x75 || offset + 5 >= value.length) {
      return false;
    }
    decodedCodeUnit = 0;
    for (let index = 2; index <= 5; index += 1) {
      const digit = hexDigitValue(charCodeAt(value, offset + index));
      if (digit < 0) {
        return false;
      }
      decodedCodeUnit = decodedCodeUnit * 16 + digit;
    }
    encodedUtf8ByteLength = appendDecodedCodeUnitUtf8Length(
      encodedUtf8ByteLength,
      decodedCodeUnit,
    );
    offset += 6;
  }

  return false;
}

function scanJsonNumber(value: string, start: number): number | null {
  let offset = start;
  if (charCodeAt(value, offset) === 0x2d) {
    offset += 1;
  }
  if (offset >= value.length) {
    return null;
  }

  const first = charCodeAt(value, offset);
  if (first === 0x30) {
    offset += 1;
    if (offset < value.length && isDecimalDigit(charCodeAt(value, offset))) {
      return null;
    }
  } else if (isNonZeroDecimalDigit(first)) {
    offset += 1;
    while (offset < value.length && isDecimalDigit(charCodeAt(value, offset))) {
      offset += 1;
    }
  } else {
    return null;
  }

  if (offset < value.length && charCodeAt(value, offset) === 0x2e) {
    offset += 1;
    if (offset >= value.length || !isDecimalDigit(charCodeAt(value, offset))) {
      return null;
    }
    while (offset < value.length && isDecimalDigit(charCodeAt(value, offset))) {
      offset += 1;
    }
  }

  if (offset < value.length) {
    const exponent = charCodeAt(value, offset);
    if (exponent === 0x65 || exponent === 0x45) {
      offset += 1;
      if (offset < value.length) {
        const sign = charCodeAt(value, offset);
        if (sign === 0x2b || sign === 0x2d) {
          offset += 1;
        }
      }
      if (offset >= value.length || !isDecimalDigit(charCodeAt(value, offset))) {
        return null;
      }
      while (
        offset < value.length &&
        isDecimalDigit(charCodeAt(value, offset))
      ) {
        offset += 1;
      }
    }
  }

  return offset;
}

function nextDecodedStringCodeUnit(value: string, offset: number): number {
  const code = charCodeAt(value, offset);
  if (code !== 0x5c) {
    return (offset + 1) * 65_536 + code;
  }

  const escaped = charCodeAt(value, offset + 1);
  let decodedCodeUnit: number;
  if (escaped === 0x22 || escaped === 0x5c || escaped === 0x2f) {
    decodedCodeUnit = escaped;
  } else if (escaped === 0x62) {
    decodedCodeUnit = 0x08;
  } else if (escaped === 0x66) {
    decodedCodeUnit = 0x0c;
  } else if (escaped === 0x6e) {
    decodedCodeUnit = 0x0a;
  } else if (escaped === 0x72) {
    decodedCodeUnit = 0x0d;
  } else if (escaped === 0x74) {
    decodedCodeUnit = 0x09;
  } else {
    decodedCodeUnit = 0;
    for (let index = 2; index <= 5; index += 1) {
      decodedCodeUnit =
        decodedCodeUnit * 16 +
        hexDigitValue(charCodeAt(value, offset + index));
    }
    return (offset + 6) * 65_536 + decodedCodeUnit;
  }
  return (offset + 2) * 65_536 + decodedCodeUnit;
}

function compareDecodedStringTokens(
  value: string,
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): number {
  let leftOffset = leftStart + 1;
  let rightOffset = rightStart + 1;
  const leftLimit = leftEnd - 1;
  const rightLimit = rightEnd - 1;

  while (leftOffset < leftLimit && rightOffset < rightLimit) {
    const leftPacked = nextDecodedStringCodeUnit(value, leftOffset);
    const rightPacked = nextDecodedStringCodeUnit(value, rightOffset);
    const leftCodeUnit = leftPacked % 65_536;
    const rightCodeUnit = rightPacked % 65_536;
    if (leftCodeUnit !== rightCodeUnit) {
      return leftCodeUnit < rightCodeUnit ? -1 : 1;
    }
    leftOffset = (leftPacked - leftCodeUnit) / 65_536;
    rightOffset = (rightPacked - rightCodeUnit) / 65_536;
  }

  if (leftOffset === leftLimit && rightOffset === rightLimit) return 0;
  return leftOffset === leftLimit ? -1 : 1;
}

function compareKeyLedgerEntries(
  value: string,
  objectIds: Uint32Array,
  starts: Uint32Array,
  ends: Uint32Array,
  leftIndex: number,
  rightIndex: number,
): number {
  const leftObjectId = objectIds[leftIndex];
  const rightObjectId = objectIds[rightIndex];
  if (leftObjectId !== rightObjectId) {
    return leftObjectId < rightObjectId ? -1 : 1;
  }
  const decodedComparison = compareDecodedStringTokens(
    value,
    starts[leftIndex],
    ends[leftIndex],
    starts[rightIndex],
    ends[rightIndex],
  );
  if (decodedComparison !== 0) return decodedComparison;
  if (leftIndex === rightIndex) return 0;
  return leftIndex < rightIndex ? -1 : 1;
}

function keyLedgerHasDuplicate(
  value: string,
  objectIds: Uint32Array,
  starts: Uint32Array,
  ends: Uint32Array,
  keyCount: number,
): boolean {
  if (keyCount < 2) return false;

  let source = new SafeUint32Array(keyCount);
  let target = new SafeUint32Array(keyCount);
  for (let index = 0; index < keyCount; index += 1) {
    source[index] = index;
  }

  for (let width = 1; width < keyCount; width *= 2) {
    for (let start = 0; start < keyCount; start += width * 2) {
      const proposedMiddle = start + width;
      const proposedEnd = proposedMiddle + width;
      const middle = proposedMiddle < keyCount ? proposedMiddle : keyCount;
      const end = proposedEnd < keyCount ? proposedEnd : keyCount;
      let left = start;
      let right = middle;
      let write = start;

      while (left < middle || right < end) {
        if (
          right >= end ||
          (left < middle &&
            compareKeyLedgerEntries(
              value,
              objectIds,
              starts,
              ends,
              source[left],
              source[right],
            ) <= 0)
        ) {
          target[write] = source[left];
          left += 1;
        } else {
          target[write] = source[right];
          right += 1;
        }
        write += 1;
      }
    }
    const previousSource = source;
    source = target;
    target = previousSource;
  }

  for (let index = 1; index < keyCount; index += 1) {
    const previous = source[index - 1];
    const current = source[index];
    if (
      objectIds[previous] === objectIds[current] &&
      compareDecodedStringTokens(
        value,
        starts[previous],
        ends[previous],
        starts[current],
        ends[current],
      ) === 0
    ) {
      return true;
    }
  }
  return false;
}

function scanJsonDocument(
  value: string,
  rawByteLength: number,
  maximumStringUtf8Bytes: number,
): ScanResult {
  const frameCapacity = rawByteLength + 1;
  const frameKinds = new SafeUint8Array(frameCapacity);
  const frameStates = new SafeUint8Array(frameCapacity);
  const frameValues = new SafeUint32Array(frameCapacity);
  const keyCapacity = (rawByteLength >>> 2) + 1;
  const keyObjectIds = new SafeUint32Array(keyCapacity);
  const keyStarts = new SafeUint32Array(keyCapacity);
  const keyEnds = new SafeUint32Array(keyCapacity);
  const stringScratch = new SafeUint32Array(2);

  frameKinds[0] = FRAME_KIND_ROOT;
  frameStates[0] = ROOT_STATE_VALUE;
  let stackSize = 1;
  let offset = 0;
  let nextObjectId = 0;
  let keyCount = 0;
  let enumerableOwnPropertyCount = 0;
  let resourceLimitExceeded = false;

  const finishScan = (syntaxValid: boolean): ScanResult => {
    const duplicateKeyDetected =
      syntaxValid &&
      keyLedgerHasDuplicate(
        value,
        keyObjectIds,
        keyStarts,
        keyEnds,
        keyCount,
      );
    return {
      syntaxValid,
      duplicateKeyDetected,
      resourceLimitExceeded,
    };
  };

  const scanStringAtOffset = (): boolean => {
    if (!scanJsonString(value, offset, stringScratch)) {
      return false;
    }
    if (
      stringScratch[STRING_SCAN_UTF8_BYTE_LENGTH] > maximumStringUtf8Bytes
    ) {
      resourceLimitExceeded = true;
    }
    return true;
  };

  const completeValue = (): boolean => {
    const parentIndex = stackSize - 1;
    const parentKind = frameKinds[parentIndex];
    const parentState = frameStates[parentIndex];
    if (parentKind === FRAME_KIND_ROOT && parentState === ROOT_STATE_VALUE) {
      frameStates[parentIndex] = ROOT_STATE_DONE;
      return true;
    }
    if (
      parentKind === FRAME_KIND_OBJECT &&
      parentState === OBJECT_STATE_VALUE
    ) {
      frameStates[parentIndex] = OBJECT_STATE_COMMA_OR_END;
      return true;
    }
    if (
      parentKind === FRAME_KIND_ARRAY &&
      (parentState === ARRAY_STATE_VALUE ||
        parentState === ARRAY_STATE_VALUE_OR_END)
    ) {
      const elementCount = frameValues[parentIndex] + 1;
      frameValues[parentIndex] = elementCount;
      enumerableOwnPropertyCount += 1;
      if (
        elementCount > COMMON_MAXIMUM_ARRAY_LENGTH_V0_4 ||
        enumerableOwnPropertyCount >
          COMMON_MAXIMUM_ENUMERABLE_OWN_PROPERTIES_V0_4
      ) {
        resourceLimitExceeded = true;
      }
      frameStates[parentIndex] = ARRAY_STATE_COMMA_OR_END;
      return true;
    }
    return false;
  };

  const beginValue = (): boolean => {
    if (offset >= value.length) {
      return false;
    }
    const code = charCodeAt(value, offset);
    if (code === 0x7b || code === 0x5b) {
      const containerDepth = stackSize;
      if (containerDepth > COMMON_MAXIMUM_GRAPH_DEPTH_V0_4) {
        resourceLimitExceeded = true;
      }
      if (stackSize >= frameCapacity) {
        return false;
      }
      offset += 1;
      if (code === 0x7b) {
        nextObjectId += 1;
        frameKinds[stackSize] = FRAME_KIND_OBJECT;
        frameStates[stackSize] = OBJECT_STATE_KEY_OR_END;
        frameValues[stackSize] = nextObjectId;
      } else {
        frameKinds[stackSize] = FRAME_KIND_ARRAY;
        frameStates[stackSize] = ARRAY_STATE_VALUE_OR_END;
        frameValues[stackSize] = 0;
      }
      stackSize += 1;
      return true;
    }

    if (code === 0x22) {
      if (!scanStringAtOffset()) {
        return false;
      }
      offset = stringScratch[STRING_SCAN_NEXT_OFFSET];
      return completeValue();
    }

    const literalLength =
      slice(value, offset, offset + 4) === "true" ||
      slice(value, offset, offset + 4) === "null"
        ? 4
        : slice(value, offset, offset + 5) === "false"
          ? 5
          : 0;
    if (literalLength > 0) {
      offset += literalLength;
      return completeValue();
    }

    if (code === 0x2d || isDecimalDigit(code)) {
      const nextOffset = scanJsonNumber(value, offset);
      if (nextOffset === null) {
        return false;
      }
      offset = nextOffset;
      return completeValue();
    }

    return false;
  };

  while (stackSize > 0) {
    offset = skipJsonWhitespace(value, offset);
    const frameIndex = stackSize - 1;
    const frameKind = frameKinds[frameIndex];
    const frameState = frameStates[frameIndex];

    if (frameKind === FRAME_KIND_ROOT) {
      if (frameState === ROOT_STATE_VALUE) {
        if (!beginValue()) {
          return finishScan(false);
        }
        continue;
      }
      return finishScan(offset === value.length);
    }

    if (frameKind === FRAME_KIND_ARRAY) {
      if (
        frameState === ARRAY_STATE_VALUE_OR_END ||
        frameState === ARRAY_STATE_VALUE
      ) {
        if (
          frameState === ARRAY_STATE_VALUE_OR_END &&
          offset < value.length &&
          charCodeAt(value, offset) === 0x5d
        ) {
          offset += 1;
          stackSize -= 1;
          if (!completeValue()) {
            return finishScan(false);
          }
          continue;
        }
        if (!beginValue()) {
          return finishScan(false);
        }
        continue;
      }

      const code = offset < value.length ? charCodeAt(value, offset) : -1;
      if (code === 0x2c) {
        offset += 1;
        frameStates[frameIndex] = ARRAY_STATE_VALUE;
        continue;
      }
      if (code === 0x5d) {
        offset += 1;
        stackSize -= 1;
        if (!completeValue()) {
          return finishScan(false);
        }
        continue;
      }
      return finishScan(false);
    }

    if (
      frameState === OBJECT_STATE_KEY_OR_END ||
      frameState === OBJECT_STATE_KEY
    ) {
      if (
        frameState === OBJECT_STATE_KEY_OR_END &&
        offset < value.length &&
        charCodeAt(value, offset) === 0x7d
      ) {
        offset += 1;
        stackSize -= 1;
        if (!completeValue()) {
          return finishScan(false);
        }
        continue;
      }
      if (offset >= value.length || charCodeAt(value, offset) !== 0x22) {
        return finishScan(false);
      }
      const keyStart = offset;
      if (!scanStringAtOffset()) {
        return finishScan(false);
      }
      if (keyCount >= keyCapacity) {
        return finishScan(false);
      }
      keyObjectIds[keyCount] = frameValues[frameIndex];
      keyStarts[keyCount] = keyStart;
      keyEnds[keyCount] = stringScratch[STRING_SCAN_NEXT_OFFSET];
      keyCount += 1;
      enumerableOwnPropertyCount += 1;
      if (
        enumerableOwnPropertyCount >
        COMMON_MAXIMUM_ENUMERABLE_OWN_PROPERTIES_V0_4
      ) {
        resourceLimitExceeded = true;
      }
      offset = stringScratch[STRING_SCAN_NEXT_OFFSET];
      frameStates[frameIndex] = OBJECT_STATE_COLON;
      continue;
    }

    if (frameState === OBJECT_STATE_COLON) {
      if (offset >= value.length || charCodeAt(value, offset) !== 0x3a) {
        return finishScan(false);
      }
      offset += 1;
      frameStates[frameIndex] = OBJECT_STATE_VALUE;
      continue;
    }

    if (frameState === OBJECT_STATE_VALUE) {
      if (!beginValue()) {
        return finishScan(false);
      }
      continue;
    }

    const code = offset < value.length ? charCodeAt(value, offset) : -1;
    if (code === 0x2c) {
      offset += 1;
      frameStates[frameIndex] = OBJECT_STATE_KEY;
      continue;
    }
    if (code === 0x7d) {
      offset += 1;
      stackSize -= 1;
      if (!completeValue()) {
        return finishScan(false);
      }
      continue;
    }
    return finishScan(false);
  }

  return finishScan(false);
}

function isUnicodeScalarString(value: string): boolean {
  let offset = 0;
  while (offset < value.length) {
    const code = charCodeAt(value, offset);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (offset + 1 >= value.length) {
        return false;
      }
      const low = charCodeAt(value, offset + 1);
      if (low < 0xdc00 || low > 0xdfff) {
        return false;
      }
      offset += 2;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
    offset += 1;
  }
  return true;
}

function appendOwnArrayValue<T>(target: T[], value: T): void {
  safeObjectDefineProperty(target, SafeString(target.length), {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function validateExactJsonGraph(
  root: unknown,
  limits: ValidatedLimits,
): GraphValidationResult {
  const pending: GraphEntry[] = [];
  appendOwnArrayValue(pending, {
    value: root,
    containerDepth: typeof root === "object" && root !== null ? 1 : 0,
  });
  const nodesToFreeze: object[] = [];
  const seen = new SafeSet<object>();
  let pendingOffset = 0;
  let enumerableOwnPropertyCount = 0;

  while (pendingOffset < pending.length) {
    const entry = pending[pendingOffset];
    pendingOffset += 1;
    const value = entry.value;

    if (value === null || typeof value === "boolean") {
      continue;
    }
    if (typeof value === "number") {
      if (
        !safeNumberIsFinite(value) ||
        safeObjectIs(value, -0) ||
        (safeNumberIsInteger(value) && !safeNumberIsSafeInteger(value))
      ) {
        return { status: "source_invalid" };
      }
      continue;
    }
    if (typeof value === "string") {
      const stringByteLength = utf8ByteLength(value);
      if (!isUnicodeScalarString(value)) {
        return { status: "source_invalid" };
      }
      if (
        stringByteLength === null ||
        stringByteLength > limits.maximumStringUtf8Bytes
      ) {
        return { status: "resource_exceeded" };
      }
      continue;
    }
    if (typeof value !== "object") {
      return { status: "source_invalid" };
    }

    if (entry.containerDepth > COMMON_MAXIMUM_GRAPH_DEPTH_V0_4) {
      return { status: "resource_exceeded" };
    }
    if (safeReflectApply(safeSetHas, seen, [value])) {
      return { status: "source_invalid" };
    }
    safeReflectApply(safeSetAdd, seen, [value]);
    appendOwnArrayValue(nodesToFreeze, value);

    const symbols = safeObjectGetOwnPropertySymbols(value);
    if (symbols.length !== 0) {
      return { status: "source_invalid" };
    }

    if (safeArrayIsArray(value)) {
      if (safeObjectGetPrototypeOf(value) !== intrinsicArrayPrototype) {
        return { status: "source_invalid" };
      }
      const lengthDescriptor = safeObjectGetOwnPropertyDescriptor(
        value,
        "length",
      );
      if (!hasOwnDataValue(lengthDescriptor)) {
        return { status: "source_invalid" };
      }
      const length = lengthDescriptor.value;
      if (!isNonNegativeSafeInteger(length)) {
        return { status: "source_invalid" };
      }
      if (length > COMMON_MAXIMUM_ARRAY_LENGTH_V0_4) {
        return { status: "resource_exceeded" };
      }

      const names = safeObjectGetOwnPropertyNames(value);
      if (names.length !== length + 1) {
        return { status: "source_invalid" };
      }
      enumerableOwnPropertyCount += length;
      if (
        enumerableOwnPropertyCount >
        COMMON_MAXIMUM_ENUMERABLE_OWN_PROPERTIES_V0_4
      ) {
        return { status: "resource_exceeded" };
      }

      for (let index = 0; index < length; index += 1) {
        const descriptor = safeObjectGetOwnPropertyDescriptor(
          value,
          SafeString(index),
        );
        if (!hasOwnDataValue(descriptor) || descriptor.enumerable !== true) {
          return { status: "source_invalid" };
        }
        const child = descriptor.value;
        appendOwnArrayValue(pending, {
          value: child,
          containerDepth:
            typeof child === "object" && child !== null
              ? entry.containerDepth + 1
              : entry.containerDepth,
        });
      }
      continue;
    }

    if (safeObjectGetPrototypeOf(value) !== intrinsicObjectPrototype) {
      return { status: "source_invalid" };
    }
    const names = safeObjectGetOwnPropertyNames(value);
    enumerableOwnPropertyCount += names.length;
    if (
      enumerableOwnPropertyCount >
      COMMON_MAXIMUM_ENUMERABLE_OWN_PROPERTIES_V0_4
    ) {
      return { status: "resource_exceeded" };
    }

    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const nameByteLength = utf8ByteLength(name);
      if (!isUnicodeScalarString(name)) {
        return { status: "source_invalid" };
      }
      if (
        nameByteLength === null ||
        nameByteLength > limits.maximumStringUtf8Bytes
      ) {
        return { status: "resource_exceeded" };
      }
      const descriptor = safeObjectGetOwnPropertyDescriptor(value, name);
      if (!hasOwnDataValue(descriptor) || descriptor.enumerable !== true) {
        return { status: "source_invalid" };
      }
      const child = descriptor.value;
      appendOwnArrayValue(pending, {
        value: child,
        containerDepth:
          typeof child === "object" && child !== null
            ? entry.containerDepth + 1
            : entry.containerDepth,
      });
    }
  }

  return { status: "valid", nodesToFreeze };
}

function bytesEqual(
  left: Uint8Array,
  leftLength: number,
  right: Uint8Array,
  rightLength: number,
): boolean {
  if (leftLength !== rightLength) {
    return false;
  }
  for (let index = 0; index < leftLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Parses one exact Common V0.4 canonical JSON byte document.
 *
 * This is an inactive, provider-neutral building block. It does not perform
 * proof lookup, claim/CAS, adapter execution, IPC, or source verification.
 */
export function parseCommonCanonicalJsonBytesInternalV0_4(
  candidateBytes: unknown,
  maximumCanonicalUtf8Bytes: number,
  maximumStringUtf8Bytes: number,
): CommonCanonicalJsonParseResultInternalV0_4 {
  const limits = validateTrustedLimits(
    maximumCanonicalUtf8Bytes,
    maximumStringUtf8Bytes,
  );
  if (limits === null) {
    return RESOURCE_LIMIT_FAILURE;
  }

  const candidate = snapshotCandidateBytes(
    candidateBytes,
    limits.maximumCanonicalUtf8Bytes,
  );
  if (candidate === "source_invalid") {
    return SOURCE_BINDING_FAILURE;
  }
  if (candidate === "resource_exceeded") {
    return RESOURCE_LIMIT_FAILURE;
  }

  const ownedBytes = candidate.bytes;
  if (
    candidate.byteLength >= 3 &&
    ownedBytes[0] === 0xef &&
    ownedBytes[1] === 0xbb &&
    ownedBytes[2] === 0xbf
  ) {
    return SOURCE_BINDING_FAILURE;
  }

  let decoded: string;
  try {
    decoded = safeReflectApply(
      safeTextDecoderDecode,
      intrinsicFatalUtf8Decoder,
      [ownedBytes],
    ) as string;
  } catch {
    return SOURCE_BINDING_FAILURE;
  }

  let scan: ScanResult;
  try {
    scan = scanJsonDocument(
      decoded,
      candidate.byteLength,
      limits.maximumStringUtf8Bytes,
    );
  } catch {
    return RESOURCE_LIMIT_FAILURE;
  }
  if (!scan.syntaxValid || scan.duplicateKeyDetected) {
    return SOURCE_BINDING_FAILURE;
  }
  if (scan.resourceLimitExceeded) {
    return RESOURCE_LIMIT_FAILURE;
  }

  let parsed: unknown;
  try {
    parsed = safeReflectApply(safeJsonParse, undefined, [decoded]);
  } catch {
    return SOURCE_BINDING_FAILURE;
  }

  const graphValidation = validateExactJsonGraph(parsed, limits);
  if (graphValidation.status === "source_invalid") {
    return SOURCE_BINDING_FAILURE;
  }
  if (graphValidation.status === "resource_exceeded") {
    return RESOURCE_LIMIT_FAILURE;
  }

  let canonicalBytes: Uint8Array;
  let canonicalByteLength: number;
  try {
    for (
      let index = graphValidation.nodesToFreeze.length - 1;
      index >= 0;
      index -= 1
    ) {
      safeObjectFreeze(graphValidation.nodesToFreeze[index]);
    }
    const graphHandle =
      createCommonSuggestionEvidenceParentValidatedGraphHandleFromTrustedParentInternalV0_4(
        parsed,
      );
    const canonical = canonicalizeCommonSuggestionEvidenceGraphInternalV0_4(
      graphHandle,
      limits.maximumCanonicalUtf8Bytes,
      limits.maximumStringUtf8Bytes,
    );
    if (!canonical.valid) {
      return canonical.failure === "resource_limit_exceeded"
        ? RESOURCE_LIMIT_FAILURE
        : SOURCE_BINDING_FAILURE;
    }
    canonicalBytes = safeReflectApply(
      safeTextEncoderEncode,
      intrinsicUtf8Encoder,
      [canonical.canonicalJson],
    ) as Uint8Array;
    canonicalByteLength = canonical.canonicalUtf8ByteLength;
  } catch {
    return SOURCE_BINDING_FAILURE;
  }

  if (
    !bytesEqual(
      ownedBytes,
      candidate.byteLength,
      canonicalBytes,
      canonicalByteLength,
    )
  ) {
    return SOURCE_BINDING_FAILURE;
  }

  try {
    return safeObjectFreeze({
      valid: true,
      value: parsed as ExactJsonValueV0_4,
      canonicalUtf8ByteLength: canonicalByteLength,
    });
  } catch {
    return SOURCE_BINDING_FAILURE;
  }
}
