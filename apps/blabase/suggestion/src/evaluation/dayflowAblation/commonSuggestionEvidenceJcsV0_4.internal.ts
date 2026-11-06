import { types as nodeUtilTypes } from "node:util";

const safeReflectApply = Reflect.apply;
const safeObjectCreate = Object.create;
const safeObjectDefineProperty = Object.defineProperty;
const safeObjectFreeze = Object.freeze;
const safeObjectIsFrozen = Object.isFrozen;
const safeObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const safeObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const safeObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const safeObjectGetPrototypeOf = Object.getPrototypeOf;
const safeObjectHasOwnProperty = Object.prototype.hasOwnProperty;
const safeObjectIs = Object.is;
const safeArrayIsArray = Array.isArray;
const safeArrayJoin = Array.prototype.join;
const SafeArray = Array;
const SafeUint32Array = Uint32Array;
const safeJsonStringify = JSON.stringify;
const safeNumberIsFinite = Number.isFinite;
const safeNumberIsInteger = Number.isInteger;
const safeNumberIsSafeInteger = Number.isSafeInteger;
const safeNumberMaxSafeInteger = Number.MAX_SAFE_INTEGER;
const safeStringCharCodeAt = String.prototype.charCodeAt;
const SafeString = String;
const SafeWeakMap = WeakMap;
const safeWeakMapGet = WeakMap.prototype.get;
const safeWeakMapSet = WeakMap.prototype.set;
const SafeWeakSet = WeakSet;
const safeWeakSetAdd = WeakSet.prototype.add;
const safeWeakSetHas = WeakSet.prototype.has;
const safeIsProxy = nodeUtilTypes.isProxy;
const safeIsAnyArrayBuffer = nodeUtilTypes.isAnyArrayBuffer;
const safeIsArrayBufferView = nodeUtilTypes.isArrayBufferView;
const safeIsArgumentsObject = nodeUtilTypes.isArgumentsObject;
const safeIsBoxedPrimitive = nodeUtilTypes.isBoxedPrimitive;
const safeIsDate = nodeUtilTypes.isDate;
const safeIsMap = nodeUtilTypes.isMap;
const safeIsNativeError = nodeUtilTypes.isNativeError;
const safeIsPromise = nodeUtilTypes.isPromise;
const safeIsRegExp = nodeUtilTypes.isRegExp;
const safeIsSet = nodeUtilTypes.isSet;
const safeIsSharedArrayBuffer = nodeUtilTypes.isSharedArrayBuffer;
const safeIsWeakMap = nodeUtilTypes.isWeakMap;
const safeIsWeakSet = nodeUtilTypes.isWeakSet;

const intrinsicObjectPrototype = Object.prototype;
const intrinsicArrayPrototype = Array.prototype;

const COMMON_MAXIMUM_GRAPH_DEPTH_V0_4 = 32;
const COMMON_MAXIMUM_ENUMERABLE_OWN_PROPERTIES_V0_4 = 16_384;
const COMMON_MAXIMUM_ARRAY_LENGTH_V0_4 = 1_024;
const COMMON_MAXIMUM_CUMULATIVE_PRIVATE_UTF8_BYTES_V0_4 = 5_242_880;

declare const commonSuggestionEvidenceParentValidatedGraphHandleBrandV0_4:
  unique symbol;

export type CommonSuggestionEvidenceParentValidatedGraphHandleV0_4 = Readonly<{
  readonly [commonSuggestionEvidenceParentValidatedGraphHandleBrandV0_4]:
    "CommonSuggestionEvidenceParentValidatedGraphHandleV0_4";
}>;

export type CommonSuggestionEvidenceJcsResultInternalV0_4 =
  | Readonly<{
      valid: true;
      canonicalJson: string;
      canonicalUtf8ByteLength: number;
    }>
  | Readonly<{
      valid: false;
      failure: "graph_invalid";
    }>
  | Readonly<{
      valid: false;
      failure: "resource_limit_exceeded";
    }>;

function createFrozenFailure(
  failure: "graph_invalid" | "resource_limit_exceeded",
): CommonSuggestionEvidenceJcsResultInternalV0_4 {
  const result = safeObjectCreate(null) as object;
  safeObjectDefineProperty(result, "valid", {
    configurable: false,
    enumerable: true,
    value: false,
    writable: false,
  });
  safeObjectDefineProperty(result, "failure", {
    configurable: false,
    enumerable: true,
    value: failure,
    writable: false,
  });
  return safeObjectFreeze(
    result,
  ) as CommonSuggestionEvidenceJcsResultInternalV0_4;
}

