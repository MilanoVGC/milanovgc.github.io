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
    const OWP_MINIMUM = 0.25; // Minimum opponent win percentage (33%)

    // --- Core Functions ---

    async function loadTournamentData() {
        console.log("loadTournamentData: Starting fetch...");
        try {
            const response = await fetch(`${xmlFilePath}?t=${new Date().getTime()}`);
            console.log(`loadTournamentData: Fetch status: ${response.status}`);
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
                console.error("XML Parsing Error:", parseError.textContent);
                updateStatusElement.textContent = `Parse Error`; updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                if (lastKnownTimeElapsed !== -1) { loadingMessage.textContent = "Error parsing updated tournament data. Check console."; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545'; }
                return false;
            }
            console.log("loadTournamentData: XML parsed successfully.");

            const currentTimeElapsedElement = xmlDoc.querySelector('tournament > timeelapsed');
            const currentTimeElapsed = currentTimeElapsedElement ? parseInt(currentTimeElapsedElement.textContent, 10) : -1;

            if (currentTimeElapsed !== -1 && currentTimeElapsed === lastKnownTimeElapsed) {
                console.log("loadTournamentData: No change detected (timeelapsed).");
                updateStatusElement.textContent = `Up to date`; updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                return false; // No change
            }

            console.log("loadTournamentData: Change detected or initial load. Processing XML...");
            extractData(xmlDoc); // Extract data
            lastKnownTimeElapsed = currentTimeElapsed;
            standingsCache = {}; // Clear standings cache on new data
            console.log("loadTournamentData: Data extracted, cache cleared.");
            return true; // New data processed

        } catch (error) {
             console.error("loadTournamentData: Error during fetch/parse:", error);
             updateStatusElement.textContent = `Fetch Error`; updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
             if (lastKnownTimeElapsed !== -1) { loadingMessage.textContent = `Error loading data: ${error.message}`; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545'; }
             return false;
        }
    }

    function extractData(xmlDoc) {
        console.log("extractData: Starting extraction...");
        try {
            const tournamentData = xmlDoc.querySelector('tournament > data');
            if (tournamentData) { const city = tournamentData.querySelector('city')?.textContent; const country = tournamentData.querySelector('country')?.textContent; tournamentInfoElement.textContent = `${city ? city + ', ' : ''}${country || ''}`.trim(); }

            const tempPlayersData = {};
            const playerElements = xmlDoc.querySelectorAll('tournament > players > player');
            playerElements.forEach(player => { const userId = player.getAttribute('userid'); const firstName = player.querySelector('firstname')?.textContent || ''; const lastName = player.querySelector('lastname')?.textContent || ''; if (userId) { tempPlayersData[userId] = { id: userId, firstName, lastName, name: `${firstName} ${lastName}`.trim() }; } });
            playersData = tempPlayersData;
            console.log(`extractData: Extracted ${Object.keys(playersData).length} players.`);

            const tempRoundsData = [];
            const roundElements = xmlDoc.querySelectorAll('tournament > pods > pod > rounds > round');
            roundElements.forEach((round, roundIndex) => {
                const roundNumber = parseInt(round.getAttribute('number'), 10);
                const roundType = round.getAttribute('type');
                console.log(`extractData: Processing Round ${roundNumber}, Type: ${roundType}`); // <<<--- Log round type

                if (isNaN(roundNumber)) { console.warn(`extractData: Skipping round at index ${roundIndex} with invalid number:`, round); return; }

                const matches = [];
                const matchElements = round.querySelectorAll('matches > match');
                matchElements.forEach((match, matchIndex) => {
                    const tableNumber = parseInt(match.querySelector('tablenumber')?.textContent || '0', 10); const outcome = parseInt(match.getAttribute('outcome'), 10);
                    const player1Element = match.querySelector('player1'); const player2Element = match.querySelector('player2'); const singlePlayerElement = match.querySelector('player');
                    let matchData = { table: tableNumber, player1Id: null, player2Id: null, outcome: outcome, isBye: false };
                    if (outcome === 5 && singlePlayerElement) { matchData.player1Id = singlePlayerElement.getAttribute('userid'); matchData.isBye = true; }
                    else if (player1Element && player2Element) { matchData.player1Id = player1Element.getAttribute('userid'); matchData.player2Id = player2Element.getAttribute('userid'); }
                    else { console.warn(`extractData: Skipping malformed match element in round ${roundNumber} (index ${matchIndex}):`, match); return; }
                    if (matchData.player1Id && !playersData[matchData.player1Id]) console.warn(`extractData: Player ID ${matchData.player1Id} from match in round ${roundNumber} not found in players list.`);
                    if (matchData.player2Id && !playersData[matchData.player2Id]) console.warn(`extractData: Player ID ${matchData.player2Id} from match in round ${roundNumber} not found in players list.`);
                    matches.push(matchData);
                });
                matches.sort((a, b) => a.table - b.table);
                tempRoundsData.push({ roundNumber, type: roundType, matches });
            });
            tempRoundsData.sort((a, b) => a.roundNumber - b.roundNumber);
            roundsData = tempRoundsData;
            console.log(`extractData: Extracted ${roundsData.length} rounds.`);
        } catch (error) {
             console.error("extractData: Error during extraction:", error);
             loadingMessage.textContent = `Error processing data structure: ${error.message}. Check console.`; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545';
             playersData = {}; roundsData = [];
        }
    }

    // --- Standings Calculation Functions ---

    function calculatePlayerSwissRecord(playerId) {
        let wins = 0; let losses = 0; let matchesPlayed = 0;
        if (!playerId) return { wins, losses, matchesPlayed };
        // console.log(`calculatePlayerSwissRecord: Calculating for Player ${playerId}...`); // DEBUG - Can be noisy

        for (const round of roundsData) {
            // Only count Swiss rounds
            if (round.type !== "3") {
                // console.log(`  Skipping Round ${round.roundNumber} (type=${round.type})`); // DEBUG - Can be noisy
                continue;
            }
            console.log(`calculatePlayerSwissRecord (${playerId}): Checking Swiss Round ${round.roundNumber}`); // <<<--- Log entering swiss round check

            for (const match of round.matches) {
                let playedInMatch = false;
                let winInMatch = false;
                let lossInMatch = false;

                if (match.isBye && match.player1Id === playerId) {
                    winInMatch = true; playedInMatch = true;
                } else if (match.player1Id === playerId) {
                    playedInMatch = true;
                    if (match.outcome === 1) winInMatch = true;
                    else if (match.outcome === 2 || match.outcome === 4) lossInMatch = true;
                } else if (match.player2Id === playerId) {
                    playedInMatch = true;
                    if (match.outcome === 2) winInMatch = true;
                    else if (match.outcome === 1 || match.outcome === 4) lossInMatch = true;
                }

                if(playedInMatch) {
                    matchesPlayed++;
                    if(winInMatch) wins++;
                    if(lossInMatch) losses++;
                    // <<<--- Log when a match is counted
                    console.log(`calculatePlayerSwissRecord (${playerId}): Found match in R${round.roundNumber}. Played=${playedInMatch}, Win=${winInMatch}, Loss=${lossInMatch}. Total Matches Played Now: ${matchesPlayed}`);
                }
            }
        }
        // console.log(`calculatePlayerSwissRecord (${playerId}): Result = W:${wins}, L:${losses}, Played:${matchesPlayed}`); // DEBUG - Can be noisy
        return { wins, losses, matchesPlayed };
    }

    function getSwissOpponents(playerId) { const opponents = new Set(); if (!playerId) return []; for (const round of roundsData) { if (round.type !== "3") continue; for (const match of round.matches) { if (match.isBye) continue; if (match.player1Id === playerId && match.player2Id) opponents.add(match.player2Id); else if (match.player2Id === playerId && match.player1Id) opponents.add(match.player1Id); } } return Array.from(opponents); }
    function getPlayerSwissWinPercentage(playerId, minPercentage) { const record = (standingsCache[playerId]?.record) ? standingsCache[playerId].record : calculatePlayerSwissRecord(playerId); const totalGames = record.wins + record.losses; if (totalGames === 0) return 0; const winRate = record.wins / totalGames; return Math.max(winRate, minPercentage); }
    function calculateOWP(playerId, minPercentage) { const opponents = getSwissOpponents(playerId); if (opponents.length === 0) return 0; let totalOpponentWinPercentage = 0; opponents.forEach(oppId => { totalOpponentWinPercentage += getPlayerSwissWinPercentage(oppId, minPercentage); }); return totalOpponentWinPercentage / opponents.length; }
    function calculateOOWP(playerId, minPercentage) { const opponents = getSwissOpponents(playerId); if (opponents.length === 0) return 0; let totalOpponentOWP = 0; opponents.forEach(oppId => { let oppOWP = 0; if (standingsCache[oppId] && typeof standingsCache[oppId].owp === 'number') { oppOWP = standingsCache[oppId].owp; } else { oppOWP = calculateOWP(oppId, minPercentage); } totalOpponentOWP += oppOWP; }); return totalOpponentOWP / opponents.length; }

    function calculateSwissStandings() {
        console.log("calculateSwissStandings: Starting calculation...");
        if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'block';
        if (noStandingsMsg) noStandingsMsg.style.display = 'none';
        standingsCache = {};
        const standingsData = [];
        let hasSwissRounds = roundsData.some(r => r.type === "3");

        if (!hasSwissRounds) {
            console.log("calculateSwissStandings: No Swiss rounds found.");
            if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
            if (noStandingsMsg) noStandingsMsg.style.display = 'block';
            if (standingsContainer) standingsContainer.style.display = 'block';
            return [];
        }

        console.log("calculateSwissStandings: Pre-calculating records...");
        for (const playerId in playersData) {
             standingsCache[playerId] = { record: calculatePlayerSwissRecord(playerId) };
        }
        console.log("calculateSwissStandings: Pre-calculating OWP...");
         for (const playerId in playersData) {
             if (standingsCache[playerId] && standingsCache[playerId].record.matchesPlayed > 0) {
                try { standingsCache[playerId].owp = calculateOWP(playerId, OWP_MINIMUM); }
                catch (error) { console.error(`Error calculating OWP for player ${playerId}:`, error); standingsCache[playerId].owp = 0; }
             } else if (standingsCache[playerId]) { standingsCache[playerId].owp = 0; }
         }
        console.log("calculateSwissStandings: Calculating OOWP and final list...");
        for (const playerId in playersData) {
            const playerInfo = playersData[playerId];
            const cachedData = standingsCache[playerId];
            // <<<--- Log matchesPlayed value for each player here
            console.log(`calculateSwissStandings: Checking player ${playerId} (${playerInfo?.name}). Matches Played = ${cachedData?.record?.matchesPlayed}`);

            if (cachedData && cachedData.record.matchesPlayed > 0) {
                try {
                    const oowp = calculateOOWP(playerId, OWP_MINIMUM);
                    standingsData.push({ playerInfo: playerInfo, wins: cachedData.record.wins, losses: cachedData.record.losses, owp: cachedData.owp ?? 0, oowp: oowp });
                } catch (error) {
                    console.error(`Error calculating OOWP for player ${playerId}:`, error);
                    standingsData.push({ playerInfo: playerInfo, wins: cachedData.record.wins, losses: cachedData.record.losses, owp: cachedData.owp ?? 0, oowp: 0 });
                }
            } else {
                 console.log(`calculateSwissStandings: Skipping player ${playerId} (matchesPlayed=${cachedData?.record?.matchesPlayed})`); // <<<--- Log skipped players
            }
        }

        console.log(`calculateSwissStandings: Calculation finished. ${standingsData.length} players eligible for standings.`); // <<<--- Updated log message
        if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
        return standingsData;
    }

    function sortStandings(standingsData) { /* ... (sorting logic same) ... */ return standingsData.sort((a, b) => { if (b.wins !== a.wins) return b.wins - a.wins; if (b.owp !== a.owp) return b.owp - a.owp; if (b.oowp !== a.oowp) return b.oowp - a.oowp; return a.playerInfo.name.localeCompare(b.playerInfo.name); }); }
    function displayStandings(sortedStandings) { /* ... (display logic same, incl. console logs) ... */ console.log("displayStandings: Starting display..."); if (!standingsTableBody) { console.error("displayStandings: Standings table body not found!"); return; } standingsTableBody.innerHTML = ''; if (!sortedStandings || sortedStandings.length === 0) { console.log("displayStandings: No standings data to display."); if (standingsContainer) standingsContainer.style.display = roundsData.some(r => r.type === "3") ? 'block' : 'none'; return; } if (standingsContainer) standingsContainer.style.display = 'block'; sortedStandings.forEach((data, index) => { try { const rank = index + 1; const row = standingsTableBody.insertRow(); const cellRank = row.insertCell(); cellRank.textContent = rank; cellRank.style.textAlign = 'center'; const cellName = row.insertCell(); cellName.textContent = data.playerInfo?.name || 'Unknown Player'; const cellRecord = row.insertCell(); cellRecord.textContent = `${data.wins}-${data.losses}`; cellRecord.style.textAlign = 'center'; const cellOWP = row.insertCell(); cellOWP.textContent = (data.owp * 100).toFixed(2); cellOWP.style.textAlign = 'right'; const cellOOWP = row.insertCell(); cellOOWP.textContent = (data.oowp * 100).toFixed(2); cellOOWP.style.textAlign = 'right'; } catch (error) { console.error(`Error displaying standings row ${index+1} for player ${data?.playerInfo?.id}:`, error); } }); console.log("displayStandings: Display finished."); }

    // --- End Standings Functions ---


    function updateUI() {
        console.log("updateUI: Starting UI update...");
        // --- Pairings Update Logic ---
        try {
            if (roundsData.length === 0 && lastKnownTimeElapsed === -1) { loadingMessage.textContent = "Waiting for tournament data..."; loadingMessage.style.display = 'block'; if(pairingsTable) pairingsTable.style.display = 'none'; if(currentRoundTitle) currentRoundTitle.style.display = 'none'; if(roundTabsContainer) roundTabsContainer.innerHTML = ''; console.log("updateUI: Waiting for initial data."); return; }
            else if (roundsData.length === 0 && lastKnownTimeElapsed !== -1) { loadingMessage.textContent = "No rounds found in current data."; loadingMessage.style.display = 'block'; if(pairingsTable) pairingsTable.style.display = 'none'; if(currentRoundTitle) currentRoundTitle.style.display = 'none'; if(roundTabsContainer) roundTabsContainer.innerHTML = ''; console.log("updateUI: No rounds found in data."); return; }

            const latestRoundNumber = roundsData.length > 0 ? roundsData[roundsData.length - 1].roundNumber : 1;
            const currentRoundExists = roundsData.some(r => r.roundNumber === currentRound);
            if (!currentRoundExists || currentRound < 1) { currentRound = latestRoundNumber; }

            let existingTabs = Array.from(roundTabsContainer.querySelectorAll('button')).map(btn => parseInt(btn.dataset.roundNumber, 10));
            let newRounds = roundsData.map(r => r.roundNumber);

            if (JSON.stringify(existingTabs) !== JSON.stringify(newRounds)) {
                if (roundTabsContainer) roundTabsContainer.innerHTML = '';
                roundsData.forEach(round => { const button = document.createElement('button'); button.textContent = `Round ${round.roundNumber}`; button.dataset.roundNumber = round.roundNumber; button.addEventListener('click', () => { currentRound = round.roundNumber; displayRound(currentRound); updateActiveTab(); filterTable(); }); if (roundTabsContainer) roundTabsContainer.appendChild(button); });
                console.log("updateUI: Round tabs updated.");
            }

            displayRound(currentRound);
            updateActiveTab();
            if (loadingMessage) loadingMessage.style.display = 'none';
            if (pairingsTable) pairingsTable.style.display = 'table';
            if (currentRoundTitle) currentRoundTitle.style.display = 'block';
            filterTable();
            console.log("updateUI: Pairings section updated.");
        } catch (error) {
             console.error("updateUI: Error during pairings update:", error);
             if (loadingMessage) { loadingMessage.textContent = `Error displaying pairings: ${error.message}. Check console.`; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545'; }
             if (pairingsTable) pairingsTable.style.display = 'none';
        }

        // --- Standings Update Logic ---
        try {
            console.log("updateUI: Starting standings update logic...");
            const swissRoundsExist = roundsData.some(r => r.type === "3");
            if (swissRoundsExist) {
                const standingsData = calculateSwissStandings();
                const sortedStandings = sortStandings(standingsData);
                displayStandings(sortedStandings);
            } else {
                 console.log("updateUI: No swiss rounds exist, hiding standings.");
                 if (standingsContainer) standingsContainer.style.display = 'none';
                 if (noStandingsMsg) noStandingsMsg.style.display = 'block';
                 if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
            }
            console.log("updateUI: Standings section updated.");
        } catch (error) {
             console.error("updateUI: Error during standings update:", error);
             if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
             if (noStandingsMsg) { noStandingsMsg.style.display = 'block'; noStandingsMsg.textContent = `Error calculating standings: ${error.message}. Check console.`; }
             if (standingsContainer) standingsContainer.style.display = 'block';
             if (standingsTableBody) standingsTableBody.innerHTML = '';
        }

        if (updateStatusElement) { updateStatusElement.textContent = `Updated`; updateStatusElement.title = `Last update: ${new Date().toLocaleTimeString()}`; }
        console.log("updateUI: Update finished.");
    }

    // --- Helper Functions (getPlayerScoreBeforeRound, displayRound, updateActiveTab, filterTable, checkClearButtonVisibility) ---
    function getPlayerScoreBeforeRound(playerId, targetRoundNumber) { let wins = 0; let losses = 0; if (!playerId) return { wins, losses }; for (const pastRound of roundsData) { if (pastRound.roundNumber >= targetRoundNumber) continue; for (const match of pastRound.matches) { if (match.isBye && match.player1Id === playerId) { wins++; continue; } if (match.player1Id === playerId) { if (match.outcome === 1) wins++; else if (match.outcome === 2 || match.outcome === 4) losses++; continue; } if (match.player2Id === playerId) { if (match.outcome === 2) wins++; else if (match.outcome === 1 || match.outcome === 4) losses++; continue; } } } return { wins, losses }; }
    function displayRound(roundNumber) { console.log(`displayRound: Displaying round ${roundNumber}`); const round = roundsData.find(r => r.roundNumber === roundNumber); if (!round) { console.error(`Round data not found for round: ${roundNumber}`); if (pairingsTableBody) pairingsTableBody.innerHTML = '<tr><td colspan="3">Could not load data for this round.</td></tr>'; if (currentRoundTitle) currentRoundTitle.textContent = `Round ${roundNumber} (Error)`; return; } if (currentRoundTitle) currentRoundTitle.textContent = `Round ${roundNumber} Pairings`; if (pairingsTableBody) pairingsTableBody.innerHTML = ''; if (round.matches.length === 0) { if (pairingsTableBody) pairingsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: #6c757d;">No matches reported for this round yet.</td></tr>'; return; } round.matches.forEach(match => { try { const row = pairingsTableBody.insertRow(); const player1Info = playersData[match.player1Id] || { name: `Unknown (${match.player1Id})` }; const player2Info = match.isBye ? { name: "BYE" } : (playersData[match.player2Id] || { name: `Unknown (${match.player2Id})` }); const scoreP1 = getPlayerScoreBeforeRound(match.player1Id, roundNumber); const scoreP2 = match.isBye ? { wins: 0, losses: 0 } : getPlayerScoreBeforeRound(match.player2Id, roundNumber); const player1DisplayText = `${player1Info.name} (${scoreP1.wins}-${scoreP1.losses})`; const player2DisplayText = match.isBye ? player2Info.name : `${player2Info.name} (${scoreP2.wins}-${scoreP2.losses})`; row.dataset.player1Name = player1Info.name.toLowerCase(); row.dataset.player2Name = match.isBye ? 'bye' : player2Info.name.toLowerCase(); const cellTable = row.insertCell(); cellTable.textContent = match.table === 0 ? "N/A" : match.table; const cellP1 = row.insertCell(); if (match.outcome === 1) { cellP1.innerHTML = `<span class="winner">${player1DisplayText}</span>`; } else { cellP1.textContent = player1DisplayText; } const cellP2 = row.insertCell(); if (match.isBye) { cellP2.textContent = player2DisplayText; cellP2.style.color = '#6c757d'; } else { if (match.outcome === 2) { cellP2.innerHTML = `<span class="winner">${player2DisplayText}</span>`; } else { cellP2.textContent = player2DisplayText; } } } catch (error) { console.error(`Error displaying match row: ${JSON.stringify(match)}`, error); } }); }
    function updateActiveTab() { if(!roundTabsContainer) return; const buttons = roundTabsContainer.querySelectorAll('button'); buttons.forEach(button => { if (parseInt(button.dataset.roundNumber, 10) === currentRound) button.classList.add('active'); else button.classList.remove('active'); }); }
    function filterTable() { if(!pairingsTableBody) return; const searchTerm = searchInput.value.toLowerCase().trim(); const rows = pairingsTableBody.querySelectorAll('tr'); let visibleRows = 0; rows.forEach(row => { if (row.cells.length === 1 && row.cells[0].colSpan === 3) { row.classList.remove('hidden-row'); visibleRows++; return; } const p1Name = row.dataset.player1Name || ''; const p2Name = row.dataset.player2Name || ''; if (!searchTerm || p1Name.includes(searchTerm) || (p2Name && p2Name.includes(searchTerm))) { row.classList.remove('hidden-row'); visibleRows++; } else { row.classList.add('hidden-row'); } }); const noResultsMessage = document.getElementById('no-search-results'); if (noResultsMessage) noResultsMessage.style.display = (visibleRows === 0 && searchTerm) ? 'block' : 'none'; }
    function checkClearButtonVisibility() { if (!clearSearchBtn) return; if (searchInput && searchInput.value.length > 0) clearSearchBtn.style.display = 'inline-block'; else clearSearchBtn.style.display = 'none'; }


    async function checkForUpdates() {
        if (updateStatusElement) { updateStatusElement.textContent = `Checking...`; updateStatusElement.title = `Checking at: ${new Date().toLocaleTimeString()}`; }
        const newDataProcessed = await loadTournamentData();
        if (newDataProcessed) { console.log("checkForUpdates: New data processed, updating UI."); updateUI(); }
    }

    async function initialize() {
        console.log("initialize: Starting initialization...");
        if(updateStatusElement) updateStatusElement.textContent = `Loading...`;
        await loadTournamentData();
        updateUI(); // Initial UI update attempt

        checkClearButtonVisibility();

        if (updateIntervalId) clearInterval(updateIntervalId);
        updateIntervalId = setInterval(checkForUpdates, refreshInterval);
        console.log(`initialize: Started checking for updates every ${refreshInterval / 1000} seconds.`);
    }

    // --- Event Listeners ---
    if(searchInput) searchInput.addEventListener('input', () => { filterTable(); checkClearButtonVisibility(); });
    if (clearSearchBtn) { clearSearchBtn.addEventListener('click', () => { if(searchInput) searchInput.value = ''; filterTable(); checkClearButtonVisibility(); if(searchInput) searchInput.focus(); }); }

    // --- Initialisation ---
    initialize();

}); // End of DOMContentLoaded
