import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { Claim, RoutingSeat } from "./router.ts";
import { chooseSeat } from "./router.ts";
import { healthy, now, row } from "./router-test-fixture.ts";

await test("excludes exhausted windows and ranks live sessions before weekly usage", (): void => {
	const rows = [
		row("main", { sevenDay: 100 }),
		row("dev", { fiveHour: 100 }),
		row("dev2", { live: 1, sevenDay: 52 }),
		row("dev3", { live: 2 }),
	];
	const before = structuredClone(rows);
	const decision = chooseSeat(rows, [], { now });
	strictEqual(decision.seat, "dev2");
	strictEqual(decision.mode, "auto");
	strictEqual(decision.reason.includes("fewest live"), true);
	deepStrictEqual(rows, before);
	deepStrictEqual(
		decision.rows.map((entry) => entry.status),
		["exhausted", "exhausted", "healthy", "healthy"],
	);
});

await test("90% 5h sorts last on equal live counts even with lower weekly usage", (): void => {
	for (const values of [
		{ fiveHour: 90 },
		{ fiveHour: 92 },
		{ fiveHour: 99.9 },
	]) {
		strictEqual(
			chooseSeat(
				[
					row("dev2", { ...values, live: 1, sevenDay: 0 }),
					row("dev3", { live: 1, sevenDay: 52 }),
				],
				[],
				{ now },
			).seat,
			"dev3",
		);
	}
	strictEqual(
		chooseSeat([row("dev2", { fiveHour: 92 }), row("dev3", { live: 1 })], [], {
			now,
		}).seat,
		"dev2",
	);
	strictEqual(
		chooseSeat(
			[
				row("dev2", { fiveHour: 89.9, live: 1, sevenDay: 0 }),
				row("dev3", { live: 1, sevenDay: 52 }),
			],
			[],
			{ now },
		).seat,
		"dev2",
	);
});

await test("weekly usage breaks remaining ties, then registry order", (): void => {
	strictEqual(
		chooseSeat(
			[row("dev2", { live: 1, sevenDay: 52 }), row("dev3", { live: 1 })],
			[],
			{ now },
		).seat,
		"dev3",
	);
	strictEqual(chooseSeat(healthy, [], { now }).seat, "main");
});

await test("rows arrive in registry order, so ties keep the row order of any seat names", (): void => {
	for (const { rows, expected } of [
		{ expected: "dev3", rows: healthy.toReversed() },
		{ expected: "dev3", rows: [row("dev3"), row("dev2")] },
		{
			expected: "work",
			rows: [row("work"), row("main", { fiveHour: 100 }), row("dev")],
		},
	]) {
		const before = structuredClone(rows);
		strictEqual(chooseSeat(rows, [], { now }).seat, expected);
		deepStrictEqual(rows, before);
	}
});

await test("all exhausted refuses, including utilization above 100", (): void => {
	const decision = chooseSeat(
		[row("main", { fiveHour: 100 }), row("dev", { sevenDay: 101 })],
		[],
		{ now },
	);
	strictEqual(decision.seat, "none");
	strictEqual(decision.reason, "all seats exhausted");
});

await test("unknown usage is not mistaken for healthy or exhausted", (): void => {
	const unknown: RoutingSeat = { live: 0, seat: "main", usage: "unknown" };
	strictEqual(chooseSeat([unknown, row("dev")], [], { now }).seat, "dev");
	strictEqual(
		chooseSeat([unknown, row("dev", { fiveHour: 100 })], [], { now }).reason,
		"usage unavailable",
	);
	strictEqual(chooseSeat([], [], { now }).reason, "usage unavailable");
	strictEqual(
		chooseSeat(
			[{ ...row("main"), usage: { fiveHour: "unknown", sevenDay: "unknown" } }],
			[],
			{ now },
		).seat,
		"none",
	);
	strictEqual(
		chooseSeat(
			[
				{
					...row("main"),
					usage: {
						fiveHour: "unknown",
						sevenDay: { resetAt: "unknown", utilization: 100 },
					},
				},
			],
			[],
			{ now },
		).reason,
		"all seats exhausted",
	);
});

await test("ten-second claims spread four launches and expire at the boundary", (): void => {
	const claims: Claim[] = [];
	for (const expected of ["main", "dev", "dev2", "dev3"]) {
		const decision = chooseSeat(healthy, claims, { now });
		strictEqual(decision.seat, expected);
		if (decision.seat !== "none") {
			claims.push({ createdAt: now, seat: decision.seat });
		}
	}
	for (const { age, expected } of [
		{ age: 9999, expected: "dev" },
		{ age: 10_000, expected: "main" },
		{ age: -1, expected: "main" },
	]) {
		strictEqual(
			chooseSeat(healthy, [{ createdAt: now - age, seat: "main" }], { now })
				.seat,
			expected,
		);
	}
});

await test("manual routing ignores exhaustion, usage availability, live counts and claims", (): void => {
	const decision = chooseSeat(
		[row("dev2", { fiveHour: 100, live: 5, sevenDay: 100 })],
		[{ createdAt: now, seat: "dev2" }],
		{ manual: "dev2", now },
	);
	strictEqual(decision.seat, "dev2");
	strictEqual(decision.mode, "manual");
	strictEqual(decision.reason, "manual");
});

const partialCases = [
	{
		expected: "main",
		rows: [
			row("main", { sevenDay: "unknown" }),
			row("dev", { sevenDay: "unknown" }),
		],
	},
	{
		expected: "dev",
		rows: [
			row("main", { fiveHour: 90, sevenDay: "unknown" }),
			row("dev", { sevenDay: "unknown" }),
		],
	},
	{
		expected: "dev",
		rows: [
			row("main", { fiveHour: "unknown", sevenDay: 0 }),
			row("dev", { sevenDay: 99 }),
		],
	},
	{
		expected: "dev",
		rows: [row("main", { sevenDay: "unknown" }), row("dev", { sevenDay: 99 })],
	},
	{
		expected: "dev",
		rows: [
			row("main", { fiveHour: "unknown", sevenDay: 50 }),
			row("dev", { fiveHour: "unknown", sevenDay: 10 }),
		],
	},
	{
		expected: "main",
		rows: [row("main", { sevenDay: "unknown" }), row("dev", { live: 1 })],
	},
	{
		expected: "main",
		rows: [row("main", { fiveHour: "unknown" }), row("dev", { live: 1 })],
	},
];

await test("partial usage remains rankable with conservative missing-window tie breakers", (): void => {
	for (const { rows, expected } of partialCases) {
		const decision = chooseSeat(rows, [], { now });
		strictEqual(decision.seat, expected);
		strictEqual(
			decision.reason.includes("fewest live sessions + claims; below 90%"),
			true,
		);
		strictEqual(
			decision.rows.every((entry) => entry.status === "healthy"),
			true,
		);
	}
});

await test("either known exhausted window excludes a partial row", (): void => {
	for (const partial of [
		row("main", { fiveHour: 100, sevenDay: "unknown" }),
		row("main", { fiveHour: "unknown", sevenDay: 100 }),
	]) {
		strictEqual(
			chooseSeat([partial], [], { now }).reason,
			"all seats exhausted",
		);
	}
});
