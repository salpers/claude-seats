import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { isRecord } from "./json.ts";
import { isPid } from "./sessions.ts";

const zero = 0;
const one = 1;
const directoryMode = 0o700;
const retryMs = 20;
const attempts = 100;
// Allow more than the old 15-second probe window before recovering legacy locks.
const staleMs = 20_000;
const ownerPattern = /^owner-(?<pid>\d+)-[a-f\d-]{36}$/u;
type LockResult =
	| { readonly kind: "locked"; readonly owner: string }
	| { readonly kind: "busy" }
	| { readonly kind: "unavailable" };

const hasCode = (error: unknown, codes: readonly string[]): boolean =>
	isRecord(error) &&
	typeof error["code"] === "string" &&
	codes.includes(error["code"]);

const ownerPid = (owner: string): number | false => {
	const match = ownerPattern.exec(owner);
	if (!match) {
		return false;
	}
	const { groups } = match;
	if (!groups) {
		return false;
	}
	const pid = Number(groups["pid"]);
	if (!isPid(pid)) {
		return false;
	}
	return pid;
};

const ownerIsDead = (owner: string): boolean => {
	const pid = ownerPid(owner);
	if (pid === false) {
		return false;
	}
	try {
		process.kill(pid, zero);
		return false;
	} catch (error: unknown) {
		return hasCode(error, ["ESRCH"]);
	}
};

const recoverOwner = async (lock: string): Promise<boolean> => {
	const entries = await readdir(lock);
	if (entries.length === zero) {
		return true;
	}
	const [owner] = entries;
	if (
		entries.length !== one ||
		typeof owner !== "string" ||
		!ownerIsDead(owner)
	) {
		return false;
	}
	// Only one reaper can remove this generation's marker. A successor is never emptied.
	await rmdir(path.join(lock, owner));
	return true;
};

const canAcquire = async (
	lock: string,
): Promise<"ready" | "busy" | "unavailable"> => {
	try {
		const info = await lstat(lock);
		if (!info.isDirectory() || Date.now() - info.mtimeMs <= staleMs) {
			return "busy";
		}
		if (await recoverOwner(lock)) {
			return "ready";
		}
		return "busy";
	} catch (error: unknown) {
		if (hasCode(error, ["ENOENT"])) {
			return "ready";
		}
		return "unavailable";
	}
};

const cleanupStaging = async (staging: string): Promise<void> => {
	try {
		await rm(staging, { force: true, recursive: true });
	} catch {
		// A staging directory cannot own the lock; cleanup failure must not obscure acquisition.
	}
};

const publish = async (
	lock: string,
	owner: string,
): Promise<"locked" | "busy" | "unavailable"> => {
	const staging = `${lock}.${owner}.tmp`;
	try {
		await mkdir(staging, { mode: directoryMode });
		await mkdir(path.join(staging, owner), { mode: directoryMode });
		// A nonempty directory is published atomically, so stale reapers cannot replace a new owner.
		await rename(staging, lock);
		return "locked";
	} catch (error: unknown) {
		if (hasCode(error, ["EEXIST", "ENOTEMPTY"])) {
			return "busy";
		}
		return "unavailable";
	} finally {
		await cleanupStaging(staging);
	}
};

const tryAcquire = async (directory: string): Promise<LockResult> => {
	const lock = path.join(directory, "routing.lock");
	const owner = `owner-${process.pid}-${randomUUID()}`;
	const ready = await canAcquire(lock);
	if (ready !== "ready") {
		return { kind: ready };
	}
	const acquired = await publish(lock, owner);
	if (acquired === "locked") {
		return { kind: "locked", owner };
	}
	return { kind: acquired };
};
const acquireRoutingLock = async (
	directory: string,
	remaining = attempts,
): Promise<LockResult> => {
	const result = await tryAcquire(directory);
	if (result.kind !== "busy" || remaining <= zero) {
		return result;
	}
	await setTimeout(retryMs);
	return acquireRoutingLock(directory, remaining - one);
};

const releaseRoutingLock = async (
	directory: string,
	owner: string,
): Promise<boolean> => {
	const lock = path.join(directory, "routing.lock");
	try {
		await rmdir(path.join(lock, owner));
	} catch {
		return false;
	}
	try {
		await rmdir(lock);
		return true;
	} catch (error: unknown) {
		// Another selector may already have atomically replaced the now-empty directory.
		return hasCode(error, ["ENOENT", "ENOTEMPTY", "EEXIST"]);
	}
};

export { acquireRoutingLock, releaseRoutingLock };
