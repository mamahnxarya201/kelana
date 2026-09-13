# AGENTS.md

## CodeGraph

This repo is indexed with CodeGraph (CLI on PATH). Use `codegraph sync` if the index seems stale.

- `codegraph query <term>` — find symbols
- `codegraph explore <query>` — symbols + call paths + source in one shot
- `codegraph node <symbol>` — one symbol's source with caller/callee trail
- `codegraph callers <symbol>` / `callees <symbol>` / `impact <symbol>` — dependency analysis
- `codegraph files` — project structure from the index

Use it wisely: reach for CodeGraph when you need relationship or blast-radius information (who calls this, what breaks if I change it), not for every lookup. Simple greps, file reads, and known-file edits don't need it.
