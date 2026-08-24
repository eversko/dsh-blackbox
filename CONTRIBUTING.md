# Contributing

Issues and focused pull requests are welcome.

## Ground rules

- Preserve the metadata-only default. Never add prompts, reasoning, tool arguments, tool results, raw session identifiers, or filesystem paths to a default pack.
- Add a regression test for every parser, detector, privacy, or lifecycle change.
- Keep the analyzer deterministic and side-effect free.
- Do not append custom session events or alter the canonical DSH log.
- Run `npm test` and `npm pack --dry-run` from this directory before requesting review.

Compatibility claims require a real boot/capture test against each named DSH release. Fixture-only support must be described as fixture compatibility.
