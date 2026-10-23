import { createHash } from "node:crypto";
import path from "node:path";

type SeatName = "main" | "dev" | "dev2" | "dev3";

interface Seat {
	readonly directory: string;
	readonly name: SeatName;
	readonly slot: string;
}

const names: readonly SeatName[] = ["main", "dev", "dev2", "dev3"];
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

const createSeats = (home: string): readonly Seat[] =>
	names.map((name) => createSeat(home, name));
const isSeatName = (name: string): name is SeatName =>
	names.some((seat) => seat === name);
const compareSeatNames = (left: SeatName, right: SeatName): number =>
	names.indexOf(left) - names.indexOf(right);

export type { Seat, SeatName };
export { compareSeatNames, createSeats, isSeatName };
