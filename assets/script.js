// Wait for the HTML document to be fully loaded before running script
document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Element References ---
    const tournamentNameElement = document.getElementById('tournament-name');
    const tournamentInfoElement = document.getElementById('tournament-info');
    const roundTabsContainer = document.getElementById('round-tabs');
    const pairingsTableBody = document.getElementById('pairings-body');
    const pairingsTable = document.getElementById('pairings-table');
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const currentRoundTitle = document.getElementById('current-round-title');
    const loadingMessage = document.getElementById('loading-message');
    // Standings elements
    const standingsContainer = document.getElementById('standings-container');
    const standingsTableBody = document.getElementById('standings-body');
    const standingsLoadingMsg = document.getElementById('standings-loading-message');
    const noStandingsMsg = document.getElementById('no-standings-message');

    const headerContainer = document.querySelector('header .container');
    const updateStatusElement = document.createElement('span');
    updateStatusElement.id = 'update-status';
    if (headerContainer) headerContainer.appendChild(updateStatusElement);
    else document.querySelector('header')?.appendChild(updateStatusElement);

    // --- Global Data Storage ---
    let playersData = {}; // Stores { id: { id, name, firstName, lastName } }
    let roundsData = []; // Stores { roundNumber, type, matches: [{...}] }
    let currentRound = 1;
    let lastKnownTimeElapsed = -1;
    let updateIntervalId = null;
    let standingsCache = {}; // Cache for calculated standings data

    // --- Configuration ---
    const xmlFilePath = 'data/tournament_data.xml';
    const refreshInterval = 15000;
    const OWP_MINIMUM = 0.33; // Minimum opponent win percentage (33%)

    // --- Core Functions ---

    async function loadTournamentData() {
        console.log("loadTournamentData: Starting fetch..."); // DEBUG
        try {
            const response = await fetch(`${xmlFilePath}?t=${new Date().getTime()}`);
            console.log(`loadTournamentData: Fetch status: ${response.status}`); // DEBUG
            if (!response.ok) {
                 if (response.status === 404) { console.log(`Tournament data file not found at ${xmlFilePath}. Waiting...`); updateStatusElement.textContent = `Waiting for data...`; }
                 else { console.error(`HTTP error! status: ${response.status}, file: ${xmlFilePath}`); updateStatusElement.textContent = `Error (${response.status})`; }
                 updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`; return false;
            }
            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");
            const parseError = xmlDoc.querySelector("parsererror");
            if (parseError) {
                console.error("XML Parsing Error:", parseError.textContent); // DEBUG: Log content of error
                updateStatusElement.textContent = `Parse Error`; updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                if (lastKnownTimeElapsed !== -1) { loadingMessage.textContent = "Error parsing updated tournament data. Check console."; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545'; }
                return false;
            }
            console.log("loadTournamentData: XML parsed successfully."); // DEBUG

            const currentTimeElapsedElement = xmlDoc.querySelector('tournament > timeelapsed');
            const currentTimeElapsed = currentTimeElapsedElement ? parseInt(currentTimeElapsedElement.textContent, 10) : -1;

            if (currentTimeElapsed !== -1 && currentTimeElapsed === lastKnownTimeElapsed) {
                console.log("loadTournamentData: No change detected (timeelapsed)."); // DEBUG
                updateStatusElement.textContent = `Up to date`; updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                return false; // No change
            }

            console.log("loadTournamentData: Change detected or initial load. Processing XML...");
            extractData(xmlDoc); // Extract data
            lastKnownTimeElapsed = currentTimeElapsed;
            standingsCache = {}; // Clear standings cache on new data
            console.log("loadTournamentData: Data extracted, cache cleared."); // DEBUG
            return true; // New data processed

        } catch (error) {
             console.error("loadTournamentData: Error during fetch/parse:", error); // DEBUG
             updateStatusElement.textContent = `Fetch Error`; updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
             if (lastKnownTimeElapsed !== -1) { loadingMessage.textContent = `Error loading data: ${error.message}`; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545'; }
             return false;
        }
    }

    function extractData(xmlDoc) {
        console.log("extractData: Starting extraction..."); // DEBUG
        try {
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
                    tempPlayersData[userId] = { id: userId, firstName, lastName, name: `${firstName} ${lastName}`.trim() };
                }
            });
            playersData = tempPlayersData;
            console.log(`extractData: Extracted ${Object.keys(playersData).length} players.`); // DEBUG

            // Extract Rounds and Matches Info
            const tempRoundsData = [];
            const roundElements = xmlDoc.querySelectorAll('tournament > pods > pod > rounds > round');
            roundElements.forEach((round, roundIndex) => { // DEBUG: Added index
                const roundNumber = parseInt(round.getAttribute('number'), 10);
                const roundType = round.getAttribute('type');

                if (isNaN(roundNumber)) { console.warn(`extractData: Skipping round at index ${roundIndex} with invalid number:`, round); return; }

                const matches = [];
                const matchElements = round.querySelectorAll('matches > match');
                matchElements.forEach((match, matchIndex) => { // DEBUG: Added index
                    const tableNumber = parseInt(match.querySelector('tablenumber')?.textContent || '0', 10);
                    const outcome = parseInt(match.getAttribute('outcome'), 10);
                    const player1Element = match.querySelector('player1');
                    const player2Element = match.querySelector('player2');
                    const singlePlayerElement = match.querySelector('player');

                    let matchData = { table: tableNumber, player1Id: null, player2Id: null, outcome: outcome, isBye: false };

                    if (outcome === 5 && singlePlayerElement) {
                        matchData.player1Id = singlePlayerElement.getAttribute('userid');
                        matchData.isBye = true;
                    } else if (player1Element && player2Element) {
                        matchData.player1Id = player1Element.getAttribute('userid');
                        matchData.player2Id = player2Element.getAttribute('userid');
                    } else {
                         console.warn(`extractData: Skipping malformed match element in round ${roundNumber} (index ${matchIndex}):`, match);
                         return;
                    }
                    // Basic validation that player IDs exist in our player data
                    if (matchData.player1Id && !playersData[matchData.player1Id]) console.warn(`extractData: Player ID ${matchData.player1Id} from match in round ${roundNumber} not found in players list.`);
                    if (matchData.player2Id && !playersData[matchData.player2Id]) console.warn(`extractData: Player ID ${matchData.player2Id} from match in round ${roundNumber} not found in players list.`);

                    matches.push(matchData);
                });

                matches.sort((a, b) => a.table - b.table);
                tempRoundsData.push({ roundNumber, type: roundType, matches });
            });

            tempRoundsData.sort((a, b) => a.roundNumber - b.roundNumber);
            roundsData = tempRoundsData;
            console.log(`extractData: Extracted ${roundsData.length} rounds.`); // DEBUG
        } catch (error) {
             console.error("extractData: Error during extraction:", error); // DEBUG
             // Optionally, display an error to the user here
             loadingMessage.textContent = `Error processing data structure: ${error.message}. Check console.`;
             loadingMessage.style.display = 'block';
             loadingMessage.style.color = '#dc3545';
             playersData = {}; // Reset data on error
             roundsData = [];
        }
    }

    // --- Standings Calculation Functions ---

    function calculatePlayerSwissRecord(playerId) {
        let wins = 0; let losses = 0; let matchesPlayed = 0;
        if (!playerId) return { wins, losses, matchesPlayed };

        for (const round of roundsData) {
            if (round.type !== "3") continue;
            for (const match of round.matches) {
                let playedInMatch = false;
                if (match.isBye && match.player1Id === playerId) { wins++; playedInMatch = true; }
                else if (match.player1Id === playerId) { playedInMatch = true; if (match.outcome === 1) wins++; else if (match.outcome === 2 || match.outcome === 4) losses++; }
                else if (match.player2Id === playerId) { playedInMatch = true; if (match.outcome === 2) wins++; else if (match.outcome === 1 || match.outcome === 4) losses++; }
                if (playedInMatch) matchesPlayed++;
            }
        }
        return { wins, losses, matchesPlayed };
    }

    function getSwissOpponents(playerId) {
        const opponents = new Set();
        if (!playerId) return [];
        for (const round of roundsData) {
            if (round.type !== "3") continue;
            for (const match of round.matches) {
                if (match.isBye) continue;
                if (match.player1Id === playerId && match.player2Id) opponents.add(match.player2Id);
                else if (match.player2Id === playerId && match.player1Id) opponents.add(match.player1Id);
            }
        }
        return Array.from(opponents);
    }

    function getPlayerSwissWinPercentage(playerId, minPercentage) {
        // Use cached record if available, otherwise calculate fresh (safer)
        const record = (standingsCache[playerId]?.record) ? standingsCache[playerId].record : calculatePlayerSwissRecord(playerId);
        const totalGames = record.wins + record.losses;
        if (totalGames === 0) return 0;
        const winRate = record.wins / totalGames;
        return Math.max(winRate, minPercentage);
    }

    function calculateOWP(playerId, minPercentage) {
        const opponents = getSwissOpponents(playerId);
        if (opponents.length === 0) return 0;
        let totalOpponentWinPercentage = 0;
        opponents.forEach(oppId => {
            totalOpponentWinPercentage += getPlayerSwissWinPercentage(oppId, minPercentage);
        });
        return totalOpponentWinPercentage / opponents.length;
    }

    function calculateOOWP(playerId, minPercentage) {
         const opponents = getSwissOpponents(playerId);
         if (opponents.length === 0) return 0;
         let totalOpponentOWP = 0;
         opponents.forEach(oppId => {
            // Safer check for cached OWP before calculating
            let oppOWP = 0;
             if (standingsCache[oppId] && typeof standingsCache[oppId].owp === 'number') {
                 oppOWP = standingsCache[oppId].owp;
             } else {
                // console.log(`Calculating OWP for opponent ${oppId} (needed by ${playerId})`); // DEBUG - can be noisy
                oppOWP = calculateOWP(oppId, minPercentage);
                // Optionally update cache - might not be needed if pre-calc works
                // if (standingsCache[oppId]) standingsCache[oppId].owp = oppOWP;
             }
             totalOpponentOWP += oppOWP;
         });
         return totalOpponentOWP / opponents.length;
    }

    function calculateSwissStandings() {
        console.log("calculateSwissStandings: Starting calculation..."); // DEBUG
        if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'block';
        if (noStandingsMsg) noStandingsMsg.style.display = 'none';
        standingsCache = {}; // Clear cache
        const standingsData = [];
        let hasSwissRounds = roundsData.some(r => r.type === "3");

        if (!hasSwissRounds) {
            console.log("calculateSwissStandings: No Swiss rounds found."); // DEBUG
            if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
            if (noStandingsMsg) noStandingsMsg.style.display = 'block';
            if (standingsContainer) standingsContainer.style.display = 'block';
            return [];
        }

        console.log("calculateSwissStandings: Pre-calculating records..."); // DEBUG
        for (const playerId in playersData) {
             standingsCache[playerId] = { record: calculatePlayerSwissRecord(playerId) };
        }
        console.log("calculateSwissStandings: Pre-calculating OWP..."); // DEBUG
         for (const playerId in playersData) {
             if (standingsCache[playerId] && standingsCache[playerId].record.matchesPlayed > 0) { // Only calc OWP if they played
                try { // DEBUG: Add try-catch
                    standingsCache[playerId].owp = calculateOWP(playerId, OWP_MINIMUM);
                } catch (error) {
                     console.error(`Error calculating OWP for player ${playerId}:`, error);
                     standingsCache[playerId].owp = 0; // Default on error
                }
             } else if (standingsCache[playerId]) {
                standingsCache[playerId].owp = 0; // Default OWP if no matches played
             }
         }
        console.log("calculateSwissStandings: Calculating OOWP and final list..."); // DEBUG
        for (const playerId in playersData) {
            const playerInfo = playersData[playerId];
            const cachedData = standingsCache[playerId];

            if (cachedData && cachedData.record.matchesPlayed > 0) {
                try { // DEBUG: Add try-catch
                    const oowp = calculateOOWP(playerId, OWP_MINIMUM);
                    standingsData.push({
                        playerInfo: playerInfo,
                        wins: cachedData.record.wins, losses: cachedData.record.losses,
                        owp: cachedData.owp ?? 0, // Use ?? 0 as fallback
                        oowp: oowp
                    });
                } catch (error) {
                    console.error(`Error calculating OOWP for player ${playerId}:`, error);
                     // Optionally add player with default OOWP or skip
                      standingsData.push({
                          playerInfo: playerInfo,
                          wins: cachedData.record.wins, losses: cachedData.record.losses,
                          owp: cachedData.owp ?? 0,
                          oowp: 0 // Default on error
                      });
                }
            }
        }

        console.log(`calculateSwissStandings: Calculation finished for ${standingsData.length} players.`); // DEBUG
        if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
        return standingsData;
    }

    function sortStandings(standingsData) {
        // --- Sorting logic remains the same ---
        return standingsData.sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            if (b.owp !== a.owp) return b.owp - a.owp;
            if (b.oowp !== a.oowp) return b.oowp - a.oowp;
            return a.playerInfo.name.localeCompare(b.playerInfo.name);
        });
    }

    function displayStandings(sortedStandings) {
        console.log("displayStandings: Starting display..."); // DEBUG
        if (!standingsTableBody) { console.error("displayStandings: Standings table body not found!"); return; } // DEBUG Guard
        standingsTableBody.innerHTML = '';

        if (!sortedStandings || sortedStandings.length === 0) {
            console.log("displayStandings: No standings data to display."); // DEBUG
            // Message displayed by calculateSwissStandings if no swiss rounds
            if (standingsContainer) standingsContainer.style.display = roundsData.some(r => r.type === "3") ? 'block' : 'none';
            return;
        }

        if (standingsContainer) standingsContainer.style.display = 'block';

        sortedStandings.forEach((data, index) => {
            try { // DEBUG: Add try-catch per row
                const rank = index + 1;
                const row = standingsTableBody.insertRow();

                const cellRank = row.insertCell(); cellRank.textContent = rank; cellRank.style.textAlign = 'center';
                const cellName = row.insertCell(); cellName.textContent = data.playerInfo?.name || 'Unknown Player'; // Safer access
                const cellRecord = row.insertCell(); cellRecord.textContent = `${data.wins}-${data.losses}`; cellRecord.style.textAlign = 'center';
                const cellOWP = row.insertCell(); cellOWP.textContent = (data.owp * 100).toFixed(2); cellOWP.style.textAlign = 'right';
                const cellOOWP = row.insertCell(); cellOOWP.textContent = (data.oowp * 100).toFixed(2); cellOOWP.style.textAlign = 'right';
            } catch (error) {
                 console.error(`Error displaying standings row ${index+1} for player ${data?.playerInfo?.id}:`, error);
            }
        });
         console.log("displayStandings: Display finished."); // DEBUG
    }

    // --- End Standings Functions ---


    function updateUI() {
        console.log("updateUI: Starting UI update..."); // DEBUG
        // --- Pairings Update Logic ---
        try { // DEBUG: Wrap pairings part
            if (roundsData.length === 0 && lastKnownTimeElapsed === -1) { loadingMessage.textContent = "Waiting for tournament data..."; loadingMessage.style.display = 'block'; pairingsTable.style.display = 'none'; currentRoundTitle.style.display = 'none'; roundTabsContainer.innerHTML = ''; console.log("updateUI: Waiting for initial data."); return; }
            else if (roundsData.length === 0 && lastKnownTimeElapsed !== -1) { loadingMessage.textContent = "No rounds found in current data."; loadingMessage.style.display = 'block'; pairingsTable.style.display = 'none'; currentRoundTitle.style.display = 'none'; roundTabsContainer.innerHTML = ''; console.log("updateUI: No rounds found in data."); return; }

            const latestRoundNumber = roundsData.length > 0 ? roundsData[roundsData.length - 1].roundNumber : 1;
            const currentRoundExists = roundsData.some(r => r.roundNumber === currentRound);
            if (!currentRoundExists || currentRound < 1) { currentRound = latestRoundNumber; }

            let existingTabs = Array.from(roundTabsContainer.querySelectorAll('button')).map(btn => parseInt(btn.dataset.roundNumber, 10));
            let newRounds = roundsData.map(r => r.roundNumber);

            if (JSON.stringify(existingTabs) !== JSON.stringify(newRounds)) {
                roundTabsContainer.innerHTML = '';
                roundsData.forEach(round => {
                    const button = document.createElement('button'); button.textContent = `Round ${round.roundNumber}`; button.dataset.roundNumber = round.roundNumber;
                    button.addEventListener('click', () => { currentRound = round.roundNumber; displayRound(currentRound); updateActiveTab(); filterTable(); });
                    roundTabsContainer.appendChild(button);
                });
                 console.log("updateUI: Round tabs updated."); // DEBUG
            }

            displayRound(currentRound); // <<<<<<<<<<<< Potential error source
            updateActiveTab();
            loadingMessage.style.display = 'none';
            pairingsTable.style.display = 'table';
            currentRoundTitle.style.display = 'block';
            filterTable(); // Apply search filter
            console.log("updateUI: Pairings section updated."); // DEBUG
        } catch (error) {
             console.error("updateUI: Error during pairings update:", error); // DEBUG
             loadingMessage.textContent = `Error displaying pairings: ${error.message}. Check console.`;
             loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545';
             pairingsTable.style.display = 'none'; // Hide broken table
        }

        // --- Standings Update Logic ---
        try { // DEBUG: Wrap standings part
            console.log("updateUI: Starting standings update logic..."); // DEBUG
            const swissRoundsExist = roundsData.some(r => r.type === "3");
            if (swissRoundsExist) {
                const standingsData = calculateSwissStandings(); // <<<<<<< Potential error source
                const sortedStandings = sortStandings(standingsData);
                displayStandings(sortedStandings); // <<<<<<<< Potential error source
            } else {
                 console.log("updateUI: No swiss rounds exist, hiding standings."); // DEBUG
                 if (standingsContainer) standingsContainer.style.display = 'none';
                 if (noStandingsMsg) noStandingsMsg.style.display = 'block';
                 if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
            }
            console.log("updateUI: Standings section updated."); // DEBUG
        } catch (error) {
             console.error("updateUI: Error during standings update:", error); // DEBUG
             if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
             if (noStandingsMsg) noStandingsMsg.style.display = 'block';
             if (noStandingsMsg) noStandingsMsg.textContent = `Error calculating standings: ${error.message}. Check console.`;
             if (standingsContainer) standingsContainer.style.display = 'block'; // Show container to display error
             if (standingsTableBody) standingsTableBody.innerHTML = ''; // Clear potentially broken table
        }

        updateStatusElement.textContent = `Updated`;
        updateStatusElement.title = `Last update: ${new Date().toLocaleTimeString()}`;
        console.log("updateUI: Update finished."); // DEBUG
    }

    // --- Helper Functions (getPlayerScoreBeforeRound, displayRound, updateActiveTab, filterTable, checkClearButtonVisibility) ---
    // These remain largely the same as the previous correct version. Make sure displayRound has the score logic.
    // ... (Include the full, previously working versions of these functions here) ...
    function getPlayerScoreBeforeRound(playerId, targetRoundNumber) { let wins = 0; let losses = 0; if (!playerId) return { wins, losses }; for (const pastRound of roundsData) { if (pastRound.roundNumber >= targetRoundNumber) continue; for (const match of pastRound.matches) { if (match.isBye && match.player1Id === playerId) { wins++; continue; } if (match.player1Id === playerId) { if (match.outcome === 1) wins++; else if (match.outcome === 2 || match.outcome === 4) losses++; continue; } if (match.player2Id === playerId) { if (match.outcome === 2) wins++; else if (match.outcome === 1 || match.outcome === 4) losses++; continue; } } } return { wins, losses }; }
    function displayRound(roundNumber) { console.log(`displayRound: Displaying round ${roundNumber}`); const round = roundsData.find(r => r.roundNumber === roundNumber); if (!round) { console.error(`Round data not found for round: ${roundNumber}`); pairingsTableBody.innerHTML = '<tr><td colspan="3">Could not load data for this round.</td></tr>'; currentRoundTitle.textContent = `Round ${roundNumber} (Error)`; return; } currentRoundTitle.textContent = `Round ${roundNumber} Pairings`; pairingsTableBody.innerHTML = ''; if (round.matches.length === 0) { pairingsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: #6c757d;">No matches reported for this round yet.</td></tr>'; return; } round.matches.forEach(match => { try { const row = pairingsTableBody.insertRow(); const player1Info = playersData[match.player1Id] || { name: `Unknown (${match.player1Id})` }; const player2Info = match.isBye ? { name: "BYE" } : (playersData[match.player2Id] || { name: `Unknown (${match.player2Id})` }); const scoreP1 = getPlayerScoreBeforeRound(match.player1Id, roundNumber); const scoreP2 = match.isBye ? { wins: 0, losses: 0 } : getPlayerScoreBeforeRound(match.player2Id, roundNumber); const player1DisplayText = `${player1Info.name} (${scoreP1.wins}-${scoreP1.losses})`; const player2DisplayText = match.isBye ? player2Info.name : `${player2Info.name} (${scoreP2.wins}-${scoreP2.losses})`; row.dataset.player1Name = player1Info.name.toLowerCase(); row.dataset.player2Name = match.isBye ? 'bye' : player2Info.name.toLowerCase(); const cellTable = row.insertCell(); cellTable.textContent = match.table === 0 ? "N/A" : match.table; const cellP1 = row.insertCell(); if (match.outcome === 1) { cellP1.innerHTML = `<span class="winner">${player1DisplayText}</span>`; } else { cellP1.textContent = player1DisplayText; } const cellP2 = row.insertCell(); if (match.isBye) { cellP2.textContent = player2DisplayText; cellP2.style.color = '#6c757d'; } else { if (match.outcome === 2) { cellP2.innerHTML = `<span class="winner">${player2DisplayText}</span>`; } else { cellP2.textContent = player2DisplayText; } } } catch (error) { console.error(`Error displaying match row: ${JSON.stringify(match)}`, error); } }); }
    function updateActiveTab() { const buttons = roundTabsContainer.querySelectorAll('button'); buttons.forEach(button => { if (parseInt(button.dataset.roundNumber, 10) === currentRound) button.classList.add('active'); else button.classList.remove('active'); }); }
    function filterTable() { const searchTerm = searchInput.value.toLowerCase().trim(); const rows = pairingsTableBody.querySelectorAll('tr'); let visibleRows = 0; rows.forEach(row => { if (row.cells.length === 1 && row.cells[0].colSpan === 3) { row.classList.remove('hidden-row'); visibleRows++; return; } const p1Name = row.dataset.player1Name || ''; const p2Name = row.dataset.player2Name || ''; if (!searchTerm || p1Name.includes(searchTerm) || (p2Name && p2Name.includes(searchTerm))) { row.classList.remove('hidden-row'); visibleRows++; } else { row.classList.add('hidden-row'); } }); const noResultsMessage = document.getElementById('no-search-results'); if (noResultsMessage) noResultsMessage.style.display = (visibleRows === 0 && searchTerm) ? 'block' : 'none'; }
    function checkClearButtonVisibility() { if (!clearSearchBtn) return; if (searchInput.value.length > 0) clearSearchBtn.style.display = 'inline-block'; else clearSearchBtn.style.display = 'none'; }


    async function checkForUpdates() {
        // --- Remains the same ---
        updateStatusElement.textContent = `Checking...`; updateStatusElement.title = `Checking at: ${new Date().toLocaleTimeString()}`;
        const newDataProcessed = await loadTournamentData();
        if (newDataProcessed) { console.log("checkForUpdates: New data processed, updating UI."); updateUI(); }
    }

    async function initialize() {
        console.log("initialize: Starting initialization..."); // DEBUG
        updateStatusElement.textContent = `Loading...`;
        await loadTournamentData(); // Wait for first load attempt
        updateUI(); // Initial UI update attempt

        checkClearButtonVisibility();

        if (updateIntervalId) clearInterval(updateIntervalId);
        updateIntervalId = setInterval(checkForUpdates, refreshInterval);
        console.log(`initialize: Started checking for updates every ${refreshInterval / 1000} seconds.`); // DEBUG
    }

    // --- Event Listeners ---
    searchInput.addEventListener('input', () => { filterTable(); checkClearButtonVisibility(); });
    if (clearSearchBtn) { clearSearchBtn.addEventListener('click', () => { searchInput.value = ''; filterTable(); checkClearButtonVisibility(); searchInput.focus(); }); }

    // --- Initialisation ---
    initialize();

}); // End of DOMContentLoaded
