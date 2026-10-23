import { ok } from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { Context, Fixture } from "./shim-fixture.ts";

interface Numbers {
	readonly fiveHour: number | "unknown";
	readonly sevenDay: number | "unknown";
}
const window = (
	utilization: number | "unknown",
	resetAt: string,
): Readonly<{ resetAt: string; utilization: number }> | "unknown" => {
	if (utilization === "unknown") {
		return "unknown";
	}
	return { resetAt, utilization };
};
const healthy: Numbers = { fiveHour: 10, sevenDay: 1 };
const start = 0;
const suffixLength = 8;
const hashLength = 64;
const timeout = 10_000;
const seatDirectory = (setup: Fixture, name: string): string => {
	if (name === "main") {
		return path.join(setup.home, ".claude");
	}
	return path.join(setup.home, `.claude-${name}`);
};
const writeKeys = async (
	directory: string,
	pids: readonly number[],
): Promise<void> => {
	await mkdir(directory, { recursive: true });
	await Promise.all(
		pids.map(async (pid, index): Promise<void> => {
			await writeFile(
				path.join(
					directory,
					`${pid}.${String(index).padStart(hashLength, "0")}.key`,
				),
				'{"pidDomain":"local"}',
			);
		}),
	);
};
const slotFor = (setup: Fixture, name: string): string => {
	if (name === "main") {
		return "Claude Code-credentials";
	}
	const hash = createHash("sha256")
		.update(path.join(setup.home, `.claude-${name}`))
		.digest("hex")
		.slice(start, suffixLength);
	return `Claude Code-credentials-${hash}`;
};
const seedRouting = async (
	setup: Fixture,
	values: Readonly<Record<string, Numbers>> = {},
): Promise<void> => {
	const state = path.join(setup.directory, "state");
	await mkdir(state, { recursive: true });
	await Promise.all(
		["main", "dev", "dev2", "dev3"].map(async (name): Promise<void> => {
			// Fresh usage caches need presence only, so no synthetic OAuth token is needed.
			await writeFile(
				path.join(setup.keychain, `${slotFor(setup, name)}.json`),
				"{}",
			);
			const numbers = values[name] ?? healthy;
			await writeFile(
				path.join(state, `usage-${name}.json`),
				JSON.stringify({
					fetchedAt: Date.now(),
					usage: {
						fiveHour: window(numbers.fiveHour, "2026-09-18T15:20:00.000Z"),
						sevenDay: window(numbers.sevenDay, "2026-09-25T11:00:00.000Z"),
					},
				}),
			);
		}),
	);
};
const seedSessions = async (
	setup: Fixture,
	name: string,
	pids: readonly number[],
): Promise<void> => {
	await writeKeys(path.join(seatDirectory(setup, name), "sessions"), pids);
};

// Every seat's sessions folder links to one registry, as cc install sets it up.
const seedSharedSessions = async (
	setup: Fixture,
	names: readonly string[],
	pids: readonly number[],
): Promise<void> => {
	const shared = path.join(setup.home, ".claude-shared", "sessions");
	await writeKeys(shared, pids);
	await Promise.all(
		names.map(async (name): Promise<void> => {
			const directory = seatDirectory(setup, name);
			await mkdir(directory, { recursive: true });
			await symlink(shared, path.join(directory, "sessions"));
		}),
	);
};

// A live process whose environment names its seat like a cc launch: main has no CLAUDE_CONFIG_DIR.
const startSession = async (
	context: Context,
	setup: Fixture,
	name: string,
): Promise<number> => {
	const env: Record<string, string> = {};
	if (name !== "main") {
		env["CLAUDE_CONFIG_DIR"] = seatDirectory(setup, name);
	}
	const child = spawn(process.execPath, ["-e", "process.stdin.resume()"], {
		env,
		timeout,
	});
	context.after(async (): Promise<void> => {
		if (child.exitCode === null && child.signalCode === null) {
			const closed = once(child, "close");
			child.stdin.end();
			await closed;
		}
	});
	await once(child, "spawn");
	ok(typeof child.pid === "number");
	return child.pid;
};

export { seedRouting, seedSessions, seedSharedSessions, slotFor, startSession };
