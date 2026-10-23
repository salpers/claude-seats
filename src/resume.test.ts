import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { parseResume } from "./resume.ts";

const sessionId = "11111111-2222-4333-8444-555555555555";

await test("leading resume flags identify the picker or an explicit session for the audit", (): void => {
	for (const flag of ["-r", "--resume"]) {
		deepStrictEqual(parseResume([flag]), { resume: true });
		deepStrictEqual(parseResume([flag, sessionId, "-p", "private prompt"]), {
			resume: true,
			sessionId,
		});
		deepStrictEqual(parseResume([flag, "--model", "sonnet"]), { resume: true });
	}
});

await test("resume auditing never mistakes prompts, search terms, or later arguments for session IDs", (): void => {
	for (const args of [
		[],
		["--", "-r", sessionId],
		["-p", "--resume"],
		["prompt", "-r"],
	]) {
		deepStrictEqual(parseResume(args), {});
	}
	for (const value of [
		"",
		"private search text",
		"private\ntext",
		`${sessionId}\n`,
		`prefix-${sessionId}`,
	]) {
		deepStrictEqual(parseResume(["-r", value]), { resume: true });
	}
});
