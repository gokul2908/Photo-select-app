# Backend Product Requirements Document (PRD)

## 1. Overview
The backend for the Local Photo Culler is a high-performance local server designed to manage the "git-flow" state of a user's photography library. It is responsible for reading the local file system, extracting photo metadata, serving images efficiently to the browser, and managing the append-only SQLite database that stores all user decisions (commits).

## 2. Tech Stack
*   **Framework:** FastAPI (Python)
*   **Database:** SQLite 
*   **ORM:** SQLAlchemy
*   **Metadata Extraction:** `exifread`
*   **Image Processing:** `Pillow` (PIL) for generating thumbnails.
*   **Concurrency:** Async imports/processing to prevent blocking the REST API.

## 3. Data Models (The Git-Flow)

### `photos` (The Object Store)
*   Immutable layer. Once a photo is indexed, it is never modified or deleted.
*   Fields: `id`, `absolute_path`, `content_hash` (SHA-256), `timestamp` (from EXIF), `width`, `height`, `group_id`.

### `branches` (The Timelines)
*   Tracks different culling sessions or variations.
*   Fields: `id`, `name`, `parent_branch_id`, `parent_commit_id`, `head_commit_id`.

### `commits` (The Decision Log)
*   Append-only ledger of actions.
*   Fields: `id`, `branch_id`, `parent_commit_id`, `timestamp`, `action_type` (e.g., "decide", "best", "restore"), `payload` (JSON dict containing the exact action data, e.g., `{"photo_id": 42, "decision": "keep"}`).

## 4. Core Subsystems

### 4.1 Importer & Indexer
*   Accepts a local directory path.
*   Recursively finds supported image formats (starting with `.jpg` / `.jpeg`).
*   Extracts EXIF creation time for sorting.
*   Generates a lightweight SHA-256 hash of the file.
*   **Thumbnail Generator:** Creates two down-sampled versions (e.g., 256px for strip, 1600px for main view) stored in a hidden `.photocull/thumbnails/` directory.
*   **Auto-Grouping Engine:** Sorts newly imported photos by EXIF timestamp. Photos with a time gap smaller than `THRESHOLD` (e.g., 3 seconds) from the previous photo are assigned the same `group_id`.

### 4.2 State Replay Engine
*   Because the database only stores *deltas* (commits), the backend must compute the current state of any branch.
*   Algorithm: Starting from the root commit, replay all commits chronologically down to the `head_commit_id` of the requested branch.
*   Resolves final status (keep, reject, skip, unprocessed) for every photo on that branch.

## 5. API Endpoints

### Library & Photos
*   `POST /api/library/import`: Start an async job to index a folder path.
*   `GET /api/library/status`: Get progress of the current import job.
*   `GET /api/photos`: Fetch the list of all indexed photos.
*   `GET /api/photos/{photo_id}/thumbnail/{size}`: Serve pre-generated thumbnails (fast).
*   `GET /api/photos/{photo_id}/original`: Serve original file for 1:1 zooming.

### Branches & State
*   `GET /api/branches`: List all branches.
*   `POST /api/branches`: Create a new branch from a specific commit.
*   `GET /api/branches/{branch_id}/state`: Computes and returns the state of all photos for a given branch.

### Commits (Decisions)
*   `POST /api/commits`: Append a new decision. The payload specifies the action type (`decide`, `best`, `restore`) and updates the branch's `head_commit_id`.

### Export
*   `POST /api/export`: Given a `branch_id` and `destination_path`, copy all photos with state `keep` to the destination.

## 6. Constraints & Edge Cases
*   **Read-Only Originals:** The backend must explicitly restrict itself from modifying, moving, or deleting original user files.
*   **Async Indexing:** Hashing and thumbnail generation must be done in a background thread/task to keep the API responsive.
*   **Path Resolution:** Must handle absolute paths robustly across OS types, though current focus is macOS.
