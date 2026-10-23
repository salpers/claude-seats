import type { ResumeMetadata } from "./resume.ts";
import { parseResume } from "./resume.ts";
import type { Claim, Decision, RoutingOptions, RoutingSeat } from "./router.ts";
import { activeClaim, chooseSeat } from "./router.ts";

type ClaimsResult =
	| { readonly ok: true; readonly claims: readonly Claim[] }
	| { readonly ok: false };
type RoutingResult =
	| { readonly ok: true; readonly decision: Decision }
	| {
			readonly ok: false;
			readonly reason:
				| "claims unavailable"
				| "routing state unavailable"
				| "routing busy; check routing.lock in the state directory";
	  };
interface RoutingStateIo {
	readonly read: () => ClaimsResult | Promise<ClaimsResult>;
	readonly write: (claims: readonly Claim[]) => boolean | Promise<boolean>;
	readonly append: (line: string) => boolean | Promise<boolean>;
}
interface DecisionOptions extends RoutingOptions {
	readonly resume?: ResumeMetadata | undefined;
}
const unavailable: RoutingResult = {
	ok: false,
	reason: "routing state unavailable",
};

const resumeFields = (resume: ResumeMetadata | undefined): ResumeMetadata => {
	if (!resume) {
		return {};
	}
	if (resume.resume === true) {
		return parseResume(["--resume", resume.sessionId ?? ""]);
	}
	return {};
};

const persistDecision = async (
	decision: Decision,
	io: RoutingStateIo,
	{
		claims,
		now,
		resume,
	}: Readonly<{
		claims: readonly Claim[];
		now: number;
		resume?: ResumeMetadata | undefined;
	}>,
): Promise<RoutingResult> => {
	if (
		decision.seat !== "none" &&
		!(await io.write([...claims, { createdAt: now, seat: decision.seat }]))
	) {
		return unavailable;
	}
	// Only routing projections and parsed resume metadata reach the audit, never argv.
	if (
		!(await io.append(
			`${JSON.stringify({ at: now, ...decision, ...resumeFields(resume) })}\n`,
		))
	) {
		return unavailable;
	}
	return { decision, ok: true };
};

const recordClaimsFailure = async (
	io: RoutingStateIo,
	options: DecisionOptions,
): Promise<RoutingResult> => {
	// Without valid claims there is no trustworthy reservation snapshot to log.
	const refusal = {
		...chooseSeat([], [], options),
		...resumeFields(options.resume),
		at: options.now,
		reason: "claims unavailable",
		seat: "none",
	};
	if (!(await io.append(`${JSON.stringify(refusal)}\n`))) {
		return unavailable;
	}
	return { ok: false, reason: "claims unavailable" };
};

const recordDecision = async (
	rows: readonly RoutingSeat[],
	io: RoutingStateIo,
	options: DecisionOptions,
): Promise<RoutingResult> => {
	try {
		const stored = await io.read();
		if (!stored.ok) {
			return await recordClaimsFailure(io, options);
		}
		const claims = stored.claims.filter((claim) =>
			activeClaim(claim, options.now),
		);
		const decision = chooseSeat(rows, claims, options);
		return await persistDecision(decision, io, {
			claims,
			now: options.now,
			resume: options.resume,
		});
	} catch {
		return unavailable;
	}
};

export type { ClaimsResult, DecisionOptions, RoutingResult, RoutingStateIo };
export { recordDecision, resumeFields, unavailable };
