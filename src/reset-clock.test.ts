import { strictEqual } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseResetClock } from "./reset-clock.ts";

const now = Date.parse("2026-09-18T10:00:00Z");
const berlin = "Europe/Berlin";

await test("captured limit errors retain their clocks and timezone annotations", async (): Promise<void> => {
	const text = await readFile(
		new URL("../tests/fixtures/limit-errors.txt", import.meta.url),
		"utf8",
	);
	const expected = [
		"2026-09-18T11:50:00Z",
		"2026-09-19T05:50:00Z",
		"2026-09-18T11:00:00Z",
	];
	for (const [index, message] of text.trimEnd().split("\n").entries()) {
		strictEqual(
			parseResetClock(message, now, berlin),
			Date.parse(expected[index] ?? ""),
		);
	}
});

await test("ticket limit messages parse 12-hour, 24-hour and timezone clocks", (): void => {
	for (const text of [
		"hit your session limit · resets 13:50",
		"You've hit your limit · resets 1:50pm",
	]) {
		strictEqual(
			parseResetClock(text, now, berlin),
			Date.parse("2026-09-18T11:50:00Z"),
		);
	}
	strictEqual(
		parseResetClock(
			"You've hit your limit · resets 1pm (Europe/Berlin)",
			now,
			"UTC",
		),
		Date.parse("2026-09-18T11:00:00Z"),
	);
});

await test("clocks roll into tomorrow, distinguish noon/midnight, and default to local time", (): void => {
	strictEqual(
		parseResetClock("resets 1am", now, berlin),
		Date.parse("2026-09-18T23:00:00Z"),
	);
	strictEqual(
		parseResetClock("resets 12am", now, berlin),
		Date.parse("2026-09-18T22:00:00Z"),
	);
	strictEqual(
		parseResetClock("resets 12pm", now, berlin),
		Date.parse("2026-09-19T10:00:00Z"),
	);
	strictEqual(
		parseResetClock("resets 13:50", now),
		parseResetClock(
			"resets 13:50",
			now,
			new Intl.DateTimeFormat().resolvedOptions().timeZone,
		),
	);
});

await test("timezone clocks follow daylight savings including a repeated hour", (): void => {
	strictEqual(
		parseResetClock(
			"resets 3:30am",
			Date.parse("2026-03-29T00:00:00Z"),
			berlin,
		),
		Date.parse("2026-03-29T01:30:00Z"),
	);
	strictEqual(
		parseResetClock(
			"resets 2:30am",
			Date.parse("2026-10-25T00:45:00Z"),
			berlin,
		),
		Date.parse("2026-10-25T01:30:00Z"),
	);
});

await test("malformed or unsupported clocks never fabricate cooldowns", (): void => {
	for (const text of [
		"normal reply",
		"resets 25:50",
		"resets 13:60",
		"resets 0pm",
		"resets 13pm",
		"resets 1:5pm",
		"resets 1:50:30",
		"resets 1pm (Invalid/Zone)",
		"resets tomorrow",
		"resets 130:50",
	]) {
		strictEqual(parseResetClock(text, now, berlin), false);
	}
});

await test("malformed timezone annotations cannot fall back to an unannotated local clock", (): void => {
	for (const text of [
		"hit your session limit · resets 13:50 ()",
		"hit your session limit · resets 1:50pm (",
		"hit your session limit · resets 1pm (Europe/Berlin",
		"hit your session limit · resets 13:50 (Invalid/Zone) trailing",
	]) {
		strictEqual(parseResetClock(text, now, berlin), false, text);
	}
});
