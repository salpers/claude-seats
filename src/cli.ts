import process from "node:process";
import type { ParsedArgs } from "./args.ts";
import { parseArgs } from "./args.ts";
import { authEnvironmentProblems } from "./claude-environment.ts";
import { launch } from "./launch.ts";
import { listSeats } from "./list-seats.ts";
import { printError } from "./output.ts";
import type { ResumeMetadata } from "./resume.ts";
import { parseResume } from "./resume.ts";
import type { SeatEnvironment, Selection } from "./route-seats.ts";
import { routeSeats } from "./route-seats.ts";
import type { Seat, SeatName, SeatsResult } from "./seats.ts";
import { loadSeats } from "./seats.ts";
import { setupCommand } from "./setup-command.ts";

const usageError = 2;
const unavailable = 1;
const argumentOffset = 2;
type Environment = Readonly<Record<string, string | undefined>>;

const fail = (message: string, exitCode = usageError): void => {
	printError(message);
	process.exitCode = exitCode;
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
	// /seat without a name moves the session to the best seat other than its own.
	const avoided = options.env["CLAUDE_SEATS_AVOID"];
	const selection = await routeSeats(
		seats.filter((seat) => seat.name !== avoided),
		options,
	);
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

const selectSeats = async (
	parsed: Extract<ParsedArgs, { kind: "auto" | "launch" | "list" | "menu" }>,
	seats: readonly Seat[],
	options: SeatEnvironment,
): Promise<void> => {
	if (parsed.kind === "list" || parsed.kind === "menu") {
		await listSeats(seats, options, parsed.kind);
		return;
	}
	await selectLaunch(parsed, seats, options);
};

const select = async (
	parsed: ParsedArgs,
	registry: SeatsResult,
	options: SeatEnvironment,
): Promise<void> => {
	// Setup commands report an invalid seat config themselves.
	if (
		parsed.ok &&
		(parsed.kind === "doctor" ||
			parsed.kind === "install" ||
			parsed.kind === "migrate" ||
			parsed.kind === "migrate-apply")
	) {
		await setupCommand(parsed.kind, options);
		return;
	}
	if (!registry.ok) {
		fail(registry.reason, unavailable);
		return;
	}
	if (!parsed.ok) {
		fail(parsed.reason);
		return;
	}
	await selectSeats(parsed, registry.seats, options);
};

const registryNames = (registry: SeatsResult): readonly SeatName[] => {
	if (registry.ok) {
		return registry.seats.map((seat) => seat.name);
	}
	return [];
};

const resumeFor = (
	parsed: ParsedArgs,
	args: readonly string[],
): ResumeMetadata => {
	if (parsed.ok && (parsed.kind === "auto" || parsed.kind === "launch")) {
		return parseResume(args.slice(parsed.consumed));
	}
	return {};
};

const run = async (env: Environment): Promise<void> => {
	const home = env["CLAUDE_SEATS_HOME"] ?? env["HOME"] ?? "";
	if (home === "") {
		fail("Set HOME or CLAUDE_SEATS_HOME to the seat home directory.");
		return;
	}
	const args = process.argv.slice(argumentOffset);
	const registry = await loadSeats(home);
	const parsed = parseArgs(args, registryNames(registry));
	await select(parsed, registry, {
		env,
		home,
		resume: resumeFor(parsed, args),
	});
};

const environment: Environment = process.env;
if (environment["CLAUDE_SEATS_KEYCHAIN_DIR"] === "") {
	fail("CLAUDE_SEATS_KEYCHAIN_DIR must name a fixture directory or be unset.");
} else {
	await run(environment);
}
