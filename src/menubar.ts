import type { SeatRow } from "./output.ts";
import { padColumns } from "./output.ts";
import type { UsageWindow } from "./usage.ts";
import { formatClock } from "./usage-format.ts";

const maxPercent = 100;
const warnPercent = 60;
const alertPercent = 80;
// "100%" is the widest percentage, so every percentage ends in the same column.
const percentWidth = 4;
// A monospace font is what turns the padded cells into visible columns.
const style = "font=Menlo size=13";
// Session counts reach two digits, so the column stays steady as sessions come and go.
const liveWidth = 2;

// An unreadable window counts as full, so a broken seat never looks like the free one.
const windowPressure = (window: UsageWindow | "unknown"): number => {
	if (window === "unknown") {
		return maxPercent;
	}
	return Math.min(maxPercent, Math.round(window.utilization));
};

const seatPressure = (row: SeatRow): number => {
	if (!row.usage.ok) {
		return maxPercent;
	}
	return Math.max(
		windowPressure(row.usage.usage.fiveHour),
		windowPressure(row.usage.usage.sevenDay),
	);
};

const colourParameter = (pressure: number): string => {
	if (pressure >= alertPercent) {
		return " color=red";
	}
	if (pressure >= warnPercent) {
		return " color=orange";
	}
	return "";
};

// The percentage and its reset clock are separate cells so both columns line up.
const windowCells = (
	label: string,
	window: UsageWindow | "unknown",
	weekly: boolean,
): readonly [string, string] => {
	if (window === "unknown") {
		return [`${label} ${"?".padStart(percentWidth)}`, ""];
	}
	const percent = `${windowPressure(window)}%`.padStart(percentWidth);
	if (window.resetAt === "unknown") {
		return [`${label} ${percent}`, ""];
	}
	return [`${label} ${percent}`, `↻${formatClock(window.resetAt, weekly)}`];
};

const seatCells = (row: SeatRow): readonly string[] => {
	const live = `${String(row.live).padStart(liveWidth)} live`;
	if (!row.usage.ok) {
		const unknown = "?".padStart(percentWidth);
		return [
			row.seat.name,
			`5h ${unknown}`,
			"",
			`7d ${unknown}`,
			`(${row.usage.reason})`,
			live,
		];
	}
	const fiveHour = windowCells("5h", row.usage.usage.fiveHour, false);
	const sevenDay = windowCells("7d", row.usage.usage.sevenDay, true);
	return [row.seat.name, ...fiveHour, ...sevenDay, live];
};

// Launching through an interactive zsh reuses the shell's own cc function and PATH.
const seatLine = (row: SeatRow, text: string): string => {
	const launch = `shell=/bin/zsh param1=-ic param2="cc @${row.seat.name}" terminal=true`;
	return `${text} | ${launch} ${style}${colourParameter(seatPressure(row))}`;
};

const freestSeat = (rows: readonly SeatRow[]): SeatRow | "none" => {
	let best: SeatRow | "none" = "none";
	for (const row of rows) {
		if (best === "none" || seatPressure(row) < seatPressure(best)) {
			best = row;
		}
	}
	return best;
};

// The title names the seat with the most headroom, which is the seat to launch next.
const titleLine = (rows: readonly SeatRow[]): string => {
	const best = freestSeat(rows);
	if (best === "none") {
		return "⌁ ?";
	}
	const pressure = seatPressure(best);
	const title = `⌁ ${best.seat.name} ${pressure}%`;
	const colour = colourParameter(pressure);
	if (colour === "") {
		return title;
	}
	return `${title} |${colour}`;
};

// One entry per seat for the /seats pane: the menu row's text, and whether the menu colours it red.
const formatPanel = (rows: readonly SeatRow[]): string => {
	const padded = padColumns(
		rows.map((row): readonly string[] => seatCells(row)),
	);
	return JSON.stringify(
		rows.map((row, index) => ({
			alert: seatPressure(row) >= alertPercent,
			seat: row.seat.name,
			text: padded[index] ?? "",
		})),
	);
};

const formatMenu = (rows: readonly SeatRow[]): string => {
	const padded = padColumns(
		rows.map((row): readonly string[] => seatCells(row)),
	);
	return [
		titleLine(rows),
		"---",
		...rows.map((row, index): string => seatLine(row, padded[index] ?? "")),
		"---",
		`Refresh | refresh=true ${style}`,
	].join("\n");
};

export { formatMenu, formatPanel };
