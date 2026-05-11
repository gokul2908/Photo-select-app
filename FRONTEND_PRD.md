# Frontend Product Requirements Document (PRD)

## 1. Overview
The frontend for the Local Photo Culler is a Vite + React Single Page Application (SPA) built for extreme speed and premium aesthetics. It serves as a thin client that talks to the local Python backend, focusing purely on rapid UI rendering, keyboard-driven workflows, and a stunning, dynamic visual experience.

## 2. Tech Stack & Styling
*   **Framework:** React + Vite
*   **Styling:** Vanilla CSS focusing on best practices.
*   **Design Aesthetics:** Premium dark mode UI. Features will include:
    *   Glassmorphism (translucent panels over deep backgrounds).
    *   Dynamic micro-animations (e.g., hover states, swipe transitions, smooth image loading).
    *   Sleek, modern typography (Google Fonts: Inter or Outfit).
    *   Subtle gradients to highlight active elements without being overwhelming.

## 3. Core Views & Routing

### 3.1 Library View (Home)
*   **Purpose:** The entry point to start a new culling session or resume an old one.
*   **Features:**
    *   Input field to paste an absolute directory path for import.
    *   List of existing branches fetched from the backend.
    *   Real-time progress indicator for active imports.

### 3.2 Cull View (The Main Engine)
*   **Purpose:** Rapid photo review and decision making.
*   **Layout:**
    *   **Header:** Shows current branch name, progress (e.g., "Photo 45 / 1200"), and global stats ("Kept: 12").
    *   **Center Stage:** Displays the `1600px` thumbnail of the currently selected photo. Must support smooth cross-fading when switching photos.
    *   **Bottom Strip:** A horizontal scrolling strip showing `256px` thumbnails of photos in the *current burst group*. Highlights the currently active photo.
*   **Interactions (Keyboard First):**
    *   `Right Arrow`: Keep (API call to `/api/commits`, advances to next photo).
    *   `Left Arrow`: Reject (API call, advances).
    *   `Up Arrow`: Mark Best (API call, auto-rejects rest of group, advances to next group).
    *   `Down Arrow`: Skip (Advances without decision).
    *   `Z`: Undo (Reverts UI state, could potentially delete last commit or create inverse commit depending on backend state support).

### 3.3 Branches / History View
*   **Purpose:** Visualizing the git-flow.
*   **Features:**
    *   A list or tree view of branches.
    *   Ability to view the final state of a selected branch.
    *   Button to create a new branch from a selected point.

### 3.4 Export View
*   **Purpose:** Outputting the final kept images.
*   **Features:**
    *   Input field for the destination directory.
    *   Summary of what is about to be exported (e.g., "Exporting 45 kept photos from branch 'main'").
    *   Export execution button triggering the backend `/api/export` route.

## 4. State Management & API Integration
*   **API Base:** `http://localhost:8000`
*   **Global Context:**
    *   `photos`: The complete catalog array.
    *   `currentBranch`: ID of the active branch.
    *   `branchState`: The resolved dictionary of `{ photo_id: "keep" | "reject" | "skip" }`.
    *   `currentIndex`: Integer tracking the currently viewed photo.
*   **Optimistic UI Updates:** When a decision is made (e.g., "Keep"), the UI will instantly advance to the next photo and update the local `branchState` context while the `POST /api/commits` call happens asynchronously in the background. This ensures zero perceived latency.

## 5. Performance Targets
*   Preloading the next 3-5 high-res (`1600px`) thumbnails into memory using hidden `<img />` tags so arrow navigation is instantaneous.
*   No full page reloads.
*   Strict reliance on CSS transforms/opacity for animations to guarantee 60fps rendering.
