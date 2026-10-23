import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import {
	installedStatuslineCommand,
	statuslineCommand,
} from "./statusline-runtime.ts";
import { parseWrapper, shellQuote } from "./statusline-wrapper.ts";

const settings = (command: string): string =>
	JSON.stringify({ statusLine: { command, type: "command" } });
const installed = parseWrapper(statuslineCommand);
ok(installed.ok);
const alternate = "/other ' runtime/bin/node";
const saved = `${shellQuote(alternate)} ${shellQuote(installed.entrypoint)}`;

await test("runtime selection retains a usable installed Node without depending on the current Node", async (): Promise<void> => {
	const inspected: string[] = [];
	strictEqual(
		await installedStatuslineCommand(
			settings(`${saved} --legacy-command 'prefix'`),
			"installed",
			(file) => {
				inspected.push(file);
				return true;
			},
		),
		saved,
	);
	deepStrictEqual(inspected, [alternate]);
	strictEqual(
		await installedStatuslineCommand(settings(saved), "installed", () => false),
		statuslineCommand,
	);
});

await test("explicit installation and obsolete adapters select the current runtime", async (): Promise<void> => {
	const inspected: string[] = [];
	const inspect = (file: string): boolean => {
		inspected.push(file);
		return true;
	};
	const oldEntrypoint = shellQuote(installed.entrypoint.replace(".mjs", ".ts"));
	strictEqual(
		await installedStatuslineCommand(settings(saved), "current", inspect),
		statuslineCommand,
	);
	await Promise.all(
		[
			"private invalid JSON",
			settings(`'/old/node' '/moved/src/statusline-cli.mjs'`),
			settings(`'/old/node' ${oldEntrypoint}`),
			settings(`${saved}; extra`),
		].map(async (text): Promise<void> => {
			strictEqual(
				await installedStatuslineCommand(text, "installed", inspect),
				statuslineCommand,
			);
		}),
	);
	deepStrictEqual(inspected, []);
});