const GRAPH_INVALID_FAILURE = createFrozenFailure("graph_invalid");
const RESOURCE_LIMIT_FAILURE = createFrozenFailure("resource_limit_exceeded");

const parentValidatedGraphsByHandle = new SafeWeakMap<object, unknown>();
const parentValidatedGraphHandles = new SafeWeakSet<object>();

type ValidatedLimits = Readonly<{
  maximumCanonicalUtf8Bytes: number;
  maximumStringUtf8Bytes: number;
}>;

type FailureKind = "graph_invalid" | "resource_limit_exceeded";

type ValueFrame = {
  kind: "value";
  value: unknown;
  containerDepth: number;
};

type ArrayFrame = {
  kind: "array";
  value: object;
  length: number;
  nextIndex: number;
  containerDepth: number;
};

type ObjectFrame = {
  kind: "object";
  value: object;
  keys: string[];
  nextIndex: number;
  containerDepth: number;
};

type WorkFrame = ValueFrame | ArrayFrame | ObjectFrame;

type SerializationState = {
  enumerableOwnPropertyCount: number;
  canonicalKeyUtf8ByteLength: number;
  canonicalUtf8ByteLength: number;
  chunks: string[];
};

type RadixWorkFrame = {
  start: number;
  end: number;
  codeUnitIndex: number;
  bit: number;
};

