import { spawn } from "node:child_process";
import { once } from "node:events";
import { stat } from "node:fs/promises";
import path from "node:path";

type CredentialPresence =
	| { readonly ok: true; readonly present: boolean }
	| { readonly ok: false; readonly reason: string };

interface CredentialIo {
	readonly fileExists: (
		file: string,
	) => boolean | "unavailable" | Promise<boolean | "unavailable">;
	readonly securityStatus: (
		args: readonly string[],
	) => number | "unavailable" | Promise<number | "unavailable">;
}

const keychainMissing = 44;
const success = 0;
const timeout = 5000;
const unavailable: CredentialPresence = {
	ok: false,
	reason: "Credential presence unavailable.",
};

const systemIo: CredentialIo = {
	fileExists: async (file: string): Promise<boolean | "unavailable"> => {
		try {
			const info = await stat(file);
			return info.isFile();
		} catch (error: unknown) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				return false;
			}
			return "unavailable";
		}
	},
	securityStatus: async (
		args: readonly string[],
	): Promise<number | "unavailable"> => {
		// Discard metadata too: it can contain account identifiers even without -w.
		const child = spawn("/usr/bin/security", args, {
			stdio: "ignore",
			timeout,
		});
		await once(child, "close");
		if (typeof child.exitCode === "number") {
			return child.exitCode;
		}
		return "unavailable";
	},
};

const fixturePresence = async (
	slot: string,
	directory: string,
	io: CredentialIo,
): Promise<CredentialPresence> => {
	const present = await io.fileExists(path.join(directory, `${slot}.json`));
	if (present === "unavailable") {
		return unavailable;
	}
	return { ok: true, present };
};

const checkCredential = async (
	slot: string,
	{
		fixtureDirectory,
		io = systemIo,
	}: Readonly<{
		fixtureDirectory?: string | undefined;
		io?: CredentialIo;
	}> = {},
): Promise<CredentialPresence> => {
	if (fixtureDirectory === "") {
		return unavailable;
	}
	try {
		if (typeof fixtureDirectory === "string") {
			return await fixturePresence(slot, fixtureDirectory, io);
		}
		const status = await io.securityStatus([
			"find-generic-password",
			"-s",
			slot,
		]);
		if (status === success || status === keychainMissing) {
			return { ok: true, present: status === success };
		}
	} catch {
		// External diagnostics are untrusted and may include private data.
	}
	return unavailable;
};

export type { CredentialIo, CredentialPresence };
export { checkCredential };
