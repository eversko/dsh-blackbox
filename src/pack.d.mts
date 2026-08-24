import type { BlackBoxReport, SessionHeaderLike } from "./analyzer.mjs";

export interface BlackBoxArtifactIdentity {
  readonly encoding?: unknown;
  readonly sha256?: unknown;
  readonly bytes?: unknown;
}

export interface BlackBoxPack {
  readonly schema: "eversko.dsh-blackbox.pack.v1";
  readonly generatedAt: number;
  readonly privacy: Readonly<{
    mode: "metadata-only";
    contentIncluded: false;
    pathsIncluded: false;
    rawSessionIdentifiersIncluded: false;
  }>;
  readonly source: Readonly<{
    kind: string;
    runtimeVersion: string | null;
    sessionFormatVersion: number | null;
    sessionIdHash: string | null;
    workspaceHash: string | null;
    agentPreset: string | null;
    artifactEncoding: string | null;
    artifactSha256: string | null;
    artifactBytes: number | null;
  }>;
  readonly report: BlackBoxReport;
}

export const BLACKBOX_PACK_SCHEMA: "eversko.dsh-blackbox.pack.v1";
export function createBlackBoxPack(input: {
  readonly header?: SessionHeaderLike;
  readonly report: BlackBoxReport;
  readonly artifact?: BlackBoxArtifactIdentity | null;
  readonly runtimeVersion?: unknown;
  readonly generatedAt?: number;
  readonly sourceKind?: string;
}): Readonly<BlackBoxPack>;
export function renderBlackBoxMarkdown(pack: BlackBoxPack): string;
