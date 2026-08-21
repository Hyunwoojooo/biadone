import { decide } from "./decide.mjs";
import { JournalConflictError, invariant } from "./errors.mjs";
import {
  BINDING_FIELDS,
  clone,
  deepFreeze,
  packetRevisionKey,
} from "./shared.mjs";
import { replay } from "./state.mjs";
import { generateTokenMaterial } from "./token.mjs";

function assertNoRawToken(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    invariant(
      key !== "continuation_token" && key !== "correlation_token",
      "raw_continuation_token_forbidden",
    );
    assertNoRawToken(child);
  }
}

function sameBinding(left, right) {
  return BINDING_FIELDS.every((field) => left[field] === right[field]);
}

function matchingDispatch(selection, dispatch) {
  return sameBinding(selection, dispatch)
    && selection.payload.interaction_id === dispatch.payload.interaction_id
    && selection.payload.packet_id === dispatch.payload.packet_id
    && selection.payload.revision === dispatch.payload.revision
    && selection.payload.option_id === dispatch.payload.option_id;
}

function validateAtomicRuntimeBatch(currentSnapshot, events, documents, verificationRecords) {
  const allDocuments = [...currentSnapshot.documents, ...documents];
  const documentByRevision = new Map(
    allDocuments.map((packet) => [packetRevisionKey(packet.packet_id, packet.revision), packet]),
  );
  const selections = events.filter((event) => event.event_type === "decision_selection_claimed");
  const dispatches = events.filter((event) => event.event_type === "continuation_dispatched");

  for (const dispatch of dispatches) {
    const matching = selections.filter((selection) => matchingDispatch(selection, dispatch));
    invariant(matching.length === 1, "selection_dispatch_atomic_batch_required");
    invariant(
      matching[0].event_sequence + 1 === dispatch.event_sequence,
      "selection_dispatch_sequence_not_adjacent",
    );
    const verification = verificationRecords.filter(
      (record) => record.continuation_id === dispatch.payload.continuation_id,
    );
    invariant(verification.length === 1, "verification_dispatch_atomic_batch_required");
  }

  for (const selection of selections) {
    const packet = documentByRevision.get(
      packetRevisionKey(selection.payload.packet_id, selection.payload.revision),
    );
    invariant(packet, "packet_document_missing");
    const choice = packet.choices.find(
      (candidate) => candidate.option_id === selection.payload.option_id,
    );
    invariant(choice, "decision_option_not_found");
    if (choice.action) {
      const matching = dispatches.filter((dispatch) => matchingDispatch(selection, dispatch));
      invariant(matching.length === 1, "selection_dispatch_atomic_batch_required");
    } else if (choice.slot === 3) {
      const closes = events.filter(
        (event) => event.event_type === "decision_boundary_closed"
          && sameBinding(selection, event)
          && event.payload.close_reason === "episode_paused",
      );
      invariant(closes.length === 1, "pause_selection_close_atomic_batch_required");
      invariant(
        selection.event_sequence + 1 === closes[0].event_sequence,
        "pause_selection_close_sequence_not_adjacent",
      );
    }
  }

  for (const document of documents) {
    const matching = events.filter(
      (event) => event.event_type === "decision_packet_sealed"
        && event.payload.packet_id === document.packet_id
        && event.payload.revision === document.revision,
    );
    invariant(matching.length === 1, "packet_document_seal_atomic_batch_required");
  }
  for (const event of events.filter((candidate) => candidate.event_type === "decision_packet_sealed")) {
    const matching = documents.filter(
      (document) => document.packet_id === event.payload.packet_id
        && document.revision === event.payload.revision,
    );
    invariant(matching.length === 1, "packet_document_seal_atomic_batch_required");
  }
}

function validateAppendSequence(expectedSequence, events) {
  invariant(Array.isArray(events) && events.length > 0, "journal_empty_batch");
  for (const [index, event] of events.entries()) {
    invariant(
      event.event_sequence === expectedSequence + index + 1,
      "journal_batch_sequence_not_contiguous",
    );
  }
}

export class InMemoryJournal {
  #events;
  #documents;
  #verificationRecords;
  #writeTail = Promise.resolve();

