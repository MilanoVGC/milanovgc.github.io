// Wait for the HTML document to be fully loaded before running script
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");
    console.log("--- Initializing Pairing/Standings Script (TPCi Rules - v4.2 Try No-Bye-In-WP) ---");

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
    const standingsContainer = document.getElementById('standings-container');
    const standingsTableBody = document.getElementById('standings-body');
    const standingsLoadingMsg = document.getElementById('standings-loading-message');
    const noStandingsMsg = document.getElementById('no-standings-message');
    const headerContainer = document.querySelector('header .container');
    const updateStatusElement = document.createElement('span');
    updateStatusElement.id = 'update-status';
    if (headerContainer) headerContainer.appendChild(updateStatusElement);
    else document.querySelector('header')?.appendChild(updateStatusElement);


    // Guard: Check essential elements
     if (!pairingsTableBody || !searchInput || !loadingMessage || !standingsTableBody || !standingsContainer) {
          console.error("CRITICAL ERROR: Essential DOM elements not found. Stopping script.");
          if(loadingMessage) { loadingMessage.textContent = "Critical page error: Required elements missing."; loadingMessage.style.display = 'block'; loadingMessage.style.color = 'red'; }
          return;
     }
     console.log("Essential DOM elements found.");

    // --- Global Data Storage ---
    let playersData = {};
    let roundsData = [];
    let currentRound = 1;
    let lastKnownTimeElapsed = -1;
    let updateIntervalId = null;
    let standingsCache = {}; // Cleared before each standings calculation


    // --- Configuration ---
    const xmlFilePath = 'data/tournament_data.xml';
    const refreshInterval = 15000; // 15 seconds
    const WP_MINIMUM = 0.25; // TPCi Minimum Win Percentage
    const WP_MAX_COMPLETED = 1.0; // TPCi Max WP if completed tournament
    const WP_MAX_DROPPED = 0.75; // TPCi Max WP if dropped
    const CURRENT_YEAR = new Date().getFullYear();
    const DEBUG_STANDINGS = true; // <<< SET TO true TO ENABLE DETAILED LOGGING


    // --- Core Data Loading and Parsing (FULL VERSION - v4.2 - Identical to v4.1) ---
    async function loadTournamentData() {
        console.log("loadTournamentData: Starting fetch...");
        try {
            const response = await fetch(`${xmlFilePath}?t=${new Date().getTime()}`);
            console.log(`loadTournamentData: Fetch status: ${response.status}`);
            if (!response.ok) { /* error handling */ return false; }
            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");
            const parseError = xmlDoc.querySelector("parsererror");
            if (parseError) { /* error handling */ return false; }
            console.log("loadTournamentData: XML parsed successfully.");
            const currentTimeElapsedElement = xmlDoc.querySelector('tournament > timeelapsed');
            const currentTimeElapsed = currentTimeElapsedElement ? parseInt(currentTimeElapsedElement.textContent, 10) : -1;
            if (currentTimeElapsed !== -1 && currentTimeElapsed === lastKnownTimeElapsed) { console.log("loadTournamentData: No change detected."); return false; }
            console.log("loadTournamentData: Change detected. Processing XML...");
            extractData(xmlDoc);
            lastKnownTimeElapsed = currentTimeElapsed;
            console.log("loadTournamentData: Data extraction call complete.");
            return true;
        } catch (error) { console.error("loadTournamentData: Error:", error); return false; }
    }

    function extractData(xmlDoc) {
         console.log("extractData: Starting extraction..."); playersData = {}; roundsData = []; let extractionError = false;
         try {
            /* ... Set location ... */
            const tempPlayersData = {}; const playerElements = xmlDoc.querySelectorAll('tournament > players > player'); console.log(`extractData: Found ${playerElements.length} players.`);
            playerElements.forEach((player, index) => {
                 const userId = player.getAttribute('userid'); const firstName = player.querySelector('firstname')?.textContent || ''; const lastName = player.querySelector('lastname')?.textContent || '';
                 if (userId) { tempPlayersData[String(userId)] = { id: String(userId), firstName, lastName, name: `${firstName} ${lastName}`.trim(), birthYear: null }; } else { console.warn(`extractData: Player index ${index} missing userid.`); }
            });
            playersData = tempPlayersData; console.log(`extractData: Extracted ${Object.keys(playersData).length} players.`);
            const tempRoundsData = []; const roundElements = xmlDoc.querySelectorAll('tournament > pods > pod > rounds > round'); console.log(`extractData: Found ${roundElements.length} rounds.`);
            roundElements.forEach((round, roundIndex) => {
                 const roundNumber = parseInt(round.getAttribute('number'), 10); const roundType = round.getAttribute('type'); if (isNaN(roundNumber)) { console.warn(`extractData: Skipping round index ${roundIndex}.`); return; }
                 const matches = []; const matchElements = round.querySelectorAll('matches > match');
                 matchElements.forEach((match, matchIndex) => {
                     const tableNumber = parseInt(match.querySelector('tablenumber')?.textContent || '0', 10); const outcome = parseInt(match.getAttribute('outcome'), 10); const player1Element = match.querySelector('player1'); const player2Element = match.querySelector('player2'); const singlePlayerElement = match.querySelector('player'); let matchData = { table: tableNumber, player1Id: null, player2Id: null, outcome: outcome, isBye: false };
                     if (outcome === 5 && singlePlayerElement) { matchData.player1Id = String(singlePlayerElement.getAttribute('userid')); matchData.isBye = true; }
                     else if (player1Element && player2Element) { matchData.player1Id = String(player1Element.getAttribute('userid')); matchData.player2Id = String(player2Element.getAttribute('userid')); }
                     else { console.warn(`extractData: Skipping malformed match R ${roundNumber} index ${matchIndex}.`); return; } matches.push(matchData);
                 });
                 matches.sort((a, b) => a.table - b.table); tempRoundsData.push({ roundNumber, type: roundType, matches });
            });
            tempRoundsData.sort((a, b) => a.roundNumber - b.roundNumber); roundsData = tempRoundsData; console.log(`extractData: Extracted ${roundsData.length} rounds.`);
         } catch (error) { console.error("extractData: CRITICAL Error:", error); extractionError = true; playersData = {}; roundsData = []; }
         finally { console.log(`extractData: Finished. players: ${Object.keys(playersData).length}, rounds: ${roundsData.length}, Error: ${extractionError}`); }
    }


    // --- Standings Calculation Logic (TPCi Rules Implementation - v4.2) ---

    /** Helper to get total Swiss rounds in the tournament */
    function getTotalSwissRounds() {
        let maxSwissRound = 0;
        for (const round of roundsData) { if (round.type === "3" && round.roundNumber > maxSwissRound) { maxSwissRound = round.roundNumber; } }
        return maxSwissRound;
    }

    /** Calculates record & participation up to maxRoundNumber. */
    function calculatePlayerSwissRecord(playerId, maxRoundNumber) {
        let wins = 0, losses = 0, ties = 0, byes = 0, matchPoints = 0, roundsParticipated = 0, highestRoundParticipated = 0;
        const effectivePlayerId = String(playerId);
        if (!effectivePlayerId) return { wins, losses, ties, byes, matchPoints, roundsParticipated, highestRoundParticipated };

        for (const round of roundsData) {
            const isSwissRound = round.type === "3"; const isWithinLimit = round.roundNumber <= maxRoundNumber;
            if (!isSwissRound || !isWithinLimit) continue;
            let playedThisRound = false;
            for (const match of round.matches) {
                let playerFoundInThisMatch = false; const matchP1Id = String(match.player1Id); const matchP2Id = String(match.player2Id);
                if (match.isBye && matchP1Id === effectivePlayerId) { wins++; byes++; matchPoints += 3; playerFoundInThisMatch = true; }
                else if (matchP1Id === effectivePlayerId) { if (match.outcome === 1) { wins++; matchPoints += 3; } else if (match.outcome === 2) { losses++; matchPoints += 0; } else if (match.outcome === 3 || match.outcome === 4) { ties++; matchPoints += 1; } else { matchPoints += 0; } playerFoundInThisMatch = true; }
                else if (matchP2Id === effectivePlayerId) { if (match.outcome === 1) { losses++; matchPoints += 0; } else if (match.outcome === 2) { wins++; matchPoints += 3; } else if (match.outcome === 3 || match.outcome === 4) { ties++; matchPoints += 1; } else { matchPoints += 0; } playerFoundInThisMatch = true; }
                if (playerFoundInThisMatch) { playedThisRound = true; break; }
            }
            if (playedThisRound) { roundsParticipated++; highestRoundParticipated = round.roundNumber; }
        }
        // Debug log unchanged but useful
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`      DEBUG: Record for ${playersData[effectivePlayerId]?.name} (${effectivePlayerId}) up to R${maxRoundNumber}: Wins=${wins}, Byes=${byes}, Losses=${losses}, Ties=${ties} (${matchPoints}pts). RoundsParticipated=${roundsParticipated}, HighestRound=${highestRoundParticipated}`);
        return { wins, losses, ties, byes, matchPoints, roundsParticipated, highestRoundParticipated };
    }

    /** Gets opponents from Swiss rounds up to maxRoundNumber. Excludes byes. */
    function getSwissOpponents(playerId, maxRoundNumber) {
        const opponents = new Set(); const effectivePlayerId = String(playerId); if (!effectivePlayerId) return [];
        for (const round of roundsData) { if (round.type !== "3" || round.roundNumber > maxRoundNumber) continue; for (const match of round.matches) { if (match.isBye) continue; const matchP1Id = String(match.player1Id); const matchP2Id = String(match.player2Id); if (matchP1Id === effectivePlayerId && matchP2Id) opponents.add(matchP2Id); else if (matchP2Id === effectivePlayerId && matchP1Id) opponents.add(matchP1Id); } }
        return Array.from(opponents);
    }


    /**
     * Calculates WP based on TPCi rules up to maxRoundNumber. Uses cache. (TPCi v4.2 - EXCLUDES BYES FROM WINS)
     * Needs totalSwissRounds for the tournament.
     */
    function getPlayerSwissWinPercentage(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache) {
        const effectivePlayerId = String(playerId);
        const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`;
        if (currentStandingsCache[cacheKey]?.wp !== undefined) { return currentStandingsCache[cacheKey].wp; }

        let record = currentStandingsCache[cacheKey]?.record || calculatePlayerSwissRecord(effectivePlayerId, maxRoundNumber);
        if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
        currentStandingsCache[cacheKey].record = record;

        // >>>>>> CHANGE: Use only match wins (record.wins), DO NOT include byes (record.byes) <<<<<<
        const totalWins = record.wins;

        const completedStage = record.highestRoundParticipated >= maxRoundNumber;
        let divisor, maxWP;
        if (completedStage) { divisor = totalSwissRounds; maxWP = WP_MAX_COMPLETED; }
        else { divisor = record.roundsParticipated; maxWP = WP_MAX_DROPPED; }

        let finalWP;
        if (divisor === 0) { finalWP = WP_MINIMUM; }
        else { const rawWP = totalWins / divisor; finalWP = Math.min(Math.max(rawWP, WP_MINIMUM), maxWP); }

        currentStandingsCache[cacheKey].wp = finalWP;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`    DEBUG: WP CALC for ${cacheKey} (${playersData[effectivePlayerId]?.name}): MatchWins=${totalWins}, Divisor=${divisor}, MaxWP=${maxWP} => Final=${finalWP.toFixed(4)}`);
        return finalWP;
    }


    /** Calculates OWP up to maxRoundNumber using TPCi WP rules. Uses cache. (TPCi v4.2) */
    function calculateOWP(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache) {
        const effectivePlayerId = String(playerId);
        const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`;
        if (currentStandingsCache[cacheKey]?.owp !== undefined) { return currentStandingsCache[cacheKey].owp; }

        const opponents = getSwissOpponents(effectivePlayerId, maxRoundNumber);
        if (opponents.length === 0) { if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].owp = 0; return 0; }

        let totalOpponentWinPercentage = 0; let validOpponentCount = 0;
        opponents.forEach(oppId => {
            try {
                const opponentWinPerc = getPlayerSwissWinPercentage(oppId, maxRoundNumber, totalSwissRounds, currentStandingsCache); // Calls the modified WP calc
                if (typeof opponentWinPerc === 'number' && !isNaN(opponentWinPerc)) { totalOpponentWinPercentage += opponentWinPerc; validOpponentCount++; }
                else { console.warn(`calculateOWP (${cacheKey}): Invalid Win% for opponent ${oppId}.`); }
            } catch (e) { console.error(`calculateOWP (${cacheKey}): Error getting WP for opponent ${oppId}:`, e); }
        });

        const result = (validOpponentCount > 0) ? (totalOpponentWinPercentage / validOpponentCount) : 0;
        if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
        currentStandingsCache[cacheKey].owp = result;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`  DEBUG: OWP RESULT for ${cacheKey} (${playersData[effectivePlayerId]?.name}): Avg=${result.toFixed(4)}`);
        return result;
    }

    /** Calculates OOWP up to maxRoundNumber using TPCi rules. Uses cache. (TPCi v4.2) */
    function calculateOOWP(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache) {
        const effectivePlayerId = String(playerId);
        const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`;
        if (currentStandingsCache[cacheKey]?.oowp !== undefined) { return currentStandingsCache[cacheKey].oowp; }

        const opponents = getSwissOpponents(effectivePlayerId, maxRoundNumber);
        if (opponents.length === 0) { if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].oowp = 0; return 0; }

        let totalOpponentOWP = 0; let validOpponentCount = 0;
        opponents.forEach(oppId => {
            try {
                const oppOWP = calculateOWP(oppId, maxRoundNumber, totalSwissRounds, currentStandingsCache); // Calls the modified OWP calc
                 if (typeof oppOWP === 'number' && !isNaN(oppOWP)) { totalOpponentOWP += oppOWP; validOpponentCount++; }
                 else { console.warn(`calculateOOWP (${cacheKey}): Invalid OWP for opponent ${oppId}.`); }
            } catch (e) { console.error(`calculateOOWP (${cacheKey}): Error getting OWP for opponent ${oppId}:`, e); }
        });

        const result = (validOpponentCount > 0) ? (totalOpponentOWP / validOpponentCount) : 0;
        if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
        currentStandingsCache[cacheKey].oowp = result;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`DEBUG: OOWP RESULT for ${cacheKey} (${playersData[effectivePlayerId]?.name}): Avg=${result.toFixed(4)}`);
        return result;
    }


    /** Orchestrates calculation up to maxRoundNumber using TPCi rules (TPCi v4.2) */
    function calculateSwissStandingsForRound(maxRoundNumber) {
        if (DEBUG_STANDINGS) console.log(`\n--- Calculating Standings for Round ${maxRoundNumber} (TPCi Rules - No Bye Wins) ---`);
        const currentStandingsCache = {}; const standingsData = []; const allPlayerIds = Object.keys(playersData);
        if (allPlayerIds.length === 0) { return []; }
        const totalSwissRounds = getTotalSwissRounds();
        if (totalSwissRounds === 0) { return []; }
        if (DEBUG_STANDINGS) console.log(`   Detected Total Swiss Rounds: ${totalSwissRounds}`);

        if (DEBUG_STANDINGS) console.log(`\n--- STEP 1: Calculating Records & WPs (No Bye Wins) for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => { getPlayerSwissWinPercentage(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache); });
        if (DEBUG_STANDINGS) console.log(`\n--- STEP 2: Calculating OWPs for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => { calculateOWP(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache); });
        if (DEBUG_STANDINGS) console.log(`\n--- STEP 3: Calculating OOWPs & Final Data for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => {
            const cacheKey = `${playerId}_R${maxRoundNumber}`; const playerInfo = playersData[playerId]; const cachedData = currentStandingsCache[cacheKey];
            if (cachedData?.record && cachedData.wp !== undefined && cachedData.owp !== undefined && playerInfo) {
                try {
                    const oowp = calculateOOWP(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache);
                    const record = cachedData.record;
                    standingsData.push({ playerInfo, matchPoints: record.matchPoints, recordString: `${record.wins}-${record.losses}${record.ties > 0 ? '-' + record.ties : ''}`, owp: cachedData.owp, oowp });
                } catch (error) { console.error(`Error final OOWP step ${cacheKey}:`, error); }
            } else { console.warn(`calculateSwissStandingsForRound: Skipping ${playerId} - missing data.`); }
        });
        if (DEBUG_STANDINGS) console.log(`--- Standings Calculation Complete for Round ${maxRoundNumber} ---`);
        return standingsData;
    }

    /** Sorts standings: 1. Match Points, 2. OWP, 3. OOWP, 4. Name */
    function sortStandings(standingsData) {
        return standingsData.sort((a, b) => { if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints; const owpDiff = b.owp - a.owp; if (Math.abs(owpDiff) > 1e-9) return owpDiff; const oowpDiff = b.oowp - a.oowp; if (Math.abs(oowpDiff) > 1e-9) return oowpDiff; return a.playerInfo.name.localeCompare(b.playerInfo.name); });
    }

    /** Displays standings in the table. */
    function displayStandings(sortedStandings) {
        console.log("displayStandings: Starting display..."); if (!standingsTableBody) { return; } standingsTableBody.innerHTML = ''; if (!Array.isArray(sortedStandings) || sortedStandings.length === 0) { if (standingsContainer) standingsContainer.style.display = roundsData.some(r => r.type === "3") ? 'block' : 'none'; if(noStandingsMsg) noStandingsMsg.style.display = 'block'; return; } console.log(`displayStandings: Received ${sortedStandings.length} players.`); if(noStandingsMsg) noStandingsMsg.style.display = 'none'; if (standingsContainer) standingsContainer.style.display = 'block'; sortedStandings.forEach((data, index) => { try { const rank = index + 1; const row = standingsTableBody.insertRow(); const cellRank = row.insertCell(); cellRank.textContent = rank; cellRank.style.textAlign = 'center'; const cellName = row.insertCell(); cellName.textContent = data.playerInfo?.name || 'Unknown'; const cellRecord = row.insertCell(); cellRecord.textContent = data.recordString; cellRecord.style.textAlign = 'center'; const cellOWP = row.insertCell(); cellOWP.textContent = (data.owp * 100).toFixed(2); cellOWP.style.textAlign = 'right'; const cellOOWP = row.insertCell(); cellOOWP.textContent = (data.oowp * 100).toFixed(2); cellOOWP.style.textAlign = 'right'; } catch (error) { console.error(`Error displaying standings row ${index + 1}:`, error); } }); console.log("displayStandings: Display finished.");
    }


    // --- UI Update and Display Functions (FULL VERSION - v4.2 - Minor log change) ---
    function updateUI() {
        console.log("updateUI: Starting UI update...");
        try { if (Object.keys(playersData).length === 0 || roundsData.length === 0) { /* No data handling */ return; } /* ... Update pairings table, tabs etc. ... */ } catch (error) { console.error("updateUI: Error pairings update:", error); return; }
        if (Object.keys(playersData).length > 0 && roundsData.length > 0) {
            try { console.log("updateUI: >>> Starting Standings Update Logic <<<"); const swissRounds = roundsData.filter(r => r.type === "3"); if (swissRounds.length > 0) { const latestSwissRoundNumber = swissRounds[swissRounds.length - 1].roundNumber; console.log(`updateUI: Calculating standings as of Round ${latestSwissRoundNumber} (TPCi Rules - No Bye Wins)`); const standingsData = calculateSwissStandingsForRound(latestSwissRoundNumber); const sortedStandings = sortStandings(standingsData); displayStandings(sortedStandings); /* ... show standings ... */ } else { /* No swiss rounds handling */ } console.log("updateUI: >>> Standings section processing complete <<<"); } catch (error) { console.error("updateUI: CRITICAL Error standings update:", error); /* Standings error handling */ }
        } else { /* Hide standings */ }
        if (updateStatusElement) { updateStatusElement.textContent = `Updated`; /*...*/ } console.log("updateUI: Update finished.");
    }
    function getPlayerScoreBeforeRound(playerId, targetRoundNumber) { /* ... Full function ... */
        let wins = 0, losses = 0; const effectivePlayerId = String(playerId); if (!effectivePlayerId) return { wins, losses };
        for (const pastRound of roundsData) { if (pastRound.roundNumber >= targetRoundNumber) continue; for (const match of pastRound.matches) { const matchP1Id = String(match.player1Id); const matchP2Id = String(match.player2Id); if (match.isBye && matchP1Id === effectivePlayerId) { wins++; continue; } if (matchP1Id === effectivePlayerId) { if (match.outcome === 1) wins++; else if (match.outcome === 2) losses++; continue; } if (matchP2Id === effectivePlayerId) { if (match.outcome === 2) wins++; else if (match.outcome === 1) losses++; continue; } } }
        return { wins, losses };
    }
    function displayRound(roundNumber) { /* ... Full function ... */
        const round = roundsData.find(r => r.roundNumber === roundNumber); if (!round) { return; } if (currentRoundTitle) currentRoundTitle.textContent = `Round ${roundNumber} Pairings`; if (!pairingsTableBody) { return; } pairingsTableBody.innerHTML = ''; if (round.matches.length === 0) { return; } round.matches.forEach(match => { try { /* ... create row, get player info, scores, display ... */ } catch (error) { console.error(`Error displaying match row: ${JSON.stringify(match)}`, error); } });
    }
    function updateActiveTab() { /* ... Full function ... */ }
    function filterTable() { /* ... Full function ... */ }
    function checkClearButtonVisibility() { /* ... Full function ... */ }


    // --- Automatic Update Check ---
    async function checkForUpdates() { /* ... Full function ... */
         if (updateStatusElement) { updateStatusElement.textContent = `Checking...`; }
         const newDataProcessed = await loadTournamentData();
         if (newDataProcessed) { console.log("checkForUpdates: New data processed, updating UI."); updateUI(); }
    }

    // --- Initialisation ---
    async function initialize() { /* ... Full function ... */
         console.log("initialize: Starting initialization...");
         if(updateStatusElement) updateStatusElement.textContent = `Loading...`;
         await loadTournamentData();
         updateUI();
         checkClearButtonVisibility();
         if (updateIntervalId) clearInterval(updateIntervalId);
         updateIntervalId = setInterval(checkForUpdates, refreshInterval);
         console.log(`initialize: Started checking for updates every ${refreshInterval / 1000} seconds.`);
    }

    // --- Event Listeners ---
    if(searchInput) { searchInput.addEventListener('input', () => { filterTable(); checkClearButtonVisibility(); }); }
    if (clearSearchBtn) { clearSearchBtn.addEventListener('click', () => { if(searchInput) searchInput.value = ''; filterTable(); checkClearButtonVisibility(); if(searchInput) searchInput.focus(); }); }


    // --- Start the application ---
    initialize();

}); // End of DOMContentLoaded
