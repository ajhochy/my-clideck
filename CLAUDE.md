# my-clideck

## Overview
Custom CLI deck / personal automation scripts.

## Repo / Location
`/Users/ajhochhalter/Documents/my-clideck`

## Project logging (canonical: `docs/ai/`)

Logging lives in **`docs/ai/`** — the single source of truth, surfaced in Obsidian via the `ai-*` symlinks under `Projects/my-clideck/`.

After significant work, log to `docs/ai/` (never to one growing file):

- **Current state** → overwrite `docs/ai/project-state.md` (lean snapshot: focus · branch/PR · in progress · risks · test status · next step). No log accumulates here.
- **This run/session** → create `docs/ai/runs/YYYY-MM-DD-<slug>.md` — frontmatter `date, repo, branch, pr, issues, status, tags: [run, <repo>]`; body = Files / Checks / Notes.
- **Each durable decision** → create `docs/ai/decisions/YYYY-MM-DD-<slug>.md` — frontmatter `tags: [decision, <repo>]`; Context / Decision / Alternatives / Consequences.

Do **not** write session logs to the Obsidian vault note via `obsidian_post_file` — that path is retired; it created a second, divergent log. The vault note is now a read-only index that links to these `docs/ai/` files.