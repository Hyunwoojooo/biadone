import { runSemanticContinuationValidation } from "../src/semanticContinuation/validation";

if (process.argv.slice(2).length > 0) {
  console.error(
    JSON.stringify({
      status: "inconclusive",
      code: "SEMANTIC_VALIDATION_ARGUMENTS_NOT_ALLOWED"
    })
  );
  process.exitCode = 2;
} else {
  try {
    const result = await runSemanticContinuationValidation();
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "passed") process.exitCode = 1;
  } catch {
    console.error(
      JSON.stringify({
        status: "inconclusive",
        code: "SEMANTIC_VALIDATION_UNAVAILABLE"
      })
    );
    process.exitCode = 2;
  }
}
