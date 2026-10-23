import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import {
	chmod,
	mkdir,
	mkdtemp,
	open,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { test } from "node:test";
import type { ConfigFileIo, ConfigSnapshot } from "./project-config-file.ts";
import { readProjectFile, writeProjectFile } from "./project-config-file.ts";

const modeBase = 0o1_0000;
const privateMode = 0o600;
const sharedMode = 0o640;
type Context = Readonly<Pick<TestContext, "after">>;
const fixture = async (context: Context): Promise<string> => {
	const directory = await mkdtemp(
		path.join(tmpdir(), "claude-seats-projects-"),
	);
	context.after(async (): Promise<void> => {
		await rm(directory, { force: true, recursive: true });
	});
	return directory;
};
const before = '{"identity":"seat","projects":{}}\n';
const after = `${JSON.stringify({
	identity: "seat",
	projects: { "/repo": { hasTrustDialogAccepted: true } },
})}\n`;
const stage = async (
	file: string,
	text: string,
	mode: number,
): Promise<void> => {
	await writeFile(file, text, { flag: "wx", mode });
	await chmod(file, mode);
};
const io: ConfigFileIo = {
	read: readProjectFile,
	remove: async (file: string): Promise<void> => {
		await rm(file, { force: true });
	},
	rename,
	stage,
};
const snapshot = async (file: string): Promise<ConfigSnapshot> => {
	const result = await readProjectFile(file);
	ok(result.ok);
	return result;
};
const existingFixture = async (
	context: Context,
): Promise<{ file: string; original: ConfigSnapshot }> => {
	const directory = await fixture(context);
	const file = path.join(directory, ".claude.json");
	await writeFile(file, before);
	await chmod(file, sharedMode);
	return { file, original: await snapshot(file) };
};
const assertMode = async (file: string, expected: number): Promise<void> => {
	const info = await stat(file);
	strictEqual(info.mode % modeBase, expected);
};
const assertOnlyConfig = async (file: string): Promise<void> => {
	deepStrictEqual(await readdir(path.dirname(file)), [".claude.json"]);
};
const observeRename = async (
	temporary: string,
	destination: string,
): Promise<void> => {
	strictEqual(path.dirname(temporary), path.dirname(destination));
	strictEqual(await readFile(destination, "utf8"), before);
	strictEqual(await readFile(temporary, "utf8"), after);
	await assertMode(temporary, sharedMode);
	await rename(temporary, destination);
};
const fail = (): never => {
	throw new Error("private diagnostic");
};

await test("atomic replacement uses a same-directory temporary file, preserves mode, and leaves open readers intact", async (context: Context): Promise<void> => {
	const { file, original } = await existingFixture(context);
	const reader = await open(file, "r");
	try {
		strictEqual(
			await writeProjectFile(
				file,
				{ original, text: after },
				{ ...io, rename: observeRename },
			),
			true,
		);
		strictEqual(await reader.readFile("utf8"), before);
	} finally {
		await reader.close();
	}
	strictEqual(await readFile(file, "utf8"), after);
	await assertMode(file, sharedMode);
	await assertOnlyConfig(file);
});

await test("production writes preserve existing modes", async (context: Context): Promise<void> => {
	const { file, original } = await existingFixture(context);
	strictEqual(await writeProjectFile(file, { original, text: after }), true);
	await assertMode(file, sharedMode);
	strictEqual(await readFile(file, "utf8"), after);
});

await test("production writes create missing files privately", async (context: Context): Promise<void> => {
	const directory = await fixture(context);
	const file = path.join(directory, "new-seat/.claude.json");
	const original = await snapshot(file);
	deepStrictEqual(original, {
		exists: false,
		mode: privateMode,
		ok: true,
		text: "{}",
	});
	strictEqual(await writeProjectFile(file, { original, text: after }), true);
	await assertMode(file, privateMode);
});

await test("failed staging or rename leaves the original untouched and cleans temporary files", async (context: Context): Promise<void> => {
	await Promise.all(
		[
			{ rename: fail },
			{
				stage: async (temporary: string): Promise<void> => {
					await writeFile(temporary, "partial");
					fail();
				},
			},
		].map(async (overrides: Readonly<Partial<ConfigFileIo>>): Promise<void> => {
			const { file, original } = await existingFixture(context);
			strictEqual(
				await writeProjectFile(
					file,
					{ original, text: after },
					{ ...io, ...overrides },
				),
				false,
			);
			strictEqual(await readFile(file, "utf8"), before);
			await assertOnlyConfig(file);
		}),
	);
});

await test("a config changed by Claude while staging is not overwritten", async (context: Context): Promise<void> => {
	const { file, original } = await existingFixture(context);
	const concurrent = '{"userID":"updated by Claude"}';
	strictEqual(
		await writeProjectFile(
			file,
			{ original, text: after },
			{
				...io,
				stage: async (
					temporary: string,
					text: string,
					mode: number,
				): Promise<void> => {
					await stage(temporary, text, mode);
					await writeFile(file, concurrent);
				},
			},
		),
		false,
	);
	strictEqual(await readFile(file, "utf8"), concurrent);
	await assertOnlyConfig(file);
});

await test("unreadable paths and symlinks are skipped without modifying their targets", async (context: Context): Promise<void> => {
	const { file } = await existingFixture(context);
	const link = path.join(path.dirname(file), "link");
	const subdirectory = path.join(path.dirname(file), "directory");
	await symlink(file, link);
	await mkdir(subdirectory);
	await Promise.all(
		[link, subdirectory, path.join(file, "child")].map(
			async (target): Promise<void> => {
				deepStrictEqual(await readProjectFile(target), { ok: false });
			},
		),
	);
	strictEqual(await readFile(file, "utf8"), before);
});

await test("invalid UTF-8 is rejected instead of changing unrelated bytes on re-encoding", async (context: Context): Promise<void> => {
	const { file } = await existingFixture(context);
	const invalidByte = 255;
	const bytes = Buffer.concat([
		Buffer.from('{"identity":"'),
		Buffer.from([invalidByte]),
		Buffer.from('"}'),
	]);
	await writeFile(file, bytes);
	deepStrictEqual(await readProjectFile(file), { ok: false });
	deepStrictEqual(await readFile(file), bytes);
});
