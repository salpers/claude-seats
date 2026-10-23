import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Seat, SeatName } from "./seats.ts";
import { sessionRegistry, sharedDirectories } from "./setup-layout.ts";

type Action = "move" | "same" | "park" | "blocked" | "history" | "share";
interface Step {
	readonly action: Action;
	readonly seat: SeatName;
	readonly from: string;
	readonly to: string;
}
interface FileTargets {
	readonly seat: SeatName;
	readonly from: string;
	readonly to: string;
	readonly park: string;
}
// Targets claimed by earlier seats in this plan, mapped to the file that will land there.
type Claimed = Readonly<Record<string, string>>;

// Live sessions keep writing the registry, so it moves whole in a "share" step instead.
const movedDirectories = sharedDirectories.filter(
	(name) => name !== sessionRegistry,
);

const kindOf = async (file: string): Promise<"directory" | "file" | false> => {
	try {
		const info = await lstat(file);
		if (info.isDirectory()) {
			return "directory";
		}
		return "file";
	} catch {
		return false;
	}
};
const isRegularFile = async (file: string): Promise<boolean> => {
	try {
		const info = await lstat(file);
		return info.isFile();
	} catch {
		return false;
	}
};
const sameBytes = async (left: string, right: string): Promise<boolean> => {
	try {
		const [first, second] = await Promise.all([
			readFile(left),
			readFile(right),
		]);
		return first.equals(second);
	} catch {
		return false;
	}
};

// Every path below root, absolute, with its kind; symlinks count as files and are not followed.
const listTree = async (
	root: string,
): Promise<readonly Readonly<{ file: string; kind: string | false }>[]> => {
	const names = await readdir(root, { recursive: true });
	return Promise.all(
		names.map(async (name) => {
			const file = path.join(root, name);
			return { file, kind: await kindOf(file) };
		}),
	);
};

const occupant = async (
	target: string,
	claimed: Claimed,
): Promise<string | false> => {
	const planned = claimed[target];
	if (typeof planned === "string") {
		return planned;
	}
	if ((await kindOf(target)) === false) {
		return false;
	}
	return target;
};

const fileStep = async (
	targets: FileTargets,
	claimed: Claimed,
): Promise<Step> => {
	const { from, park, seat, to } = targets;
	const current = await occupant(to, claimed);
	if (current === false) {
		return { action: "move", from, seat, to };
	}
	if (await sameBytes(from, current)) {
		return { action: "same", from, seat, to };
	}
	// A rename replaces its target, so an earlier set-aside twin blocks this one.
	if ((await kindOf(park)) !== false) {
		return { action: "blocked", from, seat, to: park };
	}
	return { action: "park", from, seat, to: park };
};

const fileTargets = (seat: Seat, shared: string, file: string): FileTargets => {
	const relative = path.relative(seat.directory, file);
	return {
		from: file,
		park: path.join(shared, "_conflicts", seat.name, relative),
		seat: seat.name,
		to: path.join(shared, relative),
	};
};

const directorySteps = async (
	seat: Seat,
	home: string,
	claimed: Claimed,
): Promise<readonly Step[]> => {
	const shared = path.join(home, ".claude-shared");
	const roots = movedDirectories.map((name) => path.join(seat.directory, name));
	const kinds = await Promise.all(roots.map(async (root) => kindOf(root)));
	const trees = await Promise.all(
		roots
			.filter((_root, index) => kinds[index] === "directory")
			.map(async (root) => listTree(root)),
	);
	const files = trees.flat().filter((entry) => entry.kind === "file");
	return Promise.all(
		files.map(async ({ file }) =>
			fileStep(fileTargets(seat, shared, file), claimed),
		),
	);
};

const historySteps = async (
	seat: Seat,
	home: string,
): Promise<readonly Step[]> => {
	const from = path.join(seat.directory, "history.jsonl");
	if (!(await isRegularFile(from))) {
		return [];
	}
	const to = path.join(home, ".claude-shared", "history.jsonl");
	return [{ action: "history", from, seat: seat.name, to }];
};

const registrySteps = async (
	seat: Seat,
	home: string,
): Promise<readonly Step[]> => {
	const from = path.join(seat.directory, sessionRegistry);
	if ((await kindOf(from)) !== "directory") {
		return [];
	}
	const to = path.join(home, ".claude-shared", sessionRegistry);
	return [{ action: "share", from, seat: seat.name, to }];
};

// Non-main seats link settings.json to the hub; a seat's own copy is set aside for merging.
const settingsSteps = async (
	seat: Seat,
	home: string,
	claimed: Claimed,
): Promise<readonly Step[]> => {
	const from = path.join(seat.directory, "settings.json");
	if (seat.name === "main" || !(await isRegularFile(from))) {
		return [];
	}
	const park = path.join(
		home,
		".claude-shared",
		"_conflicts",
		seat.name,
		"settings.json",
	);
	const to = path.join(home, ".claude", "settings.json");
	return [await fileStep({ from, park, seat: seat.name, to }, claimed)];
};

const seatSteps = async (
	seat: Seat,
	home: string,
	claimed: Claimed,
): Promise<readonly Step[]> => [
	...(await directorySteps(seat, home, claimed)),
	...(await historySteps(seat, home)),
	...(await settingsSteps(seat, home, claimed)),
	...(await registrySteps(seat, home)),
];

// Seats are planned one after another, so a file claimed by an earlier seat is compared, not overwritten.
const planSeats = async (
	seats: readonly Seat[],
	home: string,
	claimed: Claimed,
): Promise<readonly Step[]> => {
	const [seat, ...rest] = seats;
	if (!seat) {
		return [];
	}
	const steps = await seatSteps(seat, home, claimed);
	const moved = steps
		.filter((step) => step.action === "move")
		.map((step): [string, string] => [step.to, step.from]);
	return [
		...steps,
		...(await planSeats(rest, home, {
			...claimed,
			...Object.fromEntries(moved),
		})),
	];
};

const planMigration = async (
	seats: readonly Seat[],
	home: string,
): Promise<readonly Step[]> => planSeats(seats, home, {});

export type { Action, Step };
export { listTree, movedDirectories, planMigration };
