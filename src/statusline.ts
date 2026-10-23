import path from "node:path";
import { isRecord } from "./json.ts";
import type { SeatName } from "./seats.ts";
import { createSeats } from "./seats.ts";
import type { Usage, UsageWindow } from "./usage.ts";
import { formatUsageWindow } from "./usage-format.ts";

const zero = 0;
const millisecondsPerSecond = 1000;

const statuslineSeat = (
	home: string,
	configDirectory?: string,
): SeatName | "unknown" => {
	if (typeof configDirectory !== "string" || configDirectory === "") {
		return "main";
	}
	const match = createSeats(home).find(
		(seat) => seat.directory === path.resolve(configDirectory),
	);
	if (match && home !== "") {
		return match.name;
	}
	return "unknown";
};

const parseEpochReset = (reset: unknown): string => {
	if (typeof reset !== "number" || !Number.isFinite(reset) || reset < zero) {
		return "unknown";
	}
	const date = new Date(reset * millisecondsPerSecond);
	if (!Number.isFinite(date.getTime())) {
		return "unknown";
	}
	return date.toISOString();
};

const parseRateWindow = (value: unknown): UsageWindow | "unknown" => {
	if (!isRecord(value)) {
		return "unknown";
	}
	const utilization = value["used_percentage"];
	let resetAt = "unknown";
	if (Object.hasOwn(value, "resets_at") && value["resets_at"] !== null) {
		resetAt = parseEpochReset(value["resets_at"]);
	}
	if (
		typeof utilization !== "number" ||
		!Number.isFinite(utilization) ||
		utilization < zero
	) {
		return "unknown";
	}
	return { resetAt, utilization };
};

const parseRateLimits = (value: unknown): Usage => {
	if (!(isRecord(value) && isRecord(value["rate_limits"]))) {
		return { fiveHour: "unknown", sevenDay: "unknown" };
	}
	return {
		fiveHour: parseRateWindow(value["rate_limits"]["five_hour"]),
		sevenDay: parseRateWindow(value["rate_limits"]["seven_day"]),
	};
};

const formatStatuslineSegment = (
	seat: string,
	usage: Usage,
	timeZone?: string,
): string =>
	`${seat} · 5h ${formatUsageWindow(usage.fiveHour, false, { timeZone })} · 7d ${formatUsageWindow(usage.sevenDay, true, { timeZone })}`;

export { formatStatuslineSegment, parseRateLimits, statuslineSeat };
