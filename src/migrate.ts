import {
	link,
	lstat,
	mkdir,
	readdir,
	readFile,
	rename,
	rmdir,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { SetupReport } from "./doctor.ts";
import { isRecord, parseJson } from "./json.ts";
import type { Action, Step } from "./migrate-plan.ts";
import { listTree, movedDirectories } from "./migrate-plan.ts";
import type { Seat, SeatName } from "./seats.ts";
import { countLiveSessions } from "./sessions.ts";

const zero = 0;
const first = 1;
const swapAttempts = 3;
const registryMode = 0o700;
const lineBreak = "\n";
const hasCode = (error: unknown, code: string): boolean =>
	isRecord(error) && error["code"] === code;

const timestamp = (line: string): number => {
	const parsed = parseJson(line);
	if (
		parsed.ok &&
		isRecord(parsed.value) &&
		typeof parsed.value["timestamp"] === "number"
	) {
		return parsed.value["timestamp"];
	}
	return zero;
};
const readLines = async (file: string): Promise<readonly string[]> => {
	try {
		const text = await readFile(file, "utf8");
		return text.split(lineBreak).filter((line) => line !== "");
	} catch (error) {
		if (hasCode(error, "ENOENT")) {
			return [];
		}
		throw error;
	}
};

// Union of both histories, ordered by prompt time so up-arrow recall stays chronological.
const mergeHistory = async (step: Step): Promise<void> => {
	const [current, incoming] = await Promise.all([
		readLines(step.to),
		readLines(step.from),
	]);
	const merged = [...new Set([...current, ...incoming])].toSorted(
		(left, right) => timestamp(left) - timestamp(right),
	);
	const temporary = `${step.to}.migrate-${String(process.pid)}`;
	await mkdir(path.dirname(step.to), { recursive: true });
	await writeFile(temporary, `${merged.join(lineBreak)}${lineBreak}`);
	await rename(temporary, step.to);
	await unlink(step.from);
};

// Every seat merges into the same shared history, so these run one after another.
const mergeHistories = async (steps: readonly Step[]): Promise<void> => {
	const [step, ...rest] = steps;
	if (!step) {
		return;
	}
	await mergeHistory(step);
	await mergeHistories(rest);
};

const moveStep = async (step: Step): Promise<void> => {
	if (step.action === "same") {
		await unlink(step.from);
		return;
	}
	if (step.action === "move" || step.action === "park") {
		await mkdir(path.dirname(step.to), { recursive: true });
		await rename(step.from, step.to);
	}
};

// A directory that still holds a blocked twin stays, and install reports it.
const removeInOrder = async (
	directories: readonly Readonly<{ file: string }>[],
): Promise<void> => {
	const [directory, ...rest] = directories;
	if (!directory) {
		return;
	}
	try {
		await rmdir(directory.file);
	} catch {
		// Not empty: keep it.
	}
	await removeInOrder(rest);
};

const removeEmptyDirectories = async (root: string): Promise<void> => {
	try {
		// A linked root would list the shared store, whose empty folders live sessions may use.
		const info = await lstat(root);
		if (!info.isDirectory()) {
			return;
		}
		const tree = await listTree(root);
		// Longer paths first, so every child goes before its parent.
		const directories: readonly Readonly<{ file: string }>[] = [
			{ file: root },
			...tree.filter((entry) => entry.kind === "directory"),
		];
		await removeInOrder(
			directories.toSorted(
				(left, right) => right.file.length - left.file.length,
			),
		);
	} catch {
		// Already linked or gone.
	}
};

// A session can recreate the folder between the rename and the link: park that one too, then retry.
const swapRegistry = async (
	step: Step,
	attempt: number,
): Promise<readonly string[]> => {
	const parked = `${step.from}.pre-share-${String(process.pid)}-${String(attempt)}`;
	await rename(step.from, parked);
	try {
		await symlink(step.to, step.from);
		return [parked];
	} catch (error) {
		if (attempt < swapAttempts && hasCode(error, "EEXIST")) {
			return [parked, ...(await swapRegistry(step, attempt + first))];
		}
		throw error;
	}
};

// Hard links keep each key file's mode 0600; a file its session already rewrote in the shared registry wins.
const drainFile = async (from: string, to: string): Promise<void> => {
	try {
		await link(from, to);
	} catch (error) {
		if (!hasCode(error, "EEXIST")) {
			throw error;
		}
	}
	await unlink(from);
};
const drainRegistry = async (parked: string, shared: string): Promise<void> => {
	const entries = await readdir(parked, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.isFile()) {
			files.push(entry.name);
		}
	}
	await Promise.all(
		files.map(async (name) =>
			drainFile(path.join(parked, name), path.join(shared, name)),
		),
	);
	await rmdir(parked);
};

