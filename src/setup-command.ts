import path from "node:path";
import process from "node:process";
import type { SetupOptions, SetupReport } from "./doctor.ts";
import { doctor } from "./doctor.ts";
import { install } from "./install.ts";
import { stateDirectory } from "./list-seats.ts";
import { applyMigration, count, formatPlan } from "./migrate.ts";
import type { Step } from "./migrate-plan.ts";
import { planMigration } from "./migrate-plan.ts";
import { printError, printReply } from "./output.ts";
import type { SeatEnvironment } from "./route-seats.ts";
import type { Seat } from "./seats.ts";
import { loadSeats } from "./seats.ts";

const unavailable = 1;
const zero = 0;
type SetupCommandName = "doctor" | "install" | "migrate" | "migrate-apply";

const doctorReport = async (options: SetupOptions): Promise<SetupReport> => {
	const report = await doctor(options);
	if (report.ok) {
		return {
			messages: [
				`Setup is healthy: Node >=24, seats ${(options.names ?? []).join(", ")}, shared links, credential presence, private state and statusLine.`,
			],
			ok: true,
		};
	}
	return report;
};

const mergeHint = (steps: readonly Step[], home: string): readonly string[] => {
	if (count(steps, "park") + count(steps, "blocked") === zero) {
		return [];
	}
	const conflicts = path.join(home, ".claude-shared", "_conflicts");
	return [
		`Set-aside files wait in ${JSON.stringify(conflicts)}. Merge them with the merge-seat-conflicts skill in this checkout's .claude/skills.`,
	];
};

// Only moving the session registry is safe while sessions run.
const nextStep = (steps: readonly Step[]): string => {
	if (count(steps, "share") === steps.length) {
		return "Nothing changed. Run cc migrate --apply; live Claude sessions keep running.";
	}
	return "Nothing changed. Quit every Claude session, then run cc migrate --apply.";
};

const migrateReport = async (
	command: "migrate" | "migrate-apply",
	options: SetupOptions,
	seats: readonly Seat[],
): Promise<SetupReport> => {
	const steps = await planMigration(seats, options.home);
	if (steps.length === zero) {
		return {
			messages: [
				"Nothing to migrate: every seat already uses the shared store.",
			],
			ok: true,
		};
	}
	if (command === "migrate") {
		return { messages: [...formatPlan(steps), nextStep(steps)], ok: true };
	}
	const migrated = await applyMigration(steps, seats, options.home);
	if (!migrated.ok) {
		return migrated;
	}
	const installed = await install({
		...options,
		names: seats.map((seat) => seat.name),
	});
	return {
		messages: [
			...migrated.messages,
			...installed.messages,
			...mergeHint(steps, options.home),
		],
		ok: installed.ok,
	};
};

const setupReport = async (
	command: SetupCommandName,
	options: SetupOptions,
): Promise<SetupReport> => {
	const registry = await loadSeats(options.home);
	if (!registry.ok) {
		return { messages: [registry.reason], ok: false };
	}
	const names = registry.seats.map((seat) => seat.name);
	if (command === "install") {
		return install({ ...options, names });
	}
	if (command === "doctor") {
		return doctorReport({ ...options, names });
	}
	return migrateReport(command, options, registry.seats);
};

const setupCommand = async (
	command: SetupCommandName,
	options: SeatEnvironment,
): Promise<void> => {
	const report = await setupReport(command, {
		env: options.env,
		fixtureDirectory: options.env["CLAUDE_SEATS_KEYCHAIN_DIR"],
		home: options.home,
		state: stateDirectory(options.env, options.home),
	});
	if (report.ok) {
		printReply(["display", report.messages.join("\n")]);
	} else {
		printError(report.messages.join("\n"));
		process.exitCode = unavailable;
	}
};

export { setupCommand };
