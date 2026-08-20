import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { M0SafetyError } from "./safety.mjs";

const CATALOG_NAME = "catalog.json";

function newestRecoveryId(records) {
  return records
    .filter((record) => record.kind === "recovery")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.id ?? null;
}

function isProtected(record, latestRecoveryId) {
  return Boolean(
    record.pendingRef ||
    (record.kind === "baseline" && (record.status === "active" || record.status === "paused")) ||
    record.id === latestRecoveryId,
  );
}

export function planRetention(records, { projectId, maxBytes, incomingBytes = 0 }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(incomingBytes) || incomingBytes < 0) {
    throw new TypeError("retention byte limits must be non-negative safe integers");
  }

  const projectRecords = records.filter((record) => record.projectId === projectId);
  const latestRecovery = newestRecoveryId(projectRecords);
  let remainingBytes = projectRecords.reduce((sum, record) => sum + record.bytes, 0) + incomingBytes;
  const removable = projectRecords
    .filter((record) => record.status === "ended" && !isProtected(record, latestRecovery))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const removeIds = [];

  for (const record of removable) {
    if (remainingBytes <= maxBytes) break;
    remainingBytes -= record.bytes;
    removeIds.push(record.id);
  }

  return {
    removeIds,
    remainingBytes,
    exhausted: remainingBytes > maxBytes,
    protectedIds: projectRecords.filter((record) => isProtected(record, latestRecovery)).map((record) => record.id).sort(),
  };
}

export async function loadCatalog(storageRoot) {
  try {
    const raw = await readFile(path.join(storageRoot, CATALOG_NAME), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function saveCatalog(storageRoot, records) {
  await writeFile(path.join(storageRoot, CATALOG_NAME), `${JSON.stringify({ version: 1, records }, null, 2)}\n`, {
    mode: 0o600,
  });
}

export async function reserveRetention(storageRoot, records, options) {
  const plan = planRetention(records, options);
  if (plan.exhausted) return { ok: false, plan, records };

  const removeSet = new Set(plan.removeIds);
  for (const id of plan.removeIds) {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new M0SafetyError(`unsafe retention record id: ${id}`);
    }
    await rm(path.join(storageRoot, "records", id), { recursive: true, force: true });
  }
  const retained = records.filter((record) => !removeSet.has(record.id));
  await saveCatalog(storageRoot, retained);
  return { ok: true, plan, records: retained };
}
