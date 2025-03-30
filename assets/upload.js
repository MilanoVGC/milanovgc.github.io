// Wait for the HTML document to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const repoOwner = 'MilanoVGC';
    const repoName = 'milanovgc.github.io';
    const targetBranch = 'main';
    const targetFolder = 'incoming'; // For uploads
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
        const response = await fetch(url, config);
        if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') { const resetTime = new Date(parseInt(response.headers.get('X-RateLimit-Reset') || '0', 10) * 1000); throw new Error(`API rate limit exceeded. Try again after ${resetTime.toLocaleTimeString()}.`); }
        if (options.method === 'DELETE' && (response.status === 200 || response.status === 204)) { return { ok: true, status: response.status }; }
        if (options.method === 'GET' && endpoint.includes('/contents/') && response.status === 404) { return { ok: false, status: 404, data: null }; }
        let data = null;
        try { if (response.status !== 204) { data = await response.json(); } } catch (e) { if (!response.ok) console.warn("Could not parse JSON error response"); }
        if (!response.ok) { const errorMessage = data?.message || response.statusText || `Request failed with status ${response.status}`; console.error("API Error:", data); throw new Error(errorMessage); }
        return { ok: true, status: response.status, data };
    }

    // --- Populate Tournament Delete Dropdown (using API) ---
    async function fetchTournamentsAndPopulateDropdown() {
        deleteSelect.disabled = true; deleteSelect.innerHTML = '<option value="" disabled selected>Loading tournaments...</option>';
        const token = githubTokenInput.value.trim();
        if (!token) { deleteSelect.innerHTML = '<option value="" disabled selected>Enter PAT above to load</option>'; checkDeleteFormState(); return; }
        try {
            const rootContentsEndpoint = `/repos/${repoOwner}/${repoName}/contents/?ref=${targetBranch}`;
            const { ok, data: rootContents } = await githubApiRequest(rootContentsEndpoint, token, { method: 'GET' });
            if (!ok || !Array.isArray(rootContents)) { throw new Error("Could not fetch repository contents."); }
            const excludeFolders = ['.git', '.github', 'assets', 'incoming', 'data']; // Also exclude root 'data' if it exists
            const tournamentFolders = rootContents.filter(item => item.type === 'dir' && !excludeFolders.includes(item.name));
            if (tournamentFolders.length > 0) {
                tournamentFolders.sort((a, b) => a.name.localeCompare(b.name));
                deleteSelect.innerHTML = '<option value="" disabled selected>Select a tournament...</option>';
                tournamentFolders.forEach(t => { const option = document.createElement('option'); option.value = t.name; option.textContent = t.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()); deleteSelect.appendChild(option); });
                deleteSelect.disabled = false;
            } else { deleteSelect.innerHTML = '<option value="" disabled selected>No tournaments found</option>'; }
        } catch (error) { logStatus(`Error loading tournament list via API: ${error.message}`, "error"); if (error.message.includes('401')) logStatus("-> Check PAT/scope.", "error"); deleteSelect.innerHTML = '<option value="" disabled selected>Error loading list</option>'; }
        finally { checkDeleteFormState(); }
    }

    // --- Upload Logic (Identical) ---
    uploadForm.addEventListener('submit', async (event) => {
        event.preventDefault(); uploadButton.disabled = true; clearStatus(); logStatus("Starting upload process...");
        const token = githubTokenInput.value.trim(); const file = tdfFileInput.files[0]; const filename = file.name; const filePath = `${targetFolder}/${filename}`;
        if (!token || !file || !filename.toLowerCase().endsWith('.tdf')) { logStatus("Invalid input for upload.", "error"); checkUploadFormState(); return; }
        let encodedContent; try { logStatus(`Reading file: ${filename}...`); encodedContent = await readFileAsBase64(file); logStatus("File read."); } catch (error) { logStatus(`Error reading file: ${error.message}`, "error"); checkUploadFormState(); return; }
        const endpoint = `/repos/${repoOwner}/${repoName}/contents/${filePath}`; const commitMessage = `Upload TDF: ${filename}`;
        try {
            logStatus(`Checking if file exists at '${filePath}'...`); let existingFileSha = null;
            try { const { ok, data } = await githubApiRequest(endpoint + `?ref=${targetBranch}`, token, { method: 'GET' }); if (ok && data?.sha) { existingFileSha = data.sha; logStatus(`File exists. Will update.`); } else { logStatus("File does not exist. Will create."); } } catch (getError) { if (!getError.message.includes('404')) throw getError; logStatus("File does not exist (404 check)."); }
            const requestBody = { message: commitMessage, content: encodedContent, branch: targetBranch }; if (existingFileSha) { requestBody.sha = existingFileSha; }
            logStatus(`Uploading file via GitHub API...`); const { ok, data: responseData, status } = await githubApiRequest(endpoint, token, { method: 'PUT', body: JSON.stringify(requestBody) });
            if (ok) { const action = status === 201 ? 'created' : 'updated'; logStatus(`File successfully ${action}! Commit: ${responseData?.commit?.sha || 'N/A'}`, "success"); logStatus("Workflow should trigger shortly."); tdfFileInput.value = ''; }
        } catch (error) { logStatus(`Upload failed: ${error.message}`, "error"); if (error.message.includes('401')) logStatus("-> Check PAT/scope.", "error"); }
        finally { checkUploadFormState(); }
    });


    // --- Delete Logic (Corrected) ---
    deleteForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const selectedSlug = deleteSelect.value;
        const token = githubTokenDeleteInput.value.trim();
        if (!selectedSlug || !token) { logStatus("Please select tournament and enter PAT for deletion.", "error"); return; }
        const tournamentName = deleteSelect.options[deleteSelect.selectedIndex].text;
        if (!window.confirm(`ARE YOU SURE you want to permanently delete files for tournament "${tournamentName}" (${selectedSlug})?\n\nThis CANNOT be undone.`)) { logStatus("Deletion cancelled.", "info"); return; }

        deleteButton.disabled = true; clearStatus(); logStatus(`--- Starting Deletion for ${tournamentName} (${selectedSlug}) ---`);

        try {
            // Define paths for the files we know exist within the folder
            const filesToDeletePaths = [
                `${selectedSlug}/index.html`,
                `${selectedSlug}/data/tournament_data.xml`
                // Add other specific files if your workflow creates more
            ];

            let filesActuallyDeleted = 0;
            const deletePromises = [];

            // For each expected file, try to get its SHA and then delete it
            for (const filePath of filesToDeletePaths) {
                const fileContentEndpoint = `/repos/${repoOwner}/${repoName}/contents/${filePath}?ref=${targetBranch}`;
                logStatus(`Checking for file: ${filePath}...`);

                try {
                    const { ok, data: fileData } = await githubApiRequest(fileContentEndpoint, token, { method: 'GET' });

                    if (ok && fileData && fileData.sha) {
                        logStatus(`File found. Attempting to delete ${filePath} (SHA: ${fileData.sha.substring(0,7)}...)`);
                        const deleteEndpoint = `/repos/${repoOwner}/${repoName}/contents/${filePath}`;
                        deletePromises.push(
                            githubApiRequest(deleteEndpoint, token, {
                                method: 'DELETE',
                                body: JSON.stringify({
                                    message: `Delete file: ${filePath}`,
                                    sha: fileData.sha,
                                    branch: targetBranch
                                })
                            }).then(deleteResult => {
                                if(deleteResult.ok) filesActuallyDeleted++;
                                return deleteResult; // Pass result along
                            }).catch(deleteError => {
                                logStatus(`Failed to delete ${filePath}: ${deleteError.message}`, "error");
                                return { ok: false, path: filePath }; // Mark as failed
                            })
                        );
                    } else if (status === 404) {
                         logStatus(`File ${filePath} not found (already deleted?). Skipping.`, "info");
                         // Consider this 'success' in terms of cleanup
                    } else {
                         logStatus(`Could not get info for ${filePath}. Cannot delete.`, "warning");
                         deletePromises.push(Promise.resolve({ ok: false, path: filePath })); // Mark as failed
                    }
                } catch (getFileError) {
                     // Handle case where getting file info fails (e.g., 404)
                     if (getFileError.message.includes('404')) {
                         logStatus(`File ${filePath} not found (already deleted?). Skipping.`, "info");
                     } else {
                         logStatus(`Error checking file ${filePath}: ${getFileError.message}`, "error");
                         deletePromises.push(Promise.resolve({ ok: false, path: filePath })); // Mark as failed
                     }
                }
            } // End for loop

            // Wait for all attempted deletions
            const deleteResults = await Promise.all(deletePromises);
            const failedDeletes = deleteResults.filter(res => !res.ok);

            if (failedDeletes.length > 0) {
                logStatus(`Could not delete all expected files: ${failedDeletes.map(f=>f.path).join(', ')}. Manual cleanup might be needed.`, "error");
                throw new Error("Not all files in the tournament folder could be deleted.");
            }

            logStatus(`Successfully deleted ${filesActuallyDeleted} file(s) for tournament ${selectedSlug}.`);

            // Inform user about homepage update timing
            logStatus(`The link on the homepage will be removed the next time *any* tournament TDF is uploaded (as this regenerates the list).`, "info");
            logStatus(`--- Deletion process for ${tournamentName} completed! ---`, "success");

            // Refresh dropdown and clear token
            await fetchTournamentsAndPopulateDropdown();
            githubTokenDeleteInput.value = '';

        } catch (error) {
            logStatus(`Deletion failed: ${error.message}`, "error");
            if (error.message.includes('401')) logStatus("-> Check PAT.", "error");
            if (error.message.includes('409')) logStatus("-> Conflict error? Try again.", "error");
        } finally {
            checkDeleteFormState();
        }
    });

    // --- Initial Setup ---
    githubTokenInput.addEventListener('input', () => { checkUploadFormState(); if (githubTokenInput.value.trim()) { fetchTournamentsAndPopulateDropdown(); } });
    tdfFileInput.addEventListener('change', checkUploadFormState);
    deleteSelect.addEventListener('change', checkDeleteFormState);
    githubTokenDeleteInput.addEventListener('input', checkDeleteFormState);
    checkUploadFormState(); checkDeleteFormState();
    // Fetch tournaments ONLY if token is already present on load (e.g., saved by browser)
    if (githubTokenInput.value.trim()) { fetchTournamentsAndPopulateDropdown(); } else { deleteSelect.innerHTML = '<option value="" disabled selected>Enter PAT above to load</option>'; }

}); // End of DOMContentLoaded
