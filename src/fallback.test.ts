import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { prepareFallback } from "./fallback.ts";
import type { RoutingSeat } from "./router.ts";
import { chooseSeat } from "./router.ts";
import { now, row } from "./router-test-fixture.ts";
import type { SeatName } from "./seats.ts";
import { unexpected } from "./usage-test-fixture.ts";

const zero = 0;
const one = 1;
const available = (seat: SeatName, live = zero): RoutingSeat => ({
	availability: { kind: "available" },
	live,
	probe: true,
	seat,
	usage: "unknown",
});
const candidates = [
	available("main"),
	available("dev"),
	available("dev2"),
	available("dev3"),
];

await test("fallback round-robin persists beyond claims and wraps while respecting live sessions", (): void => {
	let lastFallbackSeat: SeatName | "none" = "none";
	for (const expected of ["main", "dev", "dev2", "dev3", "main"]) {
		const decision = chooseSeat(candidates, [], { lastFallbackSeat, now });
		strictEqual(decision.seat, expected);
		lastFallbackSeat = decision.seat;
	}
	strictEqual(
		chooseSeat([available("main", one), available("dev")], [], {
			lastFallbackSeat: "dev",
			now,
		}).seat,
		"dev",
	);
	strictEqual(
		chooseSeat(candidates, [{ createdAt: now, seat: "main" }], { now }).seat,
		"dev",
	);
});

await test("fallback rotation uses registry order even for shuffled or missing candidate rows", (): void => {
	for (const seats of [candidates, candidates.toReversed()]) {
		const before = structuredClone(seats);
		let lastFallbackSeat: SeatName | "none" = "none";
		for (const expected of ["main", "dev", "dev2", "dev3", "main"]) {
			const decision = chooseSeat(seats, [], { lastFallbackSeat, now });
			strictEqual(decision.seat, expected);
			lastFallbackSeat = decision.seat;
		}
		deepStrictEqual(seats, before);
	}
	strictEqual(
		chooseSeat([available("dev3"), available("main")], [], {
			lastFallbackSeat: "dev2",
			now,
		}).seat,
		"dev3",
	);
	strictEqual(
		chooseSeat([available("dev2"), available("main")], [], {
			lastFallbackSeat: "dev3",
			now,
		}).seat,
		"main",
	);
});

await test("known healthy usage ranks ahead of probed candidates; cooldowns override cached headroom", (): void => {
	strictEqual(
		chooseSeat([available("main"), row("dev")], [], { now }).seat,
		"dev",
	);
	strictEqual(
		chooseSeat(
			[
				{
					...row("main"),
					availability: { kind: "cooldown", until: now + one },
				},
				available("dev"),
			],
			[],
			{ now },
		).seat,
		"dev",
	);
	strictEqual(
		chooseSeat(
			[
				{ ...row("main"), availability: { kind: "cooldown", until: now } },
				available("dev"),
			],
			[],
			{ now },
		).seat,
		"main",
	);
});

await test("all candidates cooling down refuse like exhaustion, while failed probes stay unknown", (): void => {
	const cooling: RoutingSeat = {
		...available("main"),
		availability: { kind: "cooldown", until: now + one },
	};
	strictEqual(
		chooseSeat(
			[cooling, { live: 0, probe: false, seat: "dev", usage: "unknown" }],
			[],
			{ now },
		).reason,
		"usage unavailable",
	);
	strictEqual(
		chooseSeat(
			[cooling, { ...available("dev"), availability: { kind: "unavailable" } }],
			[],
			{ now },
		).reason,
		"usage unavailable",
	);
});

await test("known healthy headroom suppresses all probes unless every healthy seat is cooling down", async (): Promise<void> => {
	await Promise.all(
		[
			{ expected: [], until: now },
			{ expected: ["dev"], until: now + one },
		].map(
			async ({
				until,
				expected,
			}: Readonly<{
				until: number;
				expected: readonly string[];
			}>): Promise<void> => {
				const calls: SeatName[] = [];
				await prepareFallback(
					[row("main"), available("dev")],
					{ cooldowns: [{ seat: "main", until }], lastSeat: "none" },
					{
						now,
						probe: (seat: SeatName) => {
							calls.push(seat);
							return { kind: "available" };
						},
					},
				);
				deepStrictEqual(calls, expected);
			},
		),
	);
});

await test("cooldowns skip probes until exact expiry; successes and errors never invent usage numbers", async (): Promise<void> => {
	const stored = {
		cooldowns: [{ seat: "main", until: now + one }],
		lastSeat: "dev3",
	};
	const calls: SeatName[] = [];
	const result = await prepareFallback(
		candidates,
		{ cooldowns: [{ seat: "main", until: now + one }], lastSeat: "dev3" },
		{
			now,
			probe: (seat: SeatName) => {
				calls.push(seat);
				return { kind: "available" };
			},
		},
	);
	deepStrictEqual(calls, ["dev", "dev2", "dev3"]);
	deepStrictEqual(result.state, stored);
	strictEqual(
		result.rows.every((entry) => entry.usage === "unknown"),
		true,
	);
	const expired = await prepareFallback(
		candidates,
		{ cooldowns: [{ seat: "main", until: now }], lastSeat: "dev3" },
		{ now, probe: () => ({ kind: "available" }) },
	);
	deepStrictEqual(expired.state.cooldowns, []);
});

await test("exhausted or ineligible seats are never probed and partial healthy windows skip probes", async (): Promise<void> => {
	const exhausted = { ...row("main", { fiveHour: 100 }), probe: true };
	const absent: RoutingSeat = {
		live: 0,
		probe: false,
		seat: "dev",
		usage: "unknown",
	};
	await prepareFallback(
		[exhausted, absent, row("dev2")],
		{ cooldowns: [], lastSeat: "none" },
		{ now, probe: unexpected },
	);
	const partial: RoutingSeat = {
		...row("main"),
		probe: true,
		usage: {
			fiveHour: "unknown",
			sevenDay: { resetAt: "unknown", utilization: 1 },
		},
	};
	const result = await prepareFallback(
		[partial],
		{ cooldowns: [], lastSeat: "none" },
		{ now, probe: unexpected },
	);
	strictEqual(chooseSeat(result.rows, [], { now }).seat, "main");
});

await test("either partial window suppresses probes for the entire pool", async (): Promise<void> => {
	await Promise.all(
		[
			row("main", { fiveHour: "unknown" }),
			row("main", { sevenDay: "unknown" }),
		].map(async (partial): Promise<void> => {
			const calls: SeatName[] = [];
			const prepared = await prepareFallback(
				[
					{ ...partial, probe: true },
					{ ...row("dev", { sevenDay: "unknown" }), probe: true },
					available("dev2"),
				],
				{ cooldowns: [], lastSeat: "none" },
				{
					now,
					probe: (seat: SeatName) => {
						calls.push(seat);
						return { kind: "available" };
					},
				},
			);
			deepStrictEqual(calls, []);
			strictEqual(
				chooseSeat(prepared.rows, [], { now }).reason.includes("below 90%"),
				true,
			);
		}),
	);
});
