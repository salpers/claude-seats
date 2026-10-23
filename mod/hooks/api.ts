// The part of the mods API this mod uses; each Claude Code build ships the full types.

// An element tree is opaque to the mod: it builds one and hands it back to Claude Code.
type UiNode = Readonly<Record<string, unknown>>;
interface ButtonProps {
	readonly dimColor: boolean;
	readonly hotkey?: string;
	readonly key: string;
	readonly label: string;
	readonly onPress: () => Promise<void>;
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
interface PaneEvent {
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
	readonly session: { readonly id: () => Promise<string> };
	readonly ui: {
		readonly close: (pane: Readonly<{ id: string }>) => Promise<unknown>;
		readonly invalidate: (event: "ui.render") => void;
		readonly open: (
			pane: Readonly<{
				closeOnEscape: true;
				focus: true;
				id: string;
				rows: number;
				title: string;
			}>,
		) => Promise<unknown>;
		readonly resolve: (event: PaneEvent) => Elements;
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
interface On {
	(
		name: "session.start",
		hook: (
			$: SeatsApi,
			event: unknown,
			next: Next<unknown>,
		) => Promise<unknown>,
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
		hook: (
			$: SeatsApi,
			event: Measure,
			next: Next<Measure>,
		) => Promise<unknown>,
	): void;
	(
		name: "ui.render",
		matcher: Readonly<{ component: "Pane"; requestId: string }>,
		// Claude Code awaits each hook, so a drawing can come back without a promise.
		hook: ($: SeatsApi, event: PaneEvent) => UiNode,
	): void;
}

export type {
	ButtonProps,
	Elements,
	Measure,
	On,
	PaneEvent,
	RateLimit,
	SeatsApi,
	UiNode,
};
