import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  codexLocalDirectory,
  deleteStoredCodexConnection,
  readStoredCodexConfig
} from "../src/connectors/codex/localStore";
import {
  deleteStoredGitHubConnection,
  githubLocalDirectory,
  readStoredGitHubTokens
} from "../src/connectors/github/localStore";
import {
  deleteStoredGoogleCalendarConnection,
  googleCalendarLocalDirectory,
  readStoredTokens as readStoredGoogleCalendarTokens
} from "../src/connectors/googleCalendar/localStore";
import {
  cleanupStaleConnectorTempFiles,
  CONNECTOR_TEMP_FILE_GRACE_MS,
  withActiveConnectorTempFile
} from "../src/connectors/localTempCleanup";
import {
  deleteStoredNotionConnection,
  notionLocalDirectory,
  readStoredNotionTokens
} from "../src/connectors/notion/localStore";

const temporaryDirectories: string[] = [];

const connectorStores = [
  {
    name: "GitHub",
    directoryFor: githubLocalDirectory,
    canonicalBasenames: ["tokens.json", "snapshot.json"],
    read: readStoredGitHubTokens,
    disconnect: deleteStoredGitHubConnection
  },
  {
    name: "Google Calendar",
    directoryFor: googleCalendarLocalDirectory,
    canonicalBasenames: ["tokens.json", "snapshot.json"],
    read: readStoredGoogleCalendarTokens,
    disconnect: deleteStoredGoogleCalendarConnection
  },
  {
    name: "Notion",
    directoryFor: notionLocalDirectory,
    canonicalBasenames: ["tokens.json", "snapshot.json"],
    read: readStoredNotionTokens,
    disconnect: deleteStoredNotionConnection
  },
  {
    name: "Codex",
    directoryFor: codexLocalDirectory,
    canonicalBasenames: [
      "config.json",
      "snapshot.json",
      "observation-history.json"
    ],
    read: readStoredCodexConfig,
    disconnect: deleteStoredCodexConnection
  }
] as const;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("connector crash-temp cleanup", () => {
  it("matches only strict atomic basenames and protects fresh and active files", async () => {
    const directory = await createTempDirectory();
    const nowMs = Date.parse("2026-07-29T12:00:00.000Z");
    const oldDate = new Date(
      nowMs - CONNECTOR_TEMP_FILE_GRACE_MS - 1
    );
    const graceBoundary = new Date(
      nowMs - CONNECTOR_TEMP_FILE_GRACE_MS
    );
    const stale =
      "tokens.json.42001.0123456789abcdef.tmp";
    const fresh =
      "tokens.json.42002.abcdef0123456789.tmp";
    const active =
      "snapshot.json.42003.1111111111111111.tmp";
    const preserved = [
      "tokens.json",
      "snapshot.json",
      "other.json.42001.0123456789abcdef.tmp",
      "tokens.json.0.0123456789abcdef.tmp",
      "tokens.json.42001.0123456789abcde.tmp",
      "tokens.json.42001.fedcba9876543ABC.tmp",
      "tokens.json.42001.0123456789abcdef.tmp.extra",
      "tokens.json.42001.0123456789abcdef"
    ];

    await Promise.all(
      [stale, fresh, active, ...preserved].map((basename) =>
        writeFile(join(directory, basename), basename, "utf8")
      )
    );
    await Promise.all([
      utimes(join(directory, stale), oldDate, oldDate),
      utimes(join(directory, active), oldDate, oldDate),
      utimes(join(directory, fresh), graceBoundary, graceBoundary)
    ]);

    await withActiveConnectorTempFile(
      join(directory, active),
      async () => {
        await expect(
          cleanupStaleConnectorTempFiles({
            directory,
            canonicalBasenames: ["tokens.json", "snapshot.json"],
            nowMs
          })
        ).resolves.toEqual([stale]);
      }
    );

    await expect(readdir(directory)).resolves.toEqual(
      expect.arrayContaining([fresh, active, ...preserved])
    );
    await expect(
      cleanupStaleConnectorTempFiles({
        directory,
        canonicalBasenames: ["tokens.json", "snapshot.json"],
        nowMs
      })
    ).resolves.toEqual([active]);
  });

  it.each(connectorStores)(
    "cleans an old $name temp during a startup read without touching canonical or unrelated files",
    async ({ directoryFor, canonicalBasenames, read }) => {
      const cwd = await createTempDirectory();
      const directory = directoryFor(cwd);
      const canonical = canonicalBasenames[0];
      const stale =
        `${canonical}.73001.0123456789abcdef.tmp`;
      const unrelated = "operator-notes.txt";
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, canonical), "canonical", "utf8");
      await writeFile(join(directory, stale), "abandoned", "utf8");
      await writeFile(join(directory, unrelated), "keep", "utf8");
      await makeStale(join(directory, stale));

      await read(cwd);

      await expect(access(join(directory, stale))).rejects.toMatchObject({
        code: "ENOENT"
      });
      await expect(
        access(join(directory, canonical))
      ).resolves.toBeUndefined();
      await expect(
        access(join(directory, unrelated))
      ).resolves.toBeUndefined();
    }
  );

  it.each(connectorStores)(
    "removes all recognized inactive $name temps on disconnect while preserving unrelated files",
    async ({ directoryFor, canonicalBasenames, disconnect }) => {
      const cwd = await createTempDirectory();
      const directory = directoryFor(cwd);
      const externalPid = process.pid + 100_000;
      const nonce = "0123456789abcdef";
      const staleTemps = canonicalBasenames.map(
        (basename) => `${basename}.${externalPid}.${nonce}.tmp`
      );
      const fresh =
        `${canonicalBasenames[0]}.${externalPid + 1}.` +
        "abcdef0123456789.tmp";
      const unrelated =
        `unrelated.json.${externalPid}.${nonce}.tmp`;

      await mkdir(directory, { recursive: true });
      await Promise.all([
        ...canonicalBasenames.map((basename) =>
          writeFile(join(directory, basename), "canonical", "utf8")
        ),
        ...staleTemps.map((basename) =>
          writeFile(join(directory, basename), "abandoned", "utf8")
        ),
        writeFile(join(directory, fresh), "active", "utf8"),
        writeFile(join(directory, unrelated), "keep", "utf8")
      ]);
      await Promise.all(
        staleTemps.map((basename) =>
          makeStale(join(directory, basename))
        )
      );

      await disconnect(cwd);

      for (const basename of canonicalBasenames) {
        await expect(
          access(join(directory, basename))
        ).rejects.toMatchObject({ code: "ENOENT" });
      }
      for (const basename of staleTemps) {
        await expect(
          access(join(directory, basename))
        ).rejects.toMatchObject({ code: "ENOENT" });
      }
      await expect(
        access(join(directory, fresh))
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        access(join(directory, unrelated))
      ).resolves.toBeUndefined();
    }
  );
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "blabase-connector-temp-cleanup-")
  );
  temporaryDirectories.push(directory);
  return directory;
}

async function makeStale(path: string): Promise<void> {
  const stale = new Date(
    Date.now() - CONNECTOR_TEMP_FILE_GRACE_MS - 60_000
  );
  await utimes(path, stale, stale);
}
