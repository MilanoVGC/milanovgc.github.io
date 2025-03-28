# Pokémon VGC Tournament Pairings Viewer

This repository automatically processes Pokémon VGC tournament XML files (from software like TOM) and displays the pairings on a GitHub Pages site.

## How to Add/Update a Tournament

1.  **Navigate to the `incoming` folder** in this repository on GitHub: [incoming/](incoming/)
2.  Click the **"Add file"** button and choose **"Upload files"**.
3.  **Drag & drop** your tournament XML file (e.g., `my_tournament_round_5.xml`) onto the upload area, or use the file chooser.
4.  Scroll down and click **"Commit changes"** (you can add an optional description).
5.  Wait a minute or two for the system to process the file (check the "Actions" tab for progress).
6.  Once processed, a link to the tournament should appear on the main page: [https://YOUR_USERNAME.github.io/pokemon-pairings-viewer/](https://YOUR_USERNAME.github.io/pokemon-pairings-viewer/)
    *   _(Replace `YOUR_USERNAME` with your actual GitHub username)_
    *   The direct link will be `https://YOUR_USERNAME.github.io/pokemon-pairings-viewer/Tournament-Folder-Name/`

## Notes

*   The system uses the `<name>` tag within the XML file to create the tournament's folder and page title. Please ensure this tag is present and accurate in your XML.
*   Uploading a new XML file with the **exact same tournament name** will overwrite the previous data for that tournament.
*   The processing script sanitizes the tournament name for the URL (e.g., "My Premier Challenge" becomes "My-Premier-Challenge").
*   Shared CSS and JavaScript are located in the `/assets` folder.

---
*Powered by GitHub Actions.*
