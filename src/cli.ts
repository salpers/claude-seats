import process from "node:process";
import type { ParsedArgs } from "./args.ts";
import { parseArgs } from "./args.ts";
import { authEnvironmentProblems } from "./claude-environment.ts";
import { launch } from "./launch.ts";
import { listSeats } from "./list-seats.ts";
import { printError } from "./output.ts";
import { parseResume } from "./resume.ts";
import type { SeatEnvironment, Selection } from "./route-seats.ts";
import { routeSeats } from "./route-seats.ts";
import type { Seat } from "./seats.ts";
import { createSeats } from "./seats.ts";
import { setupCommand } from "./setup-command.ts";

const usageError = 2;
const argumentOffset = 2;
type Environment = Readonly<Record<string, string | undefined>>;

const fail = (message: string): void => {
	printError(message);
	process.exitCode = usageError;
};

const routedSelection = async (
	parsed: Extract<ParsedArgs, { kind: "auto" | "launch" }>,
	seats: readonly Seat[],
	options: SeatEnvironment,
): Promise<Selection> => {
	if (parsed.kind === "launch") {
		const selection = await routeSeats(seats, options, parsed.seat);
		return selection;
	}
	const selection = await routeSeats(seats, options);
	return selection;
};

const selectLaunch = async (
	parsed: Extract<ParsedArgs, { kind: "auto" | "launch" }>,
	seats: readonly Seat[],
	options: SeatEnvironment,
): Promise<void> => {
	const binary = options.env["CLAUDE_SEATS_CLAUDE_BIN"] ?? "claude";
	if (binary === "") {
		fail("CLAUDE_SEATS_CLAUDE_BIN must name an executable.");
		return;
	}
	const selection = await routedSelection(parsed, seats, options);
	if (!selection.ok) {
		printError(selection.reason);
		process.exitCode = selection.exitCode;
		return;
	}
	await launch(selection.seat, seats, {
		binary,
		consumed: parsed.consumed,
		notices: [...authEnvironmentProblems(options.env), ...selection.notices],
	});
};

const select = async (
	parsed: ParsedArgs,
	seats: readonly Seat[],
	options: SeatEnvironment,
): Promise<void> => {
	if (!parsed.ok) {
		fail(parsed.reason);
		return;
	}
	if (parsed.kind === "list" || parsed.kind === "menu") {
		await listSeats(seats, options, parsed.kind);
		return;
	}
	if (parsed.kind === "doctor" || parsed.kind === "install") {
		await setupCommand(parsed.kind, options);
		return;
	}
	await selectLaunch(parsed, seats, options);
};

const run = async (env: Environment): Promise<void> => {
	const home = env["CLAUDE_SEATS_HOME"] ?? env["HOME"] ?? "";
	if (home === "") {
		fail("Set HOME or CLAUDE_SEATS_HOME to the seat home directory.");
		return;
	}
	const args = process.argv.slice(argumentOffset);
	const parsed = parseArgs(args);
	let resume = {};
	if (parsed.ok && (parsed.kind === "auto" || parsed.kind === "launch")) {
		resume = parseResume(args.slice(parsed.consumed));
	}
	await select(parsed, createSeats(home), { env, home, resume });
};

const environment: Environment = process.env;
if (environment["CLAUDE_SEATS_KEYCHAIN_DIR"] === "") {
	fail("CLAUDE_SEATS_KEYCHAIN_DIR must name a fixture directory or be unset.");
} else {
	await run(environment);
}
