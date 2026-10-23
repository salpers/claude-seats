import {
	mkdir,
	readFile,
	rename,
	rmdir,
	unlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { SetupReport } from "./doctor.ts";
import { isRecord, parseJson } from "./json.ts";
import type { Action, Step } from "./migrate-plan.ts";
import { listTree } from "./migrate-plan.ts";
import type { Seat, SeatName } from "./seats.ts";
import { countLiveSessions } from "./sessions.ts";
import { sharedDirectories } from "./setup-layout.ts";

const zero = 0;
const lineBreak = "\n";

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
		if (isRecord(error) && error["code"] === "ENOENT") {
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

const count = (steps: readonly Step[], action: Action): number =>
	steps.filter((step) => step.action === action).length;

const seatSummary = (steps: readonly Step[], seat: SeatName): string => {
	const own = steps.filter((step) => step.seat === seat);
	return `${seat}: ${String(count(own, "move"))} to move, ${String(count(own, "same"))} identical, ${String(count(own, "park"))} to set aside, ${String(count(own, "blocked"))} blocked, ${String(count(own, "history"))} history file`;
};

const formatPlan = (steps: readonly Step[]): readonly string[] =>
	[...new Set(steps.map((step) => step.seat))].map((seat) =>
		seatSummary(steps, seat),
	);

const liveSessions = async (seats: readonly Seat[]): Promise<number> => {
	const counts = await Promise.all(
		seats.map(async (seat) => countLiveSessions(seat.directory)),
	);
	return counts.reduce((total, live) => total + live, zero);
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
			sharedDirectories.map(async (name) =>
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
	if ((await liveSessions(seats)) > zero) {
		return {
			messages: [
				"Quit every Claude session on every seat before cc migrate --apply; nothing was moved.",
			],
			ok: false,
		};
	}
	const log = await writeLog(steps, home);
	try {
		await applySteps(steps, seats);
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
