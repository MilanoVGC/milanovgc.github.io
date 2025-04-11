// Wait for the HTML document to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const repoOwner = 'MilanoVGC';
    const repoName = 'milanovgc.github.io';
    const targetBranch = 'main';
    const targetFolder = 'incoming'; // For uploads
    // REMOVED: const rootIndexPath = 'index.html'; // No longer modifying index.html directly here
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
        statusBox.appendChild(entry);
        statusBox.scrollTop = statusBox.scrollHeight;
    }

    function clearStatus() {
        statusBox.innerHTML = '';
    }

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                // result contains the Data URL "data:*;base64,base64String"
                // We only need the base64String part after the comma
                const base64String = reader.result.split(',')[1];
                resolve(base64String);
            };
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(file);
        });
    }
    // REMOVED: Base64 encode/decode helpers for HTML - not needed anymore here

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
            "Accept": "application/vnd.github.v3+json",
        };
        if (options.body) {
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

        // Handle file not found specifically for GET requests
        if (options.method === 'GET' && endpoint.includes('/contents/') && response.status === 404) {
            return { ok: false, status: 404, data: null, message: 'File not found (404)' };
        }

        // Handle successful deletion (200 OK or 204 No Content)
        if (options.method === 'DELETE' && (response.status === 200 || response.status === 204)) {
            return { ok: true, status: response.status, data: null }; // Return null data on successful delete
        }

        let data = null;
        try {
            // Don't try to parse JSON for 204 No Content responses
            if (response.status !== 204) {
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    data = await response.json();
                } else {
                    // Could potentially read as text if needed: await response.text();
                    // console.log("Received non-JSON response");
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
            // Use message from JSON response if available, otherwise use statusText
            const errorMessage = data?.message || response.statusText || `Request failed with status ${response.status}`;
            console.error("API Error Response Body:", data); // Log the full error structure if available
            throw new Error(errorMessage);
        }

        return { ok: true, status: response.status, data };
    }


    // --- Populate Tournament Delete Dropdown (using API) ---
    async function fetchTournamentsAndPopulateDropdown() {
        deleteSelect.disabled = true;
        deleteSelect.innerHTML = '<option value="" disabled selected>Loading tournaments...</option>';

        let token = githubTokenInput.value.trim();
        if (!token) {
            token = githubTokenDeleteInput.value.trim();
        }

        if (!token) {
            deleteSelect.innerHTML = '<option value="" disabled selected>Enter PAT above to load</option>';
            checkDeleteFormState();
            return;
        }

        try {
            const rootContentsEndpoint = `/repos/${repoOwner}/${repoName}/contents/?ref=${targetBranch}`;
            const { ok, data: rootContents, message: errMsg } = await githubApiRequest(rootContentsEndpoint, token, { method: 'GET' });

            if (!ok) {
                throw new Error(errMsg || "Could not fetch repository contents.");
            }
            if (!Array.isArray(rootContents)) {
                console.warn("Received unexpected data format for root contents:", rootContents);
                throw new Error("Unexpected data format received when fetching repository contents.");
            }

            // Define folders/files to exclude from the list
            const excludeItems = ['.git', '.github', 'assets', 'incoming', 'data', 'README.md', 'index.html', 'admin_upload.html', '.gitignore', '_config.yml']; // Add common root files
            const tournamentFolders = rootContents.filter(item =>
                item.type === 'dir' && !excludeItems.includes(item.name) && !item.name.startsWith('_') && !item.name.startsWith('.')
            );

            if (tournamentFolders.length > 0) {
                // Sort alphabetically by folder name
                tournamentFolders.sort((a, b) => a.name.localeCompare(b.name));

                deleteSelect.innerHTML = '<option value="" disabled selected>Select a tournament...</option>';
                tournamentFolders.forEach(t => {
                    const option = document.createElement('option');
                    option.value = t.name; // Use the folder name (slug) as value
                    // Create a display name from the slug
                    let displayName = t.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                    option.textContent = displayName;
                    deleteSelect.appendChild(option);
                });
                deleteSelect.disabled = false;
            } else {
                deleteSelect.innerHTML = '<option value="" disabled selected>No tournament folders found</option>';
            }
        } catch (error) {
            logStatus(`Error loading tournament list via API: ${error.message}`, "error");
            if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                logStatus("-> Check if PAT is valid and has 'repo' scope.", "error");
            } else if (error.message.includes('404')) {
                 logStatus("-> Repository or branch not found. Check config.", "error");
            } else if (error.message.includes('API rate limit exceeded')) {
                 logStatus("-> GitHub API rate limit hit. Please wait.", "error");
            }
            deleteSelect.innerHTML = '<option value="" disabled selected>Error loading list</option>';
        }
        finally {
            checkDeleteFormState();
        }
    }

    // --- Upload Logic ---
    uploadForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        uploadButton.disabled = true;
        clearStatus();
        logStatus("Starting upload process...");

        const token = githubTokenInput.value.trim();
        const file = tdfFileInput.files[0];
        if (!token || !file) {
            logStatus("GitHub PAT and TDF file are required.", "error");
            checkUploadFormState(); // Re-enable button if needed
            return;
        }
        const filename = file.name;
        if (!filename.toLowerCase().endsWith('.tdf')) {
             logStatus("Please select a valid .tdf file.", "error");
             checkUploadFormState();
             return;
        }
        const filePath = `${targetFolder}/${filename}`; // Place in incoming folder

        let encodedContent;
        try {
            logStatus(`Reading file: ${filename}...`);
            encodedContent = await readFileAsBase64(file);
            logStatus("File read successfully.");
        } catch (error) {
            logStatus(`Error reading file: ${error.message}`, "error");
            checkUploadFormState();
            return;
        }

        const endpoint = `/repos/${repoOwner}/${repoName}/contents/${filePath}`;
        const commitMessage = `Upload TDF: ${filename}`;

        try {
            logStatus(`Checking if file exists at '${filePath}'...`);
            let existingFileSha = null;
            try {
                 const { ok, data, status } = await githubApiRequest(endpoint + `?ref=${targetBranch}`, token, { method: 'GET' });
                 if (ok && data?.sha) {
                     existingFileSha = data.sha;
                     logStatus(`File exists (SHA: ${existingFileSha.substring(0,7)}...). Will update.`);
                 } else if (status === 404) {
                     logStatus("File does not exist. Will create.");
                 } else {
                     logStatus(`Could not determine if file exists (Status: ${status}). Proceeding with create/update attempt.`, "warning");
                 }
             } catch (getError) {
                  logStatus(`Error checking for existing file: ${getError.message}. Attempting upload anyway.`, "warning");
             }

            // Prepare request body (includes SHA only if updating)
            const requestBody = {
                message: commitMessage,
                content: encodedContent,
                branch: targetBranch
            };
            if (existingFileSha) {
                requestBody.sha = existingFileSha;
            }

            logStatus(`Uploading file via GitHub API to ${filePath}...`);
            // Use PUT to create or update the file
            const { ok, data: responseData, status } = await githubApiRequest(endpoint, token, {
                method: 'PUT',
                body: JSON.stringify(requestBody)
            });

            if (ok) {
                const action = status === 201 ? 'created' : 'updated'; // 201 Created, 200 OK (updated)
                logStatus(`File successfully ${action} in incoming/ folder! Commit: ${responseData?.commit?.sha || 'N/A'}`, "success");
                logStatus("GitHub Actions workflow should trigger shortly to process the file.");
                tdfFileInput.value = ''; // Clear the file input
            } else {
                 // This case should be handled by githubApiRequest throwing, but as a fallback:
                 throw new Error(`API responded with status ${status}, but ok was false.`);
            }
        } catch (error) {
            logStatus(`Upload failed: ${error.message}`, "error");
            if (error.message.includes('401')) logStatus("-> Check PAT validity and 'repo' scope.", "error");
            else if (error.message.includes('422')) logStatus("-> Unprocessable Entity. File might be too large or content invalid?", "error");
            else if (error.message.includes('409')) logStatus("-> Conflict. Branch may have updated. Try again?", "error");
            else if (error.message.includes('API rate limit exceeded')) logStatus("-> GitHub API rate limit hit. Please wait.", "error");
        }
        finally {
            // Re-enable button and check form state
            checkUploadFormState();
        }
    });


    // --- Delete Logic (REVISED - Only deletes files, doesn't touch index.html) ---
    deleteForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const selectedSlug = deleteSelect.value;
        const token = githubTokenDeleteInput.value.trim();

        if (!selectedSlug || !token) {
            logStatus("Please select tournament and enter PAT for deletion.", "error");
            return;
        }

        const tournamentName = deleteSelect.options[deleteSelect.selectedIndex].text;
        if (!window.confirm(`ARE YOU SURE you want to permanently delete the files for tournament "${tournamentName}" (${selectedSlug})?\n\nThis CANNOT be undone. The link on the homepage will be removed the NEXT time a tournament is uploaded.`)) {
            logStatus("Deletion cancelled.", "info");
            return;
        }

        deleteButton.disabled = true;
        clearStatus();
        logStatus(`--- Starting Deletion for ${tournamentName} (${selectedSlug}) ---`);

        try {
            logStatus("Attempting to delete tournament files...");
            // Define paths for the core files known to exist within the folder
            const filesToDeletePaths = [
                `${selectedSlug}/index.html`,
                `${selectedSlug}/data/tournament_data.xml`
                // Add other specific files if your workflow creates more (e.g., images, specific css/js)
            ];

            let filesActuallyDeleted = 0;
            let filesSkippedNotFound = 0;
            const deletePromises = [];

            for (const filePath of filesToDeletePaths) {
                const fileContentEndpoint = `/repos/${repoOwner}/${repoName}/contents/${filePath}?ref=${targetBranch}`;
                logStatus(`Checking for file: ${filePath}...`);

                try {
                    // Pass the token to the check request
                    const { ok, data: fileData, status } = await githubApiRequest(fileContentEndpoint, token, { method: 'GET' });

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
                                if(deleteResult.ok) {
                                    logStatus(`Successfully deleted ${filePath}.`);
                                    filesActuallyDeleted++;
                                } else {
                                     logStatus(`Failed to delete ${filePath}. Status: ${deleteResult.status}`, "error");
                                }
                                return deleteResult; // Pass result along
                            }).catch(deleteError => {
                                logStatus(`Error during deletion of ${filePath}: ${deleteError.message}`, "error");
                                return { ok: false, path: filePath }; // Mark as failed
                            })
                        );
                    } else if (status === 404) {
                         logStatus(`File ${filePath} not found (already deleted or never existed?). Skipping.`, "info");
                         filesSkippedNotFound++;
                         deletePromises.push(Promise.resolve({ ok: true, path: filePath, skipped: true })); // Treat as success for cleanup purpose
                    } else {
                         logStatus(`Could not get required info (SHA) for ${filePath}. Status: ${status}. Cannot delete.`, "warning");
                         deletePromises.push(Promise.resolve({ ok: false, path: filePath })); // Mark as failed
                    }
                } catch (getFileError) {
                     logStatus(`Error checking file ${filePath}: ${getFileError.message}`, "error");
                     deletePromises.push(Promise.resolve({ ok: false, path: filePath })); // Mark as failed
                }
            } // End for loop

            // Wait for all attempted deletions
            const deleteResults = await Promise.all(deletePromises);
            const failedDeletes = deleteResults.filter(res => !res.ok);

            if (failedDeletes.length > 0) {
                const failedPaths = failedDeletes.map(f => f.path).join(', ');
                logStatus(`Could not delete all expected tournament files: ${failedPaths}. Manual cleanup might be needed.`, "error");
                // Note: Even if some files fail, we proceed to the final message.
                throw new Error(`Failed to delete some tournament files: ${failedPaths}`);
            }

            // Report final status based on results
            if (filesActuallyDeleted > 0) {
                 logStatus(`Successfully deleted ${filesActuallyDeleted} file(s) for tournament ${selectedSlug}.`, "success");
            } else if (filesSkippedNotFound === filesToDeletePaths.length) {
                 logStatus(`All expected files for ${selectedSlug} were already absent.`, "info");
            } else if (filesActuallyDeleted === 0 && filesSkippedNotFound > 0) {
                 logStatus(`No files were deleted, but ${filesSkippedNotFound} expected files were already absent.`, "info");
            } else {
                 // This case should be covered by failedDeletes check, but as a fallback
                 logStatus("Deletion process completed, but no files were successfully deleted or confirmed absent.", "warning");
            }

            // --- REMOVED STEP 2: No direct modification of index.html here ---

            // Inform user about homepage update timing
            logStatus(`Homepage link for '${tournamentName}' will be removed the next time the processing workflow runs (after the next tournament upload).`, "info");
            logStatus(`--- Deletion process for ${tournamentName} completed! ---`, "success");

            // Refresh dropdown and clear token ONLY on full success (no failed deletes)
            githubTokenDeleteInput.value = ''; // Clear token after successful use
            await fetchTournamentsAndPopulateDropdown(); // Refresh list

        } catch (error) {
            // Catch errors from the file deletion loop or other unexpected issues
            logStatus(`Deletion process encountered an error: ${error.message}`, "error");
            if (error.message.includes('401')) logStatus("-> Check PAT validity and scope.", "error");
            if (error.message.includes('409')) logStatus("-> Conflict error? File might have been modified. Try again.", "error");
            if (error.message.includes('API rate limit exceeded')) logStatus("-> GitHub API rate limit hit. Please wait.", "error");
             // Do not clear token or refresh list if there was a failure
        } finally {
             // Always re-enable the button and check state, regardless of success/failure
            checkDeleteFormState();
            deleteButton.disabled = false; // Explicitly re-enable after process finishes
        }
    });

    // --- Initial Setup ---
    // Populate dropdown when either token input changes
    githubTokenInput.addEventListener('input', () => { checkUploadFormState(); fetchTournamentsAndPopulateDropdown(); });
    githubTokenDeleteInput.addEventListener('input', () => { checkDeleteFormState(); fetchTournamentsAndPopulateDropdown(); }); // Also trigger load on delete token input

    tdfFileInput.addEventListener('change', checkUploadFormState);
    deleteSelect.addEventListener('change', checkDeleteFormState);

    // Initial state checks
    checkUploadFormState();
    checkDeleteFormState();

    // Fetch tournaments ONLY if a token is present on load in either field
    if (githubTokenInput.value.trim() || githubTokenDeleteInput.value.trim()) {
        fetchTournamentsAndPopulateDropdown();
    } else {
        deleteSelect.innerHTML = '<option value="" disabled selected>Enter PAT above or below to load</option>';
    }

}); // End of DOMContentLoaded
