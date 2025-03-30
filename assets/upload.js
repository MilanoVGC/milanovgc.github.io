// Wait for the HTML document to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const repoOwner = 'MilanoVGC';
    const repoName = 'milanovgc.github.io';
    const targetBranch = 'main';
    const targetFolder = 'incoming';
    // --- END CONFIGURATION ---

    // --- DOM References ---
    const uploadForm = document.getElementById('uploadForm');
    const githubTokenInput = document.getElementById('githubToken');
    const tdfFileInput = document.getElementById('tdfFile');
    const uploadButton = document.getElementById('uploadButton');

    const deleteForm = document.getElementById('deleteForm');
    const deleteSelect = document.getElementById('deleteTournamentSelect');
    const githubTokenDeleteInput = document.getElementById('githubTokenDelete');
    const deleteButton = document.getElementById('deleteButton');

    const statusBox = document.getElementById('status');

    // --- Helper Functions (Log, Clear, Base64 Read) ---
    function logStatus(message, type = "info") { const entry = document.createElement('div'); if (type === "error") { entry.className = 'error'; entry.textContent = `ERROR: ${message}`; } else if (type === "success") { entry.className = 'success'; entry.textContent = `SUCCESS: ${message}`; } else { entry.textContent = message; } statusBox.appendChild(entry); statusBox.scrollTop = statusBox.scrollHeight; }
    function clearStatus() { statusBox.innerHTML = ''; }
    function readFileAsBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { const base64String = reader.result.split(',')[1]; resolve(base64String); }; reader.onerror = (error) => reject(error); reader.readAsDataURL(file); }); }

    // --- Form State Checks ---
    function checkUploadFormState() { uploadButton.disabled = !(githubTokenInput.value.trim() && tdfFileInput.files.length > 0); }
    function checkDeleteFormState() { deleteButton.disabled = !(deleteSelect.value && githubTokenDeleteInput.value.trim()); }

    // --- GitHub API Helpers ---
    const githubApiBase = 'https://api.github.com';
    async function githubApiRequest(endpoint, token, options = {}) {
        const url = `${githubApiBase}${endpoint}`;
        const defaultHeaders = { "Authorization": `token ${token}`, "Accept": "application/vnd.github.v3+json", };
        if (options.body) { defaultHeaders['Content-Type'] = 'application/json'; }
        const config = { ...options, headers: { ...defaultHeaders, ...options.headers, }, };

        // logStatus(`API Request: ${options.method || 'GET'} ${endpoint}`); // Reduce noise
        const response = await fetch(url, config);

        if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') { const resetTime = new Date(parseInt(response.headers.get('X-RateLimit-Reset') || '0', 10) * 1000); throw new Error(`GitHub API rate limit exceeded. Try again after ${resetTime.toLocaleTimeString()}.`); }
        if (options.method === 'DELETE' && (response.status === 200 || response.status === 204)) { /* logStatus(`API Success: DELETE ${endpoint} (${response.status})`); */ return { ok: true, status: response.status }; }
        if (options.method === 'GET' && endpoint.includes('/contents/') && response.status === 404) { return { ok: false, status: 404, data: null }; }

        let data = null;
        try { if (response.status !== 204) { data = await response.json(); } } catch (e) { if (!response.ok) { console.warn("Could not parse JSON response for error"); } }

        if (!response.ok) { const errorMessage = data?.message || response.statusText || `Request failed with status ${response.status}`; console.error("API Error Response:", data); throw new Error(errorMessage); }

        // logStatus(`API Success: ${options.method || 'GET'} ${endpoint} (${response.status})`);
        return { ok: true, status: response.status, data };
    }

    // --- Populate Tournament Delete Dropdown (using API) ---
    async function fetchTournamentsAndPopulateDropdown() {
        deleteSelect.disabled = true;
        deleteSelect.innerHTML = '<option value="" disabled selected>Loading tournaments...</option>';
        // Use the "main" token input for read access needed here
        const token = githubTokenInput.value.trim();
        if (!token) {
            deleteSelect.innerHTML = '<option value="" disabled selected>Enter PAT above to load</option>';
             // Don't log an error yet, just prompt user
            checkDeleteFormState();
            return; // Can't load without token
        }

        try {
            // Fetch contents of the repository root
            const rootContentsEndpoint = `/repos/${repoOwner}/${repoName}/contents/?ref=${targetBranch}`;
            const { ok, data: rootContents } = await githubApiRequest(rootContentsEndpoint, token, { method: 'GET' });

            if (!ok || !Array.isArray(rootContents)) {
                 throw new Error("Could not fetch repository contents.");
            }

            // Filter for directories, excluding known non-tournament folders
            const excludeFolders = ['.git', '.github', 'assets', 'incoming'];
            const tournamentFolders = rootContents.filter(item => item.type === 'dir' && !excludeFolders.includes(item.name));

            if (tournamentFolders.length > 0) {
                // Sort alphabetically by name (folder slug)
                tournamentFolders.sort((a, b) => a.name.localeCompare(b.name));
                deleteSelect.innerHTML = '<option value="" disabled selected>Select a tournament...</option>'; // Reset prompt
                tournamentFolders.forEach(t => {
                    const option = document.createElement('option');
                    option.value = t.name; // Folder name is the slug
                    // Simple display name from folder name
                    option.textContent = t.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                    deleteSelect.appendChild(option);
                });
                deleteSelect.disabled = false;
            } else {
                deleteSelect.innerHTML = '<option value="" disabled selected>No tournaments found</option>';
            }
        } catch (error) {
            logStatus(`Error loading tournament list via API: ${error.message}`, "error");
            if (error.message.includes('401')) logStatus("-> Check if PAT is correct and has 'repo' scope.", "error");
            deleteSelect.innerHTML = '<option value="" disabled selected>Error loading list</option>';
        } finally {
            checkDeleteFormState(); // Check button state after loading attempt
        }
    }


    // --- Upload Logic (Identical to your provided code) ---
    uploadForm.addEventListener('submit', async (event) => {
        event.preventDefault(); uploadButton.disabled = true; clearStatus(); logStatus("Starting upload process...");
        const token = githubTokenInput.value.trim(); const file = tdfFileInput.files[0]; const filename = file.name; const filePath = `${targetFolder}/${filename}`;
        if (!token || !file || !filename.toLowerCase().endsWith('.tdf')) { logStatus("Invalid input for upload.", "error"); checkUploadFormState(); return; }

        let encodedContent;
        try { logStatus(`Reading file: ${filename}...`); encodedContent = await readFileAsBase64(file); logStatus("File read."); }
        catch (error) { logStatus(`Error reading file: ${error.message}`, "error"); checkUploadFormState(); return; }

        const endpoint = `/repos/${repoOwner}/${repoName}/contents/${filePath}`;
        const commitMessage = `Upload TDF: ${filename}`;

        try {
            logStatus(`Checking if file exists at '${filePath}'...`);
            let existingFileSha = null;
            try {
                 const { ok, data } = await githubApiRequest(endpoint + `?ref=${targetBranch}`, token, { method: 'GET' });
                 if (ok && data && data.sha) { existingFileSha = data.sha; logStatus(`File exists. Will update (SHA: ${existingFileSha.substring(0,7)}...).`); }
                 else { logStatus("File does not exist. Will create new file."); }
            } catch (getError) { if (!getError.message.includes('404')) throw getError; logStatus("File does not exist (404 check). Will create new file."); }

            const requestBody = { message: commitMessage, content: encodedContent, branch: targetBranch };
            if (existingFileSha) { requestBody.sha = existingFileSha; }

            logStatus(`Uploading file via GitHub API...`);
            const { ok, data: responseData, status } = await githubApiRequest(endpoint, token, { method: 'PUT', body: JSON.stringify(requestBody) });

            if (ok) { const action = status === 201 ? 'created' : 'updated'; logStatus(`File successfully ${action}! Commit: ${responseData?.commit?.sha || 'N/A'}`, "success"); logStatus("GitHub Actions workflow should trigger shortly."); tdfFileInput.value = ''; }
        } catch (error) { logStatus(`Upload failed: ${error.message}`, "error"); if (error.message.includes('401')) logStatus("-> Check PAT/scope.", "error"); if (error.message.includes('404')) logStatus(`-> Check owner/repo/branch names.`, "error"); }
        finally { checkUploadFormState(); }
    });


    // --- Delete Logic ---
    deleteForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const selectedSlug = deleteSelect.value;
        const token = githubTokenDeleteInput.value.trim(); // Use the separate delete token input

        if (!selectedSlug) { logStatus("Please select a tournament to delete.", "error"); return; }
        if (!token) { logStatus("PAT is required in the 'Deletion' section to confirm.", "error"); return; }

        const tournamentName = deleteSelect.options[deleteSelect.selectedIndex].text;

        if (!window.confirm(`ARE YOU SURE you want to permanently delete all files for tournament "${tournamentName}" (${selectedSlug})?\n\nThis CANNOT be undone.`)) {
            logStatus("Deletion cancelled by user.", "info");
            return;
        }

        deleteButton.disabled = true;
        clearStatus();
        logStatus(`--- Starting Deletion for ${tournamentName} (${selectedSlug}) ---`);

        try {
            // 1. Get contents of the folder to delete
            const folderContentEndpoint = `/repos/${repoOwner}/${repoName}/contents/${selectedSlug}?ref=${targetBranch}`;
            logStatus(`Fetching contents of folder ${selectedSlug}...`);
            const { ok: contentsOk, status: contentsStatus, data: folderContents } = await githubApiRequest(folderContentEndpoint, token, { method: 'GET' });

            let filesToDelete = [];
            if (contentsOk && Array.isArray(folderContents)) {
                filesToDelete = folderContents; // Use the fetched list
            } else if (contentsStatus === 404) {
                logStatus(`Folder ${selectedSlug} not found on GitHub. Nothing to delete there.`, "warning");
                // If folder doesn't exist, there are no files to delete, proceed to step 3 (update root index)
            } else {
                throw new Error(`Could not fetch contents for folder ${selectedSlug}. Status: ${contentsStatus}.`);
            }

            // 2. Delete each file/item within the folder (if any found)
            if (filesToDelete.length > 0) {
                 logStatus(`Found ${filesToDelete.length} items in ${selectedSlug}. Deleting...`);
                 const deletePromises = filesToDelete.map(item => {
                     logStatus(`Attempting to delete ${item.type}: ${item.path}`);
                     const deleteEndpoint = `/repos/${repoOwner}/${repoName}/contents/${item.path}`;
                     return githubApiRequest(deleteEndpoint, token, {
                         method: 'DELETE',
                         body: JSON.stringify({ message: `Delete ${item.type}: ${item.path}`, sha: item.sha, branch: targetBranch })
                     }).catch(deleteError => ({ ok: false, path: item.path, error: deleteError.message }));
                 });

                 const deleteResults = await Promise.all(deletePromises);
                 const failedDeletes = deleteResults.filter(res => !res.ok);

                 if (failedDeletes.length > 0) {
                     logStatus(`Could not delete all items: ${failedDeletes.map(f=>f.path).join(', ')}. Manual cleanup may be required.`, "error");
                     throw new Error("Not all files in the tournament folder could be deleted.");
                 } else {
                     logStatus(`Successfully deleted all items in folder ${selectedSlug}.`);
                 }
            }

            // 3. Regenerate the root index.html to remove the deleted tournament link
            // This requires triggering the *workflow* again. We can't easily do this from client-side JS.
            // The simplest approach is to tell the user the folder is deleted, but the link
            // on the homepage will remain until the *next* TDF upload triggers the workflow
            // which regenerates the index.html based on existing folders.
            logStatus(`Folder '${selectedSlug}' contents deleted from GitHub.`, "success");
            logStatus(`The link on the homepage will be removed the next time *any* tournament TDF is uploaded.`, "info");

            // 4. Refresh the dropdown and provide final success message
            logStatus(`--- Deletion process for ${tournamentName} completed! ---`, "success");
            await fetchTournamentsAndPopulateDropdown(); // Refresh list
            githubTokenDeleteInput.value = ''; // Clear token field

        } catch (error) {
            logStatus(`Deletion failed: ${error.message}`, "error");
            if (error.message.includes('401')) logStatus("-> Check PAT.", "error");
            if (error.message.includes('409')) logStatus("-> Conflict error? Try again.", "error");
             if (error.message.includes('404')) logStatus(`-> Folder/file might already be deleted?`, "warning");
        } finally {
            checkDeleteFormState(); // Re-enable button if needed
        }
    });

    // --- Initial Setup ---
    githubTokenInput.addEventListener('input', () => {
        checkUploadFormState();
        // If the main token is entered, try loading the delete list
        if (githubTokenInput.value.trim()) {
            fetchTournamentsAndPopulateDropdown();
        }
    });
    tdfFileInput.addEventListener('change', checkUploadFormState);
    deleteSelect.addEventListener('change', checkDeleteFormState);
    githubTokenDeleteInput.addEventListener('input', checkDeleteFormState);

    checkUploadFormState(); // Initial state for upload button
    checkDeleteFormState(); // Initial state for delete button
    // Don't fetch tournaments initially, wait for PAT entry

}); // End of DOMContentLoaded
