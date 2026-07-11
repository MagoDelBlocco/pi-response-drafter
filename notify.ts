/**
 * Desktop notification utility — mirrors the ask-user extension's notify-send approach.
 */

import { spawn } from "node:child_process";

/**
 * Fire a desktop notification via `notify-send`.
 *
 * Failures to spawn (e.g. `notify-send` not installed) are silently ignored so
 * the extension never crashes because of the notification layer.
 */
export function notifyDesktop(summary: string, body: string): void {
	try {
		const child = spawn("notify-send", [summary, body], {
			detached: true,
			stdio: "ignore",
		});
		child.on("error", () => {});
		child.unref();
	} catch {
		// Swallow silently — a missing notify-send must not crash the extension.
		// oculus-disable-next-line oculus/error-swallowing
	}
}
