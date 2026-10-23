// The part of the mods API this mod uses; each Claude Code build ships the full types.

// An element tree is opaque to the mod: it builds one and hands it back to Claude Code.
type UiNode = Readonly<Record<string, unknown>>;
interface ButtonProps {
	readonly dimColor: boolean;
	readonly hotkey?: string;
	readonly key: string;
	readonly label: string;
	readonly onPress: () => unknown;
	readonly plain: true;
}
// Claude Code names its element factories like components.
interface Elements {
	readonly Box: (
		props: Readonly<{ children: readonly UiNode[]; flexDirection: "column" }>,
	) => UiNode;
	readonly Button: (props: ButtonProps) => UiNode;
	readonly Text: (
		props: Readonly<{ children: readonly string[]; dimColor?: boolean }>,
	) => UiNode;
}
// The band directly above the prompt; a survey there takes precedence.
interface BandEvent {
	readonly props: Readonly<{ hasSurvey: boolean }>;
	readonly requestId: string;
}
interface SeatsApi {
	readonly clock: {
		readonly after: (delayMs: number, run: () => Promise<unknown>) => unknown;
	};
	readonly command: {
		readonly register: (
			command: Readonly<{
				argumentHint?: string;
				description: string;
				immediate?: true;
				name: string;
			}>,
		) => Promise<unknown>;
		readonly run: (input: Readonly<{ command: string }>) => Promise<unknown>;
	};
	readonly env: {
		readonly get: (name: string) => Promise<string | undefined>;
	};
	readonly fs: {
		readonly write: (file: string, text: string) => Promise<void>;
	};
	readonly process: {
		readonly run: (
			argv: readonly string[],
		) => Promise<
			Readonly<{ exitCode: number; stderr: string; stdout: string }>
		>;
	};
	readonly session: {
		readonly id: () => Promise<string>;
		readonly turns: () => Promise<number>;
	};
	readonly ui: {
		readonly invalidate: (event: "ui.render") => void;
		readonly resolve: (event: BandEvent) => Elements;
		// No text removes this mod's status line.
		readonly status: (text?: string) => void;
		readonly toast: (text: string) => void;
	};
}
interface RateLimit {
	readonly kind: string;
	readonly percentUsed: number;
}
interface Measure {
	readonly changed: readonly string[];
	readonly rateLimits: readonly RateLimit[];
}
type Next<Event> = (event: Event) => Promise<unknown>;
// Claude Code awaits what a hook returns, so a hook may answer with or without a promise.
interface On {
	(
		name: "prompt.submit" | "session.start",
		hook: ($: SeatsApi, event: unknown, next: Next<unknown>) => unknown,
	): void;
	(
		name: "command.run",
		matcher: Readonly<{ command: string }>,
		hook: (
			$: SeatsApi,
			event: Readonly<{ args: string }>,
		) => Promise<Readonly<{ text?: string }>>,
	): void;
	(
		name: "session.measure",
		hook: ($: SeatsApi, event: Measure, next: Next<Measure>) => unknown,
	): void;
	(
		name: "ui.render",
		matcher: Readonly<{ component: "AbovePrompt" }>,
		hook: ($: SeatsApi, event: BandEvent, next: Next<BandEvent>) => unknown,
	): void;
}

export type {
	BandEvent,
	ButtonProps,
	Elements,
	Measure,
	On,
	RateLimit,
	SeatsApi,
	UiNode,
};
