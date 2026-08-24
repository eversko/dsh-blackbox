# Changelog

## 0.1.1 — 2026-08-24

- Publish the first npm release without rewriting the public `v0.1.0` source tag.
- Install the pinned npm release client in an isolated runner prefix so it cannot replace itself mid-job.

## 0.1.0 — 2026-08-23

- Add metadata-only `.dshpack` incident reports and Markdown rendering.
- Read raw JSONL and concatenated-frame Zstandard DSH session artifacts.
- Detect lifecycle, sequence, tool, approval, runaway-output, and repetition anomalies.
- Add a live Cordis plugin with immutable flush and disposal snapshots.
- Add bounded decompression, strict packed-row validation, TypeScript declarations, and a public JSON Schema.
