# Product Requirements Document (PRD): Local Photo Culler

## 1. Product Overview
The Local Photo Culler is a desktop-class, web-based tool designed to help photographers quickly sift through large batches of photos (culling). By utilizing a unique "git-like" architecture, the application allows users to make rapid keep/reject decisions, safely branch their workflows, group burst shots, and export their final selections without ever modifying or risking their original image files.

## 2. Target Audience
*   **Professional and Hobbyist Photographers:** Specifically those dealing with high-volume shoots like events, sports, or wildlife where burst photography is common.
*   **Users seeking speed:** Individuals frustrated by the slow import/cull speeds of heavy software like Lightroom.

## 3. Core Principles
*   **Speed over everything:** The culling process must be instantaneous, relying on keyboard shortcuts and rapid rendering.
*   **Non-destructive by default:** The application operates strictly on metadata. Original photos are *never* moved, copied, or deleted by the core workflow.
*   **No fear of mistakes:** Every decision is tracked as a "commit". Users can undo, replay, and branch their decisions freely.
*   **Local First:** Photos never leave the user's machine. The backend serves local files directly to the browser.

## 4. Architecture & Technical Strategy

### 4.1 System Components
*   **Backend:** Local Python server (FastAPI) responsible for file system access, EXIF extraction, thumbnail generation, hash calculation, and SQLite database management.
*   **Frontend:** React + Vite single-page application. Acts as a thin client for fast rendering and keyboard/mouse interactions.
*   **Communication:** REST APIs and WebSockets over `localhost`.

### 4.2 Data Model ("Git-Flow")
The system uses an append-only SQLite database architecture:
*   **`photos` (Immutable):** Stores photo absolute path, content hash (SHA-256), EXIF timestamp, dimensions, and group ID. 
*   **`branches`:** Tracks timelines of culling sessions (name, parent branch, HEAD commit).
*   **`commits`:** The decision log. Records actions like `keep`, `reject`, `skip`, or `best`. The current state of any branch is computed purely by replaying these commits.

### 4.3 Grouping Engine
*   **Time-based:** Photos are grouped if the time difference between consecutive shots is below a user-defined threshold (e.g., 3 seconds).
*   **Visual Similarity (Optional):** pHash analysis on thumbnails to group photos that look visually similar, catching burst shots even if clock data is irregular.

## 5. Key Features & User Flows

### 5.1 Library Screen (Import & Setup)
*   **Select Folders:** Users point the app to local directories.
*   **Background Processing:** The server asynchronously walks directories, reads EXIF, and generates thumbnails (stored in a hidden `.photocull/` folder).
*   **Branch Selection:** Users can pick an existing branch or start a new culling session.

### 5.2 The Cull Screen (The Core Interface)
*   **Layout:** Large central preview with a bottom strip showing thumbnails of the current "burst" group.
*   **Interactions:**
    *   Keyboard shortcuts: `→` (Keep), `←` (Reject), `↑` (Mark Best), `↓` (Skip), `z` (Undo), `space` (Next Group).
    *   Mouse gestures: Swipe to keep/reject.
*   **State Handling:** 
    *   "Skip" leaves the photo to be reviewed later.
    *   Marking a photo as "Best" atomically rejects other photos in that specific group.

### 5.3 Branches & History Screen
*   **Visual Git Tree:** A visual representation of branches and commits.
*   **Time Travel:** Click to switch between different culling sessions or historical states.
*   **View Rejected:** Toggle to view rejected photos from previous states.
*   **Cherry-picking:** Right-click a rejected photo to restore it as a new commit on the current branch.

### 5.4 Export Screen
*   **Output Options:**
    1.  Copy kept photos to a new destination folder.
    2.  Generate XMP sidecar files (for Lightroom/Capture One compatibility).
    3.  Export a flat text list of kept file paths.
*   **Safety Lock:** Deleting originals is strictly hidden behind multiple explicit confirmation gates.

## 6. Scope & Constraints (v1.0)
*   **Format Support:** v1.0 will focus strictly on JPEGs to minimize complexity before tackling RAW file decoding.
*   **Storage:** Thumbnails are pre-generated at 256px (strips) and 1600px (main view). Original high-res files are only loaded for 1:1 zoom requests.
*   **Performance:** UI rendering must maintain 60fps during rapid swiping. Batching commits visually on the frontend prevents UI clutter from thousands of single actions.