  constructor({ events = [], documents = [], verificationRecords = [] } = {}) {
    assertNoRawToken(events);
    assertNoRawToken(documents);
    assertNoRawToken(verificationRecords);
    replay(events, { documents, verificationRecords });
    this.#events = clone(events);
    this.#documents = clone(documents);
    this.#verificationRecords = clone(verificationRecords);
  }

  async load() {
    await this.#writeTail;
    return deepFreeze({
      events: clone(this.#events),
      documents: clone(this.#documents),
      verificationRecords: clone(this.#verificationRecords),
    });
  }

  append(expectedSequence, events, { documents = [], verificationRecords = [] } = {}) {
    const operation = this.#writeTail.then(() => {
      const actualSequence = this.#events.at(-1)?.event_sequence ?? 0;
      if (actualSequence !== expectedSequence) {
        throw new JournalConflictError(expectedSequence, actualSequence);
      }
      validateAppendSequence(expectedSequence, events);
      invariant(Array.isArray(documents), "packet_documents_invalid");
      invariant(Array.isArray(verificationRecords), "verification_records_invalid");
      assertNoRawToken(events);
      assertNoRawToken(documents);
      assertNoRawToken(verificationRecords);

      const currentSnapshot = {
        events: this.#events,
        documents: this.#documents,
        verificationRecords: this.#verificationRecords,
      };
      validateAtomicRuntimeBatch(currentSnapshot, events, documents, verificationRecords);

      const existingDocumentKeys = new Set(
        this.#documents.map((packet) => packetRevisionKey(packet.packet_id, packet.revision)),
      );
      for (const packet of documents) {
        invariant(
          !existingDocumentKeys.has(packetRevisionKey(packet.packet_id, packet.revision)),
          "packet_document_duplicate",
        );
      }
      const existingVerificationIds = new Set(
        this.#verificationRecords.map((record) => record.continuation_id),
      );
      for (const verification of verificationRecords) {
        invariant(
          !existingVerificationIds.has(verification.continuation_id),
          "verification_record_duplicate",
        );
      }

      const candidate = {
        events: [...this.#events, ...clone(events)],
        documents: [...this.#documents, ...clone(documents)],
        verificationRecords: [...this.#verificationRecords, ...clone(verificationRecords)],
      };
      // Projection validation happens before any private field changes. A failure
      // therefore rejects the whole logical batch without a partial append.
      replay(candidate.events, {
        documents: candidate.documents,
        verificationRecords: candidate.verificationRecords,
      });
      this.#events = candidate.events;
      this.#documents = candidate.documents;
      this.#verificationRecords = candidate.verificationRecords;
      return deepFreeze({
        firstSequence: events[0].event_sequence,
        lastSequence: events.at(-1).event_sequence,
        eventCount: events.length,
      });
    });
    this.#writeTail = operation.catch(() => undefined);
    return operation;
  }
}

export async function executeCommand(journal, command, { maxSequenceConflicts = 2 } = {}) {
  invariant(journal && typeof journal.load === "function" && typeof journal.append === "function", "journal_port_invalid");
  invariant(Number.isInteger(maxSequenceConflicts) && maxSequenceConflicts >= 0, "retry_limit_invalid");
  const preparedCommand = (
    (command.type === "select_option" || command.type === "reserve_format_repair")
    && command.token_material === undefined
  )
    ? { ...command, token_material: generateTokenMaterial() }
    : command;
  let conflicts = 0;
  for (;;) {
    const snapshot = await journal.load();
    const state = replay(snapshot.events, {
      documents: snapshot.documents,
      verificationRecords: snapshot.verificationRecords,
    });
    const change = decide(state, preparedCommand);
    try {
      const commit = await journal.append(state.eventSequence, change.events, {
        documents: change.documents,
        verificationRecords: change.verificationRecords,
      });
      // Effects, including raw one-time tokens, become visible only after the
      // atomic append succeeds. Losing this response never authorizes reissue.
      return deepFreeze({ commit, effects: clone(change.effects) });
    } catch (error) {
      if (!(error instanceof JournalConflictError) || conflicts >= maxSequenceConflicts) throw error;
      conflicts += 1;
    }
  }
}
