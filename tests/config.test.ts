import { ok, strictEqual } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const read = async (file: string): Promise<string> =>
	readFile(new URL(`../${file}`, import.meta.url), "utf8");

const readConfig = async (file: string): Promise<Record<string, unknown>> => {
	const value: unknown = JSON.parse(await read(file));
	ok(isRecord(value));
	return value;
};

await test("tsgo enables the strictness and Node ESM contract", async (): Promise<void> => {
	const config = await readConfig("tsconfig.json");
	const options = config["compilerOptions"];
	ok(isRecord(options));
	const requiredOptions = {
		allowImportingTsExtensions: true,
		allowUnreachableCode: false,
		allowUnusedLabels: false,
		erasableSyntaxOnly: true,
		exactOptionalPropertyTypes: true,
		forceConsistentCasingInFileNames: true,
		isolatedModules: true,
		module: "NodeNext",
		moduleResolution: "NodeNext",
		noEmit: true,
		noFallthroughCasesInSwitch: true,
		noImplicitOverride: true,
		noImplicitReturns: true,
		noPropertyAccessFromIndexSignature: true,
		noUncheckedIndexedAccess: true,
		noUncheckedSideEffectImports: true,
		noUnusedLocals: true,
		noUnusedParameters: true,
		strict: true,
		useUnknownInCatchVariables: true,
		verbatimModuleSyntax: true,
	};
	for (const [flag, expected] of Object.entries(requiredOptions)) {
		strictEqual(options[flag], expected, flag);
	}
});

await test("Node supports 24+ with development pinned, pnpm is pinned and dependencies are development-only", async (): Promise<void> => {
	const config = await readConfig("package.json");
	const { engines } = config;
	ok(isRecord(engines));
	strictEqual(engines["node"], ">=24");
	strictEqual(config["packageManager"], "pnpm@10.28.1");
	strictEqual(config["type"], "module");
	ok(!("dependencies" in config));
	const mise = await read(".mise.toml");
	ok(mise.includes('node = "24"'));
});

await test("Oxlint enables every category and required plugin", async (): Promise<void> => {
	const oxlint = await read(".oxlintrc.json");
	for (const category of [
		"correctness",
		"suspicious",
		"pedantic",
		"perf",
		"style",
		"restriction",
		"nursery",
	]) {
		ok(oxlint.includes(`"${category}": "error"`), category);
	}
	for (const plugin of [
		"typescript",
		"unicorn",
		"oxc",
		"promise",
		"node",
		"import",
	]) {
		ok(oxlint.includes(`"${plugin}"`), plugin);
	}
});

await test("Biome enables every rule group as errors", async (): Promise<void> => {
	const biome = await read("biome.jsonc");
	for (const group of [
		"a11y",
		"complexity",
		"correctness",
		"nursery",
		"performance",
		"security",
		"style",
		"suspicious",
	]) {
		ok(biome.includes(`"${group}": "error"`), group);
	}
});

await test("lint warnings are forbidden and every disabled rule has a reason beside it", async (): Promise<void> => {
	const sources = await Promise.all(
		[".oxlintrc.json", "biome.jsonc"].map(async (file) => read(file)),
	);
	const previousLineOffset = 1;
	for (const source of sources) {
		ok(
			!source.includes('"warn"'),
			"Lint severities must not be weakened to warn",
		);
		const lines = source.split("\n");
		for (const [index, line] of lines.entries()) {
			if (line.includes('"off"')) {
				const previousLine = lines.at(index - previousLineOffset);
				ok(typeof previousLine === "string");
				ok(previousLine.trimStart().startsWith("//"), line);
			}
		}
	}
});

await test("README documents all optional environment seams and their defaults", async (): Promise<void> => {
	const readme = await read("README.md");
	for (const [name, defaultValue] of [
		["CLAUDE_SEATS_HOME", "$HOME"],
		["CLAUDE_SEATS_STATE_DIR", "$CLAUDE_SEATS_HOME/.claude-shared/_seats"],
		["CLAUDE_SEATS_USAGE_URL", "https://api.anthropic.com"],
		["CLAUDE_SEATS_CLAUDE_BIN", "PATH"],
		["CLAUDE_SEATS_KEYCHAIN_DIR", "Unset: use the macOS keychain"],
	]) {
		ok(typeof name === "string" && typeof defaultValue === "string");
		const row = readme
			.split("\n")
			.find((line) => line.startsWith(`| \`${name}\` |`));
		ok(typeof row === "string", `Missing documentation for ${name}`);
		ok(row.includes(defaultValue), `Missing default for ${name}`);
	}
	ok(readme.includes("<slot>.json"));
	ok(readme.includes("Never set this for normal operation"));
});
