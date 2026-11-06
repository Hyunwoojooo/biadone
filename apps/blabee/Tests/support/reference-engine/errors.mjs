export class CoordinatorError extends Error {
  constructor(code, message = code, details = undefined) {
    super(message);
    this.name = "CoordinatorError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export class JournalConflictError extends CoordinatorError {
  constructor(expectedSequence, actualSequence) {
    super(
      "journal_sequence_conflict",
      `journal sequence conflict: expected ${expectedSequence}, current ${actualSequence}`,
      { expectedSequence, actualSequence },
    );
    this.name = "JournalConflictError";
  }
}

export function fail(code, message = code, details = undefined) {
  throw new CoordinatorError(code, message, details);
}

export function invariant(condition, code, message = code, details = undefined) {
  if (!condition) fail(code, message, details);
}
