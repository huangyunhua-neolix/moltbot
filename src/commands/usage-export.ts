import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "../config/config.js";
import { loadSessionStore, resolveStorePath, type SessionEntry } from "../config/sessions.js";
import type { RuntimeEnv } from "../runtime.js";
import { isRich, theme } from "../terminal/theme.js";

export type UsageExportOptions = {
  json?: boolean;
  csv?: boolean;
  output?: string;
  store?: string;
  minTokens?: string;
};

export type UsageExportRow = {
  key: string;
  label: string;
  from: string;
  channel: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  updatedAt: number | null;
};

const LABEL_PAD = 24;
const FROM_PAD = 20;
const CHANNEL_PAD = 12;
const MODEL_PAD = 14;
const NUM_PAD = 9;

const commaNum = (n: number) => n.toLocaleString("en-US");

function resolveLabel(key: string, entry: SessionEntry): string {
  return entry.label ?? entry.displayName ?? entry.origin?.label ?? key;
}

function resolveFrom(key: string, entry: SessionEntry): string {
  return entry.origin?.from ?? entry.lastTo ?? key;
}

function resolveChannel(entry: SessionEntry): string {
  return entry.origin?.provider ?? entry.lastChannel ?? entry.channel ?? "";
}

function toRow(key: string, entry: SessionEntry): UsageExportRow {
  const input = entry.inputTokens ?? 0;
  const output = entry.outputTokens ?? 0;
  const total = entry.totalTokens ?? input + output;
  return {
    key,
    label: resolveLabel(key, entry),
    from: resolveFrom(key, entry),
    channel: resolveChannel(entry),
    model: entry.model ?? "",
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    updatedAt: entry.updatedAt ?? null,
  };
}

function toCsvLine(fields: string[]): string {
  return fields
    .map((f) => {
      const s = String(f);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    })
    .join(",");
}

function buildCsv(rows: UsageExportRow[]): string {
  const header = toCsvLine([
    "session_key",
    "label",
    "from",
    "channel",
    "model",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "last_active_ms",
    "last_active",
  ]);
  const lines = rows.map((r) =>
    toCsvLine([
      r.key,
      r.label,
      r.from,
      r.channel,
      r.model,
      String(r.inputTokens),
      String(r.outputTokens),
      String(r.totalTokens),
      r.updatedAt !== null ? String(r.updatedAt) : "",
      r.updatedAt !== null ? new Date(r.updatedAt).toISOString() : "",
    ]),
  );
  return [header, ...lines].join("\n");
}

function renderTable(rows: UsageExportRow[], rich: boolean): string[] {
  const header = [
    "Label".padEnd(LABEL_PAD),
    "From".padEnd(FROM_PAD),
    "Channel".padEnd(CHANNEL_PAD),
    "Model".padEnd(MODEL_PAD),
    "Input".padStart(NUM_PAD),
    "Output".padStart(NUM_PAD),
    "Total".padStart(NUM_PAD),
  ].join(" ");

  const lines: string[] = [rich ? theme.heading(header) : header];

  for (const r of rows) {
    const label = r.label.slice(0, LABEL_PAD).padEnd(LABEL_PAD);
    const from = r.from.slice(0, FROM_PAD).padEnd(FROM_PAD);
    const channel = r.channel.slice(0, CHANNEL_PAD).padEnd(CHANNEL_PAD);
    const model = r.model.slice(0, MODEL_PAD).padEnd(MODEL_PAD);
    const input = commaNum(r.inputTokens).padStart(NUM_PAD);
    const output = commaNum(r.outputTokens).padStart(NUM_PAD);
    const total = commaNum(r.totalTokens).padStart(NUM_PAD);

    const line = [
      rich ? theme.accent(label) : label,
      rich ? theme.muted(from) : from,
      channel,
      rich ? theme.info(model) : model,
      input,
      output,
      rich ? theme.success(total) : total,
    ].join(" ");

    lines.push(line.trimEnd());
  }

  return lines;
}

export async function usageExportCommand(
  opts: UsageExportOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const cfg = loadConfig();
  const storePath = resolveStorePath(opts.store ?? cfg.session?.store);
  const store = loadSessionStore(storePath);

  let minTokens = 0;
  if (opts.minTokens !== undefined) {
    const parsed = Number.parseInt(opts.minTokens, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      runtime.error("--min-tokens must be a non-negative integer");
      runtime.exit(1);
      return;
    }
    minTokens = parsed;
  }

  const rows = Object.entries(store)
    .map(([key, entry]) => toRow(key, entry))
    .filter((r) => r.totalTokens >= minTokens)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  // Determine output content
  let content: string;
  if (opts.csv) {
    content = buildCsv(rows);
  } else if (opts.json) {
    content = JSON.stringify(
      {
        path: storePath,
        exportedAt: new Date().toISOString(),
        count: rows.length,
        sessions: rows,
      },
      null,
      2,
    );
  } else {
    content = "";
  }

  // Write to file or stdout
  if (opts.output) {
    const outPath = path.resolve(opts.output);
    if (!opts.csv && !opts.json) {
      // default to CSV when writing to file
      content = buildCsv(rows);
    }
    fs.writeFileSync(outPath, content + "\n", "utf-8");
    runtime.log(`Exported ${rows.length} session(s) to ${outPath}`);
    return;
  }

  if (opts.csv || opts.json) {
    runtime.log(content);
    return;
  }

  // Default: text table
  const rich = isRich();
  runtime.log(`Session store: ${storePath}`);
  runtime.log(`Sessions exported: ${rows.length}`);
  if (minTokens > 0) {
    runtime.log(`Min tokens filter: ${minTokens}`);
  }
  if (rows.length === 0) {
    runtime.log("No sessions found.");
    return;
  }
  for (const line of renderTable(rows, rich)) {
    runtime.log(line);
  }
}
