# MilanoVGC Tournament Viewer

[![Process Tournament TDF Upload](https://github.com/MilanoVGC/milanovgc.github.io/actions/workflows/process_tournament.yml/badge.svg)](https://github.com/MilanoVGC/milanovgc.github.io/actions/workflows/process_tournament.yml)

A static website hosted on [GitHub Pages](https://pages.github.com/) to display live pairings, results, and final standings for MilanoVGC Pokémon VGC tournaments. Data is processed automatically from Tournament Organizer Manager (TOM) `.tdf` exports using GitHub Actions.

**Live Site:** [https://milanovgc.github.io/](https://milanovgc.github.io/)

## Features

*   **Live Pairings:** View current round pairings for ongoing tournaments.
*   **Auto-Refresh:** Tournament pages automatically check for updated data every 15 seconds.
*   **Swiss Standings:** Displays final Swiss standings (Rank, Player, Record, OWP%, OOWP%) after the last Swiss round is completed.
    *   Uses calculation logic derived from observed TOM behavior (WP = Max(MatchWins / (RoundsParticipated - Byes), 0.25), no intermediate rounding).
*   **Top Cut Navigation:** Cleanly separates Swiss round tabs from Top Cut stage tabs (e.g., "Top 8", "Top 4", "Finals").
*   **Player Search:** Filter pairings tables by player name.
*   **Responsive Design:** Adapts layout for different screen sizes (desktop, mobile).
*   **Automated Processing:** Tournament data files (`.tdf`) uploaded to a specific folder trigger a GitHub Action to automatically generate the necessary pages and update the tournament list.

## How it Works

The system leverages GitHub Actions and GitHub Pages for a mostly automated workflow:

1.  **TDF Export:** A tournament organizer exports the current tournament data from TOM software as a `.tdf` file.
2.  **Admin Upload:**
    *   The organizer navigates to the (potentially private) `admin_upload.html` page.
    *   They enter a GitHub Personal Access Token (PAT) with `repo` scope and select the `.tdf` file.
    *   The `assets/upload.js` script reads the file and uses the GitHub API (via the user's browser) to upload the `.tdf` file directly into the `incoming/` directory of the `main` branch.
3.  **GitHub Action Trigger:**
    *   The push to `incoming/` triggers the `.github/workflows/process_tournament.yml` workflow.
4.  **Workflow Execution:**
    *   Checks out the repository code.
    *   Installs necessary command-line tools: `xmlstarlet` (for XML parsing) and `jq` (for JSON processing, though currently optional).
    *   Finds the newly uploaded `.tdf` file in `incoming/`.
    *   Extracts the tournament name and date using `xmlstarlet`.
    *   Creates a sanitized, URL-friendly folder name based on the tournament name (e.g., `monkey-cup-vg-16-03-2025`).
    *   Generates a basic `index.html` file inside the new tournament folder. This file contains the structure for displaying pairings and standings and links to the shared CSS and JS assets.
    *   Moves the uploaded `.tdf` file into the `Tournament-Folder/data/` directory and renames it to `tournament_data.xml`.
    *   Regenerates the **root `index.html`** file (the homepage). It scans the repository for all tournament folders, attempts to read the proper tournament name from each tournament's HTML `<title>` tag, and creates a list of links (styled as cards) pointing to each tournament's page.
    *   Configures git with bot credentials.
    *   Adds all new/modified files (the new tournament folder with its HTML/XML, the updated root `index.html`, and the removal of the TDF from `incoming/`).
    *   Commits these changes with a descriptive message.
    *   Pushes the commit back to the `main` branch.
5.  **GitHub Pages Deployment:**
    *   GitHub Pages automatically detects the push to the `main` branch and serves the updated static files.
6.  **User Experience:**
    *   A user visits `https://milanovgc.github.io/`.
    *   The browser loads the root `index.html`, which displays the list of available tournaments (styled as cards).
    *   The user clicks on a tournament card link (e.g., `./monkey-cup-vg-16-03-2025/`).
    *   The browser navigates to the corresponding `Tournament-Folder/index.html`.
    *   `assets/style.css` is loaded to apply the visual theme.
    *   `assets/script.js` executes:
        *   Fetches the specific `data/tournament_data.xml` for that tournament.
        *   Parses the XML to extract player info and round/match data.
        *   Dynamically generates the round navigation tabs (including Top Cut stages).
        *   Displays pairings for the current round, including player scores.
        *   Adds functionality to the search bar.
        *   Determines the latest *completed* Swiss round. If it's the *final* Swiss round, it calculates and displays the Swiss standings (OWP, OOWP).
        *   Sets up an interval timer (`setInterval`) to periodically re-fetch the `tournament_data.xml` and update the UI if changes are detected (auto-refresh).

## Setup & Configuration

*   **`assets/upload.js`:** The `repoOwner` and `repoName` constants must be set correctly for the GitHub API upload to function.
*   **GitHub PAT:** The admin uploading the TDF needs a GitHub Personal Access Token with the `repo` scope selected. This token should be kept secure and is entered directly on the upload page (ensure HTTPS is used).

## Usage

**Admin:**

1.  Export the tournament data from TOM as a `.tdf` file.
2.  Navigate to `admin_upload.html` on the live site.
3.  Paste your GitHub PAT into the appropriate field.
4.  Select the exported `.tdf` file.
5.  Click "Upload & Process File".
6.  Monitor the status box and wait for the GitHub Actions workflow to complete (can be viewed in the repository's "Actions" tab).

**User:**

1.  Visit the main site URL: [https://milanovgc.github.io/](https://milanovgc.github.io/)
2.  Click on the desired tournament card/link.
3.  Use the round tabs/stage buttons to navigate pairings.
4.  Standings appear automatically below pairings once the final Swiss round is complete.
5.  The page automatically checks for updates periodically.

## Technology Stack

*   **Frontend:** HTML, CSS, JavaScript (Vanilla)
*   **Hosting:** GitHub Pages
*   **Automation:** GitHub Actions
*   **Workflow Tools:**
    *   Shell Scripting (Bash)
    *   `xmlstarlet` (XML parsing)
    *   `jq` (JSON processing - included but may not be actively used in current manifest update)
    *   Python (for robust HTML escaping in workflow)
*   **Data Format:** XML (`.tdf` export from TOM)

## Potential Improvements / TODO

*   **Refactor to SPA:** Convert the project to a Single Page Application framework (Vue, React, Svelte) or use vanilla JS routing more extensively for a smoother user experience (Level 2 approach discussed previously).
*   **Admin Page Security:** The current `admin_upload.html` relies solely on the PAT. Consider adding authentication or moving upload functionality outside the static site if security is a major concern.
*   **Error Handling:** Improve error display and recovery in both the workflow and the frontend JavaScript.
*   **Design:** Further refine the UI/UX based on user feedback.
*   **Testing:** Add automated tests for standings calculation logic.
*   **Manifest Robustness:** Improve the reliability of extracting the display name when generating the root `index.html`.

## License

MIT License

Copyright (c) [2025] MilanoVGC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
