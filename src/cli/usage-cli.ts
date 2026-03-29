import type { Command } from "commander";
import { usageExportCommand } from "../commands/usage-export.js";
import { setVerbose } from "../globals.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { runCommandWithRuntime } from "./cli-utils.js";
import { formatHelpExamples } from "./help-format.js";

export function registerUsageCli(program: Command) {
  const usageCmd = program
    .command("usage")
    .description("Token usage reporting and export");

  usageCmd
    .command("export")
    .description("Export token usage for all sessions")
    .option("--json", "Output as JSON", false)
    .option("--csv", "Output as CSV", false)
    .option("--output <file>", "Write output to file (defaults to CSV format)")
    .option("--store <path>", "Path to session store (default: resolved from config)")
    .option("--min-tokens <n>", "Only include sessions with at least N total tokens")
    .option("--verbose", "Verbose logging", false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["moltbot usage export", "Show token usage table for all sessions."],
          ["moltbot usage export --csv", "Print CSV to stdout."],
          ["moltbot usage export --json", "Print JSON to stdout."],
          ["moltbot usage export --output usage.csv", "Write CSV file."],
          ["moltbot usage export --min-tokens 1000", "Only sessions with ≥1,000 tokens."],
        ])}`,
    )
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/usage", "docs.molt.bot/cli/usage")}\n`,
    )
    .action(async (opts) => {
      setVerbose(Boolean(opts.verbose));
      await runCommandWithRuntime(defaultRuntime, async () => {
        await usageExportCommand(
          {
            json: Boolean(opts.json),
            csv: Boolean(opts.csv),
            output: opts.output as string | undefined,
            store: opts.store as string | undefined,
            minTokens: opts.minTokens as string | undefined,
          },
          defaultRuntime,
        );
      });
    });
}
