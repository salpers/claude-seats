import process from "node:process";
import type { CredentialPresence } from "./credentials.ts";
import type { Seat } from "./seats.ts";
import { formatUsageWindow } from "./usage-format.ts";
import type { SeatUsage } from "./usage-probe.ts";

type SeatRow = Readonly<{
	credential: CredentialPresence;
	live: number;
	seat: Seat;
	usage: SeatUsage;
	cooldownUntil?: number;
}>;

const freshAge = 0;
const minuteMs = 60_000;
const gutter = "  ";
const emptyWidth = 0;
const controlCharacter = /[\p{Cc}\p{Cf}]/u;
const headings = [
	"seat",
	"5h",
	"7d",
	"live",
	"credential",
	"directory",
	"keychain slot",
];

// The two usage windows are separate columns so their percentages line up.
const usageColumns = (
	result: SeatUsage,
	timeZone?: string,
): readonly [string, string] => {
	if (!result.ok) {
		return ["?", `? (${result.reason})`];
	}
	let suffix = "";
	if (result.cachedAgeMs > freshAge) {
		suffix = ` (cached ${Math.floor(result.cachedAgeMs / minuteMs)}m ago)`;
	}
	const options = { timeZone, unknown: "?" };
	return [
		formatUsageWindow(result.usage.fiveHour, false, options),
		`${formatUsageWindow(result.usage.sevenDay, true, options)}${suffix}`,
	];
};

const formatSeatUsage = (result: SeatUsage, timeZone?: string): string => {
	const [fiveHour, sevenDay] = usageColumns(result, timeZone);
	return `5h ${fiveHour}  7d ${sevenDay}`;
};

const formatPresence = (credential: CredentialPresence): string => {
	if (!credential.ok) {
		return "unknown";
	}
	if (credential.present) {
		return "yes";
	}
	return "no";
};

const formatCooldown = (until: number | undefined): string => {
	if (typeof until !== "number") {
		return "";
	}
	const clock = new Intl.DateTimeFormat("en-GB", {
		hour: "2-digit",
		hourCycle: "h23",
		minute: "2-digit",
	}).format(until);
	return ` (cooldown ↻${clock})`;
};

// Quoting keeps each seat on one row, even with control characters in HOME.
const formatDirectory = (directory: string): string => {
	if (controlCharacter.test(directory)) {
		return JSON.stringify(directory);
	}
	return directory;
};

const seatCells = (row: SeatRow): readonly string[] => {
	const [fiveHour, sevenDay] = usageColumns(row.usage);
	return [
		row.seat.name,
		`${fiveHour}${formatCooldown(row.cooldownUntil)}`,
		sevenDay,
		String(row.live),
		formatPresence(row.credential),
		formatDirectory(row.seat.directory),
		row.seat.slot,
	];
};

// Cells are ASCII plus ↻, so UTF-16 length is the printed width.
const columnWidths = (
	table: readonly (readonly string[])[],
): readonly number[] => {
	const widths: number[] = [];
	for (const cells of table) {
		for (const [column, cell] of cells.entries()) {
			widths[column] = Math.max(widths[column] ?? emptyWidth, cell.length);
		}
	}
	return widths;
};

// Padding to a shared width is what makes the columns line up in a monospace font.
const padColumns = (
	table: readonly (readonly string[])[],
): readonly string[] => {
	const widths = columnWidths(table);
	return table.map((cells): string =>
		cells
			.map(
				(cell, column): string =>
					cell + " ".repeat((widths[column] ?? emptyWidth) - cell.length),
			)
			.join(gutter)
			.trimEnd(),
	);
};

const formatSeats = (rows: readonly SeatRow[]): string =>
	padColumns([
		headings,
		...rows.map((row): readonly string[] => seatCells(row)),
	]).join("\n");

const printError = (message: string): void => {
	console.error(`cc: ${message}`);
};

const printNotices = (notices: readonly string[]): void => {
	for (const notice of notices) {
		printError(notice);
	}
};

// NUL-delimited data avoids evaluating shell code or re-parsing Claude arguments.
const printReply = (fields: readonly string[]): void => {
	process.stdout.write(`${fields.join("\0")}\0`);
};

export type { SeatRow };
export {
	formatSeats,
	formatSeatUsage,
	padColumns,
	printError,
	printNotices,
	printReply,
};
