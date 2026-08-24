import type { AnalyzeSessionOptions, SessionEventLike, SessionHeaderLike } from "./analyzer.mjs";
import type { BlackBoxPack } from "./pack.mjs";

export interface LiveSessionLike {
  readonly id: string;
  readonly header: SessionHeaderLike;
  readonly events: readonly SessionEventLike[];
}

export interface BlackBoxPluginConfig {
  readonly outputRoot: string;
  readonly runtimeVersion?: string;
  readonly thresholds?: AnalyzeSessionOptions["thresholds"];
  readonly failClosed?: boolean;
}

export interface BlackBoxPluginContext {
  on(name: "session/flush", callback: (session: LiveSessionLike) => void | Promise<void>): unknown;
  on(name: "session/disposed", callback: (session: LiveSessionLike) => void): unknown;
}

export const name: "eversko-dsh-blackbox";
export const inject: readonly ["sessions"];
export function apply(context: BlackBoxPluginContext, config: BlackBoxPluginConfig): void;
export function writeBlackBoxSnapshot(
  session: LiveSessionLike,
  config: BlackBoxPluginConfig,
): Promise<Readonly<{ filename: string; pack: BlackBoxPack }>>;
export function writeBlackBoxSnapshotSync(
  session: LiveSessionLike,
  config: BlackBoxPluginConfig,
): Readonly<{ filename: string; pack: BlackBoxPack }>;
