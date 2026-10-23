import { deepStrictEqual, ok } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseJson } from "./json.ts";
import type { UsageResult } from "./usage.ts";
import { parseUsage } from "./usage.ts";

const invalid = { ok: false, reason: "invalid response" };
const parseResponse = (text: string): UsageResult => {
	const parsed = parseJson(text);
	ok(parsed.ok);
	return parseUsage(parsed.value);
};

await test("a public captured response keeps only the two usage windows", async (): Promise<void> => {
	const text = await readFile(
		new URL("../tests/fixtures/oauth-usage.json", import.meta.url),
		"utf8",
	);
	deepStrictEqual(parseResponse(text), {
		ok: true,
		usage: {
			fiveHour: { resetAt: "2026-04-11T07:00:00.528Z", utilization: 33 },
			sevenDay: { resetAt: "2026-04-17T00:59:59.951Z", utilization: 13 },
		},
	});
});

await test("unknown and obfuscated fields never enter parsed usage; null windows remain unknown", (): void => {
	deepStrictEqual(
		parseResponse(
			'{"five_hour":{"utilization":10,"resets_at":null,"private":"discard"},"seven_day":null,"iguana_necktie":{"utilization":99},"private":"discard"}',
		),
		{
			ok: true,
			usage: {
				fiveHour: { resetAt: "unknown", utilization: 10 },
				sevenDay: "unknown",
			},
		},
	);
});

await test("impossible calendar dates cannot become reset clocks in responses or caches", (): void => {
	for (const reset of [
		"2026-02-29T12:00:00Z",
		"2026-02-30T12:00:00+02:00",
		"2026-04-31T23:30:00-05:00",
		"1900-02-29T00:00:00Z",
	]) {
		deepStrictEqual(
			parseResponse(
				`{"five_hour":{"resets_at":${JSON.stringify(reset)},"utilization":10},"seven_day":null}`,
			),
			invalid,
		);
		deepStrictEqual(
			parseUsage(
				{
					fiveHour: "unknown",
					sevenDay: { resetAt: reset, utilization: 10 },
				},
				true,
			),
			invalid,
		);
	}
});

await test("valid leap days and timezone offsets preserve the reset instant", (): void => {
	for (const [reset, expected] of [
		["2024-02-29T00:30:00+02:00", "2024-02-28T22:30:00.000Z"],
		["2000-02-29T23:30:00-02:00", "2000-03-01T01:30:00.000Z"],
		["2026-04-30T23:30:00.123456Z", "2026-04-30T23:30:00.123Z"],
	]) {
		deepStrictEqual(
			parseResponse(
				`{"five_hour":{"resets_at":${JSON.stringify(reset)},"utilization":10},"seven_day":null}`,
			),
			{
				ok: true,
				usage: {
					fiveHour: { resetAt: expected, utilization: 10 },
					sevenDay: "unknown",
				},
			},
		);
	}
});

await test("untrusted usage rejects missing windows, wrong types, invalid dates and nonfinite utilization", (): void => {
	for (const text of [
		"null",
		"[]",
		"{}",
		'"private"',
		'{"five_hour":null}',
		'{"five_hour":null,"seven_day":[]}',
		...['"10"', "null", "-1", "1e999"].map(
			(value) =>
				`{"five_hour":{"utilization":${value},"resets_at":null},"seven_day":null}`,
		),
		...[
			'"private"',
			'"2026-13-18T00:00:00Z"',
			'"2026-09-18"',
			'"2026-09-18T12:00:00"',
			"123",
			"{}",
		].map(
			(value) =>
				`{"five_hour":{"utilization":10,"resets_at":${value}},"seven_day":null}`,
		),
	]) {
		deepStrictEqual(parseResponse(text), invalid);
	}
	for (const value of ["0", "0.5", "100", "101"]) {
		ok(
			parseResponse(
				`{"five_hour":{"utilization":${value},"resets_at":null},"seven_day":null}`,
			).ok,
		);
	}
});
