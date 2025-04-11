// Wait for the HTML document to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const repoOwner = 'MilanoVGC';
    const repoName = 'milanovgc.github.io';
    const targetBranch = 'main';
    const targetFolder = 'incoming'; // Folder where new TDF files are uploaded
    const deleteLinkWorkflowEventType = 'delete-tournament-link'; // Custom event type for the new workflow
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
    function logStatus(message, type = "info") {
        const entry = document.createElement('div');
        if (type === "error") {
            entry.className = 'error';
            entry.textContent = `ERROR: ${message}`;
        } else if (type === "success") {
            entry.className = 'success';
            entry.textContent = `SUCCESS: ${message}`;
        } else {
            entry.textContent = message;
        }
        statusBox.insertBefore(entry, statusBox.firstChild);
    }

    function clearStatus() {
        statusBox.innerHTML = 'Status logs will appear here...';
    }

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64String = reader.result.split(',')[1];
                resolve(base64String);
            };
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(file);
        });
    }

    // --- Form State Checks ---
    function checkUploadFormState() {
        uploadButton.disabled = !(githubTokenInput.value.trim() && tdfFileInput.files.length > 0);
    }

    function checkDeleteFormState() {
        deleteButton.disabled = !(deleteSelect.value && githubTokenDeleteInput.value.trim());
    }

    // --- GitHub API Helpers ---
    const githubApiBase = 'https://api.github.com';
    async function githubApiRequest(endpoint, token, options = {}) {
        const url = `${githubApiBase}${endpoint}`;
        const defaultHeaders = {
            "Authorization": `token ${token}`,
            "Accept": "application/vnd.github.v3+json", // Default Accept header
        };

        // Adjust Accept header for repository_dispatch
        if (endpoint.endsWith('/dispatches')) {
             defaultHeaders["Accept"] = "application/vnd.github.everest-preview+json"; // Required for dispatch endpoint
        }

        if (options.body) {
            if (typeof options.body !== 'string') {
                 options.body = JSON.stringify(options.body);
            }
            defaultHeaders['Content-Type'] = 'application/json';
        }

        const config = {
            ...options,
            headers: {
                ...defaultHeaders,
                ...options.headers,
            },
        };

        const response = await fetch(url, config);

        // Handle Rate Limiting
        if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') {
            const resetTime = new Date(parseInt(response.headers.get('X-RateLimit-Reset') || '0', 10) * 1000);
            throw new Error(`API rate limit exceeded. Try again after ${resetTime.toLocaleTimeString()}.`);
        }

        // Handle specific statuses for dispatch: 204 No Content is success
        if (endpoint.endsWith('/dispatches') && response.status === 204) {
            return { ok: true, status: response.status, data: null };
        }

        // Handle file not found specifically for GET requests
        if (options.method === 'GET' && endpoint.includes('/contents/') && response.status === 404) {
            return { ok: false, status: 404, data: null, message: 'File not found (404)' };
        }

        // Handle successful deletion (200 OK or 204 No Content)
        if (options.method === 'DELETE' && (response.status === 200 || response.status === 204)) {
            return { ok: true, status: response.status, data: null };
        }

        let data = null;
        try {
            // Don't try to parse JSON for 204 No Content responses
            if (response.status !== 204) {
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    data = await response.json();
                }
            }
        } catch (e) {
            if (!response.ok) {
                 console.warn(`Could not parse JSON response for failed request ${response.status}`, e);
            } else {
                console.error("Error parsing JSON from apparently successful response:", e);
            }
        }

        if (!response.ok) {
            const errorMessage = data?.message || response.statusText || `Request failed with status ${response.status}`;
            console.error("API Error Response Body:", data);
            throw new Error(errorMessage);
        }

        return { ok: true, status: response.status, data };
    }


    // --- Populate Tournament Delete Dropdown (using API) ---
    // (No changes needed in this function from the previous version)
    async function fetchTournamentsAndPopulateDropdown() {
        deleteSelect.disabled = true;
        deleteSelect.innerHTML = '<option value="" disabled selected>Loading tournaments...</option>';
        let token = githubTokenInput.value.trim() || githubTokenDeleteInput.value.trim();
        if (!token) {
            deleteSelect.innerHTML = '<option value="" disabled selected>Enter PAT to load list</option>';
            checkDeleteFormState(); return;
        }
        try {
            const rootContentsEndpoint = `/repos/${repoOwner}/${repoName}/contents/?ref=${targetBranch}`;
            const { ok, data: rootContents, message: errMsg } = await githubApiRequest(rootContentsEndpoint, token, { method: 'GET' });
            if (!ok) throw new Error(errMsg || "Could not fetch repository contents.");
            if (!Array.isArray(rootContents)) throw new Error("Unexpected data format received.");

            const excludeItems = ['.git', '.github', 'assets', 'incoming', 'data', 'README.md', 'index.html', 'admin_upload.html', '.gitignore', '_config.yml', 'LICENSE'];
            const tournamentFolders = rootContents.filter(item => item.type === 'dir' && !excludeItems.includes(item.name) && !item.name.startsWith('_') && !item.name.startsWith('.'));

            if (tournamentFolders.length > 0) {
                tournamentFolders.sort((a, b) => a.name.localeCompare(b.name));
                deleteSelect.innerHTML = '<option value="" disabled selected>Select a tournament...</option>';
                tournamentFolders.forEach(t => {
                    const option = document.createElement('option');
                    option.value = t.name;
                    let displayName = t.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                    option.textContent = displayName;
                    deleteSelect.appendChild(option);
                });
                deleteSelect.disabled = false;
            } else {
                deleteSelect.innerHTML = '<option value="" disabled selected>No processed tournament folders found</option>';
            }
        } catch (error) {
            logStatus(`Error loading tournament list via API: ${error.message}`, "error");
            if (error.message.includes('401')) logStatus("-> Check PAT validity/scope.", "error");
            else if (error.message.includes('404')) logStatus("-> Repository/branch not found.", "error");
            else if (error.message.includes('API rate limit')) logStatus("-> API rate limit hit.", "error");
            deleteSelect.innerHTML = '<option value="" disabled selected>Error loading list</option>';
        } finally {
            checkDeleteFormState();
        }
    }

    // --- Upload Logic ---
    // (No changes needed in this function from the previous version)
    uploadForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        uploadButton.disabled = true;
        clearStatus();
        logStatus("Starting upload process...");
        const token = githubTokenInput.value.trim();
        const file = tdfFileInput.files[0];
        if (!token || !file) {
            logStatus("GitHub PAT and TDF file are required.", "error");
            uploadButton.disabled = false; checkUploadFormState(); return;
        }
        const filename = file.name;
        if (!filename.toLowerCase().endsWith('.tdf')) {
             logStatus("Please select a valid .tdf file.", "error");
             uploadButton.disabled = false; checkUploadFormState(); return;
        }
        const filePath = `${targetFolder}/${filename}`;
        let encodedContent;
        try {
            logStatus(`Reading file: ${filename}...`);
            encodedContent = await readFileAsBase64(file);
            logStatus("File read successfully.");
        } catch (error) {
            logStatus(`Error reading file: ${error.message}`, "error");
            uploadButton.disabled = false; checkUploadFormState(); return;
        }
        const endpoint = `/repos/${repoOwner}/${repoName}/contents/${filePath}`;
        const commitMessage = `Upload TDF: ${filename}`;
        try {
            logStatus(`Checking if file exists at '${filePath}'...`);
            let existingFileSha = null;
            try {
                 const { ok, data, status } = await githubApiRequest(endpoint + `?ref=${targetBranch}`, token, { method: 'GET' });
                 if (ok && data?.sha) { existingFileSha = data.sha; logStatus(`File exists. Will update.`); }
                 else if (status === 404) { logStatus("File does not exist. Will create."); }
                 else { logStatus(`Could not determine if file exists (Status: ${status}). Proceeding anyway.`, "warning"); }
             } catch (getError) { logStatus(`Error checking for existing file: ${getError.message}. Attempting upload anyway.`, "warning"); }
            const requestBody = { message: commitMessage, content: encodedContent, branch: targetBranch };
            if (existingFileSha) requestBody.sha = existingFileSha;
            logStatus(`Uploading file via GitHub API to ${filePath}...`);
            const { ok, data: responseData, status } = await githubApiRequest(endpoint, token, { method: 'PUT', body: requestBody });
            if (ok) {
                const action = status === 201 ? 'created' : 'updated';
                logStatus(`File successfully ${action} in incoming/ folder! Commit: ${responseData?.commit?.sha || 'N/A'}`, "success");
                logStatus("GitHub Actions workflow should trigger shortly to process the file.");
                tdfFileInput.value = '';
                githubTokenInput.value = ''; // Consider clearing token on success
            } else { throw new Error(`API responded with status ${status}, but ok was false.`); }
        } catch (error) {
            logStatus(`Upload failed: ${error.message}`, "error");
            if (error.message.includes('401')) logStatus("-> Check PAT validity/scope.", "error");
            else if (error.message.includes('422')) logStatus("-> Unprocessable Entity?", "error");
            else if (error.message.includes('409')) logStatus("-> Conflict? Try again.", "error");
            else if (error.message.includes('API rate limit')) logStatus("-> API rate limit hit.", "error");
        } finally {
            uploadButton.disabled = false; checkUploadFormState();
        }
    });


    // --- Delete Logic (REVISED - Deletes files, then triggers delete workflow) ---
    deleteForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const selectedSlug = deleteSelect.value;
        const token = githubTokenDeleteInput.value.trim();

        if (!selectedSlug || !token) {
            logStatus("Please select tournament and enter PAT for deletion.", "error");
            return;
        }

        const tournamentName = deleteSelect.options[deleteSelect.selectedIndex].text;
        // Updated confirmation dialog
        if (!window.confirm(`ARE YOU SURE you want to permanently delete the files for tournament "${tournamentName}" (${selectedSlug}) AND trigger the homepage link removal?\n\nThis CANNOT be undone.`)) {
            logStatus("Deletion cancelled.", "info");
            return;
        }

        deleteButton.disabled = true;
        clearStatus();
        logStatus(`--- Starting Deletion for ${tournamentName} (${selectedSlug}) ---`);
        let fileDeletionSuccess = false; // Flag to track if file deletion was successful

        try {
            // --- Step 1: Delete Tournament Files ---
            logStatus("Step 1: Deleting tournament files...");
            const filesToDeletePaths = [
                `${selectedSlug}/index.html`,
                `${selectedSlug}/data/tournament_data.xml`
            ];
            let filesActuallyDeleted = 0;
            let filesSkippedNotFound = 0;
            const deletePromises = [];

            for (const filePath of filesToDeletePaths) {
                const fileContentEndpoint = `/repos/${repoOwner}/${repoName}/contents/${filePath}?ref=${targetBranch}`;
                logStatus(`Checking for file: ${filePath}...`);
                try {
                    const { ok, data: fileData, status } = await githubApiRequest(fileContentEndpoint, token, { method: 'GET' });
                    if (ok && fileData && fileData.sha) {
                        logStatus(`File found. Attempting to delete ${filePath}...`);
                        const deleteEndpoint = `/repos/${repoOwner}/${repoName}/contents/${filePath}`;
                        deletePromises.push(
                            githubApiRequest(deleteEndpoint, token, {
                                method: 'DELETE',
                                body: { message: `Delete file: ${filePath}`, sha: fileData.sha, branch: targetBranch }
                            }).then(deleteResult => {
                                if(deleteResult.ok) { logStatus(`Successfully deleted ${filePath}.`); filesActuallyDeleted++; }
                                return deleteResult;
                            }).catch(deleteError => {
                                logStatus(`Error during deletion of ${filePath}: ${deleteError.message}`, "error");
                                return { ok: false, path: filePath };
                            })
                        );
                    } else if (status === 404) {
                         logStatus(`File ${filePath} not found. Skipping.`, "info");
                         filesSkippedNotFound++;
                         deletePromises.push(Promise.resolve({ ok: true, path: filePath, skipped: true }));
                    } else {
                         logStatus(`Could not get info for ${filePath} (Status: ${status}). Cannot delete.`, "warning");
                         deletePromises.push(Promise.resolve({ ok: false, path: filePath }));
                    }
                } catch (getFileError) {
                     logStatus(`Error checking file ${filePath}: ${getFileError.message}`, "error");
                     deletePromises.push(Promise.resolve({ ok: false, path: filePath }));
                }
            }

            const deleteResults = await Promise.all(deletePromises);
            const failedDeletes = deleteResults.filter(res => !res.ok);

            if (failedDeletes.length > 0) {
                const failedPaths = failedDeletes.map(f => f.path).join(', ');
                logStatus(`Could not delete all expected tournament files: ${failedPaths}.`, "error");
                throw new Error(`Failed to delete some tournament files: ${failedPaths}. Aborting before triggering link removal.`);
            }

            // Report file deletion status
            if (filesActuallyDeleted > 0) logStatus(`Successfully deleted ${filesActuallyDeleted} file(s).`, "success");
            else if (filesSkippedNotFound > 0) logStatus(`All expected files were already absent or skipped.`, "info");
            else logStatus("No files were deleted, but no errors occurred.", "warning");

            fileDeletionSuccess = true; // Mark file deletion as successful

            // --- Step 2: Trigger the Delete Link Workflow ---
            logStatus("Step 2: Triggering workflow to remove homepage link...");
            const dispatchEndpoint = `/repos/${repoOwner}/${repoName}/dispatches`;
            const dispatchPayload = {
                event_type: deleteLinkWorkflowEventType, // Custom event type
                client_payload: { // Data to send to the workflow
                    slug: selectedSlug
                }
            };

            const { ok: dispatchOk, status: dispatchStatus } = await githubApiRequest(dispatchEndpoint, token, {
                method: 'POST',
                body: dispatchPayload // API helper stringifies this
            });

            if (dispatchOk && dispatchStatus === 204) { // 204 No Content is success for dispatch
                logStatus(`Successfully triggered '${deleteLinkWorkflowEventType}' workflow.`, "success");
                logStatus("Homepage link removal may take a minute to process via GitHub Actions.");
            } else {
                // Handle dispatch failure
                logStatus(`Failed to trigger link deletion workflow (Status: ${dispatchStatus}).`, "error");
                logStatus("Files were deleted, but the homepage link might remain. Manual removal or next upload needed.", "warning");
                // Consider this a partial failure, maybe don't clear token?
                throw new Error(`Failed to trigger ${deleteLinkWorkflowEventType} workflow.`);
            }

            // --- Final Success ---
            logStatus(`--- Deletion process for ${tournamentName} completed successfully! ---`, "success");
            githubTokenDeleteInput.value = ''; // Clear token only on full success
            await fetchTournamentsAndPopulateDropdown(); // Refresh list

        } catch (error) {
            logStatus(`Deletion process encountered an error: ${error.message}`, "error");
            if (error.message.includes('401')) logStatus("-> Check PAT validity/scope.", "error");
            if (error.message.includes('409')) logStatus("-> Conflict error? Try again.", "error");
            if (error.message.includes('API rate limit')) logStatus("-> API rate limit hit.", "error");
             // Do not clear token or refresh list if there was a failure
             // Log advice based on which step failed
             if (!fileDeletionSuccess) {
                 logStatus("-> File deletion failed. No workflow was triggered.", "info");
             } else {
                 logStatus("-> Link removal workflow trigger failed after file deletion.", "info");
             }
        } finally {
             deleteButton.disabled = false; // Always re-enable button
             checkDeleteFormState();
        }
    });

    // --- Initial Setup ---
    githubTokenInput.addEventListener('input', () => { checkUploadFormState(); fetchTournamentsAndPopulateDropdown(); });
    githubTokenDeleteInput.addEventListener('input', () => { checkDeleteFormState(); fetchTournamentsAndPopulateDropdown(); });
    tdfFileInput.addEventListener('change', checkUploadFormState);
    deleteSelect.addEventListener('change', checkDeleteFormState);
    checkUploadFormState();
    checkDeleteFormState();
    if (githubTokenInput.value.trim() || githubTokenDeleteInput.value.trim()) { fetchTournamentsAndPopulateDropdown(); }
    else { deleteSelect.innerHTML = '<option value="" disabled selected>Enter PAT to load list</option>'; }

}); // End of DOMContentLoaded
