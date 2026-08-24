# DSH Black Box by Eversko

[![CI](https://github.com/eversko/dsh-blackbox/actions/workflows/ci.yml/badge.svg)](https://github.com/eversko/dsh-blackbox/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@eversko/dsh-blackbox)](https://www.npmjs.com/package/@eversko/dsh-blackbox)
[![MIT](https://img.shields.io/badge/license-MIT-0b0b0b.svg)](LICENSE)

Privacy-safe flight recording and incident reports for DeepSeek Harness.

DSH Black Box turns a durable DSH session into a compact, machine-readable incident report: lifecycle timeline, tool and approval outcomes, token totals, and anomaly findings. Its default pack contains no prompts, reasoning text, tool arguments, tool results, raw session or call identifiers, or filesystem paths.

## What the first release catches

- sequence gaps and duplicate sequence numbers;
- mismatched or unfinished turns and steps;
- tool calls without results and results without calls;
- approval questions that never receive a decision;
- runaway output and chunk-boundary-independent repetition signals;
- invalid packed chunk rows and torn concatenated Zstandard artifacts.

## Install and analyze

```sh
npm exec --package=@eversko/dsh-blackbox -- dsh-blackbox ~/.dsh/sessions/.../session.jsonl.zstd \
  --runtime 0.1.1-rc.2 \
  --json incident.dshpack.json \
  --markdown incident.md
```

Both raw JSONL and DSH's concatenated-frame `.jsonl.zstd` format are supported on Node `>=22.19 <23`. Input and decompressed output are bounded, packed rows are validated strictly, and existing evidence is never replaced unless `--force` is explicit.

Exit code `0` means no critical finding, `1` means the command or artifact was invalid, and `2` means a critical anomaly was found.

## Mount as a DSH plugin

```yaml
- id: eversko-blackbox
  name: '@eversko/dsh-blackbox/plugin'
  config:
    outputRoot: /absolute/private/path/to/blackbox
    runtimeVersion: 0.1.1-rc.2
```

The plugin writes immutable metadata snapshots during the ordinary `session/flush` checkpoint and a synchronous final snapshot when a session is disposed, preserving failed and interrupted turns before shutdown. Recording failure is fail-open by default and never grants execution authority. Set `failClosed: true` only in a diagnostic environment where missing evidence must stop the checkpoint.

## Compatibility

The first release pins its optional DSH session peer to `0.1.1-rc.2`, the latest official prerelease at the time of this audit. It was validated against an official runtime boot and a real failed-turn capture without exporting its prompt. A live `0.1.0-rc.7` matrix remains a future compatibility gate; fixture similarity is not presented as live support.

The JavaScript API includes TypeScript declarations. The public `.dshpack` contract is available as `@eversko/dsh-blackbox/schema`.

## Privacy and non-goals

The default `.dshpack` is metadata-only, not anonymous. It retains operational facts such as safe-form agent preset and tool names, timestamps, counts, token usage, status labels, and one-way hashes used for correlation. Users must review every artifact before sharing it. Black Box does not upload anything, rerun tools, reproduce provider nondeterminism, repair session logs, or claim that anomaly heuristics prove a security vulnerability.

## Community direction

Next: a local drag-and-drop visual viewer, two-run comparison, version/preset compatibility badges, and a deliberately opt-in encrypted evidence attachment for maintainers who need private raw detail.

DSH Black Box is an independent Eversko community project. It is not affiliated with, endorsed by, or an official component of DeepSeek or DeepSeek Harness. “DeepSeek Harness” is used only to describe compatibility; the project name uses the community abbreviation recommended by the upstream brand guidelines.
