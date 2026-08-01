import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = resolve(new URL("../", import.meta.url).pathname);
const scriptPath = resolve(projectRoot, "tools/run-golden-note-baseline.ts");

test("Golden CLI exposes safe defaults and validates arguments before fetching", () => {
  const help = runCli(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Golden Note deterministic baseline/);

  const noOptIn = runCli([]);
  assert.equal(noOptIn.status, 1);
  assert.match(noOptIn.stderr, /LIVE_FETCH_NOT_ALLOWED/);

  const invalidTimeout = runCli(["--timeout", "0"]);
  assert.equal(invalidTimeout.status, 1);
  assert.match(invalidTimeout.stderr, /INVALID_ARGUMENT/);

  const unknownHtml = runCli([
    "--case",
    "rl-adaptation-business-008",
    "--html",
    "typo-case=/private/tmp/missing.html",
  ]);
  assert.equal(unknownHtml.status, 1);
  assert.match(unknownHtml.stderr, /UNKNOWN_HTML_CASE_ID/);

  const unsafeOutput = runCli([
    "--case",
    "rl-adaptation-business-008",
    "--allow-live-fetch",
    "--output",
    "/private/tmp/golden-output",
  ]);
  assert.equal(unsafeOutput.status, 1);
  assert.match(unsafeOutput.stderr, /UNSAFE_OUTPUT_DIRECTORY/);
});

test("Golden CLI runs a local HTML case end to end without network access", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "gptmemory-cli-"));
  const htmlPath = join(temporaryRoot, "capture.html");
  const outputRelative = `outputs/cli-test-${randomUUID()}`;
  const outputPath = resolve(projectRoot, outputRelative);
  try {
    await writeFile(htmlPath, fixtureHtml(), "utf8");
    const result = runCli([
      "--case",
      "rl-adaptation-business-008",
      "--html",
      `rl-adaptation-business-008=${htmlPath}`,
      "--output",
      outputRelative,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Technical pass\/fail\/blocked: 1\/0\/0/);
    const report = JSON.parse(
      await readFile(join(outputPath, "report.json"), "utf8"),
    );
    assert.equal(report.run.mode, "local_html");
    assert.equal(report.cases[0].acquisitionMode, "local_html");
    assert.equal(report.cases[0].technicalStatus, "pass");
    assert.equal(report.cases[0].input.filteredAfterCutoffCount, 2);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    await rm(outputPath, { recursive: true, force: true });
  }
});

function runCli(args) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", scriptPath, ...args],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CHATGPT_SHARE_FETCHER_URL: "",
        CHATGPT_SHARE_FETCHER_SECRET: "",
      },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function fixtureHtml() {
  const messages = [
    ["u1", "user", "강화학습 데이터가 부족한 분야는 어디야?"],
    ["a1", "assistant", "로봇과 산업 운영 등이 있습니다."],
    ["u2", "user", "환경이 바뀌면 사업성이 낮지 않아?"],
    ["a2", "assistant", "재학습 비용을 제한하는 구조가 필요합니다."],
    ["u3", "user", "로봇 AI는 딥러닝이야 강화학습이야?"],
    ["a3", "assistant", "둘을 전통 제어와 함께 사용합니다."],
    ["u4", "user", "자동 적응 연구도 있어?"],
    ["a4", "assistant", "meta-RL과 continual RL 등이 있습니다."],
    ["teacher", "user", "[REFERENCE_NOTE]를 작성해줘"],
    ["teacher-answer", "assistant", "[EVALUATION_GUIDE] 기준 답변"],
  ].map(([id, role, text]) => ({
    id,
    author: { role },
    content: { content_type: "text", parts: [text] },
  }));
  const payload = {
    title: "강화학습 자동 적응 논의",
    linear_conversation: messages,
  };
  const encodedPayload = JSON.stringify(JSON.stringify(payload));
  return `<!doctype html><script>window.__reactRouterContext.streamController.enqueue(${encodedPayload});</script>`;
}
