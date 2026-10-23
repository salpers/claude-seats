import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { runBoundedCommand } from "./bounded-command.mjs";
import { overridesSeatAuth } from "./claude-environment.ts";
import { parseResetClock } from "./reset-clock.ts";
import type { Seat } from "./seats.ts";

type ProbeResult =
	| { readonly kind: "available" }
	| { readonly kind: "cooldown"; readonly until: number }
	| { readonly kind: "unavailable" };
interface ProbeReply {
	readonly status: number | "unavailable";
	readonly stdout: string;
	readonly stderr: string;
}
type Environment = Readonly<Record<string, string | undefined>>;
type ProbeRun = (
	binary: string,
	args: readonly string[],
	env: Environment,
) => ProbeReply | Promise<ProbeReply>;
interface ClaudeProbeOptions {
	readonly binary: string;
	readonly env: Environment;
	readonly run?: ProbeRun;
	readonly now?: () => number;
}
const success = 0;
const timeout = 15_000;
const maxBuffer = 65_536;
const limitPattern =
	/(?:hit|reached|exceeded)[^\n]*\blimit\b|\blimit (?:reached|exceeded)\b|\busage limit\b|\brate.?limit/iu;
const unavailable: ProbeResult = { kind: "unavailable" };
const probeArgs = [
	"-p",
	"Hi",
	"--model",
	"haiku",
	"--tools",
	"",
	"--max-turns",
	"1",
	"--no-session-persistence",
	"--disable-slash-commands",
	"--strict-mcp-config",
];

const classifyProbe = (reply: ProbeReply, now: number): ProbeResult => {
	const output = stripVTControlCharacters(`${reply.stdout}\n${reply.stderr}`);
	if (limitPattern.test(output)) {
		const until = parseResetClock(output, now);
		if (until !== false) {
			return { kind: "cooldown", until };
		}
		return unavailable;
	}
	if (reply.status === success && reply.stdout.trim() !== "") {
		return { kind: "available" };
	}
	return unavailable;
};

const runProbe: ProbeRun = async (
	binary: string,
	args: readonly string[],
	env: Environment,
): Promise<ProbeReply> =>
	runBoundedCommand(binary, args, { env, maxBuffer, timeout });

const probeClaude = async (
	seat: Seat,
	{ binary, env, run = runProbe, now = Date.now }: ClaudeProbeOptions,
): Promise<ProbeResult> => {
	const environment = Object.fromEntries(
		Object.entries(env).filter(
			([key]: readonly [string, string | undefined]) =>
				key !== "CLAUDE_CONFIG_DIR" && !overridesSeatAuth(key),
		),
	);
	environment["HOME"] = path.dirname(seat.directory);
	if (seat.name !== "main") {
		environment["CLAUDE_CONFIG_DIR"] = seat.directory;
	}
	try {
		return classifyProbe(await run(binary, probeArgs, environment), now());
	} catch {
		return unavailable;
	}
};

export type { ProbeReply, ProbeResult, ProbeRun };
export { classifyProbe, probeClaude };
