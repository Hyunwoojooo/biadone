export type PrivateScreenEvidenceBudgetIssueCodeV1 =
  | "BUDGET_INPUT_INVALID"
  | "RESOURCE_LIMIT_EXCEEDED";

export class PrivateScreenEvidenceBudgetErrorV1 extends Error {
  readonly issueCode: PrivateScreenEvidenceBudgetIssueCodeV1;

  constructor(issueCode: PrivateScreenEvidenceBudgetIssueCodeV1) {
    super(`Private screen evidence budget rejected (${issueCode})`);
    this.name = "PrivateScreenEvidenceBudgetErrorV1";
    this.issueCode = issueCode;
  }
}

function fail(issueCode: PrivateScreenEvidenceBudgetIssueCodeV1): never {
  throw new PrivateScreenEvidenceBudgetErrorV1(issueCode);
}

export function accumulatePrivateScreenEvidenceBudgetV1(
  used: number,
  delta: number,
  trustedLimit: number,
): number {
  if (
    !Number.isSafeInteger(used) ||
    used < 0 ||
    !Number.isSafeInteger(delta) ||
    delta < 0 ||
    !Number.isSafeInteger(trustedLimit) ||
    trustedLimit < 0 ||
    used > trustedLimit
  ) {
    return fail("BUDGET_INPUT_INVALID");
  }
  if (delta > trustedLimit - used) {
    return fail("RESOURCE_LIMIT_EXCEEDED");
  }
  return used + delta;
}

