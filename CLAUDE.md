# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Run both servers
From the repo root: `npm start` — runs `scripts/setup.js`, which verifies that Node ≥ 20, npm ≥ 9, and Python ≥ 3.10 are installed; bootstraps any missing packages (`backend/venv`, `frontend/node_modules`, root `node_modules`); then launches both servers via `concurrently` with platform-aware paths (arm64 prefix on Apple Silicon, `venv\Scripts\` on Windows, `venv/bin/` elsewhere). Run `npm run setup` for the check-and-install steps without launching. Individual halves are still exposed as `npm run start:backend` / `npm run start:frontend`.

### Run tests
From the repo root: `npm test` — runs the backend (pytest) and frontend (vitest) suites concurrently. `npm run test:backend` and `npm run test:frontend` run each side independently.

### macOS arm64 quirk
The existing `backend/venv` was built with arm64-only wheels (notably `pydantic_core`), but `/Library/Frameworks/Python.framework` is a universal binary that defaults to running x86_64 under Rosetta. Any script that drives `venv/bin/python` or `venv/bin/uvicorn` directly must be prefixed with `arch -arm64` (the npm scripts already do this). Symptoms when missed: `ImportError: ... incompatible architecture (have 'arm64', need 'x86_64')`.

### Backend (Python / FastAPI)
Run from `backend/`. A `venv/` already exists in that directory.
- Install deps: `venv/bin/pip install -r requirements.txt`
- Run dev server directly: `venv/bin/uvicorn main:app --reload` (listens on `http://localhost:8000`; the frontend hardcodes this base URL in `frontend/src/api.js`)
- The SQLite file `backend/photocull.db` is created automatically on first run via `models.Base.metadata.create_all`.

### Frontend (React + Vite)
Run from `frontend/`.
- Install: `npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`

### Test layout
- Backend tests live in `backend/tests/`. `conftest.py` swaps `database.engine` and `database.SessionLocal` to an in-memory SQLite (with `StaticPool`) *before* `main` is imported, and exposes a `client` fixture that overrides `main.get_db` for FastAPI. Each test gets clean tables (truncated, not dropped).
- Frontend tests live next to the code they cover (`*.test.js[x]`). `vitest` is configured in `vite.config.js` with the `jsdom` environment and a setup file that pulls in `@testing-library/jest-dom`. The `api` module is mocked via `vi.hoisted` + `vi.mock` so axios is never actually called.

## Architecture

This is a local-only photo culling tool with a "git-flow" decision model. Two processes run side-by-side on localhost and talk via REST.

### The git-flow data model (backend/models.py)
The append-only SQLite design is the central abstraction — most code only makes sense in light of it:
- **`photos`** is an immutable object store. Once a JPEG is indexed (absolute path, SHA-256, EXIF timestamp, dimensions, `group_id`), the row is never mutated by the workflow.
- **`branches`** are timelines. Each tracks a `head_commit_id` and optional `parent_branch_id` / `parent_commit_id` so branches can fork from any commit.
- **`commits`** is an append-only ledger. `action_type` is one of `decide` / `best` / `restore`; the actual data lives in a JSON `payload` column.

There is no per-photo "status" column anywhere. The current keep/reject/skip state of any branch is **computed on demand** by `state_engine.get_branch_state`: it walks parent pointers from `branch.head_commit_id` back to the root, reverses the list, and replays each commit's payload into a `{photo_id: decision}` dict. Any code that needs "what's the current state?" must go through this replay — never assume a column on `photos`.

When extending decision types, both the commit producer (`POST /api/commits` in `main.py`) and the replay (`state_engine.py`) must learn the new `action_type`, and the frontend `api.js` needs a matching helper.

### Importer / grouping (backend/indexer.py)
`POST /api/library/import` kicks off `start_import` which runs `process_directory` in a `threading.Thread` — there is no job queue, status table, or progress tracking yet (`/api/library/status` is a stub). Notes that aren't obvious from the file:
- Thumbnails go to `<photo_dir>/.photocull/thumbnails/<sha>_<size>.jpg` *inside the user's photo folder*, not into the backend cwd. Two sizes: `strip` (256px) and `main` (1600px), keyed by `THUMBNAIL_SIZES` in `indexer.py`.
- The walker skips any path containing `.photocull` so re-imports don't re-ingest thumbnails.
- `group_id` assignment is purely time-based: sort newly-imported photos by EXIF timestamp, start a new group whenever the gap to the previous photo exceeds 3 seconds. The threshold is a literal in `process_directory`. Group IDs continue from the global max so imports don't collide.
- Existing photos (matched by `absolute_path`) are skipped — re-importing the same folder is a no-op for already-indexed files.

### Frontend state (frontend/src/AppContext.jsx)
A single `AppProvider` holds `photos`, `branches`, `currentBranch`, `branchState`, `currentIndex`. The UI is intentionally optimistic: `makeDecision` and `markBest` mutate `branchState` and advance `currentIndex` **before** awaiting the `POST /api/commits` response. The current code logs commit failures but does not roll back the optimistic state — keep that in mind before adding error paths.

`markBest` derives the `auto_reject` list on the frontend by filtering `photos` by `group_id`, then sends it in the commit payload. The replay engine trusts that list verbatim, so the frontend and `state_engine` must agree on group membership.

Routes are declared in `App.jsx`. Only `/` (Library) and `/cull` exist today; the History/Export views described in the PRDs are not yet implemented.

### API contract
The frontend talks to a hardcoded `http://localhost:8000/api` base in `frontend/src/api.js`. CORS is wide-open (`allow_origins=["*"]`) in `main.py`. Thumbnails and originals are served as `FileResponse` directly off disk by path lookup in the DB.

## Scope constraints from the PRDs
- **v1.0 is JPEG-only.** The indexer's extension filter is `.jpg` / `.jpeg`; RAW support is explicitly out of scope.
- **Originals are read-only.** The backend must never move, modify, or delete user files. The only filesystem writes are into `.photocull/` (thumbnails) and the export destination.
- **macOS is the focus.** Path handling targets absolute POSIX paths.
