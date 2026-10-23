import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import type { ResumeMetadata } from "./resume.ts";
import { healthy, now } from "./router-test-fixture.ts";
import type { ClaimsResult } from "./routing-audit.ts";
import { recordDecision } from "./routing-audit.ts";

await test("resume audit projects only validated metadata, even if an input object has extra properties", async (): Promise<void> => {
	const extra = {
		prompt: "private diagnostic",
		resume: true,
		sessionId: "private diagnostic",
	};
	const resume: ResumeMetadata = { ...extra, resume: true };
	let text = "";
	const result = await recordDecision(
		healthy,
		{
			append: (line: string): boolean => {
				text = line;
				return true;
			},
			read: (): ClaimsResult => ({ claims: [], ok: true }),
			write: () => true,
		},
		{ now, resume },
	);
	ok(result.ok);
	strictEqual(text.includes("private diagnostic"), false);
	strictEqual(text.includes('"resume":true'), true);
	strictEqual(text.includes("prompt"), false);
});