type PreparedContainer =
  | Readonly<{
      valid: true;
      frame: ArrayFrame | ObjectFrame;
    }>
  | Readonly<{
      valid: false;
      failure: FailureKind;
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

function validateLimits(
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

function isProxyWithoutTraps(value: unknown): boolean {
  return safeReflectApply(safeIsProxy, undefined, [value]) as boolean;
}

function isRejectedBrandedExoticWithoutTraps(value: object): boolean {
  return (
    (safeReflectApply(safeIsAnyArrayBuffer, undefined, [value]) as boolean) ||
    (safeReflectApply(safeIsArrayBufferView, undefined, [value]) as boolean) ||
    (safeReflectApply(safeIsArgumentsObject, undefined, [value]) as boolean) ||
    (safeReflectApply(safeIsBoxedPrimitive, undefined, [value]) as boolean) ||
    (safeReflectApply(safeIsDate, undefined, [value]) as boolean) ||
    (safeReflectApply(safeIsMap, undefined, [value]) as boolean) ||
    (safeReflectApply(safeIsNativeError, undefined, [value]) as boolean) ||
    (safeReflectApply(safeIsPromise, undefined, [value]) as boolean) ||
    (safeReflectApply(safeIsRegExp, undefined, [value]) as boolean) ||
    (safeReflectApply(safeIsSet, undefined, [value]) as boolean) ||
    (safeReflectApply(safeIsSharedArrayBuffer, undefined, [value]) as boolean) ||
    (safeReflectApply(safeIsWeakMap, undefined, [value]) as boolean) ||
    (safeReflectApply(safeIsWeakSet, undefined, [value]) as boolean)
  );
}

function charCodeAt(value: string, index: number): number {
  return safeReflectApply(safeStringCharCodeAt, value, [index]) as number;
}

function unicodeScalarUtf8ByteLength(value: string): number | null {
  let byteLength = 0;
  let index = 0;
  while (index < value.length) {
    const code = charCodeAt(value, index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return null;
      const low = charCodeAt(value, index + 1);
      if (low < 0xdc00 || low > 0xdfff) return null;
      byteLength += 4;
      index += 2;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return null;
    if (code <= 0x7f) {
      byteLength += 1;
    } else if (code <= 0x7ff) {
      byteLength += 2;
    } else {
      byteLength += 3;
    }
    index += 1;
  }
  return byteLength;
}

function setOwnArrayValue<T>(target: T[], index: number, value: T): void {
  safeObjectDefineProperty(target, SafeString(index), {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function appendOwnArrayValue<T>(target: T[], value: T): void {
  setOwnArrayValue(target, target.length, value);
}

function sortKeysByUnsignedUtf16Radix(
  keys: string[],
  totalCodeUnitCount: number,
): string[] | null {
  const length = keys.length;
  if (length < 2) return keys;

  const budgetBase = totalCodeUnitCount + length;
  if (
    !safeNumberIsSafeInteger(budgetBase) ||
    budgetBase > safeNumberMaxSafeInteger / 17
  ) {
    return null;
  }
  let remainingBitInspections = budgetBase * 17;
  const scratch = new SafeArray<string>();
  const symbols = new SafeUint32Array(length);
  const symbolScratch = new SafeUint32Array(length);
  const work = new SafeArray<RadixWorkFrame>();
  setOwnArrayValue(work, 0, {
    start: 0,
    end: length,
    codeUnitIndex: 0,
    bit: 16,
  });
  let workSize = 1;

  const pushWork = (frame: RadixWorkFrame): void => {
    setOwnArrayValue(work, workSize, frame);
    workSize += 1;
  };

  while (workSize > 0) {
    workSize -= 1;
    const frame = work[workSize];
    if (frame.end - frame.start < 2) continue;

    let zeroCount = 0;
    for (let index = frame.start; index < frame.end; index += 1) {
      if (remainingBitInspections <= 0) return null;
      remainingBitInspections -= 1;
      const key = keys[index];
      const symbol =
        frame.codeUnitIndex < key.length
          ? charCodeAt(key, frame.codeUnitIndex) + 1
          : 0;
      symbols[index] = symbol;
      if (((symbol >>> frame.bit) & 1) === 0) zeroCount += 1;
    }

    let zeroWrite = frame.start;
    let oneWrite = frame.start + zeroCount;
    for (let index = frame.start; index < frame.end; index += 1) {
      const symbol = symbols[index];
      const write = ((symbol >>> frame.bit) & 1) === 0
        ? zeroWrite++
        : oneWrite++;
      setOwnArrayValue(scratch, write, keys[index]);
      symbolScratch[write] = symbol;
    }
    for (let index = frame.start; index < frame.end; index += 1) {
      setOwnArrayValue(keys, index, scratch[index]);
      symbols[index] = symbolScratch[index];
    }

    const middle = frame.start + zeroCount;
    if (frame.bit > 0) {
      if (frame.end - middle > 1) {
        pushWork({
          start: middle,
          end: frame.end,
          codeUnitIndex: frame.codeUnitIndex,
          bit: frame.bit - 1,
        });
      }
      if (middle - frame.start > 1) {
        pushWork({
          start: frame.start,
          end: middle,
          codeUnitIndex: frame.codeUnitIndex,
          bit: frame.bit - 1,
        });
      }
      continue;
    }

    if (frame.end - middle > 1 && symbols[middle] !== 0) {
      pushWork({
        start: middle,
        end: frame.end,
        codeUnitIndex: frame.codeUnitIndex + 1,
        bit: 16,
      });
    }
    if (middle - frame.start > 1 && symbols[frame.start] !== 0) {
      pushWork({
        start: frame.start,
        end: middle,
        codeUnitIndex: frame.codeUnitIndex + 1,
        bit: 16,
      });
    }
  }

  return keys;
}

function addCanonicalChunk(
  state: SerializationState,
  chunk: string,
  maximumCanonicalUtf8Bytes: number,
): FailureKind | null {
  const chunkByteLength = unicodeScalarUtf8ByteLength(chunk);
  if (chunkByteLength === null) return "graph_invalid";
  if (
    chunkByteLength >
    maximumCanonicalUtf8Bytes - state.canonicalUtf8ByteLength
  ) {
    return "resource_limit_exceeded";
  }
  appendOwnArrayValue(state.chunks, chunk);
  state.canonicalUtf8ByteLength += chunkByteLength;
  return null;
}

function prepareArrayFrame(
  value: object,
  containerDepth: number,
  state: SerializationState,
): PreparedContainer {
  const symbols = safeObjectGetOwnPropertySymbols(value);
  if (symbols.length !== 0) {
    return { valid: false, failure: "graph_invalid" };
  }

  const lengthDescriptor = safeObjectGetOwnPropertyDescriptor(value, "length");
  if (!hasOwnDataValue(lengthDescriptor)) {
    return { valid: false, failure: "graph_invalid" };
  }
  const length = lengthDescriptor.value;
  if (!isNonNegativeSafeInteger(length)) {
    return { valid: false, failure: "graph_invalid" };
  }

  const names = safeObjectGetOwnPropertyNames(value);
  if (names.length !== length + 1) {
    return { valid: false, failure: "graph_invalid" };
  }
  if (length > COMMON_MAXIMUM_ARRAY_LENGTH_V0_4) {
    return { valid: false, failure: "resource_limit_exceeded" };
  }
  if (
    length >
    COMMON_MAXIMUM_ENUMERABLE_OWN_PROPERTIES_V0_4 -
      state.enumerableOwnPropertyCount
  ) {
    return { valid: false, failure: "resource_limit_exceeded" };
  }

  for (let index = 0; index < length; index += 1) {
    const descriptor = safeObjectGetOwnPropertyDescriptor(
      value,
      SafeString(index),
    );
    if (!hasOwnDataValue(descriptor) || descriptor.enumerable !== true) {
      return { valid: false, failure: "graph_invalid" };
    }
  }

  state.enumerableOwnPropertyCount += length;
  return {
    valid: true,
    frame: {
      kind: "array",
      value,
      length,
      nextIndex: 0,
      containerDepth,
    },
  };
}

function prepareObjectFrame(
  value: object,
  containerDepth: number,
  state: SerializationState,
  maximumStringUtf8Bytes: number,
  maximumCanonicalUtf8Bytes: number,
): PreparedContainer {
  const symbols = safeObjectGetOwnPropertySymbols(value);
  if (symbols.length !== 0) {
    return { valid: false, failure: "graph_invalid" };
  }

  const names = safeObjectGetOwnPropertyNames(value);
  if (
    names.length >
    COMMON_MAXIMUM_ENUMERABLE_OWN_PROPERTIES_V0_4 -
      state.enumerableOwnPropertyCount
  ) {
    return { valid: false, failure: "resource_limit_exceeded" };
  }

  let objectKeyCodeUnitCount = 0;
  let objectCanonicalKeyUtf8ByteLength = 0;
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const nameByteLength = unicodeScalarUtf8ByteLength(name);
    if (nameByteLength === null) {
      return { valid: false, failure: "graph_invalid" };
    }
    if (nameByteLength > maximumStringUtf8Bytes) {
      return { valid: false, failure: "resource_limit_exceeded" };
    }
    const serializedName = safeReflectApply(safeJsonStringify, undefined, [
      name,
    ]) as string | undefined;
    if (typeof serializedName !== "string") {
      return { valid: false, failure: "graph_invalid" };
    }
    const serializedNameByteLength = unicodeScalarUtf8ByteLength(serializedName);
    if (serializedNameByteLength === null) {
      return { valid: false, failure: "graph_invalid" };
    }
    if (
      serializedNameByteLength >
      maximumCanonicalUtf8Bytes -
        state.canonicalKeyUtf8ByteLength -
        objectCanonicalKeyUtf8ByteLength
    ) {
      return { valid: false, failure: "resource_limit_exceeded" };
    }
    objectCanonicalKeyUtf8ByteLength += serializedNameByteLength;
    objectKeyCodeUnitCount += name.length;
    if (!safeNumberIsSafeInteger(objectKeyCodeUnitCount)) {
      return { valid: false, failure: "resource_limit_exceeded" };
    }
    const descriptor = safeObjectGetOwnPropertyDescriptor(value, name);
    if (!hasOwnDataValue(descriptor) || descriptor.enumerable !== true) {
      return { valid: false, failure: "graph_invalid" };
    }
  }

  state.enumerableOwnPropertyCount += names.length;
  state.canonicalKeyUtf8ByteLength += objectCanonicalKeyUtf8ByteLength;
  const sortedKeys = sortKeysByUnsignedUtf16Radix(
    names,
    objectKeyCodeUnitCount,
  );
  if (sortedKeys === null) {
    return { valid: false, failure: "resource_limit_exceeded" };
  }
  return {
    valid: true,
    frame: {
      kind: "object",
      value,
      keys: sortedKeys,
      nextIndex: 0,
      containerDepth,
    },
  };
}

function createFailure(
  failure: FailureKind,
): CommonSuggestionEvidenceJcsResultInternalV0_4 {
  return failure === "resource_limit_exceeded"
    ? RESOURCE_LIMIT_FAILURE
    : GRAPH_INVALID_FAILURE;
}

function canonicalizeValidatedGraph(
  root: unknown,
  limits: ValidatedLimits,
): CommonSuggestionEvidenceJcsResultInternalV0_4 {
  const state: SerializationState = {
    enumerableOwnPropertyCount: 0,
    canonicalKeyUtf8ByteLength: 0,
    canonicalUtf8ByteLength: 0,
    chunks: new SafeArray<string>(),
  };
  const seenContainers = new SafeWeakSet<object>();
  const stack = new SafeArray<WorkFrame>();
  appendOwnArrayValue(stack, {
    kind: "value",
    value: root,
    containerDepth: 1,
  });
  let stackSize = 1;

  while (stackSize > 0) {
    const frame = stack[stackSize - 1];

    if (frame.kind === "array") {
      if (frame.nextIndex >= frame.length) {
        const closeFailure = addCanonicalChunk(
          state,
          "]",
          limits.maximumCanonicalUtf8Bytes,
        );
        if (closeFailure !== null) return createFailure(closeFailure);
        stackSize -= 1;
        continue;
      }

      if (frame.nextIndex > 0) {
        const commaFailure = addCanonicalChunk(
          state,
          ",",
          limits.maximumCanonicalUtf8Bytes,
        );
        if (commaFailure !== null) return createFailure(commaFailure);
      }
      const descriptor = safeObjectGetOwnPropertyDescriptor(
        frame.value,
        SafeString(frame.nextIndex),
      );
      if (!hasOwnDataValue(descriptor) || descriptor.enumerable !== true) {
        return GRAPH_INVALID_FAILURE;
      }
      frame.nextIndex += 1;
      setOwnArrayValue(stack, stackSize, {
        kind: "value",
        value: descriptor.value,
        containerDepth: frame.containerDepth + 1,
      });
      stackSize += 1;
      continue;
    }

    if (frame.kind === "object") {
      if (frame.nextIndex >= frame.keys.length) {
        const closeFailure = addCanonicalChunk(
          state,
          "}",
          limits.maximumCanonicalUtf8Bytes,
        );
        if (closeFailure !== null) return createFailure(closeFailure);
        stackSize -= 1;
        continue;
      }

      if (frame.nextIndex > 0) {
        const commaFailure = addCanonicalChunk(
          state,
          ",",
          limits.maximumCanonicalUtf8Bytes,
        );
        if (commaFailure !== null) return createFailure(commaFailure);
      }
      const key = frame.keys[frame.nextIndex];
      const serializedKey = safeReflectApply(safeJsonStringify, undefined, [
        key,
      ]) as string | undefined;
      if (typeof serializedKey !== "string") return GRAPH_INVALID_FAILURE;
      const keyFailure = addCanonicalChunk(
        state,
        serializedKey,
        limits.maximumCanonicalUtf8Bytes,
      );
      if (keyFailure !== null) return createFailure(keyFailure);
      const colonFailure = addCanonicalChunk(
        state,
        ":",
        limits.maximumCanonicalUtf8Bytes,
      );
      if (colonFailure !== null) return createFailure(colonFailure);

      const descriptor = safeObjectGetOwnPropertyDescriptor(frame.value, key);
      if (!hasOwnDataValue(descriptor) || descriptor.enumerable !== true) {
        return GRAPH_INVALID_FAILURE;
      }
      frame.nextIndex += 1;
      setOwnArrayValue(stack, stackSize, {
        kind: "value",
        value: descriptor.value,
        containerDepth: frame.containerDepth + 1,
      });
      stackSize += 1;
      continue;
    }

    const value = frame.value;
    if (value === null || typeof value === "boolean") {
      const primitiveFailure = addCanonicalChunk(
        state,
        value === null ? "null" : value ? "true" : "false",
        limits.maximumCanonicalUtf8Bytes,
      );
      if (primitiveFailure !== null) return createFailure(primitiveFailure);
      stackSize -= 1;
      continue;
    }

    if (typeof value === "number") {
      if (
        !safeNumberIsFinite(value) ||
        safeObjectIs(value, -0) ||
        (safeNumberIsInteger(value) && !safeNumberIsSafeInteger(value))
      ) {
        return GRAPH_INVALID_FAILURE;
      }
      const serializedNumber = safeReflectApply(
        safeJsonStringify,
        undefined,
        [value],
      ) as string | undefined;
      if (typeof serializedNumber !== "string") return GRAPH_INVALID_FAILURE;
      const numberFailure = addCanonicalChunk(
        state,
        serializedNumber,
        limits.maximumCanonicalUtf8Bytes,
      );
      if (numberFailure !== null) return createFailure(numberFailure);
      stackSize -= 1;
      continue;
    }

    if (typeof value === "string") {
      const stringByteLength = unicodeScalarUtf8ByteLength(value);
      if (stringByteLength === null) return GRAPH_INVALID_FAILURE;
      if (stringByteLength > limits.maximumStringUtf8Bytes) {
        return RESOURCE_LIMIT_FAILURE;
      }
      const serializedString = safeReflectApply(
        safeJsonStringify,
        undefined,
        [value],
      ) as string | undefined;
      if (typeof serializedString !== "string") return GRAPH_INVALID_FAILURE;
      const stringFailure = addCanonicalChunk(
        state,
        serializedString,
        limits.maximumCanonicalUtf8Bytes,
      );
      if (stringFailure !== null) return createFailure(stringFailure);
      stackSize -= 1;
      continue;
    }

    if (typeof value !== "object" || isProxyWithoutTraps(value)) {
      return GRAPH_INVALID_FAILURE;
    }

    if (isRejectedBrandedExoticWithoutTraps(value)) {
      return GRAPH_INVALID_FAILURE;
    }

    const isArray = safeArrayIsArray(value);
    const expectedPrototype = isArray
      ? intrinsicArrayPrototype
      : intrinsicObjectPrototype;
    if (safeObjectGetPrototypeOf(value) !== expectedPrototype) {
      return GRAPH_INVALID_FAILURE;
    }
    if (!safeObjectIsFrozen(value)) {
      return GRAPH_INVALID_FAILURE;
    }
    if (frame.containerDepth > COMMON_MAXIMUM_GRAPH_DEPTH_V0_4) {
      return RESOURCE_LIMIT_FAILURE;
    }
    if (safeReflectApply(safeWeakSetHas, seenContainers, [value])) {
      return GRAPH_INVALID_FAILURE;
    }

    const prepared = isArray
      ? prepareArrayFrame(value, frame.containerDepth, state)
      : prepareObjectFrame(
          value,
          frame.containerDepth,
          state,
          limits.maximumStringUtf8Bytes,
          limits.maximumCanonicalUtf8Bytes,
        );
    if (!prepared.valid) return createFailure(prepared.failure);
    safeReflectApply(safeWeakSetAdd, seenContainers, [value]);

    const openFailure = addCanonicalChunk(
      state,
      isArray ? "[" : "{",
      limits.maximumCanonicalUtf8Bytes,
    );
    if (openFailure !== null) return createFailure(openFailure);
    setOwnArrayValue(stack, stackSize - 1, prepared.frame);
  }

  const canonicalJson = safeReflectApply(safeArrayJoin, state.chunks, [
    "",
  ]) as string;
  return safeObjectFreeze({
    valid: true,
    canonicalJson,
    canonicalUtf8ByteLength: state.canonicalUtf8ByteLength,
  });
}

/**
 * Creates an opaque handle at the trusted-parent boundary. This factory does
 * not make the graph valid; canonicalization independently validates it.
 */
export function createCommonSuggestionEvidenceParentValidatedGraphHandleFromTrustedParentInternalV0_4(
  graph: unknown,
): CommonSuggestionEvidenceParentValidatedGraphHandleV0_4 {
  const handle = safeObjectCreate(null) as object;
  safeReflectApply(safeWeakMapSet, parentValidatedGraphsByHandle, [handle, graph]);
  safeReflectApply(safeWeakSetAdd, parentValidatedGraphHandles, [handle]);
  safeObjectFreeze(handle);
  return handle as CommonSuggestionEvidenceParentValidatedGraphHandleV0_4;
}

/** Canonicalizes only a module-issued trusted-parent graph handle. */
export function canonicalizeCommonSuggestionEvidenceGraphInternalV0_4(
  handle: CommonSuggestionEvidenceParentValidatedGraphHandleV0_4,
  maximumCanonicalUtf8Bytes: number,
  maximumStringUtf8Bytes: number,
): CommonSuggestionEvidenceJcsResultInternalV0_4 {
  const limits = validateLimits(
    maximumCanonicalUtf8Bytes,
    maximumStringUtf8Bytes,
  );
  if (limits === null) return RESOURCE_LIMIT_FAILURE;

  try {
    if (
      typeof handle !== "object" ||
      handle === null ||
      isProxyWithoutTraps(handle) ||
      !safeReflectApply(safeWeakSetHas, parentValidatedGraphHandles, [handle])
    ) {
      return GRAPH_INVALID_FAILURE;
    }
    const graph = safeReflectApply(
      safeWeakMapGet,
      parentValidatedGraphsByHandle,
      [handle],
    );
    return canonicalizeValidatedGraph(graph, limits);
  } catch {
    return GRAPH_INVALID_FAILURE;
  }
}
