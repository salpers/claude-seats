import type { UsageWindow } from "./usage.ts";

const maxPercent = 100;

const formatClock = (
	resetAt: string,
	weekly: boolean,
	timeZone?: string,
): string => {
	const date = new Date(resetAt);
	const clock = new Intl.DateTimeFormat("en-GB", {
		hour: "2-digit",
		hourCycle: "h23",
		minute: "2-digit",
		timeZone,
	}).format(date);
	if (weekly) {
		const day = new Intl.DateTimeFormat("en-GB", {
			timeZone,
			weekday: "short",
		}).format(date);
		return `${day} ${clock}`;
	}
	return clock;
};

const formatUsageWindow = (
	window: UsageWindow | "unknown",
	weekly: boolean,
	{
		timeZone,
		unknown = "—",
	}: Readonly<{ timeZone?: string | undefined; unknown?: string }> = {},
): string => {
	if (window === "unknown") {
		return unknown;
	}
	const percent = `${Math.min(maxPercent, Math.round(window.utilization))}%`;
	if (window.resetAt === "unknown") {
		return percent;
	}
	return `${percent} ↻${formatClock(window.resetAt, weekly, timeZone)}`;
};

export { formatClock, formatUsageWindow };
