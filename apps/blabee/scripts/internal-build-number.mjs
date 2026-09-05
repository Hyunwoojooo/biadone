import { basename } from "node:path";

const canonicalInternalBuildNumberPattern = /^[1-9][0-9]{0,3}$/u;

export function requireInternalBuildNumber(value, label = "build number") {
  const text = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : value;
  if (
    typeof text !== "string"
    || !canonicalInternalBuildNumberPattern.test(text)
  ) {
    throw new Error(`${label} must be a canonical integer from 1 through 9999`);
  }
  return text;
}

export function requireInternalDMGOutputBuildSuffix(outputPath, buildNumber) {
  const normalizedBuildNumber = requireInternalBuildNumber(buildNumber);
  if (typeof outputPath !== "string") {
    throw new Error("--output must be a string before its build suffix is checked");
  }
  const expectedSuffix = `-r${normalizedBuildNumber}.dmg`;
  if (!basename(outputPath).endsWith(expectedSuffix)) {
    throw new Error(`--output basename must end with ${expectedSuffix}`);
  }
  return normalizedBuildNumber;
}
