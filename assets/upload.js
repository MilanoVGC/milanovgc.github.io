document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const repoOwner = 'MilanoVGC'; // <-- !!! REPLACE with your GitHub username or org name
    const repoName = 'milanovgc.github.io';           // <-- !!! REPLACE with your repository name
    const targetBranch = 'main';             // Branch to commit to (main or master)
    const targetFolder = 'incoming';         // Folder within the repo
    // --- END CONFIGURATION ---

    const uploadForm = document.getElementById('uploadForm');
    const githubTokenInput = document.getElementById('githubToken');
    const tdfFileInput = document.getElementById('tdfFile');
    const uploadButton = document.getElementById('uploadButton');
    const statusBox = document.getElementById('status');

    // Simple validation to enable button
    function checkFormState() {
        if (githubTokenInput.value.trim() && tdfFileInput.files.length > 0) {
            uploadButton.disabled = false;
        } else {
            uploadButton.disabled = true;
        }
    }

    githubTokenInput.addEventListener('input', checkFormState);
    tdfFileInput.addEventListener('change', checkFormState);

    // Handle form submission
    uploadForm.addEventListener('submit', async (event) => {
        event.preventDefault(); // Prevent default form submission
        uploadButton.disabled = true;
        clearStatus();
        logStatus("Starting upload process...");

        const token = githubTokenInput.value.trim();
        const file = tdfFileInput.files[0];
        const filename = file.name;
        const filePath = `${targetFolder}/${filename}`; // Path within the repo

        if (!token) {
            logStatus("GitHub PAT is required.", "error");
            checkFormState(); // Re-enable button if needed
            return;
        }
        if (!file) {
            logStatus("No file selected.", "error");
            checkFormState();
            return;
        }
        if (!filename.toLowerCase().endsWith('.tdf')) {
             logStatus("Selected file must be a .tdf file.", "error");
             tdfFileInput.value = ''; // Clear invalid selection
             checkFormState();
             return;
        }

        // 1. Read file content as Base64
        let encodedContent;
        try {
            logStatus(`Reading file: ${filename}...`);
            encodedContent = await readFileAsBase64(file);
            logStatus("File read and encoded.");
        } catch (error) {
            logStatus(`Error reading file: ${error.message}`, "error");
            checkFormState();
            return;
        }

        // 2. Prepare API request details
        const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}`;
        const headers = {
            "Authorization": `token ${token}`,
            "Accept": "application/vnd.github.v3+json",
        };
        const commitMessage = `API Upload: ${filename}`;

        // 3. Check if file exists (to get SHA for update)
        let existingFileSha = null;
        try {
            logStatus(`Checking if file exists at '${filePath}'...`);
            const responseGet = await fetch(`${apiUrl}?ref=${targetBranch}`, { headers });

            if (responseGet.ok) {
                const data = await responseGet.json();
                existingFileSha = data.sha;
                logStatus(`File exists. Will update (SHA: ${existingFileSha}).`);
            } else if (responseGet.status === 404) {
                logStatus("File does not exist. Will create new file.");
            } else {
                 const errorData = await responseGet.json();
                 throw new Error(`Failed to check file: ${responseGet.status} - ${errorData.message || 'Unknown error'}`);
            }
        } catch (error) {
             logStatus(`Error checking file existence: ${error.message}`, "error");
             if (error.message.includes('401')) logStatus("-> Check if PAT is correct and has 'repo' scope.", "error");
             if (error.message.includes('404')) logStatus(`-> Check if owner ('${repoOwner}') or repo ('${repoName}') are correct.`, "error");
             checkFormState();
             return;
        }

        // 4. Prepare PUT request body
        const requestBody = {
            message: commitMessage,
            content: encodedContent,
            branch: targetBranch,
        };
        if (existingFileSha) {
            requestBody.sha = existingFileSha; // Required for update
        }

        // 5. Make the PUT request to create/update
        try {
            logStatus(`Uploading file via GitHub API...`);
            const responsePut = await fetch(apiUrl, {
                method: 'PUT',
                headers: {
                    ...headers,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            const responseData = await responsePut.json();

            if (responsePut.ok) {
                const action = responsePut.status === 201 ? 'created' : 'updated';
                const commitSha = responseData.commit?.sha || 'N/A';
                logStatus(`File successfully ${action}! Commit SHA: ${commitSha}`, "success");
                logStatus("GitHub Actions workflow should be triggered shortly.");
                // Optionally clear the form
                // tdfFileInput.value = '';
                // githubTokenInput.value = ''; // Maybe don't clear token?
            } else {
                 throw new Error(`${responsePut.status} - ${responseData.message || 'Upload failed'}`);
            }
        } catch (error) {
             logStatus(`Upload failed: ${error.message}`, "error");
             if (error.message.includes('401')) logStatus("-> Check if PAT is correct and has 'repo' scope.", "error");
             if (error.message.includes('404')) logStatus(`-> Check if owner ('${repoOwner}'), repo ('${repoName}'), or branch ('${targetBranch}') are correct.`, "error");
             if (error.message.includes('422')) logStatus("-> API validation error. Check request details.", "error");
             if (error.message.includes('409')) logStatus("-> Conflict. Branch may have changed. Try again.", "error");
        } finally {
            // Re-enable button regardless of outcome, allowing retry
             checkFormState();
        }
    });

    // --- Helper Functions ---
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
        statusBox.scrollTop = statusBox.scrollHeight; // Scroll to bottom
    }

    function clearStatus() {
        statusBox.innerHTML = '';
    }

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                // result contains the data: URL (e.g., data:text/plain;base64,MQ==)
                // We only want the Base64 part after the comma
                const base64String = reader.result.split(',')[1];
                resolve(base64String);
            };
            reader.onerror = (error) => {
                reject(error);
            };
            reader.readAsDataURL(file); // Reads the file content and encodes it as Base64
        });
    }

    // Initial check
    checkFormState();
});
