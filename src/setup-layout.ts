import path from "node:path";
import type { Seat, SeatName } from "./seats.ts";
import { createSeats } from "./seats.ts";

type LayoutEntry = Readonly<
	{ file: string; label: string } & (
		| { kind: "directory" | "file" }
		| { kind: "link"; target: string }
	)
>;
const shimSource = path.resolve(import.meta.dirname, "../bin/cc.zsh");
const sharedDirectories = [
	"projects",
	"file-history",
	"shell-snapshots",
	"tasks",
];
const sharedEntries: readonly string[] = [
	...sharedDirectories,
	"history.jsonl",
];

const seatLinks = (seat: Seat, home: string): readonly LayoutEntry[] => {
	const links: LayoutEntry[] = sharedEntries.map((name) => ({
		file: path.join(seat.directory, name),
		kind: "link",
		label: `${seat.name}: ${name}`,
		target: path.resolve(home, ".claude-shared", name),
	}));
	if (seat.name !== "main") {
		links.push({
			file: path.join(seat.directory, "settings.json"),
			kind: "link",
			label: `${seat.name}: settings.json`,
			target: path.resolve(home, ".claude/settings.json"),
		});
	}
	return links;
};

const setupLayout = (
	home: string,
	state: string,
	names?: readonly SeatName[],
): readonly LayoutEntry[] => {
	const shared = path.join(home, ".claude-shared");
	const seats = createSeats(home, names);
	return [
		{ file: home, kind: "directory", label: "seat home" },
		{ file: shared, kind: "directory", label: "shared store" },
		...seats.map(
			(seat): LayoutEntry => ({
				file: seat.directory,
				kind: "directory",
				label: `${seat.name}: config directory`,
			}),
		),
		...sharedDirectories.map(
			(name): LayoutEntry => ({
				file: path.join(shared, name),
				kind: "directory",
				label: `shared ${name}`,
			}),
		),
		{
			file: path.join(shared, "history.jsonl"),
			kind: "file",
			label: "shared history.jsonl",
		},
		{
			file: path.join(shared, "bin"),
			kind: "directory",
			label: "shared bin directory",
		},
		{ file: state, kind: "directory", label: "state directory" },
		{
			file: path.join(shared, "bin/cc.zsh"),
			kind: "link",
			label: "installed cc.zsh",
			target: shimSource,
		},
		...seats.flatMap((seat) => seatLinks(seat, home)),
	];
};

const layoutProblem = (entry: LayoutEntry): string => {
	if (entry.kind === "link") {
		return `${entry.label} must be a symlink to ${JSON.stringify(entry.target)} (${JSON.stringify(entry.file)}).`;
	}
	return `${entry.label} must be a readable ${entry.kind} (${JSON.stringify(entry.file)}).`;
};

export type { LayoutEntry };
export { layoutProblem, setupLayout };
