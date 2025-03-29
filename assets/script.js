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
        try {
            const response = await fetch(`${xmlFilePath}?t=${new Date().getTime()}`);
            if (!response.ok) { /* ... (error handling as before) ... */ return false; }
            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");
            const parseError = xmlDoc.querySelector("parsererror");
            if (parseError) { /* ... (error handling as before) ... */ return false; }

            const currentTimeElapsedElement = xmlDoc.querySelector('tournament > timeelapsed');
            const currentTimeElapsed = currentTimeElapsedElement ? parseInt(currentTimeElapsedElement.textContent, 10) : -1;

            if (currentTimeElapsed !== -1 && currentTimeElapsed === lastKnownTimeElapsed) {
                updateStatusElement.textContent = `Up to date`;
                updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                return false; // No change
            }

            console.log("Change detected or initial load. Processing XML...");
            extractData(xmlDoc); // Extract data
            lastKnownTimeElapsed = currentTimeElapsed;
            standingsCache = {}; // Clear standings cache on new data
            return true; // New data processed

        } catch (error) { /* ... (error handling as before) ... */ return false; }
    }

    function extractData(xmlDoc) {
        // Extract Tournament Info
        const tournamentData = xmlDoc.querySelector('tournament > data');
        if (tournamentData) { /* ... (city/country extraction as before) ... */ }

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

        // Extract Rounds and Matches Info
        const tempRoundsData = [];
        const roundElements = xmlDoc.querySelectorAll('tournament > pods > pod > rounds > round');
        roundElements.forEach(round => {
            const roundNumber = parseInt(round.getAttribute('number'), 10);
            const roundType = round.getAttribute('type'); // <<<--- Get round type

            if (isNaN(roundNumber)) { console.warn("Skipping round with invalid number:", round); return; }

            const matches = [];
            const matchElements = round.querySelectorAll('matches > match');
            matchElements.forEach(match => { /* ... (match data extraction as before, storing player1Id, player2Id, outcome, isBye) ... */ });

            matches.sort((a, b) => a.table - b.table);
            tempRoundsData.push({ roundNumber, type: roundType, matches }); // <<<--- Store type
        });

        tempRoundsData.sort((a, b) => a.roundNumber - b.roundNumber);
        roundsData = tempRoundsData;
        console.log("Data Extracted:", { players: Object.keys(playersData).length, rounds: roundsData.length });
    }

    // --- Standings Calculation Functions ---

    // Calculates W-L record for a player considering ONLY Swiss rounds (type="3")
    function calculatePlayerSwissRecord(playerId) {
        let wins = 0;
        let losses = 0;
        let matchesPlayed = 0;

        if (!playerId) return { wins, losses, matchesPlayed };

        for (const round of roundsData) {
            // Only count Swiss rounds
            if (round.type !== "3") continue;

            for (const match of round.matches) {
                let playedInMatch = false;
                if (match.isBye && match.player1Id === playerId) {
                    wins++;
                    playedInMatch = true;
                } else if (match.player1Id === playerId) {
                    playedInMatch = true;
                    if (match.outcome === 1) wins++;
                    else if (match.outcome === 2 || match.outcome === 4) losses++;
                } else if (match.player2Id === playerId) {
                    playedInMatch = true;
                    if (match.outcome === 2) wins++;
                    else if (match.outcome === 1 || match.outcome === 4) losses++;
                }

                if(playedInMatch) {
                    matchesPlayed++;
                }
            }
        }
        return { wins, losses, matchesPlayed };
    }

    // Gets a list of opponent IDs for a player from Swiss rounds only
    function getSwissOpponents(playerId) {
        const opponents = new Set(); // Use Set to avoid duplicates if players play twice
        if (!playerId) return [];

        for (const round of roundsData) {
            if (round.type !== "3") continue;

            for (const match of round.matches) {
                if (match.isBye) continue; // Skip BYEs for opponent calculations

                if (match.player1Id === playerId && match.player2Id) {
                    opponents.add(match.player2Id);
                } else if (match.player2Id === playerId && match.player1Id) {
                    opponents.add(match.player1Id);
                }
            }
        }
        return Array.from(opponents);
    }

    // Calculates a single player's Swiss Win Percentage (respecting minimum)
    function getPlayerSwissWinPercentage(playerId, minPercentage) {
        const record = standingsCache[playerId]?.record || calculatePlayerSwissRecord(playerId); // Use cached record if available
        const totalGames = record.wins + record.losses;
        if (totalGames === 0) {
            return 0; // Avoid division by zero
        }
        const winRate = record.wins / totalGames;
        return Math.max(winRate, minPercentage); // Apply minimum
    }


    // Calculates Opponent Win Percentage (OWP)
    function calculateOWP(playerId, minPercentage) {
        const opponents = getSwissOpponents(playerId);
        if (opponents.length === 0) {
            return 0; // No opponents, OWP is 0
        }

        let totalOpponentWinPercentage = 0;
        opponents.forEach(oppId => {
            totalOpponentWinPercentage += getPlayerSwissWinPercentage(oppId, minPercentage);
        });

        return totalOpponentWinPercentage / opponents.length; // Average
    }

    // Calculates Opponent's Opponent Win Percentage (OOWP)
    function calculateOOWP(playerId, minPercentage) {
         const opponents = getSwissOpponents(playerId);
         if (opponents.length === 0) {
             return 0; // No opponents, OOWP is 0
         }

         let totalOpponentOWP = 0;
         opponents.forEach(oppId => {
             // Recursively call calculateOWP for each opponent
             const oppOWP = standingsCache[oppId]?.owp ?? calculateOWP(oppId, minPercentage); // Use cache if available
             totalOpponentOWP += oppOWP;
         });

         return totalOpponentOWP / opponents.length; // Average
    }


    // Main function to calculate standings data for all players
    function calculateSwissStandings() {
        console.log("Calculating Swiss Standings...");
        standingsLoadingMsg.style.display = 'block';
        noStandingsMsg.style.display = 'none';
        standingsCache = {}; // Clear cache before recalculating
        const standingsData = [];
        let hasSwissRounds = roundsData.some(r => r.type === "3");

        if (!hasSwissRounds) {
            console.log("No Swiss rounds found.");
            standingsLoadingMsg.style.display = 'none';
            noStandingsMsg.style.display = 'block';
            standingsContainer.style.display = 'block'; // Show container to display the message
            return [];
        }

        // Pre-calculate records for all players to populate cache
        for (const playerId in playersData) {
             standingsCache[playerId] = {
                 record: calculatePlayerSwissRecord(playerId)
             };
        }
        // Pre-calculate OWP for all players
         for (const playerId in playersData) {
             if (standingsCache[playerId]) { // Check if player exists in cache (they should)
                standingsCache[playerId].owp = calculateOWP(playerId, OWP_MINIMUM);
             }
         }

        // Calculate final standings including OOWP
        for (const playerId in playersData) {
            const playerInfo = playersData[playerId];
            const cachedData = standingsCache[playerId];

            // Only include players who played at least one Swiss match
            if (cachedData && cachedData.record.matchesPlayed > 0) {
                const oowp = calculateOOWP(playerId, OWP_MINIMUM);
                standingsData.push({
                    playerInfo: playerInfo,
                    wins: cachedData.record.wins,
                    losses: cachedData.record.losses,
                    owp: cachedData.owp,
                    oowp: oowp
                });
            }
        }

        console.log(`Calculated standings for ${standingsData.length} players.`);
        standingsLoadingMsg.style.display = 'none';
        return standingsData;
    }

    // Sorts the calculated standings data
    function sortStandings(standingsData) {
        return standingsData.sort((a, b) => {
            // 1. Sort by Wins (descending)
            if (b.wins !== a.wins) {
                return b.wins - a.wins;
            }
            // 2. Sort by OWP (descending)
            if (b.owp !== a.owp) {
                return b.owp - a.owp;
            }
            // 3. Sort by OOWP (descending)
            if (b.oowp !== a.oowp) {
                return b.oowp - a.oowp;
            }
            // 4. Final Tiebreaker: Alphabetical by name (ascending)
            return a.playerInfo.name.localeCompare(b.playerInfo.name);
        });
    }

    // Displays the sorted standings in the table
    function displayStandings(sortedStandings) {
        standingsTableBody.innerHTML = ''; // Clear previous standings

        if (!sortedStandings || sortedStandings.length === 0) {
            // Message is handled by calculateSwissStandings if no swiss rounds
            standingsContainer.style.display = roundsData.some(r => r.type === "3") ? 'block' : 'none'; // Show if swiss rounds exist, even if empty standings
            return;
        }

        standingsContainer.style.display = 'block'; // Show the container

        sortedStandings.forEach((data, index) => {
            const rank = index + 1;
            const row = standingsTableBody.insertRow();

            const cellRank = row.insertCell();
            cellRank.textContent = rank;
            cellRank.style.textAlign = 'center';

            const cellName = row.insertCell();
            cellName.textContent = data.playerInfo.name;

            const cellRecord = row.insertCell();
            cellRecord.textContent = `${data.wins}-${data.losses}`;
            cellRecord.style.textAlign = 'center';

            const cellOWP = row.insertCell();
            cellOWP.textContent = (data.owp * 100).toFixed(2); // Format as percentage
            cellOWP.style.textAlign = 'right';

            const cellOOWP = row.insertCell();
            cellOOWP.textContent = (data.oowp * 100).toFixed(2); // Format as percentage
            cellOOWP.style.textAlign = 'right';
        });
         console.log("Standings displayed.");
    }

    // --- End Standings Functions ---


    function updateUI() {
        // --- Pairings Update Logic (as before) ---
        if (roundsData.length === 0 && lastKnownTimeElapsed === -1) { /* ... (loading message handling) ... */ return; }
        else if (roundsData.length === 0 && lastKnownTimeElapsed !== -1) { /* ... (no rounds message handling) ... */ return; }

        const latestRoundNumber = roundsData.length > 0 ? roundsData[roundsData.length - 1].roundNumber : 1;
        const currentRoundExists = roundsData.some(r => r.roundNumber === currentRound);
        if (!currentRoundExists || currentRound < 1) { currentRound = latestRoundNumber; }

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
                    // Keep search term persistent
                    filterTable();
                });
                roundTabsContainer.appendChild(button);
            });
        }

        displayRound(currentRound);
        updateActiveTab();
        loadingMessage.style.display = 'none';
        pairingsTable.style.display = 'table';
        currentRoundTitle.style.display = 'block';
        filterTable(); // Apply search filter
        // --- End Pairings Update ---


        // --- Standings Update Logic ---
        // Check if there are any Swiss rounds completed before calculating/displaying
        const swissRoundsExist = roundsData.some(r => r.type === "3");
        if (swissRoundsExist) {
            const standingsData = calculateSwissStandings();
            const sortedStandings = sortStandings(standingsData);
            displayStandings(sortedStandings);
        } else {
             // Ensure standings container is hidden if no swiss rounds exist
             if (standingsContainer) standingsContainer.style.display = 'none';
             if (noStandingsMsg) noStandingsMsg.style.display = 'block'; // Show message
             if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
        }
        // --- End Standings Update ---


        updateStatusElement.textContent = `Updated`;
        updateStatusElement.title = `Last update: ${new Date().toLocaleTimeString()}`;
    }

    function getPlayerScoreBeforeRound(playerId, targetRoundNumber) {
        // --- Function remains the same as previous version ---
        let wins = 0; let losses = 0; if (!playerId) return { wins, losses };
        for (const pastRound of roundsData) {
            if (pastRound.roundNumber >= targetRoundNumber) continue;
            for (const match of pastRound.matches) { /* ... (score calculation logic) ... */ }
        } return { wins, losses };
    }

    function displayRound(roundNumber) {
        // --- Function remains largely the same, uses getPlayerScoreBeforeRound ---
        const round = roundsData.find(r => r.roundNumber === roundNumber);
        if (!round) { /* ... (error handling) ... */ return; }
        currentRoundTitle.textContent = `Round ${roundNumber} Pairings`;
        pairingsTableBody.innerHTML = '';
        if (round.matches.length === 0) { /* ... (no matches message) ... */ return; }

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

            const cellTable = row.insertCell(); cellTable.textContent = match.table === 0 ? "N/A" : match.table;
            const cellP1 = row.insertCell(); if (match.outcome === 1) { cellP1.innerHTML = `<span class="winner">${player1DisplayText}</span>`; } else { cellP1.textContent = player1DisplayText; }
            const cellP2 = row.insertCell(); if (match.isBye) { cellP2.textContent = player2DisplayText; cellP2.style.color = '#6c757d'; } else { if (match.outcome === 2) { cellP2.innerHTML = `<span class="winner">${player2DisplayText}</span>`; } else { cellP2.textContent = player2DisplayText; } }
        });
    }

    function updateActiveTab() { /* ... (same as before) ... */ }
    function filterTable() { /* ... (same as before) ... */ }
    function checkClearButtonVisibility() { /* ... (same as before) ... */ }
    async function checkForUpdates() { /* ... (same as before) ... */ }

    async function initialize() {
        updateStatusElement.textContent = `Loading...`;
        await loadTournamentData();
        updateUI(); // Includes standings calculation/display now

        checkClearButtonVisibility();

        if (updateIntervalId) clearInterval(updateIntervalId);
        updateIntervalId = setInterval(checkForUpdates, refreshInterval);
        console.log(`Started checking for updates every ${refreshInterval / 1000} seconds.`);
    }

    // --- Event Listeners ---
    searchInput.addEventListener('input', () => { filterTable(); checkClearButtonVisibility(); });
    if (clearSearchBtn) { clearSearchBtn.addEventListener('click', () => { searchInput.value = ''; filterTable(); checkClearButtonVisibility(); searchInput.focus(); }); }

    // --- Initialisation ---
    initialize();

}); // End of DOMContentLoaded