// Live sessions keep running: Claude Code resolves the registry path on every write.
const shareRegistry = async (step: Step): Promise<void> => {
	await mkdir(step.to, { mode: registryMode, recursive: true });
	const parked = await swapRegistry(step, first);
	await Promise.all(
		parked.map(async (directory) => drainRegistry(directory, step.to)),
	);
};

const count = (steps: readonly Step[], action: Action): number =>
	steps.filter((step) => step.action === action).length;

const seatSummary = (steps: readonly Step[], seat: SeatName): string => {
	const own = steps.filter((step) => step.seat === seat);
	return `${seat}: ${String(count(own, "move"))} to move, ${String(count(own, "same"))} identical, ${String(count(own, "park"))} to set aside, ${String(count(own, "blocked"))} blocked, ${String(count(own, "history"))} history file, ${String(count(own, "share"))} sessions folder to link`;
};

const formatPlan = (steps: readonly Step[]): readonly string[] =>
	[...new Set(steps.map((step) => step.seat))].map((seat) =>
		seatSummary(steps, seat),
	);

const liveSessions = async (seats: readonly Seat[]): Promise<number> => {
	const counts = await countLiveSessions(seats);
	return [...counts.values()].reduce((total, live) => total + live, zero);
};

const writeLog = async (
	steps: readonly Step[],
	home: string,
): Promise<string> => {
	const stamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
	const log = path.join(home, ".claude-shared", `_migration-${stamp}.log`);
	const lines = steps.map(
		(step) =>
			`${step.action.toUpperCase()} ${step.seat} ${path.relative(home, step.from)}`,
	);
	await mkdir(path.dirname(log), { recursive: true });
	await writeFile(log, `${lines.join(lineBreak)}${lineBreak}`);
	return log;
};

const applySteps = async (
	steps: readonly Step[],
	seats: readonly Seat[],
): Promise<void> => {
	await Promise.all(steps.map(async (step) => moveStep(step)));
	await mergeHistories(steps.filter((step) => step.action === "history"));
	await Promise.all(
		seats.flatMap((seat) =>
			movedDirectories.map(async (name) =>
				removeEmptyDirectories(path.join(seat.directory, name)),
			),
		),
	);
};

const applyMigration = async (
	steps: readonly Step[],
	seats: readonly Seat[],
	home: string,
): Promise<SetupReport> => {
	const moves = steps.filter((step) => step.action !== "share");
	if (moves.length > zero && (await liveSessions(seats)) > zero) {
		return {
			messages: [
				"Quit every Claude session on every seat before cc migrate --apply; nothing was moved.",
			],
			ok: false,
		};
	}
	const log = await writeLog(steps, home);
	try {
		await applySteps(moves, seats);
		await Promise.all(
			steps
				.filter((step) => step.action === "share")
				.map(async (step) => shareRegistry(step)),
		);
	} catch {
		return {
			messages: [
				`Migration stopped part-way; files moved so far stay moved. See ${JSON.stringify(log)}, fix the cause and rerun cc migrate.`,
			],
			ok: false,
		};
	}
	return { messages: [...formatPlan(steps), `Log: ${log}`], ok: true };
};

export { applyMigration, count, formatPlan };
