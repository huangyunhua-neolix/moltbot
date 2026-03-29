import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Disable colors for deterministic snapshots.
process.env.FORCE_COLOR = "0";

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => ({}),
  };
});

import { usageExportCommand } from "./usage-export.js";

const makeRuntime = () => {
  const logs: string[] = [];
  const errors: string[] = [];
  let exitCode: number | null = null;
  return {
    runtime: {
      log: (msg: unknown) => logs.push(String(msg)),
      error: (msg: unknown) => errors.push(String(msg)),
      exit: (code: number) => {
        exitCode = code;
        throw new Error(`exit ${code}`);
      },
    },
    logs,
    errors,
    get exitCode() {
      return exitCode;
    },
  } as const;
};

const writeStore = (data: unknown) => {
  const file = path.join(
    os.tmpdir(),
    `usage-export-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
};

const sampleStore = {
  "+15555550123": {
    sessionId: "abc123",
    updatedAt: 1_700_000_000_000,
    label: "Alice",
    origin: { from: "+15555550123", provider: "whatsapp" },
    model: "pi:opus",
    inputTokens: 1200,
    outputTokens: 800,
    totalTokens: 2000,
  },
  "discord:user:bob": {
    sessionId: "def456",
    updatedAt: 1_699_900_000_000,
    label: "Bob",
    origin: { from: "bob#1234", provider: "discord" },
    model: "pi:sonnet",
    inputTokens: 500,
    outputTokens: 300,
    totalTokens: 800,
  },
  "telegram:no-tokens": {
    sessionId: "ghi789",
    updatedAt: 1_699_800_000_000,
    origin: { from: "tguser", provider: "telegram" },
    model: "pi:haiku",
  },
};

describe("usageExportCommand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-06T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a text table with session rows", async () => {
    const store = writeStore(sampleStore);
    const { runtime, logs } = makeRuntime();
    await usageExportCommand({ store }, runtime);
    fs.rmSync(store);

    const header = logs.find((l) => l.includes("Label"));
    expect(header).toBeTruthy();
    expect(header).toContain("Input");
    expect(header).toContain("Output");
    expect(header).toContain("Total");

    const aliceRow = logs.find((l) => l.includes("Alice")) ?? "";
    expect(aliceRow).toContain("1,200");
    expect(aliceRow).toContain("800");
    expect(aliceRow).toContain("2,000");

    const bobRow = logs.find((l) => l.includes("Bob")) ?? "";
    expect(bobRow).toContain("500");
  });

  it("outputs CSV when --csv flag is set", async () => {
    const store = writeStore(sampleStore);
    const { runtime, logs } = makeRuntime();
    await usageExportCommand({ store, csv: true }, runtime);
    fs.rmSync(store);

    const csv = logs.join("\n");
    expect(csv).toContain(
      "session_key,label,from,channel,model,input_tokens,output_tokens,total_tokens,last_active_ms,last_active",
    );
    expect(csv).toContain("+15555550123");
    expect(csv).toContain("Alice");
    expect(csv).toContain("1200");
    expect(csv).toContain("whatsapp");
  });

  it("outputs JSON when --json flag is set", async () => {
    const store = writeStore(sampleStore);
    const { runtime, logs } = makeRuntime();
    await usageExportCommand({ store, json: true }, runtime);
    fs.rmSync(store);

    const parsed = JSON.parse(logs.join("")) as {
      count: number;
      sessions: Array<{ key: string; totalTokens: number }>;
    };
    expect(parsed.count).toBe(3);
    const alice = parsed.sessions.find((s) => s.key === "+15555550123");
    expect(alice?.totalTokens).toBe(2000);
  });

  it("filters by --min-tokens", async () => {
    const store = writeStore(sampleStore);
    const { runtime, logs } = makeRuntime();
    await usageExportCommand({ store, json: true, minTokens: "1000" }, runtime);
    fs.rmSync(store);

    const parsed = JSON.parse(logs.join("")) as {
      count: number;
      sessions: Array<{ key: string }>;
    };
    // Only Alice (2000 tokens) should pass the 1000 threshold
    expect(parsed.count).toBe(1);
    expect(parsed.sessions[0]?.key).toBe("+15555550123");
  });

  it("writes CSV to file when --output is specified", async () => {
    const store = writeStore(sampleStore);
    const outFile = path.join(
      os.tmpdir(),
      `usage-export-out-${Date.now()}.csv`,
    );
    const { runtime, logs } = makeRuntime();
    await usageExportCommand({ store, output: outFile }, runtime);
    fs.rmSync(store);

    expect(logs[0]).toContain("Exported");
    expect(logs[0]).toContain("3");
    const content = fs.readFileSync(outFile, "utf-8");
    fs.rmSync(outFile);
    expect(content).toContain("session_key");
    expect(content).toContain("Alice");
  });

  it("rejects invalid --min-tokens value", async () => {
    const store = writeStore(sampleStore);
    const { runtime, errors } = makeRuntime();
    await expect(
      usageExportCommand({ store, minTokens: "bad" }, runtime),
    ).rejects.toThrow("exit 1");
    fs.rmSync(store);
    expect(errors[0]).toContain("--min-tokens");
  });
});
