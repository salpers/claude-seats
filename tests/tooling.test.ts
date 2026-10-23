import { ifError, match, notEqual, ok, strictEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import type { TestContext } from "node:test";
import { test } from "node:test";

const root = path.dirname(import.meta.dirname);
const success = 0;
const runtimePattern = /type stripping works/u;
const nestedPattern = /nested test discovered/u;
const runtimeTest = `import { strictEqual } from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";

await test("type stripping works", (): void => {
	strictEqual(process.versions.node.startsWith("24."), true);
});
`;

const fixture = async (
	context: Readonly<Pick<TestContext, "after">>,
): Promise<string> => {
	const directory = await mkdtemp(path.join(tmpdir(), "claude-seats-tooling-"));
	context.after(async (): Promise<void> => {
		await rm(directory, { force: true, recursive: true });
	});
	await Promise.all(
		[
			"package.json",
			".mise.toml",
			"tsconfig.json",
			".oxlintrc.json",
			"biome.jsonc",
			".gitignore",
		].map(async (file): Promise<void> => {
			await copyFile(path.join(root, file), path.join(directory, file));
		}),
	);
	await symlink(
		path.join(root, "node_modules"),
		path.join(directory, "node_modules"),
		"dir",
	);
	await mkdir(path.join(directory, "src"));
	await mkdir(path.join(directory, "tests"));
	await writeFile(path.join(directory, "tests/runtime.test.ts"), runtimeTest);
	return directory;
};

const runScript = (
	directory: string,
	script: "verify" | "lint" | "format" = "verify",
): { output: string; status: number } => {
	const pathVariable = "PATH";
	// Otherwise Node silently skips the nested test runner as a recursive invocation.
	const environmentEntries = Object.entries(process.env).filter(
		([key]: readonly [string, unknown]) => key !== "NODE_TEST_CONTEXT",
	);
	const env = {
		...Object.fromEntries(environmentEntries),
		[pathVariable]: `${path.dirname(process.execPath)}:${process.env[pathVariable] ?? ""}`,
	};
	const result = spawnSync("pnpm", [script], {
		cwd: directory,
		encoding: "utf8",
		env,
		timeout: 60_000,
	});
	ifError(result.error);
	ok(typeof result.status === "number");
	return { output: result.stdout + result.stderr, status: result.status };
};

await test("verify passes with empty src and runs TypeScript tests without a build", async (context: Readonly<
	Pick<TestContext, "after">
>): Promise<void> => {
	const directory = await fixture(context);
	const result = runScript(directory);
	strictEqual(result.status, success, result.output);
	match(result.output, runtimePattern);
});

const failures: readonly Readonly<{
	diagnostic: string;
	name: string;
	script?: "format";
	source: string;
}>[] = [
	{
		diagnostic: "no-explicit-any",
		name: "explicit any",
		source: "export type Value = any;\n",
	},
	{
		diagnostic: "consistent-type-assertions",
		name: "as assertion",
		source: "export const value = 1 as number;\n",
	},
	{
		diagnostic: "TS6133",
		name: "unused import",
		source: 'import { join } from "node:path";\n',
	},
	{
		diagnostic: "TS6133",
		name: "unused variable",
		source: "const unused = 1;\nexport {};\n",
	},
	{
		diagnostic: "TS1294",
		name: "non-erasable enum",
		source: "export enum Value { First }\n",
	},
	{
		diagnostic: "scratch.ts format",
		name: "formatting",
		source: 'export const value="hello";\n',
	},
	{
		diagnostic: "organizeImports",
		name: "unsorted imports",
		source:
			'import process from "node:process";\nimport path from "node:path";\n\nexport const value = path.join(process.cwd(), "value");\n',
	},
	{
		diagnostic: "no-console",
		name: "console outside output module",
		source: 'console.log("hello");\n',
	},
	{
		diagnostic: "no-non-null-assertion",
		name: "non-null assertion",
		source:
			"export function value(input: string | undefined): string { return input!; }\n",
	},
	{
		diagnostic: "no-unnecessary-condition",
		name: "type-aware lint",
		source:
			'export function value(input: string): string { return input ?? "fallback"; }\n',
	},
	{
		diagnostic: "Unused oxlint-disable directive",
		name: "unused Oxlint suppression",
		source:
			"// oxlint-disable-next-line no-explicit-any\nexport type Value = string;\n",
	},
	{
		diagnostic: "ban-ts-comment",
		name: "ts-ignore suppression",
		source: "// @ts-ignore\nexport type Value = string;\n",
	},
	{
		diagnostic: "ban-ts-comment",
		name: "ts-expect-error without justification",
		source: "// @ts-expect-error\nexport const value: string = 1;\n",
	},
	{
		diagnostic: "no-abusive-eslint-disable",
		name: "blanket Oxlint suppression",
		source: "// oxlint-disable\nexport type Value = string;\n",
	},
	{
		diagnostic: "suppressions/parse",
		name: "Biome suppression without justification",
		script: "format",
		source:
			"// biome-ignore lint/suspicious/noExplicitAny\nexport type Value = string;\n",
	},
	{
		diagnostic: "noTsIgnore",
		name: "ts-ignore suppression in Biome",
		script: "format",
		source: "// @ts-ignore\nexport type Value = string;\n",
	},
];

await Promise.all(
	failures.map(async (failure): Promise<void> => {
		await test(`${failure.script ?? "verify"} rejects ${failure.name}`, async (context: Readonly<
			Pick<TestContext, "after">
		>): Promise<void> => {
			const directory = await fixture(context);
			await writeFile(path.join(directory, "src/scratch.ts"), failure.source);
			const result = runScript(directory, failure.script);
			notEqual(result.status, success, result.output);
			ok(result.output.includes(failure.diagnostic), result.output);
		});
	}),
);

const warnings: readonly Readonly<{
	config: string;
	diagnostic: string;
	original: string;
	replacement: string;
	script: "lint" | "format";
}>[] = [
	{
		config: ".oxlintrc.json",
		diagnostic: "no-explicit-any",
		original: '"rules": {',
		replacement: '"rules": {\n\t\t"typescript/no-explicit-any": "warn",',
		script: "lint",
	},
	{
		config: "biome.jsonc",
		diagnostic: "noExplicitAny",
		original: '"correctness": {',
		replacement:
			'"suspicious": { "noExplicitAny": "warn" },\n\t\t\t\t\t"correctness": {',
		script: "format",
	},
];

await Promise.all(
	warnings.map(async (warning): Promise<void> => {
		await test(`${warning.script} rejects warn-severity violations`, async (context: Readonly<
			Pick<TestContext, "after">
		>): Promise<void> => {
			const directory = await fixture(context);
			const config = await readFile(
				path.join(directory, warning.config),
				"utf8",
			);
			ok(config.includes(warning.original));
			await writeFile(
				path.join(directory, warning.config),
				config.replace(warning.original, warning.replacement),
			);
			const baseline = runScript(directory, warning.script);
			strictEqual(baseline.status, success, baseline.output);
			await writeFile(
				path.join(directory, "src/scratch.ts"),
				"export type Value = any;\n",
			);
			const result = runScript(directory, warning.script);
			notEqual(result.status, success, result.output);
			ok(result.output.includes(warning.diagnostic), result.output);
		});
	}),
);

await test("verify discovers nested src tests and permits console only in src/output.ts", async (context: Readonly<
	Pick<TestContext, "after">
>): Promise<void> => {
	const directory = await fixture(context);
	await mkdir(path.join(directory, "src/nested"));
	await writeFile(
		path.join(directory, "src/output.ts"),
		"export const print = (message: string): void => {\n\tconsole.log(message);\n};\n",
	);
	await writeFile(
		path.join(directory, "src/nested/value.ts"),
		'export const value = "24.";\n',
	);
	await writeFile(
		path.join(directory, "src/nested/discovery.test.ts"),
		runtimeTest
			.replace("type stripping works", "nested test discovered")
			.replace(
				'import { test } from "node:test";',
				'import { test } from "node:test";\nimport { value } from "./value.ts";',
			)
			.replace('"24."', "value"),
	);
	const result = runScript(directory);
	strictEqual(result.status, success, result.output);
	match(result.output, nestedPattern);
});
