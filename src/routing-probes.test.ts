import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { test } from "node:test";
import { readFallbackState } from "./fallback-state.ts";
import type { RoutingSeat } from "./router.ts";
import type { RoutingResult } from "./routing-audit.ts";
import { routeWithState } from "./routing-state.ts";
import type { SeatName } from "./seats.ts";

const zero = 0;
const busyLive = 5;
const minuteMs = 60_000;
type Context = Readonly<Pick<TestContext, "after">>;
const rows: readonly RoutingSeat[] = [
	{ live: 0, probe: true, seat: "main", usage: "unknown" },
	{ live: 0, probe: true, seat: "dev", usage: "unknown" },
	{ live: 0, probe: true, seat: "dev2", usage: "unknown" },
	{ live: 0, probe: true, seat: "dev3", usage: "unknown" },
];
const fixture = async (context: Context): Promise<string> => {
	const directory = await mkdtemp(path.join(tmpdir(), "claude-seats-probes-"));
	context.after(async (): Promise<void> => {
		await rm(directory, { force: true, recursive: true });
	});
	return directory;
};

interface HeldProbe {
	readonly ready: Promise<boolean>;
	readonly release: () => void;
	readonly result: Promise<RoutingResult>;
}
const holdProbes = (
	directory: string,
	readSeats: () => readonly RoutingSeat[],
): HeldProbe => {
	const entered = Promise.withResolvers<boolean>();
	const resume = Promise.withResolvers<boolean>();
	const result = routeWithState(directory, readSeats, {
		probe: async () => {
			entered.resolve(true);
			await resume.promise;
			return { kind: "available" };
		},
	});
	return {
		ready: entered.promise,
		release: (): void => {
			resume.resolve(true);
		},
		result,
	};
};
const fastCooldown = async (
	directory: string,
	until: number,
): Promise<void> => {
	const result = await routeWithState(directory, () => rows, {
		probe: (seat: SeatName) => {
			if (seat === "main") {
				return { kind: "cooldown", until };
			}
			return { kind: "available" };
		},
	});
	ok(result.ok);
	strictEqual(result.decision.seat, "dev");
};
const assertCooldown = async (
	directory: string,
	result: RoutingResult,
	until: number,
): Promise<void> => {
	ok(result.ok);
	strictEqual(result.decision.seat, "dev3");
	deepStrictEqual(await readFallbackState(directory), {
		ok: true,
		state: { cooldowns: [{ seat: "main", until }], lastSeat: "dev3" },
	});
	const log = await readFile(path.join(directory, "decisions.log"), "utf8");
	strictEqual(log.includes('"status":"cooldown"'), true);
};

await test("slow probes re-read cooldowns, live counts and claims before reserving", async (context: Context): Promise<void> => {
	const directory = await fixture(context);
	let live = zero;
	const pending = holdProbes(directory, () =>
		rows.map((row) => {
			if (row.seat === "dev2") {
				return { ...row, live };
			}
			return row;
		}),
	);
	await pending.ready;
	const until = Date.now() + minuteMs;
	try {
		await fastCooldown(directory, until);
		live = busyLive;
	} finally {
		pending.release();
	}
	await assertCooldown(directory, await pending.result, until);
});

const reserveFirst = async (directory: string): Promise<void> => {
	const result = await routeWithState(directory, () => rows, {
		probe: () => ({ kind: "available" }),
	});
	ok(result.ok);
	strictEqual(result.decision.seat, "main");
	await writeFile(path.join(directory, "claims.json"), "[]");
};
await test("slow probes use the current round-robin cursor even when earlier claims expire", async (context: Context): Promise<void> => {
	const directory = await fixture(context);
	const pending = holdProbes(directory, () => rows);
	await pending.ready;
	try {
		await reserveFirst(directory);
	} finally {
		pending.release();
	}
	const result = await pending.result;
	ok(result.ok);
	strictEqual(result.decision.seat, "dev");
});
