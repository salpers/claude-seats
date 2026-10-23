import path from "node:path";
import { parseJson } from "./json.ts";
import type { SeatName } from "./seats.ts";
import { formatStatuslineSegment, parseRateLimits } from "./statusline.ts";
import { resolveStatuslineSeat } from "./statusline-seat.ts";
import type { Usage, UsageWindow } from "./usage.ts";
import type { CacheResult } from "./usage-cache.ts";
import { createUsageCache } from "./usage-cache.ts";

type Environment = Readonly<Record<string, string | undefined>>;
type CacheReader = (
	directory: string,
	seat: SeatName,
) => CacheResult | Promise<CacheResult>;
interface SegmentOptions {
	readonly readCache?: CacheReader;
	readonly timeZone?: string;
}

const readSnapshot: CacheReader = async (
	directory: string,
	seat: SeatName,
): Promise<CacheResult> => createUsageCache(directory).read(seat);

const preferLive = (
	live: UsageWindow | "unknown",
	cached: UsageWindow | "unknown",
): UsageWindow | "unknown" => {
	if (live === "unknown") {
		return cached;
	}
	return live;
};

const cacheDirectory = (env: Environment): string | false => {
	const home = env["CLAUDE_SEATS_HOME"] ?? env["HOME"] ?? "";
	const directory = env["CLAUDE_SEATS_STATE_DIR"];
	if (directory === "") {
		return false;
	}
	if (typeof directory === "string") {
		return directory;
	}
	if (home === "") {
		return false;
	}
	return path.join(home, ".claude-shared", "_seats");
};

const fillMissingWindows = async (
	live: Usage,
	seat: SeatName,
	{ env, readCache }: Readonly<{ env: Environment; readCache: CacheReader }>,
): Promise<Usage> => {
	const directory = cacheDirectory(env);
	if (
		directory === false ||
		seat === "unknown" ||
		(live.fiveHour !== "unknown" && live.sevenDay !== "unknown")
	) {
		return live;
	}
	try {
		const cached = await readCache(directory, seat);
		if (cached.ok) {
			return {
				fiveHour: preferLive(live.fiveHour, cached.snapshot.usage.fiveHour),
				sevenDay: preferLive(live.sevenDay, cached.snapshot.usage.sevenDay),
			};
		}
	} catch {
		// Statusline failures must not expose filesystem paths or config contents.
	}
	return live;
};

const renderStatuslineSegment = async (
	text: string,
	env: Environment,
	{ readCache = readSnapshot, timeZone }: SegmentOptions = {},
): Promise<string> => {
	const home = env["CLAUDE_SEATS_HOME"] ?? env["HOME"] ?? "";
	const seat = await resolveStatuslineSeat(home, env["CLAUDE_CONFIG_DIR"]);
	const parsed = parseJson(text);
	let usage: Usage = { fiveHour: "unknown", sevenDay: "unknown" };
	if (parsed.ok) {
		usage = parseRateLimits(parsed.value);
	}
	const display = await fillMissingWindows(usage, seat, { env, readCache });
	return formatStatuslineSegment(seat, display, timeZone);
};

export { renderStatuslineSegment };
