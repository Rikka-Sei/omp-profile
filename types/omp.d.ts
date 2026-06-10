/**
 * Minimal, precise type declarations for the subset of the omp (oh-my-pi)
 * extension host API that this extension uses.
 *
 * These signatures are transcribed verbatim from the real
 * `@oh-my-pi/pi-coding-agent@15.10.x` type definitions
 * (`dist/types/extensibility/extensions/types.d.ts` and
 * `dist/types/config/model-registry.d.ts`). We declare only what we consume so
 * the extension type-checks against the genuine contract without bundling the
 * 36 MB host package — at runtime omp injects the real implementation.
 */
declare module "@oh-my-pi/pi-coding-agent" {
  /** Thinking effort selector. Mirrors pi-agent-core `ThinkingLevel`. */
  export type ThinkingLevel =
    | "off"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh";

  /**
   * A resolved model. The real type (pi-ai `Model`) is far richer; we treat it
   * as mostly opaque and only read display fields. Crucially, `setModel` takes a
   * `Model` object, not a string — callers must resolve via `ModelRegistry`.
   */
  export interface Model {
    readonly id: string;
    readonly name?: string;
    readonly provider?: string;
    readonly reasoning?: boolean;
    readonly [key: string]: unknown;
  }

  /** Subset of `ModelRegistry` used to resolve profile model refs into `Model`s. */
  export class ModelRegistry {
    /** Find a model by provider and id, e.g. find("anthropic", "claude-opus-4-5"). */
    find(provider: string, modelId: string): Model | undefined;
    /** Resolve a canonical (bare) model id, e.g. "claude-opus-4-6". */
    resolveCanonicalModel(
      canonicalId: string,
      options?: { availableOnly?: boolean },
    ): Model | undefined;
    /** All models (built-in + custom). */
    getAll(): Model[];
    /** Only models with auth configured (the "available" set). */
    getAvailable(): Model[];
    /** Canonical id for a model, if known. */
    getCanonicalId(model: Model): string | undefined;
  }

  export interface ExtensionUIDialogOptions {
    signal?: AbortSignal;
    timeout?: number;
    onTimeout?: () => void;
    initialIndex?: number;
    outline?: boolean;
    helpText?: string;
  }

  export interface ExtensionUISelectOption {
    label: string;
    description?: string;
  }
  export type ExtensionUISelectItem = string | ExtensionUISelectOption;

  /** UI primitives available in command/event handlers. */
  export interface ExtensionUIContext {
    /** Show a selector; resolves to the selected option's **label** (or undefined if cancelled). */
    select(
      title: string,
      options: ExtensionUISelectItem[],
      dialogOptions?: ExtensionUIDialogOptions,
    ): Promise<string | undefined>;
    confirm(
      title: string,
      message: string,
      dialogOptions?: ExtensionUIDialogOptions,
    ): Promise<boolean>;
    input(
      title: string,
      placeholder?: string,
      dialogOptions?: ExtensionUIDialogOptions,
    ): Promise<string | undefined>;
    notify(message: string, type?: "info" | "warning" | "error"): void;
  }

  /** Context passed to event handlers. */
  export interface ExtensionContext {
    ui: ExtensionUIContext;
    hasUI: boolean;
    cwd: string;
    modelRegistry: ModelRegistry;
    model: Model | undefined;
    isIdle(): boolean;
  }

  /** Extended context for user-initiated command handlers. */
  export interface ExtensionCommandContext extends ExtensionContext {
    /** Wait for the agent to finish streaming before mutating session state. */
    waitForIdle(): Promise<void>;
    /** Reload the current session/runtime state. */
    reload(): Promise<void>;
  }

  export interface SessionStartEvent {
    type: "session_start";
  }
  export interface SessionSwitchEvent {
    type: "session_switch";
  }

  export interface AutocompleteItem {
    value: string;
    label?: string;
    description?: string;
  }

  /** The API object passed to an extension's default-exported factory. */
  export interface ExtensionAPI {
    logger: {
      info(...args: unknown[]): void;
      warn(...args: unknown[]): void;
      error(...args: unknown[]): void;
      debug(...args: unknown[]): void;
    };

    on(
      event: "session_start",
      handler: (
        event: SessionStartEvent,
        ctx: ExtensionContext,
      ) => void | Promise<void>,
    ): void;
    on(
      event: "session_switch",
      handler: (
        event: SessionSwitchEvent,
        ctx: ExtensionContext,
      ) => void | Promise<void>,
    ): void;

    registerCommand(
      name: string,
      options: {
        description?: string;
        getArgumentCompletions?: (
          argumentPrefix: string,
        ) => AutocompleteItem[] | null;
        handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
      },
    ): void;

    registerFlag(
      name: string,
      options: {
        description?: string;
        type: "boolean" | "string";
        default?: boolean | string;
      },
    ): void;
    getFlag(name: string): boolean | string | undefined;

    setLabel(entryIdOrLabel: string, label?: string | undefined): void;

    getActiveTools(): string[];
    getAllTools(): string[];
    setActiveTools(toolNames: string[]): Promise<void>;

    /** Set the current (primary) model. Returns false if no API key available. */
    setModel(model: Model): Promise<boolean>;
    getThinkingLevel(): ThinkingLevel | undefined;
    setThinkingLevel(level: ThinkingLevel): void;
  }

  export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;
}
