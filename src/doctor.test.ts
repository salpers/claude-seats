import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { DoctorIo, SetupOptions } from "./doctor.ts";
import { doctor, settingsProblems } from "./doctor.ts";
import { failFastSettings } from "./handoff-settings.ts";
import type { ConfigSnapshot } from "./project-config-file.ts";
import type { Seat } from "./seats.ts";
import type { EntryState } from "./setup-files.ts";
import type { LayoutEntry } from "./setup-layout.ts";
import { statuslineCommand } from "./statusline-runtime.ts";
import { statuslineSettings } from "./statusline-settings.ts";

const zero = 0;
const one = 1;
const options: SetupOptions = {
	home: "/fixture",
	state: "/fixture-state",
};
const snapshot = (text: string): ConfigSnapshot => ({
	exists: true,
	mode: 0o600,
	ok: true,
	text,
});
const wiredSettings = (): ConfigSnapshot => {
	const handoff = failFastSettings("{}");
	ok(handoff.ok);
	const statusline = statuslineSettings(handoff.text);
	ok(statusline.ok);
	return snapshot(statusline.text);
};
const healthyIo: DoctorIo = {
	credential: () => ({ ok: true, present: true }),
	inspect: () => "ready",
	privateState: () => true,
	settings: wiredSettings,
	statuslineCommand: () => statuslineCommand,
};

await test("doctor accepts a healthy setup", async (): Promise<void> => {
	deepStrictEqual(await doctor(options, healthyIo), { messages: [], ok: true });
});

await test("doctor collects broken links, inaccessible credentials, permissions and settings in one report", async (): Promise<void> => {
	const result = await doctor(options, {
		...healthyIo,
		credential: (seat: Seat) => ({
			ok: false,
			reason: `private diagnostic for ${seat.name}`,
		}),
		inspect: (entry: LayoutEntry): EntryState => {
			if (entry.label === "dev: settings.json") {
				return "conflict";
			}
			return "ready";
		},
		privateState: () => false,
		settings: () => snapshot("private invalid settings"),
	});
	strictEqual(result.ok, false);
	for (const diagnostic of [
		"dev: settings.json",
		"main: keychain slot presence unavailable",
		"dev3: keychain slot presence unavailable",
		"state directory",
		"statusLine",
		"autoContinueAtUsageLimit",
	]) {
		ok(
			result.messages.some((message) => message.includes(diagnostic)),
			diagnostic,
		);
	}
	strictEqual(result.messages.join("\n").includes("private diagnostic"), false);
	strictEqual(result.messages.join("\n").includes("private invalid"), false);
});

await test("doctor accepts wrapped statuslines and rejects duplicate settings, stale paths and disabled handoff", (): void => {
	const wrapped = statuslineSettings(
		JSON.stringify({
			autoContinueAtUsageLimit: false,
			statusLine: { command: "printf legacy", type: "command" },
		}),
	);
	ok(wrapped.ok);
	deepStrictEqual(settingsProblems(snapshot(wrapped.text)), []);
	for (const text of [
		"null",
		'{"statusLine":{},"statusLine":{}}',
		JSON.stringify({ autoContinueAtUsageLimit: true }),
		JSON.stringify({
			autoContinueAtUsageLimit: false,
			statusLine: {
				command: "/missing/node /old/checkout/statusline-cli.ts",
				type: "command",
			},
		}),
	]) {
		ok(settingsProblems(snapshot(text)).length > zero);
	}
});

const assertManualRepair = (
	messages: readonly string[],
	remedy: string,
): void => {
	strictEqual(messages.length, one);
	const diagnostic = messages.join("\n");
	ok(diagnostic.includes(remedy));
	ok(diagnostic.includes("before running cc install"));
	strictEqual(diagnostic.includes("private invalid"), false);
};

await test("doctor requests manual repair of malformed settings before installation", (): void => {
	for (const text of [
		"private invalid settings",
		"null",
		"[]",
		'{"statusLine":{},"statusLine":{}}',
	]) {
		assertManualRepair(settingsProblems(snapshot(text)), "valid JSON object");
	}
});

await test("doctor requests a safe regular file when hub settings cannot be read", (): void => {
	const unreadable = settingsProblems({ ok: false });
	strictEqual(unreadable.length, one);
	ok(unreadable.join("\n").includes("regular UTF-8 file (not a symlink)"));
	ok(unreadable.join("\n").includes("then run cc install"));
});

await test("doctor requests manual repair of an invalid statusLine field", (): void => {
	for (const statusLine of ["null", "{}", '{"type":"command","command":42}']) {
		assertManualRepair(
			settingsProblems(snapshot(`{"statusLine":${statusLine}}`)),
			"repair or remove the statusLine field",
		);
	}
});

await test("doctor recommends installation for missing settings or wiring", (): void => {
	for (const current of [
		snapshot("{}"),
		{ ...snapshot("{}"), exists: false },
	]) {
		const messages = settingsProblems(current);
		ok(messages.every((message) => message.includes("run cc install")));
		strictEqual(messages.join("\n").includes("before running"), false);
	}
});
