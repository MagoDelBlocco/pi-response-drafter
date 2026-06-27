/**
 * /draft command argument parsing.
 *
 * Kept free of runtime dependencies (no pi-ai/pi-tui imports) so it can be unit
 * tested in isolation — same discipline as schema.ts / context.ts.
 */

/**
 * Parse the `auto` subcommand of /draft. Returns null for ordinary draft input,
 * so anything that isn't an exact auto-toggle phrase is treated as text to draft
 * (e.g. "automate the build" is drafted, not interpreted as a toggle).
 */
export function parseAutoSubcommand(args: string): "on" | "off" | "toggle" | null {
  const a = args.trim().toLowerCase().replace(/\s+/g, " ");
  if (a === "auto") return "toggle";
  if (a === "auto on" || a === "auto enable") return "on";
  if (a === "auto off" || a === "auto disable") return "off";
  return null;
}
