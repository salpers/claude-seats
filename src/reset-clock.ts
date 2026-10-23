// A malformed annotation must not backtrack into a match using the local timezone.
const clockPattern =
	/\bresets\s+(?<hour>\d{1,2})(?::(?<minute>\d{2}))?\s*(?<period>am|pm)?(?:\s*\((?<zone>[^)]+)\))?(?!\s*\()(?=$|[\s·.,!])/iu;
const zero = 0;
const one = 1;
const noon = 12;
const hoursPerDay = 24;
const minutesPerHour = 60;
const minuteMs = 60_000;
const searchHours = 26;
const clockDigits = 2;
const searchMinutes: number = searchHours * minutesPerHour;

const clockText = (
	groups: Readonly<Record<string, string>>,
): string | false => {
	let hour = Number(groups["hour"]);
	const minute = Number(groups["minute"] ?? zero);
	const period = (groups["period"] ?? "").toLowerCase();
	if (
		minute >= minutesPerHour ||
		hour >= hoursPerDay ||
		(period !== "" && (hour < one || hour > noon)) ||
		(period === "" && typeof groups["minute"] !== "string")
	) {
		return false;
	}
	if (period !== "") {
		hour %= noon;
		if (period === "pm") {
			hour += noon;
		}
	}
	return `${String(hour).padStart(clockDigits, "0")}:${String(minute).padStart(clockDigits, "0")}`;
};

const nextOccurrence = (
	clock: string,
	now: number,
	timeZone: string | undefined,
): number | false => {
	try {
		const formatter = new Intl.DateTimeFormat("en-GB", {
			hour: "2-digit",
			hourCycle: "h23",
			minute: "2-digit",
			timeZone,
		});
		// Walk actual instants, so midnight and repeated DST hours use the next local clock occurrence.
		const start = Math.floor(now / minuteMs) * minuteMs;
		for (let step: number = one; step <= searchMinutes; step += one) {
			const instant = start + step * minuteMs;
			if (formatter.format(instant) === clock) {
				return instant;
			}
		}
	} catch {
		// Unknown timezone annotations are untrusted, not local-time guesses.
	}
	return false;
};

const parseResetClock = (
	text: string,
	now: number,
	timeZone?: string,
): number | false => {
	const { groups } = clockPattern.exec(text) ?? {};
	if (!(groups && Number.isFinite(now))) {
		return false;
	}
	const clock = clockText(groups);
	if (clock === false) {
		return false;
	}
	return nextOccurrence(clock, now, groups["zone"] ?? timeZone);
};

export { parseResetClock };
