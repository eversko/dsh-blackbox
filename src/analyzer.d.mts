export type BlackBoxStatus = "healthy" | "attention" | "critical";
export type BlackBoxSeverity = "attention" | "critical";

export interface SessionHeaderLike {
  readonly version?: unknown;
  readonly id?: unknown;
  readonly cwd?: unknown;
  readonly createdAt?: unknown;
  readonly agentPreset?: unknown;
  readonly [key: string]: unknown;
}

export interface SessionEventLike {
  readonly type?: unknown;
  readonly seq?: unknown;
  readonly time?: unknown;
  readonly data?: unknown;
  readonly [key: string]: unknown;
}

export interface BlackBoxThresholds {
  readonly approvalStallMs?: number;
  readonly outputChunkWarning?: number;
  readonly outputCharWarning?: number;
  readonly repetitionMinChars?: number;
  readonly repetitionWindowChars?: number;
  readonly repetitionStrideChars?: number;
  readonly repetitionWindowCount?: number;
}

export interface AnalyzeSessionOptions {
  readonly captureEndTime?: number;
  readonly thresholds?: BlackBoxThresholds;
}

export interface BlackBoxAnomaly {
  readonly code: string;
  readonly severity: BlackBoxSeverity;
  readonly eventSeq: number | null;
  readonly facts: Readonly<Record<string, string | number | boolean | null>>;
}

export interface BlackBoxTimelineEntry {
  readonly seq: number;
  readonly time: number;
  readonly kind: "turn" | "output" | "tool" | "approval";
  readonly label: string;
  readonly status: "neutral" | "success" | "attention";
}

export interface BlackBoxSummary {
  readonly eventCount: number;
  readonly turnCount: number;
  readonly stepCount: number;
  readonly toolCallCount: number;
  readonly approvalCount: number;
  readonly outputChunks: number;
  readonly outputChars: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
  readonly durationMs: number;
  readonly agentPreset: string | null;
}

export interface BlackBoxReport {
  readonly schema: "eversko.dsh-blackbox.report.v1";
  readonly status: BlackBoxStatus;
  readonly summary: BlackBoxSummary;
  readonly anomalies: readonly BlackBoxAnomaly[];
  readonly timeline: readonly BlackBoxTimelineEntry[];
}

export const BLACKBOX_REPORT_SCHEMA: "eversko.dsh-blackbox.report.v1";

export function analyzeSession(
  session: { readonly header?: SessionHeaderLike; readonly events: readonly SessionEventLike[] },
  options?: AnalyzeSessionOptions,
): Readonly<BlackBoxReport>;
