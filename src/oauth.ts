import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isRecord, parseJson } from "./json.ts";

type CredentialError =
	| "not logged in"
	| "credential unavailable"
	| "invalid credential";
type Credential =
	| { readonly ok: true; readonly accessToken: string }
	| { readonly ok: false; readonly reason: CredentialError };

interface KeychainReply {
	readonly status: number | "unavailable";
	readonly stdout: string;
}

interface CredentialReaderIo {
	readonly readFile: (file: string) => string | Promise<string>;
	readonly readKeychain: (
		args: readonly string[],
	) => KeychainReply | Promise<KeychainReply>;
}

const success = 0;
const missing = 44;
const timeout = 5000;
const maxBuffer = 65_536;
const controlPattern = /\p{Cc}/u;

const keychainReply = (
	status: number | null,
	stdout: string,
): KeychainReply => {
	if (stdout.length > maxBuffer) {
		return { status: "unavailable", stdout: "" };
	}
	return { status: status ?? "unavailable", stdout };
};
const systemIo: CredentialReaderIo = {
	readFile: async (file: string): Promise<string> => readFile(file, "utf8"),
	readKeychain: async (args: readonly string[]): Promise<KeychainReply> => {
		const child = spawn("/usr/bin/security", args, {
			stdio: ["ignore", "pipe", "ignore"],
			timeout,
		});
		let stdout = "";
		child.stdout.setEncoding("utf8").on("data", (data: string): void => {
			if (stdout.length <= maxBuffer) {
				stdout += data;
			}
			if (stdout.length > maxBuffer) {
				child.kill();
			}
		});
		await once(child, "close");
		return keychainReply(child.exitCode, stdout);
	},
};

const validCredential = (value: unknown): value is string =>
	typeof value === "string" &&
	value.trim() !== "" &&
	!controlPattern.test(value);

const parseCredential = (text: string): Credential => {
	const parsed = parseJson(text);
	if (parsed.ok && isRecord(parsed.value)) {
		const oauth = parsed.value["claudeAiOauth"];
		if (isRecord(oauth)) {
			const { accessToken } = oauth;
			if (validCredential(accessToken)) {
				return { accessToken, ok: true };
			}
		}
	}
	return { ok: false, reason: "invalid credential" };
};

const parseKeychain = (reply: KeychainReply): Credential => {
	if (reply.status === success) {
		return parseCredential(reply.stdout);
	}
	if (reply.status === missing) {
		return { ok: false, reason: "not logged in" };
	}
	return { ok: false, reason: "credential unavailable" };
};

const readCredential = async (
	slot: string,
	{
		fixtureDirectory,
		io = systemIo,
	}: Readonly<{
		fixtureDirectory?: string | undefined;
		io?: CredentialReaderIo;
	}> = {},
): Promise<Credential> => {
	if (fixtureDirectory === "") {
		return { ok: false, reason: "credential unavailable" };
	}
	try {
		if (typeof fixtureDirectory === "string") {
			return parseCredential(
				await io.readFile(path.join(fixtureDirectory, `${slot}.json`)),
			);
		}
		const reply = await io.readKeychain([
			"find-generic-password",
			"-s",
			slot,
			"-w",
		]);
		return parseKeychain(reply);
	} catch (error: unknown) {
		if (
			typeof fixtureDirectory === "string" &&
			isRecord(error) &&
			error["code"] === "ENOENT"
		) {
			return { ok: false, reason: "not logged in" };
		}
	}
	return { ok: false, reason: "credential unavailable" };
};

export type { Credential, CredentialError, CredentialReaderIo };
export { parseCredential, readCredential };
