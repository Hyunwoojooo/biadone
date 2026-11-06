import { spawn } from "node:child_process";

export class NdjsonClient {
  constructor(specification, options = {}) {
    this.specification = specification;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.child = spawn(specification.command, specification.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.pending = [];
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.stderrLines = [];
    this.closed = false;

    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.#consumeStdout(chunk));
    this.child.stderr.on("data", (chunk) => this.#consumeStderr(chunk));

    this.exit = new Promise((resolvePromise) => {
      this.child.on("close", (code, signal) => {
        this.closed = true;
        const error = new Error(
          `runtime exited (code=${code}, signal=${signal}, stderr=${this.stderrLines.join(" | ")})`,
        );
        for (const pending of this.pending.splice(0)) {
          clearTimeout(pending.timeout);
          pending.reject(error);
        }
        resolvePromise({ code, signal });
      });
    });
    this.child.on("error", (error) => {
      for (const pending of this.pending.splice(0)) {
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
    });
  }

  #consumeStdout(chunk) {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      const line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.length === 0) {
        continue;
      }
      const pending = this.pending.shift();
      if (!pending) {
        continue;
      }
      clearTimeout(pending.timeout);
      try {
        pending.resolve(JSON.parse(line));
      } catch (error) {
        pending.reject(new Error(`runtime emitted invalid JSON: ${error.message}`));
      }
    }
  }

  #consumeStderr(chunk) {
    this.stderrBuffer += chunk;
    while (true) {
      const newline = this.stderrBuffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      const line = this.stderrBuffer.slice(0, newline);
      this.stderrBuffer = this.stderrBuffer.slice(newline + 1);
      if (line.length > 0) {
        this.stderrLines.push(line);
      }
    }
  }

  request(payload, timeoutMs = this.timeoutMs) {
    if (this.closed) {
      return Promise.reject(new Error("runtime is already closed"));
    }
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        const index = this.pending.findIndex((entry) => entry.timeout === timeout);
        if (index !== -1) {
          this.pending.splice(index, 1);
        }
        rejectPromise(new Error(`runtime request exceeded ${timeoutMs} ms`));
        if (!this.closed) {
          this.child.kill("SIGKILL");
        }
      }, timeoutMs);
      this.pending.push({ resolve: resolvePromise, reject: rejectPromise, timeout });
      this.child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) {
          return;
        }
        const index = this.pending.findIndex((entry) => entry.timeout === timeout);
        if (index !== -1) {
          this.pending.splice(index, 1);
        }
        clearTimeout(timeout);
        rejectPromise(error);
      });
    });
  }

  async shutdown() {
    if (this.closed) {
      return this.exit;
    }
    const response = await this.request({ method: "shutdown" });
    if (response.ok !== true || response.shutdown !== true) {
      throw new Error(`runtime rejected shutdown: ${JSON.stringify(response)}`);
    }
    this.child.stdin.end();
    return this.exit;
  }

  async killForcefully() {
    if (!this.closed) {
      this.child.kill("SIGKILL");
    }
    return this.exit;
  }

  parsedLogs() {
    return this.stderrLines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { schema_version: null, event: "unparsed_stderr", line };
      }
    });
  }
}
