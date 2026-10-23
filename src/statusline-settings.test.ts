import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { isRecord, parseJson } from "./json.ts";
import { statuslineSettings } from "./statusline-settings.ts";

const command = "'/node path/bin/node' '/repo path/src/statusline-cli.mjs'";
const padding = 2;
const shellQuote = (text: string): string =>
	`'${text.replaceAll("'", String.raw`'\''`)}'`;

const readStatusline = (text: string): Record<string, unknown> => {
	const parsed = parseJson(text);
	ok(parsed.ok && isRecord(parsed.value));
	const { statusLine } = parsed.value;
	ok(isRecord(statusLine));
	return statusLine;
};

const settingsWithCommand = (legacy: string): string =>
	JSON.stringify({ statusLine: { command: legacy, padding, type: "command" } });

await test("rewiring after a Node upgrade or checkout move preserves the original prefix command", (): void => {
	const legacy = "python3 '/prefix path/old.py'";
	const before = statuslineSettings(
		settingsWithCommand(legacy),
		"'/old node/bin/node' '/old checkout/src/statusline-cli.ts'",
	);
	ok(before.ok);
	const upgraded = statuslineSettings(before.text, command);
	const fresh = statuslineSettings(settingsWithCommand(legacy), command);
	deepStrictEqual(upgraded, fresh);
	ok(upgraded.ok);
	deepStrictEqual(statuslineSettings(upgraded.text, command), upgraded);
});

await test("rewiring a standalone adapter replaces obsolete paths without retaining a legacy process", (): void => {
	const before = settingsWithCommand(
		"'/removed node/bin/node' '/old checkout/src/statusline-cli.ts'",
	);
	const edited = statuslineSettings(before, command);
	ok(edited.ok);
	strictEqual(readStatusline(edited.text)["command"], command);
});

await test("rewiring repairs nested adapters already installed with the current Node path", (): void => {
	const legacy = "python3 old.py";
	const nested = `${command} --legacy-command ${shellQuote(`'/old/bin/node' '/old/src/statusline-cli.ts' --legacy-command ${shellQuote(legacy)}`)}`;
	deepStrictEqual(
		statuslineSettings(settingsWithCommand(nested), command),
		statuslineSettings(settingsWithCommand(legacy), command),
	);
});

await test("old generated paths and legacy commands retain shell quoting byte for byte", (): void => {
	const oldCommand = `${shellQuote("/old ' $(false)\n/bin/node")} ${shellQuote("/old ' checkout/src/statusline-cli.ts")}`;
	for (const legacy of [
		"",
		"python3 'prefix.py'\n",
		"printf '%s' '$HOME `false`'",
	]) {
		const old = statuslineSettings(settingsWithCommand(legacy), oldCommand);
		ok(old.ok);
		deepStrictEqual(
			statuslineSettings(old.text, command),
			statuslineSettings(settingsWithCommand(legacy), command),
		);
	}
});

await test("similar commands with different executables, entrypoints or extra shell syntax are preserved", (): void => {
	for (const legacy of [
		"'/bin/python3' '/repo/src/statusline-cli.ts'",
		"'node' '/repo/src/statusline-cli.ts'",
		"'/bin/node' 'src/statusline-cli.ts'",
		"'/bin/node' '/repo/src/another.ts'",
		"'/bin/node' '/other/statusline-cli.ts'",
		`${command} --legacy-command 'old' extra`,
		`${command} --legacy-command 'old'; printf extra`,
		`${command}\n`,
	]) {
		const edited = statuslineSettings(settingsWithCommand(legacy), command);
		ok(edited.ok);
		strictEqual(
			readStatusline(edited.text)["command"],
			`${command} --legacy-command ${shellQuote(legacy)}`,
		);
	}
});

await test("wiring retains the prior command and unrelated settings, and is idempotent", (): void => {
	const before =
		'{ "statusLine": { "type":"command", "command":"python3 old.py", "padding": 2 }, "keep": 1e+02 }\n';
	const edited = statuslineSettings(before, command);
	ok(edited.ok);
	ok(edited.text.endsWith(', "keep": 1e+02 }\n'));
	const statusLine = readStatusline(edited.text);
	strictEqual(statusLine["padding"], padding);
	strictEqual(
		statusLine["command"],
		`${command} --legacy-command 'python3 old.py'`,
	);
	deepStrictEqual(statuslineSettings(edited.text, command), edited);
});

await test("new settings get a real entrypoint; invalid settings are refused", (): void => {
	deepStrictEqual(statuslineSettings("{}", command), {
		ok: true,
		text: JSON.stringify({ statusLine: { command, type: "command" } }),
	});
	for (const text of [
		"{",
		"null",
		'{"statusLine":[]}',
		'{"statusLine":{"type":"other"}}',
		'{"statusLine":{"type":"command","command":42}}',
	]) {
		deepStrictEqual(statuslineSettings(text, command), { ok: false });
	}
});
