import path from "node:path";
import { printNotices, printReply } from "./output.ts";
import { prepareLaunch } from "./prepare-launch.ts";
import type { Seat, SeatName } from "./seats.ts";

const launch = async (
	name: SeatName,
	seats: readonly Seat[],
	{
		binary,
		consumed,
		notices,
	}: Readonly<{ binary: string; consumed: number; notices: readonly string[] }>,
): Promise<void> => {
	const seat = seats.find((entry) => entry.name === name);
	if (!seat) {
		throw new TypeError("Chosen seat is missing from registry");
	}
	printNotices(notices);
	if (!(await prepareLaunch(seats, path.dirname(seat.directory)))) {
		return;
	}
	let { directory } = seat;
	if (seat.name === "main") {
		directory = "";
	}
	printReply([
		"launch",
		directory,
		binary,
		String(consumed),
		path.dirname(seat.directory),
		seat.name,
		// The /seat mod checks a target against these names.
		seats.map((entry) => entry.name).join(" "),
	]);
};

export { launch };
