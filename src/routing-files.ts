import { randomUUID } from "node:crypto";
import { appendFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isRecord, parseJson } from "./json.ts";
import type { Claim } from "./router.ts";
import type { ClaimsResult, RoutingStateIo } from "./routing-audit.ts";
import { isSeatName } from "./seats.ts";

const zero = 0;
const fileMode = 0o600;
const parseClaim = (value: unknown): Claim | false => {
	if (!isRecord(value)) {
		return false;
	}
	const { seat, createdAt } = value;
	if (
		typeof seat !== "string" ||
		!isSeatName(seat) ||
		typeof createdAt !== "number" ||
		!Number.isSafeInteger(createdAt) ||
		createdAt < zero
	) {
		return false;
	}
	return { createdAt, seat };
};
const parseClaims = (text: string): ClaimsResult => {
	const parsed = parseJson(text);
	if (!(parsed.ok && Array.isArray(parsed.value))) {
		return { ok: false };
	}
	const values: readonly unknown[] = parsed.value;
	const claims = values.map((value) => parseClaim(value));
	if (claims.some((claim) => claim === false)) {
		return { ok: false };
	}
	return { claims: claims.filter((claim) => claim !== false), ok: true };
};

const writeClaims = async (
	file: string,
	claims: readonly Claim[],
): Promise<boolean> => {
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(claims)}\n`, {
			flag: "wx",
			mode: fileMode,
		});
		await rename(temporary, file);
		return true;
	} catch {
		return false;
	} finally {
		await rm(temporary, { force: true });
	}
};

const createStateIo = (directory: string): RoutingStateIo => {
	const file = path.join(directory, "claims.json");
	return {
		append: async (line: string): Promise<boolean> => {
			try {
				await appendFile(path.join(directory, "decisions.log"), line, {
					mode: fileMode,
				});
				return true;
			} catch {
				return false;
			}
		},
		read: async (): Promise<ClaimsResult> => {
			try {
				return parseClaims(await readFile(file, "utf8"));
			} catch (error: unknown) {
				if (isRecord(error) && error["code"] === "ENOENT") {
					return { claims: [], ok: true };
				}
				return { ok: false };
			}
		},
		write: async (claims: readonly Claim[]): Promise<boolean> =>
			writeClaims(file, claims),
	};
};

export { createStateIo, parseClaims };
