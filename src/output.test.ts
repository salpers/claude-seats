import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { SeatRow } from "./output.ts";
import { formatSeats, formatSeatUsage } from "./output.ts";
import { createSeats } from "./seats.ts";
import type { SeatUsage } from "./usage-probe.ts";
import { usage } from "./usage-test-fixture.ts";

const rowCount = 5;
const absentParts = 2;
const presentParts = 4;
const mainRow = 1;
const noMatch = -1;
const bareSlot = "Claude Code-credentials";
const liveCounts = { dev: 1, dev2: 0, dev3: 2, main: 0 };

await test("usage rows use local 24-hour clocks and a weekday for weekly resets", (): void => {
	const value: SeatUsage = { cachedAgeMs: 0, ok: true, usage };
	strictEqual(
		formatSeatUsage(value, "Europe/Berlin"),
		"5h 10% ↻17:20  7d 1% ↻Fri 13:00",
	);
	strictEqual(
		formatSeatUsage(value, "America/New_York"),
		"5h 10% ↻11:20  7d 1% ↻Fri 07:00",
	);
	strictEqual(
		formatSeatUsage(value),
		formatSeatUsage(
			value,
			new Intl.DateTimeFormat().resolvedOptions().timeZone,
		),
	);
	strictEqual(
		formatSeatUsage({ ...value, cachedAgeMs: 180_000 }, "Europe/Berlin"),
		"5h 10% ↻17:20  7d 1% ↻Fri 13:00 (cached 3m ago)",
	);
});

await test("unknown usage, null windows and missing reset clocks remain explicit", (): void => {
	strictEqual(
		formatSeatUsage({ ok: false, reason: "HTTP 429" }),
		"5h ?  7d ? (HTTP 429)",
	);
	strictEqual(
		formatSeatUsage({ ok: false, reason: "not logged in" }),
		"5h ?  7d ? (not logged in)",
	);
	strictEqual(
		formatSeatUsage({
			cachedAgeMs: 0,
			ok: true,
			usage: {
				fiveHour: "unknown",
				sevenDay: { resetAt: "unknown", utilization: 0 },
			},
		}),
		"5h ?  7d 0%",
	);
});

const buildRows = (): readonly SeatRow[] =>
	createSeats("/tmp/seat\nhome").map((seat): SeatRow => {
		let result: SeatUsage = { cachedAgeMs: 0, ok: true, usage };
		if (seat.name === "dev") {
			result = { ok: false, reason: "not logged in" };
		}
		return {
			credential: { ok: true, present: seat.name !== "dev" },
			live: liveCounts[seat.name],
			seat,
			usage: result,
		};
	});

await test("the table isolates missing credentials from successful rows", (): void => {
	const table = formatSeats(buildRows());
	strictEqual(table.split("\n").length, rowCount);
	ok(table.startsWith("seat  5h"));
	strictEqual(table.split("not logged in").length, absentParts);
	strictEqual(table.split("10%").length, presentParts);
	ok(!table.includes(".claude-api"));
});

await test("every column is padded to a shared width", (): void => {
	const lines = formatSeats(buildRows()).split("\n");
	const mainLine = lines.at(mainRow) ?? "";
	// Every seat row starts its keychain-slot column at the same offset.
	deepStrictEqual(
		new Set(lines.map((row): number => row.indexOf(bareSlot))),
		new Set([noMatch, mainLine.indexOf(bareSlot)]),
	);
	// A control character in HOME stays quoted so the row cannot break.
	ok(mainLine.includes(JSON.stringify("/tmp/seat\nhome/.claude")));
});
