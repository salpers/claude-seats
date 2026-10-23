import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Fixture } from "./shim-fixture.ts";

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
	let seatDirectory = `.claude-${name}`;
	if (name === "main") {
		seatDirectory = ".claude";
	}
	const directory = path.join(setup.home, seatDirectory, "sessions");
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

export { seedRouting, seedSessions, slotFor };
