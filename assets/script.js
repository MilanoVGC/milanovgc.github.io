// Wait for the HTML document to be fully loaded before running script
document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Element References ---
    const tournamentNameElement = document.getElementById('tournament-name');
    const tournamentInfoElement = document.getElementById('tournament-info');
    const roundTabsContainer = document.getElementById('round-tabs');
    const pairingsTableBody = document.getElementById('pairings-body');
    const pairingsTable = document.getElementById('pairings-table');
    const searchInput = document.getElementById('search-input');
    const currentRoundTitle = document.getElementById('current-round-title');
    const loadingMessage = document.getElementById('loading-message');

    // Reference the header's inner container for status placement
    const headerContainer = document.querySelector('header .container');
    const updateStatusElement = document.createElement('span');
    updateStatusElement.id = 'update-status';
    if (headerContainer) {
        headerContainer.appendChild(updateStatusElement);
    } else {
        // Fallback: append to header directly if container isn't found
        document.querySelector('header')?.appendChild(updateStatusElement);
    }

    // --- Global Data Storage ---
    let playersData = {};
    let roundsData = [];
    let currentRound = 1;
    let lastKnownTimeElapsed = -1;
    let updateIntervalId = null;

    // --- Configuration ---
    const xmlFilePath = 'data/tournament_data.xml'; // Path relative to the HTML loading this script
    const refreshInterval = 15000; // 15 seconds

    // --- Core Functions ---

    async function loadTournamentData() {
        try {
            // Fetch with cache buster
            const response = await fetch(`${xmlFilePath}?t=${new Date().getTime()}`);

            if (!response.ok) {
                // Handle errors gracefully during updates
                if (response.status === 404) {
                     console.log(`Tournament data file not found at ${xmlFilePath}. Waiting...`);
                     updateStatusElement.textContent = `Waiting for data...`;
                } else {
                    console.error(`HTTP error! status: ${response.status}, file: ${xmlFilePath}`);
                    updateStatusElement.textContent = `Error (${response.status})`;
                }
                updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                return false; // Indicate no new data processed
            }
            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");

            // Check for XML parsing errors
            const parseError = xmlDoc.querySelector("parsererror");
            if (parseError) {
                console.error("XML Parsing Error:", parseError);
                if (lastKnownTimeElapsed !== -1) {
                    loadingMessage.textContent = "Error parsing updated tournament data. Check console.";
                    loadingMessage.style.display = 'block';
                    loadingMessage.style.color = '#dc3545';
                }
                updateStatusElement.textContent = `Parse Error`;
                updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                return false;
            }

            // Check timeelapsed for changes
            const currentTimeElapsedElement = xmlDoc.querySelector('tournament > timeelapsed');
            const currentTimeElapsed = currentTimeElapsedElement ? parseInt(currentTimeElapsedElement.textContent, 10) : -1;

            if (currentTimeElapsed !== -1 && currentTimeElapsed === lastKnownTimeElapsed) {
                // Data is the same, no need to re-process fully
                updateStatusElement.textContent = `Up to date`;
                updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                return false;
            }

            // If we are here, it's either the first load or the timeelapsed has changed
            console.log("Change detected or initial load. Processing XML...");
            extractData(xmlDoc); // Process the potentially new XML

            lastKnownTimeElapsed = currentTimeElapsed; // Update the last known time

            return true; // Indicate new data was processed

        } catch (error) {
            console.error("Error during fetch/parse:", error);
             updateStatusElement.textContent = `Fetch Error`;
             updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
            if (lastKnownTimeElapsed !== -1) { // Only show prominent error if data was loaded before
                 loadingMessage.textContent = `Error loading data: ${error.message}`;
                 loadingMessage.style.display = 'block';
                 loadingMessage.style.color = '#dc3545';
            }
            return false; // Indicate no new data processed
        }
    }

    function extractData(xmlDoc) {
        // Extract Tournament Info (but don't update H1 if Action already set it)
        const tournamentData = xmlDoc.querySelector('tournament > data');
        if (tournamentData) {
            // Update H1 only if it's still the default placeholder from template
            // (The Action now sets the H1 directly in the generated HTML)
            // if (tournamentNameElement.textContent === 'Tournament Pairings') {
            //      const name = tournamentData.querySelector('name')?.textContent || 'Tournament';
            //      tournamentNameElement.textContent = name;
            // }
            const city = tournamentData.querySelector('city')?.textContent;
            const country = tournamentData.querySelector('country')?.textContent;
            tournamentInfoElement.textContent = `${city ? city + ', ' : ''}${country || ''}`.trim();
        }

        // Extract Player Info
        const tempPlayersData = {};
        const playerElements = xmlDoc.querySelectorAll('tournament > players > player');
        playerElements.forEach(player => {
            const userId = player.getAttribute('userid');
            const firstName = player.querySelector('firstname')?.textContent || '';
            const lastName = player.querySelector('lastname')?.textContent || '';
            if (userId) {
                tempPlayersData[userId] = { firstName, lastName, name: `${firstName} ${lastName}`.trim() };
            }
        });
        playersData = tempPlayersData; // Assign once done

        // Extract Rounds and Matches Info
        const tempRoundsData = [];
        // Assuming data is within the first pod for now. Adapt if multiple pods need handling.
        const roundElements = xmlDoc.querySelectorAll('tournament > pods > pod > rounds > round');
        roundElements.forEach(round => {
            const roundNumber = parseInt(round.getAttribute('number'), 10);
            const matches = [];
            const matchElements = round.querySelectorAll('matches > match');

            matchElements.forEach(match => {
                const tableNumber = parseInt(match.querySelector('tablenumber')?.textContent || '0', 10);
                const outcome = parseInt(match.getAttribute('outcome'), 10);
                const player1Element = match.querySelector('player1');
                const player2Element = match.querySelector('player2');
                const singlePlayerElement = match.querySelector('player'); // For byes

                let matchData = { table: tableNumber, player1: null, player2: null, outcome: outcome, isBye: false };

                if (outcome === 5 && singlePlayerElement) {
                    const byePlayerId = singlePlayerElement.getAttribute('userid');
                    matchData.player1 = playersData[byePlayerId] || { name: `Unknown (${byePlayerId})` };
                    matchData.player2 = { name: "BYE" }; // Represent BYE explicitly
                    matchData.isBye = true;
                } else if (player1Element && player2Element) {
                    const p1Id = player1Element.getAttribute('userid');
                    const p2Id = player2Element.getAttribute('userid');
                    matchData.player1 = playersData[p1Id] || { name: `Unknown (${p1Id})` };
                    matchData.player2 = playersData[p2Id] || { name: `Unknown (${p2Id})` };
                    matchData.player1.id = p1Id;
                    matchData.player2.id = p2Id;
                } else {
                     console.warn("Skipping malformed match element in round", roundNumber, ":", match);
                     return; // Skip this malformed match
                }
                matches.push(matchData);
            });

            // Sort matches by table number
            matches.sort((a, b) => a.table - b.table);

            if (!isNaN(roundNumber)) {
                 tempRoundsData.push({ roundNumber, matches });
            } else {
                 console.warn("Skipping round with invalid number:", round);
            }
        });

        // Sort rounds by number
        tempRoundsData.sort((a, b) => a.roundNumber - b.roundNumber);
        roundsData = tempRoundsData; // Assign once done
    }

    function updateUI() {
        // console.log("Updating UI...");
        if (roundsData.length === 0 && lastKnownTimeElapsed === -1) {
            // Still waiting for the very first valid data
            loadingMessage.textContent = "Waiting for tournament data...";
            loadingMessage.style.display = 'block'; // Make sure it's visible
            pairingsTable.style.display = 'none';
            currentRoundTitle.style.display = 'none';
            roundTabsContainer.innerHTML = ''; // Clear tabs if no data
            return;
        } else if (roundsData.length === 0 && lastKnownTimeElapsed !== -1) {
            // Data was present before, but now it's empty? (Unlikely but handle)
             loadingMessage.textContent = "No rounds found in current data.";
             loadingMessage.style.display = 'block'; // Make sure it's visible
             pairingsTable.style.display = 'none';
             currentRoundTitle.style.display = 'none';
             roundTabsContainer.innerHTML = '';
             return;
        }

        // Determine the round to display:
        // If the currentRound exists in the new data, keep it.
        // Otherwise, switch to the latest round available in the new data.
        const latestRoundNumber = roundsData[roundsData.length - 1].roundNumber;
        const currentRoundExists = roundsData.some(r => r.roundNumber === currentRound);
        if (!currentRoundExists || currentRound < 1) { // Also handle if currentRound invalid
            currentRound = latestRoundNumber;
        }

        // --- Update Round Tabs ---
        // Only redraw tabs if the number/set of rounds changed
        let existingTabs = Array.from(roundTabsContainer.querySelectorAll('button')).map(btn => parseInt(btn.dataset.roundNumber, 10));
        let newRounds = roundsData.map(r => r.roundNumber);

        if (JSON.stringify(existingTabs) !== JSON.stringify(newRounds)) {
            roundTabsContainer.innerHTML = ''; // Clear existing tabs
            roundsData.forEach(round => {
                const button = document.createElement('button');
                button.textContent = `Round ${round.roundNumber}`;
                button.dataset.roundNumber = round.roundNumber;
                button.addEventListener('click', () => {
                    currentRound = round.roundNumber;
                    displayRound(currentRound); // Display the selected round
                    updateActiveTab();
                    searchInput.value = ''; // Clear search when changing rounds
                    filterTable(); // Re-apply filter
                });
                roundTabsContainer.appendChild(button);
            });
        }

        // --- Update Table Display ---
        displayRound(currentRound); // Display the (potentially new) current round
        updateActiveTab(); // Ensure correct tab is highlighted
        loadingMessage.style.display = 'none'; // Hide loading message
        pairingsTable.style.display = 'table'; // Show table
        currentRoundTitle.style.display = 'block'; // Show round title

        // Apply existing search filter
        filterTable();

        updateStatusElement.textContent = `Updated`;
        updateStatusElement.title = `Last update: ${new Date().toLocaleTimeString()}`;
    }


    function displayRound(roundNumber) {
        const round = roundsData.find(r => r.roundNumber === roundNumber);
        if (!round) {
            console.error("Round data not found for round:", roundNumber);
            pairingsTableBody.innerHTML = '<tr><td colspan="3">Could not load data for this round.</td></tr>';
            currentRoundTitle.textContent = `Round ${roundNumber} (Error)`;
            return;
        }

        currentRoundTitle.textContent = `Round ${roundNumber} Pairings`;
        pairingsTableBody.innerHTML = ''; // Clear previous pairings

        if (round.matches.length === 0) {
             pairingsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: #6c757d;">No matches reported for this round yet.</td></tr>';
             return;
        }

        round.matches.forEach(match => {
            const row = pairingsTableBody.insertRow();
            // Store player names on row for searching
            row.dataset.player1Name = (match.player1?.name || '').toLowerCase();

            // --- Table Cell ---
            const cellTable = row.insertCell();
            cellTable.textContent = match.table === 0 ? "N/A" : match.table;

            // --- Player 1 Cell ---
            const cellP1 = row.insertCell();
            const player1Name = match.player1?.name || 'Unknown Player';
            if (match.outcome === 1) {
                cellP1.innerHTML = `<span class="winner">${player1Name}</span>`;
            } else {
                cellP1.textContent = player1Name;
            }

            // --- Player 2 Cell ---
            const cellP2 = row.insertCell();
            if (match.isBye) {
                cellP2.textContent = "BYE";
                row.dataset.player2Name = 'bye'; // Store 'bye' for searching
            } else {
                const player2Name = match.player2?.name || 'Unknown Player';
                if (match.outcome === 2) {
                    cellP2.innerHTML = `<span class="winner">${player2Name}</span>`;
                } else {
                    cellP2.textContent = player2Name;
                }
                // Store player 2 name for searching
                row.dataset.player2Name = player2Name.toLowerCase();
            }
        });
    }

    function updateActiveTab() {
        const buttons = roundTabsContainer.querySelectorAll('button');
        buttons.forEach(button => {
            if (parseInt(button.dataset.roundNumber, 10) === currentRound) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }

    function filterTable() {
        const searchTerm = searchInput.value.toLowerCase().trim();
        const rows = pairingsTableBody.querySelectorAll('tr');
        let visibleRows = 0;

        rows.forEach(row => {
            // Check if the row itself is for the "no matches" message
            if (row.cells.length === 1 && row.cells[0].colSpan === 3) {
                 row.classList.remove('hidden-row'); // Always show this message row
                 visibleRows++;
                 return; // Skip filtering for this row
             }

            const p1Name = row.dataset.player1Name || '';
            const p2Name = row.dataset.player2Name || '';

            // Match if search term is empty or found in either player name
            if (!searchTerm || p1Name.includes(searchTerm) || (p2Name && p2Name.includes(searchTerm))) {
                row.classList.remove('hidden-row');
                visibleRows++;
            } else {
                row.classList.add('hidden-row');
            }
        });

         // Optional: Show a message if the search yields no results
         const noResultsMessage = document.getElementById('no-search-results');
         if(noResultsMessage) {
            noResultsMessage.style.display = (visibleRows === 0 && searchTerm) ? 'block' : 'none';
         }
    }

    // Function to check for updates periodically
    async function checkForUpdates() {
        // console.log("Checking for updates...");
        updateStatusElement.textContent = `Checking...`;
        updateStatusElement.title = `Checking at: ${new Date().toLocaleTimeString()}`;
        const newDataProcessed = await loadTournamentData();
        if (newDataProcessed) {
            console.log("New data processed, updating UI.");
            updateUI();
        }
    }

    // --- Initialisation ---
    async function initialize() {
        updateStatusElement.textContent = `Loading...`;
        const initialDataLoaded = await loadTournamentData();
        // Attempt initial UI setup regardless (handles "waiting" state)
        updateUI();

        // Start the update interval *after* the first attempt
        if (updateIntervalId) clearInterval(updateIntervalId); // Clear any previous interval just in case
        updateIntervalId = setInterval(checkForUpdates, refreshInterval);
        console.log(`Started checking for updates every ${refreshInterval / 1000} seconds.`);
    }

    // --- Event Listeners ---
    searchInput.addEventListener('input', filterTable);

    // --- Initialisation ---
    initialize(); // Start the process

}); // End of DOMContentLoaded
