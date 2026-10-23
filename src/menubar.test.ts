import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { formatMenu, formatPanel } from "./menubar.ts";
import type { SeatRow } from "./output.ts";
import { createSeats } from "./seats.ts";
import type { SeatUsage } from "./usage-probe.ts";
import { usage } from "./usage-test-fixture.ts";

const titleRow = 0;
const oneOffset = 1;
const busy = 91;
const liveCounts: Readonly<Record<string, number>> = {
	dev: 1,
	dev2: 0,
	dev3: 2,
	main: 0,
};

const buildRows = (): readonly SeatRow[] =>
	createSeats("/tmp/seats").map((seat): SeatRow => {
		let result: SeatUsage = { cachedAgeMs: 0, ok: true, usage };
		if (seat.name === "main") {
			result = {
				cachedAgeMs: 0,
				ok: true,
				usage: {
					...usage,
					fiveHour: { resetAt: "unknown", utilization: busy },
				},
			};
		}
		if (seat.name === "dev") {
			result = { ok: false, reason: "not logged in" };
		}
		return {
			credential: { ok: true, present: seat.name !== "dev" },
			live: liveCounts[seat.name] ?? Number.NaN,
			seat,
			usage: result,
		};
	});

await test("the title names the freest seat and every seat line can launch it", (): void => {
	const lines = formatMenu(buildRows()).split("\n");
	strictEqual(lines.at(titleRow), "⌁ dev2 10%");
	for (const seat of ["main", "dev", "dev2", "dev3"]) {
		const line = lines.find((row): boolean => row.startsWith(`${seat} `)) ?? "";
		ok(line.includes(`param2="cc @${seat}" terminal=true`));
	}
	ok(lines.some((row): boolean => row.startsWith("Refresh | refresh=true")));
});

await test("every seat column starts at the same offset in a monospace font", (): void => {
	const rows = formatMenu(buildRows())
		.split("\n")
		.filter((row): boolean => row.includes("terminal=true"));
	for (const marker of ["7d", "live", "|"]) {
		deepStrictEqual(
			new Set(rows.map((row): number => row.indexOf(marker))).size,
			oneOffset,
		);
	}
});

await test("a loaded title passes its colour as a SwiftBar parameter", (): void => {
	const allBusy = buildRows().map((row): SeatRow => {
		const busyRow: SeatRow = {
			credential: row.credential,
			live: row.live,
			seat: row.seat,
			usage: { ok: false, reason: "timeout" },
		};
		return busyRow;
	});
	strictEqual(
		formatMenu(allBusy).split("\n").at(titleRow),
		"⌁ main 100% | color=red",
	);
});

await test("a loaded or unreadable seat is coloured and never wins the title", (): void => {
	const lines = formatMenu(buildRows()).split("\n");
	const main = lines.find((row): boolean => row.startsWith("main ")) ?? "";
	const dev = lines.find((row): boolean => row.startsWith("dev ")) ?? "";
	ok(main.endsWith(" color=red"));
	// A seat with no credential reads as full, so it is never offered as the free one.
	ok(dev.endsWith(" color=red"));
	ok(dev.includes("not logged in"));
});

await test("the /seats pane gets each menu row's text and its red flag as JSON", (): void => {
	const lines = formatMenu(buildRows())
		.split("\n")
		.filter((row): boolean => row.includes("terminal=true"));
	const expected = lines.map((line) => ({
		alert: line.endsWith(" color=red"),
		seat: line.slice(titleRow, line.indexOf(" ")),
		text: line.slice(titleRow, line.indexOf(" | ")),
	}));
	const panel: unknown = JSON.parse(formatPanel(buildRows()));
	deepStrictEqual(panel, expected);
});
