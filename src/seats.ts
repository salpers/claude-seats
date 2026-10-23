import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isRecord, parseJson } from "./json.ts";

// A plain string: "none" and "unknown" stay usable as sentinels because they are reserved.
type SeatName = string;

interface Seat {
	readonly directory: string;
	readonly name: SeatName;
	readonly slot: string;
}
type SeatsResult =
	| { readonly ok: true; readonly seats: readonly Seat[] }
	| { readonly ok: false; readonly reason: string };

const defaultNames: readonly SeatName[] = ["main", "dev", "dev2", "dev3"];
// Names become `.claude-<name>` directories and `@<name>` selectors.
const namePattern = /^[a-z0-9][a-z0-9-]*$/u;
// `none` and `unknown` are routing/statusline sentinels; `shared` is the shared store.
const reservedNames: ReadonlySet<string> = new Set([
	"none",
	"shared",
	"unknown",
]);
const suffixLength = 8;
const start = 0;

const createSeat = (home: string, name: SeatName): Seat => {
	if (name === "main") {
		return {
			directory: path.resolve(home, ".claude"),
			name,
			slot: "Claude Code-credentials",
		};
	}
	const directory = path.resolve(home, `.claude-${name}`);
	const suffix = createHash("sha256")
		.update(directory)
		.digest("hex")
		.slice(start, suffixLength);
	return { directory, name, slot: `Claude Code-credentials-${suffix}` };
};

const createSeats = (
	home: string,
	names: readonly SeatName[] = defaultNames,
): readonly Seat[] => names.map((name) => createSeat(home, name));
const isSeatName = (name: string): boolean =>
	namePattern.test(name) && !reservedNames.has(name);
const isSeatList = (value: unknown): value is readonly SeatName[] =>
	Array.isArray(value) &&
	value.length > start &&
	value.every((name) => typeof name === "string" && isSeatName(name)) &&
	new Set(value).size === value.length;

const seatsConfigPath = (home: string): string =>
	path.resolve(home, ".claude-shared", "seats.json");

const loadSeats = async (home: string): Promise<SeatsResult> => {
	const file = seatsConfigPath(home);
	try {
		const parsed = parseJson(await readFile(file, "utf8"));
		if (parsed.ok && isSeatList(parsed.value)) {
			return { ok: true, seats: createSeats(home, parsed.value) };
		}
	} catch (error) {
		// No config file means the default seats; any other read error is invalid.
		if (isRecord(error) && error["code"] === "ENOENT") {
			return { ok: true, seats: createSeats(home) };
		}
	}
	return {
		ok: false,
		reason: `${JSON.stringify(file)} must be a readable JSON array of unique seat names: lowercase letters, digits and "-", not "none", "shared" or "unknown".`,
	};
};

export type { Seat, SeatName, SeatsResult };
export { createSeats, isSeatName, loadSeats, seatsConfigPath };
