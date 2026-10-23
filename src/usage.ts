import { isRecord } from "./json.ts";

interface UsageWindow {
	readonly utilization: number;
	readonly resetAt: string;
}

interface Usage {
	readonly fiveHour: UsageWindow | "unknown";
	readonly sevenDay: UsageWindow | "unknown";
}

type UsageResult =
	| { readonly ok: true; readonly usage: Usage }
	| { readonly ok: false; readonly reason: "invalid response" };
type WindowResult =
	| { readonly ok: true; readonly window: UsageWindow | "unknown" }
	| { readonly ok: false };

const timestampPattern =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const zero = 0;
const dateLength = 10;
const invalid: UsageResult = { ok: false, reason: "invalid response" };

const parseReset = (value: unknown): string => {
	if (
		typeof value === "string" &&
		timestampPattern.test(value) &&
		Number.isFinite(Date.parse(value))
	) {
		// Date.parse rolls impossible days into the next month; check the date before applying its offset.
		const calendarDate = value.slice(zero, dateLength);
		const midnight = new Date(`${calendarDate}T00:00:00Z`).toISOString();
		if (midnight.startsWith(calendarDate)) {
			return new Date(value).toISOString();
		}
	}
	return "unknown";
};

const windowWithReset = (
	utilization: number,
	reset: unknown,
	stored: boolean,
): WindowResult => {
	const resetAt = parseReset(reset);
	if (
		resetAt === "unknown" &&
		reset !== null &&
		!(stored && reset === "unknown")
	) {
		return { ok: false };
	}
	return { ok: true, window: { resetAt, utilization } };
};

const parseWindow = (value: unknown, stored: boolean): WindowResult => {
	if (value === null || (stored && value === "unknown")) {
		return { ok: true, window: "unknown" };
	}
	if (!isRecord(value)) {
		return { ok: false };
	}
	const { utilization } = value;
	if (
		typeof utilization !== "number" ||
		!Number.isFinite(utilization) ||
		utilization < zero
	) {
		return { ok: false };
	}
	if (stored) {
		return windowWithReset(utilization, value["resetAt"], stored);
	}
	return windowWithReset(utilization, value["resets_at"], stored);
};

const usageFromWindows = (
	fiveHour: WindowResult,
	sevenDay: WindowResult,
): UsageResult => {
	if (!(fiveHour.ok && sevenDay.ok)) {
		return invalid;
	}
	return {
		ok: true,
		usage: { fiveHour: fiveHour.window, sevenDay: sevenDay.window },
	};
};

const parseUsage = (value: unknown, stored = false): UsageResult => {
	if (!isRecord(value)) {
		return invalid;
	}
	let fiveHourValue = value["five_hour"];
	let sevenDayValue = value["seven_day"];
	if (stored) {
		fiveHourValue = value["fiveHour"];
		sevenDayValue = value["sevenDay"];
	}
	return usageFromWindows(
		parseWindow(fiveHourValue, stored),
		parseWindow(sevenDayValue, stored),
	);
};

export type { Usage, UsageResult, UsageWindow };
export { parseUsage };
