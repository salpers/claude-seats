import { deepStrictEqual, notStrictEqual, ok } from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
	chmod,
	mkdir,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import type { TestContext } from "node:test";

const root = path.dirname(import.meta.dirname);
const timeout = 10_000;
const executableMode = 0o700;
const start = 0;
const next = 1;
type Context = Readonly<Pick<TestContext, "after">>;
const shell =
	'source "$1" || exit; shift; cc "$@"; result=$?; print -r -- "returned:$result" >&2; exit $result';
const fakeClaude = `#!/bin/zsh -f
print -r -- "$CLAUDE_SEATS_TEST_PID:$$"
if (( \${+CLAUDE_CONFIG_DIR} )); then
  print -rn -- "set"$'\\0'"$CLAUDE_CONFIG_DIR"$'\\0'
else
  print -rn -- "unset"$'\\0'$'\\0'
fi
for arg in "$@"; do printf '%s\\0' "$arg"; done
if [[ "$CLAUDE_SEATS_TEST_HOME" == yes ]]; then printf '%s\\0' "$HOME"; fi
exit "\${CLAUDE_SEATS_TEST_EXIT:-0}"
`;

interface Fixture {
	readonly binary: string;
	readonly directory: string;
	readonly home: string;
	readonly keychain: string;
	readonly shim: string;
}

const installBinary = async (bin: string): Promise<string> => {
	await mkdir(bin);
	const binary = path.join(bin, "fake claude");
	await writeFile(binary, fakeClaude);
	await chmod(binary, executableMode);
	await Promise.all([
		symlink(binary, path.join(bin, "claude")),
		symlink(process.execPath, path.join(bin, "node")),
	]);
	return binary;
};

const fixture = async (context: Context): Promise<Fixture> => {
	const directory = await mkdtemp(path.join(tmpdir(), "claude-seats-shim-"));
	context.after(async (): Promise<void> => {
		await rm(directory, { force: true, recursive: true });
	});
	const home = path.join(directory, "home with spaces ' $(false)\n");
	const keychain = path.join(directory, "keychain");
	await Promise.all([mkdir(home), mkdir(keychain)]);
	const binary = await installBinary(path.join(directory, "bin"));
	return {
		binary,
		directory,
		home,
		keychain,
		shim: path.join(root, "bin/cc.zsh"),
	};
};

interface RunOptions {
	readonly env?: Readonly<Record<string, string>>;
	readonly input?: string;
	readonly omit?: readonly string[];
	readonly script?: string;
}

const environment = (
	setup: Fixture,
	options: RunOptions,
): Record<string, string> => {
	const env = Object.fromEntries([
		["CLAUDE_CONFIG_DIR", "/caller/exported/config"],
		["CLAUDE_SEATS_CLAUDE_BIN", setup.binary],
		["CLAUDE_SEATS_HOME", setup.home],
		["CLAUDE_SEATS_KEYCHAIN_DIR", setup.keychain],
		["CLAUDE_SEATS_STATE_DIR", path.join(setup.directory, "state")],
		["CLAUDE_SEATS_USAGE_URL", "http://127.0.0.1:1"],
		["HOME", setup.home],
		["PATH", `${path.dirname(setup.binary)}:/usr/bin:/bin`],
	]);
	const entries = Object.entries(env).filter(
		([key]: readonly [string, unknown]) => !(options.omit ?? []).includes(key),
	);
	return { ...Object.fromEntries(entries), ...options.env };
};

const run = async (
	setup: Fixture,
	args: readonly string[],
	options: RunOptions = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> => {
	const child = spawn(
		"/bin/zsh",
		[
			"-f",
			"-c",
			`export CLAUDE_SEATS_TEST_PID=$$; ${options.script ?? shell}`,
			"cc-test",
			setup.shim,
			...args,
		],
		{
			cwd: setup.directory,
			env: environment(setup, options),
			timeout,
		},
	);
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", (data: string): void => {
		stdout += data;
	});
	child.stderr.setEncoding("utf8").on("data", (data: string): void => {
		stderr += data;
	});
	child.stdin.end(options.input ?? "");
	await once(child, "close");
	return { status: child.exitCode, stderr, stdout };
};

const assertLaunch = (stdout: string, fields: readonly string[]): void => {
	const newline = stdout.indexOf("\n");
	const [before, after] = stdout.slice(start, newline).split(":");
	ok(typeof before === "string" && before !== "");
	notStrictEqual(before, after, "the caller's shell must survive the launch");
	deepStrictEqual(stdout.slice(newline + next).split("\0"), [...fields, ""]);
};

export type { Context, Fixture };
export { assertLaunch, fixture, run, shell };
