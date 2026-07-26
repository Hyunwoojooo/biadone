import {
  sha256Canonical,
  type CrossSourceIntegrityOptions
} from "../../src/evaluation/crossSourceIntegrity";
import codexDetectorConfig from "./codexDetectorConfig.v0.1.json";

export const SYNTHETIC_CODEX_DETECTOR_CONFIG_REF =
  "eval/synthetic/codexDetectorConfig.v0.1.json";

export const SYNTHETIC_CODEX_DETECTOR_CONFIG_VERSION =
  "synthetic-codex-detector-config-v0.1";

export const SYNTHETIC_CODEX_DETECTOR_CONFIG_SHA256 =
  sha256Canonical(codexDetectorConfig);

export const syntheticCrossSourceIntegrityOptions = {
  configArtifacts: {
    [SYNTHETIC_CODEX_DETECTOR_CONFIG_REF]: codexDetectorConfig
  }
} satisfies CrossSourceIntegrityOptions;
