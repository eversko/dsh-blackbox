import type { SessionEventLike, SessionHeaderLike } from "./analyzer.mjs";

export interface ArtifactLimits {
  readonly maxArtifactBytes: number;
  readonly maxDecodedBytes: number;
  readonly maxJsonlLineBytes: number;
}

export interface ArtifactReadOptions {
  readonly limits?: Partial<ArtifactLimits>;
}

export interface ParsedSessionArtifact {
  readonly header: Readonly<SessionHeaderLike>;
  readonly events: readonly SessionEventLike[];
  readonly artifact: Readonly<{
    encoding: "jsonl" | "jsonl-zstd";
    sha256: string;
    bytes: number;
  }>;
}

export interface ZstdFrameScan {
  readonly frames: readonly Readonly<{ start: number; end: number }>[];
  readonly tornStart?: number;
}

export const DEFAULT_ARTIFACT_LIMITS: Readonly<ArtifactLimits>;
export function scanDshZstdFrames(buffer: Buffer): ZstdFrameScan;
export function parseSessionArtifact(buffer: Buffer, options?: ArtifactReadOptions): ParsedSessionArtifact;
export function readSessionArtifact(path: string, options?: ArtifactReadOptions): Promise<ParsedSessionArtifact>;
