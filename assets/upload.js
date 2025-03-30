// Wait for the HTML document to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const repoOwner = 'MilanoVGC';
    const repoName = 'milanovgc.github.io';
    const targetBranch = 'main';
    const targetFolder = 'incoming';
    const manifestPath = 'data/tournaments.json'; // Path to the JSON manifest
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

    // --- Helper Functions (Log, Clear, Base64 Read - Keep from previous) ---
    function logStatus(message, type = "info") { /* ... Keep existing logStatus ... */
        const entry = document.createElement('div'); if (type === "error") { entry.className = 'error'; entry.textContent = `ERROR: ${message}`; } else if (type === "success") { entry.className = 'success'; entry.textContent = `SUCCESS: ${message}`; } else { entry.textContent = message; } statusBox.appendChild(entry); statusBox.scrollTop = statusBox.scrollHeight;
    }
    function clearStatus() { statusBox.innerHTML = ''; }
    function readFileAsBase64(file) { /* ... Keep existing readFileAsBase64 ... */
        return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { const base64String = reader.result.split(',')[1]; resolve(base64String); }; reader.onerror = (error) => reject(error); reader.readAsDataURL(file); });
    }

    // --- Form State Checks ---
    function checkUploadFormState() { uploadButton.disabled = !(githubTokenInput.value.trim() && tdfFileInput.files.length > 0); }
    function checkDeleteFormState() { deleteButton.disabled = !(deleteSelect.value && githubTokenDeleteInput.value.trim()); }

    // --- GitHub API Helpers ---
    const githubApiBase = 'https://api.github.com';

    // Function to make authenticated GitHub API requests
    async function githubApiRequest(endpoint, token, options = {}) {
        const url = `${githubApiBase}${endpoint}`;
        const defaultHeaders = {
            "Authorization": `token ${token}`,
            "Accept": "application/vnd.github.v3+json",
        };
        // Add content-type only if body exists
        if (options.body) {
            defaultHeaders['Content-Type'] = 'application/json';
        }

        const config = {
            ...options,
            headers: {
                ...defaultHeaders,
                ...options.headers, // Allow overriding headers
            },
        };

        logStatus(`API Request: ${options.method || 'GET'} ${endpoint}`);
        const response = await fetch(url, config);

        // Handle rate limiting specifically
        if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') {
             const resetTime = new Date(parseInt(response.headers.get('X-RateLimit-Reset') || '0', 10) * 1000);
             throw new Error(`GitHub API rate limit exceeded. Try again after ${resetTime.toLocaleTimeString()}.`);
        }

        // For DELETE requests, a 204 or 200 is success
        if (options.method === 'DELETE' && (response.status === 200 || response.status === 204)) {
             logStatus(`API Success: ${options.method} ${endpoint} (${response.status})`);
             // DELETE might return empty body, return status only
             return { ok: true, status: response.status };
        }
        // For GET content, 404 is a valid "not found" state
        if (options.method === 'GET' && endpoint.includes('/contents/') && response.status === 404) {
            return { ok: false, status: 404, data: null }; // Indicate not found specifically
        }

        // Attempt to parse JSON, fallback for empty responses
        let data = null;
        try {
             if (response.status !== 204) { // No content to parse for 204
                 data = await response.json();
             }
        } catch (e) {
            // Ignore JSON parse error if response is ok but body is empty/not json
            if (!response.ok) {
                 console.warn("Could not parse JSON response for error");
            }
        }

        if (!response.ok) {
            const errorMessage = data?.message || response.statusText || `Request failed with status ${response.status}`;
            console.error("API Error Response:", data); // Log full error if available
            throw new Error(errorMessage);
        }

        logStatus(`API Success: ${options.method || 'GET'} ${endpoint} (${response.status})`);
        return { ok: true, status: response.status, data }; // Return parsed data for GET/PUT/POST
    }

    // --- Populate Tournament Delete Dropdown ---
    async function fetchTournamentsAndPopulateDropdown() {
        deleteSelect.disabled = true;
        deleteSelect.innerHTML = '<option value="" disabled selected>Loading tournaments...</option>';
        try {
            // Fetch from root relative path
            const response = await fetch(`../${manifestPath}?t=${new Date().getTime()}`); // Go up one level from admin page
            if (!response.ok) {
                 // Handle case where manifest doesn't exist yet
                if (response.status === 404) {
                     deleteSelect.innerHTML = '<option value="" disabled selected>No tournaments found</option>';
                     logStatus("Tournament manifest (tournaments.json) not found.", "info");
                     return; // Exit gracefully
                }
                throw new Error(`HTTP error fetching manifest: ${response.status}`);
            }
            const tournaments = await response.json();

            if (tournaments.length > 0) {
                // Sort alphabetically by name for display
                tournaments.sort((a, b) => a.name.localeCompare(b.name));
                deleteSelect.innerHTML = '<option value="" disabled selected>Select a tournament...</option>'; // Reset prompt
                tournaments.forEach(t => {
                    const option = document.createElement('option');
                    option.value = t.slug; // Use slug (folder name) as value
                    option.textContent = t.name; // Display full name
                    deleteSelect.appendChild(option);
                });
                deleteSelect.disabled = false;
            } else {
                deleteSelect.innerHTML = '<option value="" disabled selected>No tournaments found</option>';
            }
        } catch (error) {
            logStatus(`Error loading tournament list: ${error.message}`, "error");
            deleteSelect.innerHTML = '<option value="" disabled selected>Error loading list</option>';
        } finally {
            checkDeleteFormState(); // Check button state after loading
        }
    }


    // --- Upload Logic ---
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
                 if (ok && data && data.sha) {
                     existingFileSha = data.sha;
                     logStatus(`File exists. Will update (SHA: ${existingFileSha.substring(0,7)}...).`);
                 } else {
                     logStatus("File does not exist. Will create new file.");
                 }
            } catch (getError) {
                 // If GET fails for reasons other than 404 (like auth), throw it
                 if (!getError.message.includes('404')) throw getError;
                 logStatus("File does not exist (404 check). Will create new file.");
            }


            const requestBody = { message: commitMessage, content: encodedContent, branch: targetBranch };
            if (existingFileSha) { requestBody.sha = existingFileSha; }

            logStatus(`Uploading file via GitHub API...`);
            const { ok, data: responseData, status } = await githubApiRequest(endpoint, token, { method: 'PUT', body: JSON.stringify(requestBody) });

            if (ok) {
                const action = status === 201 ? 'created' : 'updated';
                logStatus(`File successfully ${action}! Commit: ${responseData?.commit?.sha || 'N/A'}`, "success");
                logStatus("GitHub Actions workflow should trigger shortly.");
                tdfFileInput.value = ''; // Clear file input on success
            }
            // Errors are thrown by githubApiRequest

        } catch (error) {
             logStatus(`Upload failed: ${error.message}`, "error");
             if (error.message.includes('401')) logStatus("-> Check PAT/scope.", "error");
             if (error.message.includes('404')) logStatus(`-> Check owner/repo/branch names.`, "error");
             if (error.message.includes('422')) logStatus("-> API validation error.", "error");
             if (error.message.includes('409')) logStatus("-> Conflict. Branch may have changed?", "error");
        } finally {
             checkUploadFormState(); // Re-enable button if needed
        }
    });


    // --- Delete Logic ---
    deleteForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const selectedSlug = deleteSelect.value;
        const token = githubTokenDeleteInput.value.trim();

        if (!selectedSlug) { logStatus("Please select a tournament to delete.", "error"); return; }
        if (!token) { logStatus("PAT is required to confirm deletion.", "error"); return; }

        const tournamentName = deleteSelect.options[deleteSelect.selectedIndex].text; // Get name for confirmation

        if (!window.confirm(`ARE YOU SURE you want to permanently delete all files for tournament "${tournamentName}" (${selectedSlug})?\n\nThis cannot be undone.`)) {
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
            const { ok: contentsOk, data: folderContents } = await githubApiRequest(folderContentEndpoint, token, { method: 'GET' });

            if (!contentsOk || !Array.isArray(folderContents)) {
                // Handle case where folder might not exist or is empty - proceed to manifest update
                if(contentsOk === false && status === 404) {
                     logStatus(`Folder ${selectedSlug} not found on GitHub. Proceeding to check manifest...`, "info");
                } else {
                    throw new Error(`Could not fetch contents for folder ${selectedSlug}. Cannot delete files.`);
                }

            } else {
                 // 2. Delete each file/item within the folder recursively
                 logStatus(`Found ${folderContents.length} items in ${selectedSlug}. Deleting...`);
                 // Use Promise.all to delete concurrently (usually safe for files)
                 const deletePromises = folderContents.map(item => {
                     logStatus(`Attempting to delete ${item.type}: ${item.path} (SHA: ${item.sha.substring(0,7)}...)`);
                     const deleteEndpoint = `/repos/${repoOwner}/${repoName}/contents/${item.path}`;
                     return githubApiRequest(deleteEndpoint, token, {
                         method: 'DELETE',
                         body: JSON.stringify({
                             message: `Delete ${item.type}: ${item.path}`,
                             sha: item.sha,
                             branch: targetBranch
                         })
                     }).catch(deleteError => {
                         // Log individual file deletion errors but try to continue
                         logStatus(`Failed to delete ${item.path}: ${deleteError.message}`, "error");
                         // Optionally re-throw if you want the whole process to stop on one error
                         // throw deleteError;
                         return { ok: false, path: item.path }; // Mark as failed
                     });
                 });

                 const deleteResults = await Promise.all(deletePromises);
                 const failedDeletes = deleteResults.filter(res => !res.ok);

                 if (failedDeletes.length > 0) {
                     logStatus(`Could not delete all items: ${failedDeletes.map(f=>f.path).join(', ')}. Manual cleanup may be required.`, "error");
                     // Decide whether to proceed with manifest update or stop
                     // For now, let's stop to avoid inconsistent state
                     throw new Error("Not all files in the tournament folder could be deleted.");
                 } else {
                     logStatus(`Successfully deleted all items in folder ${selectedSlug}.`);
                 }
            }


            // 3. Update the manifest file
            logStatus(`Updating ${manifestPath}...`);
            const manifestEndpoint = `/repos/${repoOwner}/${repoName}/contents/${manifestPath}?ref=${targetBranch}`;

            // Get current manifest SHA and content
            const { ok: manifestOk, data: manifestData } = await githubApiRequest(manifestEndpoint, token, { method: 'GET' });
            if (!manifestOk || !manifestData || !manifestData.sha || !manifestData.content) {
                 // Handle case where manifest is missing or unreadable after folder deletion
                 if (manifestOk === false && status === 404) {
                     logStatus(`Manifest file ${manifestPath} not found. Cannot remove tournament entry.`, "warning");
                     // Allow process to finish, but warn user
                     return; // Stop here if manifest gone
                 }
                throw new Error("Could not get current manifest file content or SHA.");
            }

            const currentManifestContent = atob(manifestData.content); // Decode Base64
            const currentTournaments = JSON.parse(currentManifestContent);

            // Filter out the deleted tournament
            const updatedTournaments = currentTournaments.filter(t => t.slug !== selectedSlug);

            if (updatedTournaments.length === currentTournaments.length) {
                logStatus(`Tournament slug '${selectedSlug}' not found in manifest. No update needed.`, "info");
            } else {
                const updatedManifestContent = JSON.stringify(updatedTournaments, null, 2); // Pretty print JSON
                const updatedEncodedContent = btoa(updatedManifestContent); // Re-encode Base64

                // Commit the updated manifest
                const updateManifestBody = {
                    message: `Remove tournament ${selectedSlug} from manifest`,
                    content: updatedEncodedContent,
                    sha: manifestData.sha, // MUST provide the SHA of the file being updated
                    branch: targetBranch
                };
                await githubApiRequest(manifestEndpoint, token, { method: 'PUT', body: JSON.stringify(updateManifestBody) });
                logStatus(`Successfully updated ${manifestPath}.`, "success");
            }

            // 4. Refresh the dropdown and provide final success message
            logStatus(`--- Deletion process for ${tournamentName} completed successfully! ---`, "success");
            await fetchTournamentsAndPopulateDropdown(); // Refresh list
            githubTokenDeleteInput.value = ''; // Clear token field

        } catch (error) {
            logStatus(`Deletion failed: ${error.message}`, "error");
            if (error.message.includes('401')) logStatus("-> Check PAT.", "error");
            if (error.message.includes('404') && error.message.includes('manifest')) logStatus(`-> Manifest file likely missing.`, "warning");
            else if (error.message.includes('404')) logStatus(`-> Folder or file might already be deleted.`, "warning");
            if (error.message.includes('409')) logStatus("-> Conflict error. Maybe the file changed during deletion?", "error");
        } finally {
            checkDeleteFormState(); // Re-enable button if needed
        }
    });

    // --- Initial Setup ---
    githubTokenInput.addEventListener('input', checkUploadFormState);
    tdfFileInput.addEventListener('change', checkUploadFormState);
    deleteSelect.addEventListener('change', checkDeleteFormState);
    githubTokenDeleteInput.addEventListener('input', checkDeleteFormState);

    checkUploadFormState(); // Initial state for upload button
    fetchTournamentsAndPopulateDropdown(); // Load tournaments on page load

}); // End of DOMContentLoaded
