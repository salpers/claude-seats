import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { SeatName } from "./seats.ts";
import { renderStatuslineSegment } from "./statusline-segment.ts";
import type { CacheResult, UsageSnapshot } from "./usage-cache.ts";
import { cacheHit, snapshot, usage } from "./usage-test-fixture.ts";

const home = "/tmp/statusline home";
const env = Object.fromEntries([
	["CLAUDE_CONFIG_DIR", `${home}/.claude-dev3`],
	["HOME", home],
]);
const suffix = "dev3 · 5h 10% ↻17:20 · 7d 1% ↻Fri 13:00";
const timeZone = "Europe/Berlin";
const input =
	'{"rate_limits":{"five_hour":{"used_percentage":10,"resets_at":1789744800},"seven_day":{"used_percentage":1,"resets_at":1790334000}}}';

await test("complete stdin usage takes precedence without reading a cache", async (): Promise<void> => {
	const reads: SeatName[] = [];
	strictEqual(
		await renderStatuslineSegment(input, env, {
			readCache: (_directory: string, seat: SeatName) => {
				reads.push(seat);
				return cacheHit(snapshot);
			},
			timeZone,
		}),
		suffix,
	);
	deepStrictEqual(reads, []);
});

await test("before the first response, cached numbers appear with no question marks", async (): Promise<void> => {
	const reads: string[][] = [];
	await Promise.all(
		["{}", "", "{", "null", '{"rate_limits":null}'].map(
			async (text): Promise<void> => {
				strictEqual(
					await renderStatuslineSegment(text, env, {
						readCache: (directory: string, seat: SeatName) => {
							reads.push([directory, seat]);
							return cacheHit(snapshot);
						},
						timeZone,
					}),
					suffix,
				);
			},
		),
	);
	deepStrictEqual(
		reads,
		Array.from({ length: reads.length }, () => [
			`${home}/.claude-shared/_seats`,
			"dev3",
		]),
	);
});

await test("each missing window falls back independently without overwriting live zero usage", async (): Promise<void> => {
	strictEqual(
		await renderStatuslineSegment(
			'{"rate_limits":{"five_hour":{"used_percentage":0}}}',
			env,
			{ readCache: () => cacheHit(snapshot), timeZone },
		),
		"dev3 · 5h 0% · 7d 1% ↻Fri 13:00",
	);
	strictEqual(
		await renderStatuslineSegment(
			'{"rate_limits":{"seven_day":{"used_percentage":0}}}',
			env,
			{ readCache: () => cacheHit(snapshot), timeZone },
		),
		"dev3 · 5h 10% ↻17:20 · 7d 0%",
	);
});

await test("a malformed live reset keeps the live percentage instead of substituting cached usage", async (): Promise<void> => {
	strictEqual(
		await renderStatuslineSegment(
			'{"rate_limits":{"five_hour":{"used_percentage":5,"resets_at":-1}}}',
			env,
			{ readCache: () => cacheHit(snapshot), timeZone },
		),
		"dev3 · 5h 5% · 7d 1% ↻Fri 13:00",
	);
});

await test("missing or failed cache reads produce em dashes and never expose diagnostics", async (): Promise<void> => {
	strictEqual(
		await renderStatuslineSegment("{}", env, {
			readCache: () => ({ ok: false }),
		}),
		"dev3 · 5h — · 7d —",
	);
	strictEqual(
		await renderStatuslineSegment("{}", env, {
			readCache: () => {
				throw new Error("private diagnostic");
			},
		}),
		"dev3 · 5h — · 7d —",
	);
});

await test("home and state overrides choose the active seat's cache, including bare main", async (): Promise<void> => {
	const reads: string[][] = [];
	strictEqual(
		await renderStatuslineSegment(
			"{}",
			Object.fromEntries([
				["CLAUDE_SEATS_HOME", home],
				["CLAUDE_SEATS_STATE_DIR", "/tmp/separate state"],
				["HOME", "/tmp/other home"],
			]),
			{
				readCache: (directory: string, seat: SeatName) => {
					reads.push([directory, seat]);
					return cacheHit(snapshot);
				},
				timeZone,
			},
		),
		"main · 5h 10% ↻17:20 · 7d 1% ↻Fri 13:00",
	);
	deepStrictEqual(reads, [["/tmp/separate state", "main"]]);
});

await test("unknown config directories and absent homes never read another seat's cache", async (): Promise<void> => {
	const reads: SeatName[] = [];
	const readCache = (_directory: string, seat: SeatName): CacheResult => {
		reads.push(seat);
		return cacheHit(snapshot);
	};
	const unknownEnv = Object.fromEntries([
		...Object.entries(env),
		["CLAUDE_CONFIG_DIR", `${home}/.claude-api`],
	]);
	strictEqual(
		await renderStatuslineSegment("{}", unknownEnv, { readCache }),
		"unknown · 5h — · 7d —",
	);
	strictEqual(
		await renderStatuslineSegment("{}", {}, { readCache }),
		"main · 5h — · 7d —",
	);
	deepStrictEqual(reads, []);
});

await test("statusline fallback displays the last snapshot without the router's routing-age cutoff", async (): Promise<void> => {
	const old: UsageSnapshot = { fetchedAt: 0, usage };
	strictEqual(
		await renderStatuslineSegment("{}", env, {
			readCache: () => cacheHit(old),
			timeZone,
		}),
		suffix,
	);
});
