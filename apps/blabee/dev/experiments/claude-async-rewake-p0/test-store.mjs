// P0 ONLY: temporary snapshot journal, not the product journal or a durability claim.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function requireThat(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

// This authority survives STORE OBJECT reopening, not an actual process restart.
// It is intentionally separate from the file, and never reconstructed from it.
class TestFreshness {
  anchor = null;
  tail = Promise.resolve();

  serialize(work) {
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }
}

const ZERO = '0'.repeat(64);
const macFor = (key, payload) => createHmac('sha256', key).update(JSON.stringify(payload)).digest('hex');
const equalMAC = (left, right) => /^[a-f0-9]{64}$/.test(left ?? '')
  && /^[a-f0-9]{64}$/.test(right ?? '')
  && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));

class TestJournal {
  constructor(path, key, freshness) {
    this.path = path;
    this.key = key;
    this.freshness = freshness;
    this.metrics = { loads: 0, verifiedRecords: 0, commits: 0 };
  }

  load() {
    this.metrics.loads += 1;
    requireThat(this.freshness.anchor !== null, 'freshness_missing');
    requireThat(existsSync(this.path), 'journal_missing');
    let records;
    try { records = JSON.parse(readFileSync(this.path, 'utf8')); }
    catch { requireThat(false, 'journal_corrupt'); }
    requireThat(Array.isArray(records) && records.length > 0, 'journal_corrupt');
    let head = ZERO;
    let lastTime = 0;
    for (const [index, record] of records.entries()) {
      requireThat(record && typeof record === 'object', 'journal_corrupt');
      const { mac, ...payload } = record;
      requireThat(payload.sequence === index + 1 && payload.previous === head, 'journal_chain');
      requireThat(Number.isSafeInteger(payload.at) && payload.at >= lastTime, 'journal_time');
      requireThat(equalMAC(mac, macFor(this.key, payload)), 'journal_mac');
      requireThat(payload.state && typeof payload.state === 'object', 'journal_corrupt');
      head = mac;
      lastTime = payload.at;
      this.metrics.verifiedRecords += 1;
    }
    const expected = this.freshness.anchor;
    requireThat(expected.sequence === records.length && equalMAC(expected.head, head), 'freshness_mismatch');
    return { records, head, lastTime, state: structuredClone(records.at(-1).state) };
  }

  read() {
    return this.freshness.serialize(() => this.load().state);
  }

  mutate(event, clock, update, fault) {
    return this.freshness.serialize(() => {
      const loaded = this.load();
      const at = clock.now();
      requireThat(Number.isSafeInteger(at) && at >= loaded.lastTime, 'clock_invalid');
      // No await between final validation and commit. All handles share the test lock.
      const result = update(loaded.state);
      if (result?.unchanged) return result.value;
      requireThat(fault !== 'before_write', 'injected_before_write');
      const payload = {
        sequence: loaded.records.length + 1, previous: loaded.head,
        at, event, state: loaded.state,
      };
      const mac = macFor(this.key, payload);
      const records = [...loaded.records, { ...payload, mac }];
      writeFileSync(`${this.path}.next`, JSON.stringify(records), { mode: 0o600, flag: 'wx' });
      renameSync(`${this.path}.next`, this.path);
      // Models an interrupted disk/anchor transition. It MUST fail closed on reopening.
      requireThat(fault !== 'after_file_before_anchor', 'injected_anchor_gap');
      this.freshness.anchor = { sequence: payload.sequence, head: mac };
      this.metrics.commits += 1;
      requireThat(fault !== 'after_commit', 'response_lost');
      return result;
    });
  }
}

export const unchanged = (value) => ({ unchanged: true, value });

// No caller-selected path, existing home, environment file, DB, or default authority.
// A test gets a fresh private directory and random test-only MAC key on every call.
export function createTestStorage(initialState, clock) {
  const directory = mkdtempSync(join(tmpdir(), 'blabee-rewake-p0-'));
  chmodSync(directory, 0o700);
  const path = join(directory, 'test-journal.json');
  const key = randomBytes(32);
  const freshness = new TestFreshness();
  const payload = {
    sequence: 1, previous: ZERO, at: clock.now(), event: 'test_genesis',
    state: structuredClone(initialState),
  };
  const mac = macFor(key, payload);
  writeFileSync(path, JSON.stringify([{ ...payload, mac }]), { mode: 0o600, flag: 'wx' });
  freshness.anchor = { sequence: 1, head: mac };
  return {
    directory, path,
    reopen: () => new TestJournal(path, key, freshness),
    forgetFreshnessForTest: () => { freshness.anchor = null; },
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  };
}
