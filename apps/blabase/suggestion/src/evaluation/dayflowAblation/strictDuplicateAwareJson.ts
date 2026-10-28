export type StrictDuplicateAwareJsonIssueCode =
  | "DUPLICATE_JSON_KEY"
  | "INVALID_JSON";

export class StrictDuplicateAwareJsonParseError extends SyntaxError {
  readonly issueCode: StrictDuplicateAwareJsonIssueCode;

  constructor(issueCode: StrictDuplicateAwareJsonIssueCode) {
    super("Strict duplicate-aware JSON parse failed");
    this.name = "StrictDuplicateAwareJsonParseError";
    this.issueCode = issueCode;
  }
}

class StrictJsonParser {
  private index = 0;

  constructor(private readonly text: string) {}

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.text.length) this.fail("INVALID_JSON");
    return value;
  }

  private fail(issueCode: StrictDuplicateAwareJsonIssueCode): never {
    throw new StrictDuplicateAwareJsonParseError(issueCode);
  }

  private skipWhitespace(): void {
    while (
      this.text[this.index] === " " ||
      this.text[this.index] === "\t" ||
      this.text[this.index] === "\n" ||
      this.text[this.index] === "\r"
    ) {
      this.index += 1;
    }
  }

  private parseValue(): unknown {
    const token = this.text[this.index];
    if (token === "{") return this.parseObject();
    if (token === "[") return this.parseArray();
    if (token === '"') return this.parseString();
    if (token === "t") return this.parseLiteral("true", true);
    if (token === "f") return this.parseLiteral("false", false);
    if (token === "n") return this.parseLiteral("null", null);
    if (token === "-" || (token !== undefined && /[0-9]/u.test(token))) {
      return this.parseNumber();
    }
    return this.fail("INVALID_JSON");
  }

  private parseObject(): Record<string, unknown> {
    this.index += 1;
    this.skipWhitespace();
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return result;
    }

    while (this.index < this.text.length) {
      if (this.text[this.index] !== '"') this.fail("INVALID_JSON");
      const key = this.parseString();
      if (keys.has(key)) this.fail("DUPLICATE_JSON_KEY");
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.fail("INVALID_JSON");
      this.index += 1;
      this.skipWhitespace();
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: this.parseValue(),
        writable: true,
      });
      this.skipWhitespace();
      const delimiter = this.text[this.index];
      if (delimiter === "}") {
        this.index += 1;
        return result;
      }
      if (delimiter !== ",") this.fail("INVALID_JSON");
      this.index += 1;
      this.skipWhitespace();
    }
    return this.fail("INVALID_JSON");
  }

  private parseArray(): unknown[] {
    this.index += 1;
    this.skipWhitespace();
    const result: unknown[] = [];
    if (this.text[this.index] === "]") {
      this.index += 1;
      return result;
    }

    while (this.index < this.text.length) {
      result.push(this.parseValue());
      this.skipWhitespace();
      const delimiter = this.text[this.index];
      if (delimiter === "]") {
        this.index += 1;
        return result;
      }
      if (delimiter !== ",") this.fail("INVALID_JSON");
      this.index += 1;
      this.skipWhitespace();
    }
    return this.fail("INVALID_JSON");
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const token = this.text[this.index]!;
      if (token === "\\") {
        this.index += 2;
        continue;
      }
      if (token === '"') {
        this.index += 1;
        try {
          const value: unknown = JSON.parse(
            this.text.slice(start, this.index),
          );
          if (typeof value !== "string") return this.fail("INVALID_JSON");
          return value;
        } catch {
          return this.fail("INVALID_JSON");
        }
      }
      if (token.charCodeAt(0) <= 0x1f) this.fail("INVALID_JSON");
      this.index += 1;
    }
    return this.fail("INVALID_JSON");
  }

  private parseLiteral<T>(literal: string, value: T): T {
    if (this.text.slice(this.index, this.index + literal.length) !== literal) {
      return this.fail("INVALID_JSON");
    }
    this.index += literal.length;
    return value;
  }

  private parseNumber(): number {
    const match =
      /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
        this.text.slice(this.index),
      );
    if (match === null) return this.fail("INVALID_JSON");
    this.index += match[0].length;
    const delimiter = this.text[this.index];
    if (
      delimiter !== undefined &&
      delimiter !== " " &&
      delimiter !== "\t" &&
      delimiter !== "\n" &&
      delimiter !== "\r" &&
      delimiter !== "," &&
      delimiter !== "]" &&
      delimiter !== "}"
    ) {
      return this.fail("INVALID_JSON");
    }
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return this.fail("INVALID_JSON");
    return value;
  }
}

export function parseStrictDuplicateAwareJson(text: string): unknown {
  if (typeof text !== "string") {
    throw new StrictDuplicateAwareJsonParseError("INVALID_JSON");
  }
  return new StrictJsonParser(text).parse();
}
