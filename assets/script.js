// Wait for the HTML document to be fully loaded before running script
document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Element References ---
    const tournamentNameElement = document.getElementById('tournament-name');
    const tournamentInfoElement = document.getElementById('tournament-info');
    const roundTabsContainer = document.getElementById('round-tabs');
    const pairingsTableBody = document.getElementById('pairings-body');
    const pairingsTable = document.getElementById('pairings-table');
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search-btn'); // Reference for clear button
    const currentRoundTitle = document.getElementById('current-round-title');
    const loadingMessage = document.getElementById('loading-message');

    // Reference the header's inner container for status placement
    const headerContainer = document.querySelector('header .container');
    const updateStatusElement = document.createElement('span');
    updateStatusElement.id = 'update-status';
    if (headerContainer) {
        headerContainer.appendChild(updateStatusElement);
    } else {
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
            const response = await fetch(`${xmlFilePath}?t=${new Date().getTime()}`);
            if (!response.ok) {
                if (response.status === 404) {
                     console.log(`Tournament data file not found at ${xmlFilePath}. Waiting...`);
                     updateStatusElement.textContent = `Waiting for data...`;
                } else {
                    console.error(`HTTP error! status: ${response.status}, file: ${xmlFilePath}`);
                    updateStatusElement.textContent = `Error (${response.status})`;
                }
                updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                return false;
            }
            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");
            const parseError = xmlDoc.querySelector("parsererror");
            if (parseError) {
                console.error("XML Parsing Error:", parseError);
                updateStatusElement.textContent = `Parse Error`;
                updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                if (lastKnownTimeElapsed !== -1) { // Only show error if data loaded before
                    loadingMessage.textContent = "Error parsing updated tournament data. Check console.";
                    loadingMessage.style.display = 'block';
                    loadingMessage.style.color = '#dc3545';
                }
                return false;
            }

            const currentTimeElapsedElement = xmlDoc.querySelector('tournament > timeelapsed');
            const currentTimeElapsed = currentTimeElapsedElement ? parseInt(currentTimeElapsedElement.textContent, 10) : -1;

            if (currentTimeElapsed !== -1 && currentTimeElapsed === lastKnownTimeElapsed) {
                updateStatusElement.textContent = `Up to date`;
                updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                return false; // No change
            }

            console.log("Change detected or initial load. Processing XML...");
            extractData(xmlDoc);
            lastKnownTimeElapsed = currentTimeElapsed;
            return true; // New data processed

        } catch (error) {
            console.error("Error during fetch/parse:", error);
             updateStatusElement.textContent = `Fetch Error`;
             updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
            if (lastKnownTimeElapsed !== -1) {
                 loadingMessage.textContent = `Error loading data: ${error.message}`;
                 loadingMessage.style.display = 'block';
                 loadingMessage.style.color = '#dc3545';
            }
            return false;
        }
    }

    function extractData(xmlDoc) {
        // Extract Tournament Info
        const tournamentData = xmlDoc.querySelector('tournament > data');
        if (tournamentData) {
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
                // Store id along with name details
                tempPlayersData[userId] = { id: userId, firstName, lastName, name: `${firstName} ${lastName}`.trim() };
            }
        });
        playersData = tempPlayersData;

        // Extract Rounds and Matches Info
        const tempRoundsData = [];
        const roundElements = xmlDoc.querySelectorAll('tournament > pods > pod > rounds > round');
        roundElements.forEach(round => {
            const roundNumber = parseInt(round.getAttribute('number'), 10);
            if (isNaN(roundNumber)) {
                 console.warn("Skipping round with invalid number:", round);
                 return; // Skip this round
            }

            const matches = [];
            const matchElements = round.querySelectorAll('matches > match');

            matchElements.forEach(match => {
                const tableNumber = parseInt(match.querySelector('tablenumber')?.textContent || '0', 10);
                const outcome = parseInt(match.getAttribute('outcome'), 10);
                const player1Element = match.querySelector('player1');
                const player2Element = match.querySelector('player2');
                const singlePlayerElement = match.querySelector('player'); // For byes

                let matchData = {
                    table: tableNumber,
                    player1Id: null,
                    player2Id: null,
                    outcome: outcome,
                    isBye: false
                };

                if (outcome === 5 && singlePlayerElement) { // BYE
                    matchData.player1Id = singlePlayerElement.getAttribute('userid');
                    matchData.isBye = true;
                } else if (player1Element && player2Element) { // Normal match
                    matchData.player1Id = player1Element.getAttribute('userid');
                    matchData.player2Id = player2Element.getAttribute('userid');
                } else {
                     console.warn("Skipping malformed match element in round", roundNumber, ":", match);
                     return; // Skip this malformed match
                }
                matches.push(matchData);
            });

            matches.sort((a, b) => a.table - b.table);
            tempRoundsData.push({ roundNumber, matches });
        });

        tempRoundsData.sort((a, b) => a.roundNumber - b.roundNumber);
        roundsData = tempRoundsData;
    }

    function updateUI() {
        if (roundsData.length === 0 && lastKnownTimeElapsed === -1) {
            loadingMessage.textContent = "Waiting for tournament data...";
            loadingMessage.style.display = 'block';
            pairingsTable.style.display = 'none';
            currentRoundTitle.style.display = 'none';
            roundTabsContainer.innerHTML = '';
            return;
        } else if (roundsData.length === 0 && lastKnownTimeElapsed !== -1) {
             loadingMessage.textContent = "No rounds found in current data.";
             loadingMessage.style.display = 'block';
             pairingsTable.style.display = 'none';
             currentRoundTitle.style.display = 'none';
             roundTabsContainer.innerHTML = '';
             return;
        }

        const latestRoundNumber = roundsData.length > 0 ? roundsData[roundsData.length - 1].roundNumber : 1;
        const currentRoundExists = roundsData.some(r => r.roundNumber === currentRound);
        if (!currentRoundExists || currentRound < 1) {
            currentRound = latestRoundNumber;
        }

        let existingTabs = Array.from(roundTabsContainer.querySelectorAll('button')).map(btn => parseInt(btn.dataset.roundNumber, 10));
        let newRounds = roundsData.map(r => r.roundNumber);

        if (JSON.stringify(existingTabs) !== JSON.stringify(newRounds)) {
            roundTabsContainer.innerHTML = '';
            roundsData.forEach(round => {
                const button = document.createElement('button');
                button.textContent = `Round ${round.roundNumber}`;
                button.dataset.roundNumber = round.roundNumber;
                button.addEventListener('click', () => {
                    currentRound = round.roundNumber;
                    displayRound(currentRound);
                    updateActiveTab();
                    // searchInput.value = ''; // <<-- REMOVED Line to keep search term
                    filterTable(); // Re-apply filter on existing term
                });
                roundTabsContainer.appendChild(button);
            });
        }

        displayRound(currentRound);
        updateActiveTab();
        loadingMessage.style.display = 'none';
        pairingsTable.style.display = 'table';
        currentRoundTitle.style.display = 'block';
        filterTable(); // Apply filter on UI update
        updateStatusElement.textContent = `Updated`;
        updateStatusElement.title = `Last update: ${new Date().toLocaleTimeString()}`;
    }

    function getPlayerScoreBeforeRound(playerId, targetRoundNumber) {
        let wins = 0;
        let losses = 0;

        if (!playerId) return { wins, losses };

        for (const pastRound of roundsData) {
            if (pastRound.roundNumber >= targetRoundNumber) {
                continue;
            }

            for (const match of pastRound.matches) {
                if (match.isBye && match.player1Id === playerId) {
                    wins++;
                    continue;
                }

                if (match.player1Id === playerId) {
                    if (match.outcome === 1) wins++;
                    else if (match.outcome === 2) losses++;
                    else if (match.outcome === 4) losses++;
                    continue;
                }

                if (match.player2Id === playerId) {
                    if (match.outcome === 2) wins++;
                    else if (match.outcome === 1) losses++;
                    else if (match.outcome === 4) losses++;
                    continue;
                }
            }
        }
        return { wins, losses };
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
        pairingsTableBody.innerHTML = '';

        if (round.matches.length === 0) {
             pairingsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: #6c757d;">No matches reported for this round yet.</td></tr>';
             return;
        }

        round.matches.forEach(match => {
            const row = pairingsTableBody.insertRow();

            const player1Info = playersData[match.player1Id] || { name: `Unknown (${match.player1Id})` };
            const player2Info = match.isBye ? { name: "BYE" } : (playersData[match.player2Id] || { name: `Unknown (${match.player2Id})` });

            const scoreP1 = getPlayerScoreBeforeRound(match.player1Id, roundNumber);
            const scoreP2 = match.isBye ? { wins: 0, losses: 0 } : getPlayerScoreBeforeRound(match.player2Id, roundNumber);

            const player1DisplayText = `${player1Info.name} (${scoreP1.wins}-${scoreP1.losses})`;
            const player2DisplayText = match.isBye ? player2Info.name : `${player2Info.name} (${scoreP2.wins}-${scoreP2.losses})`;

            row.dataset.player1Name = player1Info.name.toLowerCase();
            row.dataset.player2Name = match.isBye ? 'bye' : player2Info.name.toLowerCase();

            const cellTable = row.insertCell();
            cellTable.textContent = match.table === 0 ? "N/A" : match.table;

            const cellP1 = row.insertCell();
            if (match.outcome === 1) {
                cellP1.innerHTML = `<span class="winner">${player1DisplayText}</span>`;
            } else {
                cellP1.textContent = player1DisplayText;
            }

            const cellP2 = row.insertCell();
             if (match.isBye) {
                 cellP2.textContent = player2DisplayText;
                 cellP2.style.color = '#6c757d';
             } else {
                if (match.outcome === 2) {
                    cellP2.innerHTML = `<span class="winner">${player2DisplayText}</span>`;
                } else {
                    cellP2.textContent = player2DisplayText;
                }
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
            if (row.cells.length === 1 && row.cells[0].colSpan === 3) {
                 row.classList.remove('hidden-row');
                 visibleRows++;
                 return;
             }

            const p1Name = row.dataset.player1Name || '';
            const p2Name = row.dataset.player2Name || '';

            if (!searchTerm || p1Name.includes(searchTerm) || (p2Name && p2Name.includes(searchTerm))) {
                row.classList.remove('hidden-row');
                visibleRows++;
            } else {
                row.classList.add('hidden-row');
            }
        });

         const noResultsMessage = document.getElementById('no-search-results');
         if(noResultsMessage) {
            noResultsMessage.style.display = (visibleRows === 0 && searchTerm) ? 'block' : 'none';
         }
    }

    // Helper Function for Clear Button Visibility
    function checkClearButtonVisibility() {
        if (!clearSearchBtn) return; // Guard if button doesn't exist
        if (searchInput.value.length > 0) {
            clearSearchBtn.style.display = 'inline-block'; // Show button
        } else {
            clearSearchBtn.style.display = 'none'; // Hide button
        }
    }

    async function checkForUpdates() {
        updateStatusElement.textContent = `Checking...`;
        updateStatusElement.title = `Checking at: ${new Date().toLocaleTimeString()}`;
        const newDataProcessed = await loadTournamentData();
        if (newDataProcessed) {
            console.log("New data processed, updating UI.");
            updateUI();
        }
    }

    async function initialize() {
        updateStatusElement.textContent = `Loading...`;
        await loadTournamentData();
        updateUI();

        // Initial state for clear button
        checkClearButtonVisibility();

        if (updateIntervalId) clearInterval(updateIntervalId);
        updateIntervalId = setInterval(checkForUpdates, refreshInterval);
        console.log(`Started checking for updates every ${refreshInterval / 1000} seconds.`);
    }

    // --- Event Listeners ---
    searchInput.addEventListener('input', () => {
        filterTable();
        checkClearButtonVisibility(); // Check visibility on input change
    });

    // Add listener for the clear button
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = ''; // Clear the input
            filterTable();          // Re-apply filter (show all rows)
            checkClearButtonVisibility(); // Hide the button
            searchInput.focus();      // Optional: put focus back in search bar
        });
    }

    // --- Initialisation ---
    initialize(); // Start the process

}); // End of DOMContentLoaded
