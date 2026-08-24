import { createHash } from "node:crypto";

const SAFE_METADATA_LABEL = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u;

export function shortHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

export function safeMetadataLabel(value, privatePrefix = "private") {
  if (typeof value !== "string" || value.length === 0) return null;
  return SAFE_METADATA_LABEL.test(value)
    ? value
    : `${privatePrefix}-${shortHash(value)}`;
}
