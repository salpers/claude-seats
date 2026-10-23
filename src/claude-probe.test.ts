import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { ProbeReply } from "./claude-probe.ts";
import { classifyProbe, probeClaude } from "./claude-probe.ts";
import { createSeats } from "./seats.ts";

const success = 0;
const failed = 1;
const promptArgs = 4;
const next = 1;
const now = Date.parse("2026-09-18T10:00:00Z");
const failure = { kind: "unavailable" };

const inheritedEnvironment = Object.fromEntries([
	["CLAUDE_CONFIG_DIR", "/inherited"],
	["HOME", "/caller"],
	["PATH", "/bin"],
	["ANTHROPIC_API_KEY", "private override"],
	["ANTHROPIC_AUTH_TOKEN", "private override"],
	["ANTHROPIC_BASE_URL", "private override"],
	["CLAUDE_CODE_OAUTH_TOKEN", "private override"],
	["CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR", "private override"],
	["CLAUDE_CODE_USE_BEDROCK", "1"],
	["CLAUDE_CODE_USE_VERTEX", "1"],
	["CLAUDE_CODE_USE_FOUNDRY", "1"],
]);

await test("captured Limit reached messages and terminal colors are recognized", (): void => {
	const message = "Limit reached · resets 1pm (Europe/Berlin)";
	deepStrictEqual(
		classifyProbe({ status: 0, stderr: "", stdout: message }, now),
		{ kind: "cooldown", until: Date.parse("2026-09-18T11:00:00Z") },
	);
	deepStrictEqual(
		classifyProbe(
			{
				status: 1,
				stderr: `You've hit your limit · resets \u001B[31m1pm\u001B[0m (Europe/Berlin)`,
				stdout: "",
			},
			now,
		),
		{ kind: "cooldown", until: Date.parse("2026-09-18T11:00:00Z") },
	);
});

await test("normal responses are available, while limit output on either stream becomes a cooldown", (): void => {
	deepStrictEqual(
		classifyProbe({ status: 0, stderr: "", stdout: "Hello!" }, now),
		{ kind: "available" },
	);
	const message = "hit your session limit · resets 1pm (Europe/Berlin)";
	for (const status of [success, failed]) {
		for (const reply of [
			{ status, stderr: "", stdout: message },
			{ status, stderr: message, stdout: "" },
		]) {
			deepStrictEqual(classifyProbe(reply, now), {
				kind: "cooldown",
				until: Date.parse("2026-09-18T11:00:00Z"),
			});
		}
	}
});

await test("empty, failed and unparseable limit probes remain unavailable without exposing output", (): void => {
	const replies: readonly ProbeReply[] = [
		{ status: 0, stderr: "", stdout: "" },
		{ status: 1, stderr: "", stdout: "private diagnostic" },
		{ status: "unavailable", stderr: "private diagnostic", stdout: "Hello!" },
		{
			status: 0,
			stderr: "",
			stdout: "You've hit your limit · resets tomorrow",
		},
	];
	for (const reply of replies) {
		deepStrictEqual(classifyProbe(reply, now), failure);
	}
});

await test("probes use a one-word Haiku call and isolate each seat's environment", async (): Promise<void> => {
	await Promise.all(
		createSeats("/fixture").map(async (seat): Promise<void> => {
			const result = await probeClaude(seat, {
				binary: "/fake claude",
				env: inheritedEnvironment,
				now: (): number => now,
				run: (
					binary: string,
					args: readonly string[],
					env: Readonly<Record<string, string | undefined>>,
				): ProbeReply => {
					strictEqual(binary, "/fake claude");
					deepStrictEqual(args.slice(success, promptArgs), [
						"-p",
						"Hi",
						"--model",
						"haiku",
					]);
					strictEqual(args.includes("--no-session-persistence"), true);
					strictEqual(args[args.indexOf("--tools") + next], "");
					strictEqual(env["HOME"], "/fixture");
					deepStrictEqual(
						Object.keys(env)
							.filter((key) => key !== "CLAUDE_CONFIG_DIR")
							.toSorted(),
						["HOME", "PATH"],
					);
					if (seat.name === "main") {
						strictEqual(Object.hasOwn(env, "CLAUDE_CONFIG_DIR"), false);
					} else {
						strictEqual(env["CLAUDE_CONFIG_DIR"], seat.directory);
					}
					return { status: 0, stderr: "", stdout: "Hello!" };
				},
			});
			deepStrictEqual(result, { kind: "available" });
		}),
	);
});

await test("probe runner failures do not expose diagnostics", async (): Promise<void> => {
	await Promise.all(
		createSeats("/fixture").map(async (seat): Promise<void> => {
			deepStrictEqual(
				await probeClaude(seat, {
					binary: "fake",
					env: {},
					run: (): never => {
						throw new Error("private diagnostic");
					},
				}),
				failure,
			);
		}),
	);
});
