import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { parseJson } from "./json.ts";
import {
	formatStatuslineSegment,
	parseRateLimits,
	statuslineSeat,
} from "./statusline.ts";
import type { Usage } from "./usage.ts";
import { usage } from "./usage-test-fixture.ts";

const home = "/tmp/statusline home";
const parse = (text: string): Usage => {
	const parsed = parseJson(text);
	ok(parsed.ok);
	return parseRateLimits(parsed.value);
};

await test("the active config directory identifies all four seats, including bare main", (): void => {
	strictEqual(statuslineSeat(home), "main");
	for (const directory of ["", `${home}/.claude`]) {
		strictEqual(statuslineSeat(home, directory), "main");
	}
	for (const seat of ["dev", "dev2", "dev3"]) {
		strictEqual(statuslineSeat(home, `${home}/.claude-${seat}/`), seat);
	}
	strictEqual(statuslineSeat(home, `${home}/other/../.claude-dev3`), "dev3");
	for (const directory of [
		`${home}/.claude-api`,
		`${home}/.claude-dev30`,
		"/another/home/.claude-dev3",
		"/unrecognized\nconfig",
	]) {
		strictEqual(statuslineSeat(home, directory), "unknown");
	}
});

await test("stdin rate limits use percentages and epoch seconds, ignoring unrelated data", (): void => {
	deepStrictEqual(
		parse(
			'{"account":{"email":"discard@example.invalid"},"rate_limits":{"five_hour":{"used_percentage":10,"resets_at":1789744800},"seven_day":{"used_percentage":1,"resets_at":1790334000},"private":"discard"}}',
		),
		usage,
	);
	deepStrictEqual(
		parse(
			'{"rate_limits":{"five_hour":{"used_percentage":10,"resets_at":1789744800}}}',
		),
		{ fiveHour: usage.fiveHour, sevenDay: "unknown" },
	);
});

await test("absent, null and malformed rate limits become unknown without throwing", (): void => {
	for (const text of [
		"null",
		"[]",
		'"discard"',
		"{}",
		'{"rate_limits":null}',
	]) {
		deepStrictEqual(parse(text), { fiveHour: "unknown", sevenDay: "unknown" });
	}
	for (const window of [
		"null",
		"[]",
		"{}",
		'{"used_percentage":"10","resets_at":0}',
		'{"used_percentage":-1,"resets_at":0}',
		'{"used_percentage":1e999,"resets_at":0}',
	]) {
		deepStrictEqual(
			parse(
				`{"rate_limits":{"five_hour":${window},"seven_day":{"used_percentage":1,"resets_at":1790334000}}}`,
			),
			{ fiveHour: "unknown", sevenDay: usage.sevenDay },
		);
	}
});

await test("zero and fractional usage survive validation, including absent reset clocks", (): void => {
	deepStrictEqual(
		parse(
			'{"rate_limits":{"five_hour":{"used_percentage":0,"resets_at":0},"seven_day":{"used_percentage":12.5,"resets_at":null}}}',
		),
		{
			fiveHour: { resetAt: "1970-01-01T00:00:00.000Z", utilization: 0 },
			sevenDay: { resetAt: "unknown", utilization: 12.5 },
		},
	);
	deepStrictEqual(
		parse('{"rate_limits":{"five_hour":{"used_percentage":100}}}'),
		{
			fiveHour: { resetAt: "unknown", utilization: 100 },
			sevenDay: "unknown",
		},
	);
});

await test("dev3 and bare main render the ticket suffix with local reset clocks", (): void => {
	for (const seat of ["main", "dev3"]) {
		strictEqual(
			formatStatuslineSegment(seat, usage, "Europe/Berlin"),
			`${seat} · 5h 10% ↻17:20 · 7d 1% ↻Fri 13:00`,
		);
	}
	strictEqual(
		formatStatuslineSegment("dev3", usage, "America/New_York"),
		"dev3 · 5h 10% ↻11:20 · 7d 1% ↻Fri 07:00",
	);
	strictEqual(
		formatStatuslineSegment("dev3", usage),
		formatStatuslineSegment(
			"dev3",
			usage,
			new Intl.DateTimeFormat().resolvedOptions().timeZone,
		),
	);
});

await test("missing usage shows em dashes; known usage never introduces question marks", (): void => {
	strictEqual(
		formatStatuslineSegment("main", {
			fiveHour: "unknown",
			sevenDay: "unknown",
		}),
		"main · 5h — · 7d —",
	);
	strictEqual(
		formatStatuslineSegment("dev", {
			fiveHour: { resetAt: "unknown", utilization: 0 },
			sevenDay: { resetAt: "unknown", utilization: 12.5 },
		}),
		"dev · 5h 0% · 7d 13%",
	);
});

await test("invalid reset clocks preserve valid percentages", (): void => {
	for (const reset of [
		'"2026-01-01T00:00:00Z"',
		"-1",
		"99999999999999",
		"1e999",
		"{}",
		"true",
	]) {
		deepStrictEqual(
			parse(
				`{"rate_limits":{"five_hour":{"used_percentage":5,"resets_at":${reset}}}}`,
			),
			{ fiveHour: { resetAt: "unknown", utilization: 5 }, sevenDay: "unknown" },
		);
	}
});

await test("display rounds fractional percentages and bounds oversized utilization without changing routing data", (): void => {
	strictEqual(
		formatStatuslineSegment("main", {
			fiveHour: { resetAt: "unknown", utilization: 12.7 },
			sevenDay: { resetAt: "unknown", utilization: 0.4 },
		}),
		"main · 5h 13% · 7d 0%",
	);
	strictEqual(
		formatStatuslineSegment("main", {
			fiveHour: { resetAt: "unknown", utilization: 1e9 },
			sevenDay: "unknown",
		}),
		"main · 5h 100% · 7d —",
	);
});
