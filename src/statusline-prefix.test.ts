import { strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { statuslinePrefix } from "./statusline-prefix.ts";

const green = "\u001B[32m";
const reset = "\u001B[0m";

await test("only the legacy usage and email tail is replaced, preserving prefix bytes", (): void => {
	for (const prefix of [
		"Sonnet | ~/repo | main* | ctx 12% | ",
		`${green}Opus${reset} | /tmp/日本語 | feature | ctx 0% | `,
		"model | cwd with | inside | git | context | ",
	]) {
		strictEqual(
			statuslinePrefix(`${prefix}sess 10% | wk 1% | person@example.invalid\n`),
			prefix,
		);
		strictEqual(
			statuslinePrefix(
				`${prefix}\u001B[33msess 10%\u001B[0m | \u001B[32mwk 1%\u001B[0m | person@example.invalid\r\n`,
			),
			prefix,
		);
	}
});

await test("empty output and a recognized tail without a prefix add no separator", (): void => {
	for (const output of [
		"",
		"\n",
		"\r\n",
		"sess 1% | wk 2% | person@example.invalid",
	]) {
		strictEqual(statuslinePrefix(output), "");
	}
});

await test("unrecognized prefixes and context labels preserve their original bytes", (): void => {
	for (const prefix of [
		"model | cwd | git",
		"model | cwd | git | 70% ctx",
		"model | cwd | git | ctx:5%",
		`${green}Opus${reset} | /tmp/日本語 | git | ◔ 70%`,
		"model | cwd | private diagnostic | Sebastian",
		"model | cwd | ctx 12% | unexpected | Sebastian",
		"model | cwd | unknown account label",
		"single field",
	]) {
		for (const tail of [
			"",
			" | you@example.com",
			" | sess 10% | wk 2% | you@example.com",
		]) {
			strictEqual(statuslinePrefix(`${prefix}${tail}\n`), `${prefix} | `);
		}
	}
});

await test("optional usage and email tails preserve the context prefix before login or the first response", (): void => {
	const prefix = `${green}Opus${reset} | cwd with | separator | git:main | ctx —`;
	for (const tail of [
		"",
		" | person@example.invalid",
		" | sess 10% | wk 1%",
		" | sess 10% | wk 1% | person@example.invalid",
	]) {
		strictEqual(statuslinePrefix(`${prefix}${tail}\n`), `${prefix} | `);
	}
});

await test("independent usage windows and optional git fields preserve prefix bytes", (): void => {
	for (const prefix of [
		`${green}Opus 5${reset} | 日本語 | ctx 44.3k/200.0k (22.1%)`,
		"Opus 5 | repo | git:main | ctx 44.3k/200.0k (22.1%)",
	]) {
		for (const usage of [
			"",
			" | sess 10%",
			" | wk 1%",
			" | sess 10% | wk 1%",
			` | ${green}wk 1%${reset}`,
		]) {
			for (const identity of [
				"",
				" | a@b.io",
				" | Sebastian",
				` | ${green}山田 太郎${reset}`,
				" | ctx reader",
				" | sess reader",
				" | wk reader",
			]) {
				strictEqual(
					statuslinePrefix(`${prefix}${usage}${identity}\n`),
					`${prefix} | `,
				);
			}
		}
	}
});
