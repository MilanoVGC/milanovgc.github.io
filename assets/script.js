// Wait for the HTML document to be fully loaded before running script
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");
    console.log("--- Initializing Pairing/Standings Script (Debug Mode) ---");

    // --- DOM Element References ---
    // (Keep the existing DOM element references as they are)
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
    // standingsCache stores { playerId: { record: {...}, wp: number, owp: number, oowp: number } }
    // We will clear and recalculate this fully each time standings are generated for simplicity in debugging.
    let standingsCache = {};


    // --- Configuration ---
    const xmlFilePath = 'data/tournament_data.xml';
    const refreshInterval = 15000; // 15 seconds
    const OWP_MINIMUM = 1 / 3; // Use precise fraction for minimum WP (Standard Rule)
    const CURRENT_YEAR = new Date().getFullYear();
    const DEBUG_STANDINGS = true; // <<< SET TO true TO ENABLE DETAILED LOGGING


    // --- Core Data Loading and Parsing (Keep Existing `loadTournamentData` and `extractData`) ---
    async function loadTournamentData() {
        // ... (Keep the existing loadTournamentData function from the previous version) ...
        // It should fetch, parse XML, check timeelapsed, and call extractData()
        // NO CHANGES NEEDED HERE FOR DEBUGGING STANDINGS
        console.log("loadTournamentData: Starting fetch...");
        try {
            const response = await fetch(`${xmlFilePath}?t=${new Date().getTime()}`);
            console.log(`loadTournamentData: Fetch status: ${response.status}`);
            if (!response.ok) { /* ... error handling ... */ return false; }
            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");
            const parseError = xmlDoc.querySelector("parsererror");
            if (parseError) { /* ... error handling ... */ return false; }
            console.log("loadTournamentData: XML parsed successfully.");
            const currentTimeElapsedElement = xmlDoc.querySelector('tournament > timeelapsed');
            const currentTimeElapsed = currentTimeElapsedElement ? parseInt(currentTimeElapsedElement.textContent, 10) : -1;
            if (currentTimeElapsed !== -1 && currentTimeElapsed === lastKnownTimeElapsed) {
                console.log("loadTournamentData: No change detected (timeelapsed).");
                updateStatusElement.textContent = `Up to date`; updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                return false;
            }
            console.log("loadTournamentData: Change detected or initial load. Processing XML...");
            extractData(xmlDoc); // Call extraction
            lastKnownTimeElapsed = currentTimeElapsed;
            // standingsCache = {}; // Cache is cleared within calculateSwissStandings now
            console.log("loadTournamentData: Data extraction seems complete.");
            return true;
        } catch (error) { /* ... error handling ... */ return false; }
    }

    function extractData(xmlDoc) {
         // ... (Keep the existing extractData function from the previous version) ...
         // It should parse players and rounds/matches into playersData and roundsData
         // NO CHANGES NEEDED HERE FOR DEBUGGING STANDINGS
         console.log("extractData: Starting extraction...");
         playersData = {}; roundsData = []; let extractionError = false;
         try {
            const tournamentData = xmlDoc.querySelector('tournament > data');
            if (tournamentData && tournamentInfoElement) { /* ... set location ... */ }
            const tempPlayersData = {};
            const playerElements = xmlDoc.querySelectorAll('tournament > players > player');
            playerElements.forEach((player, index) => { /* ... extract player details ... */ });
            playersData = tempPlayersData;
            console.log(`extractData: Extracted ${Object.keys(playersData).length} players.`);
            const tempRoundsData = [];
            const roundElements = xmlDoc.querySelectorAll('tournament > pods > pod > rounds > round');
            roundElements.forEach((round, roundIndex) => { /* ... extract round/match details ... */ });
            tempRoundsData.sort((a, b) => a.roundNumber - b.roundNumber);
            roundsData = tempRoundsData;
            console.log(`extractData: Extracted ${roundsData.length} rounds.`);
         } catch (error) { /* ... error handling ... */ extractionError = true; }
         finally { console.log(`extractData: Finished. Error: ${extractionError}`); }
    }


    // --- Standings Calculation Logic (REVISED with DEBUG LOGGING) ---

    /** Calculates record ONLY from Swiss rounds up to maxRoundNumber. */
    function calculatePlayerSwissRecord(playerId, maxRoundNumber) {
        let wins = 0, losses = 0, ties = 0, byes = 0, matchPoints = 0, roundsPlayed = 0;
        if (!playerId) return { wins, losses, ties, byes, matchPoints, roundsPlayed };

        for (const round of roundsData) {
            if (round.type !== "3" || round.roundNumber > maxRoundNumber) continue; // Only Swiss rounds up to the limit

            let playedThisRound = false;
            for (const match of round.matches) {
                let playerFound = false;
                if (match.isBye && match.player1Id === playerId) {
                    wins++; byes++; matchPoints += 3; playerFound = true;
                } else if (match.player1Id === playerId) {
                    if (match.outcome === 1) { wins++; matchPoints += 3; }
                    else if (match.outcome === 2) { losses++; matchPoints += 0; }
                    else if (match.outcome === 3 || match.outcome === 4) { ties++; matchPoints += 1; }
                    else { matchPoints += 0; } // Unknown outcome
                    playerFound = true;
                } else if (match.player2Id === playerId) {
                    if (match.outcome === 1) { losses++; matchPoints += 0; }
                    else if (match.outcome === 2) { wins++; matchPoints += 3; }
                    else if (match.outcome === 3 || match.outcome === 4) { ties++; matchPoints += 1; }
                    else { matchPoints += 0; } // Unknown outcome
                    playerFound = true;
                }
                if (playerFound) { playedThisRound = true; break; }
            }
            if (playedThisRound) roundsPlayed++;
        }
        if (DEBUG_STANDINGS) console.log(`      DEBUG: Record for ${playersData[playerId]?.name} (${playerId}) up to R${maxRoundNumber}: ${wins}-${losses}-${ties} (${matchPoints}pts, ${roundsPlayed} rounds)`);
        return { wins, losses, ties, byes, matchPoints, roundsPlayed };
    }

    /** Gets opponents from Swiss rounds up to maxRoundNumber. Excludes byes. */
    function getSwissOpponents(playerId, maxRoundNumber) {
        const opponents = new Set();
        if (!playerId) return [];
        for (const round of roundsData) {
            if (round.type !== "3" || round.roundNumber > maxRoundNumber) continue;
            for (const match of round.matches) {
                if (match.isBye) continue;
                if (match.player1Id === playerId && match.player2Id) opponents.add(match.player2Id);
                else if (match.player2Id === playerId && match.player1Id) opponents.add(match.player1Id);
            }
        }
        const opponentList = Array.from(opponents);
         if (DEBUG_STANDINGS) console.log(`      DEBUG: Opponents for ${playersData[playerId]?.name} (${playerId}) up to R${maxRoundNumber}: [${opponentList.join(', ')}]`);
        return opponentList;
    }


    /** Calculates WP up to maxRoundNumber. Uses cache if available for that round. */
    function getPlayerSwissWinPercentage(playerId, maxRoundNumber, minPercentage, currentStandingsCache) {
        const cacheKey = `${playerId}_R${maxRoundNumber}`;
        if (currentStandingsCache[cacheKey]?.wp !== undefined) {
             if (DEBUG_STANDINGS) console.log(`    DEBUG: WP CACHE HIT for ${cacheKey}: ${currentStandingsCache[cacheKey].wp.toFixed(4)}`);
            return currentStandingsCache[cacheKey].wp;
        }

        let record;
        // Use cached record if available FOR THIS ROUND, otherwise calculate
        if (currentStandingsCache[cacheKey]?.record) {
             record = currentStandingsCache[cacheKey].record;
        } else {
             record = calculatePlayerSwissRecord(playerId, maxRoundNumber);
             if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
             currentStandingsCache[cacheKey].record = record; // Cache the calculated record
        }


        const totalPossiblePoints = record.roundsPlayed * 3;
        let finalWP;
        if (totalPossiblePoints === 0) {
            finalWP = minPercentage; // If no rounds played, use minimum
        } else {
            const winRate = record.matchPoints / totalPossiblePoints;
            finalWP = Math.max(winRate, minPercentage);
        }

        // Cache the calculated WP
        if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
        currentStandingsCache[cacheKey].wp = finalWP;

         if (DEBUG_STANDINGS) console.log(`    DEBUG: WP CALC for ${cacheKey} (${playersData[playerId]?.name}): MP=${record.matchPoints}, Rounds=${record.roundsPlayed}, Raw=${(totalPossiblePoints === 0 ? 'N/A' : (record.matchPoints / totalPossiblePoints).toFixed(4))}, Final=${finalWP.toFixed(4)}`);
        return finalWP;
    }


    /** Calculates OWP up to maxRoundNumber. Uses cache. */
    function calculateOWP(playerId, maxRoundNumber, minPercentage, currentStandingsCache) {
        const cacheKey = `${playerId}_R${maxRoundNumber}`;
        if (currentStandingsCache[cacheKey]?.owp !== undefined) {
            // if (DEBUG_STANDINGS) console.log(`  DEBUG: OWP CACHE HIT for ${cacheKey}: ${currentStandingsCache[cacheKey].owp.toFixed(4)}`);
            return currentStandingsCache[cacheKey].owp;
        }

        const opponents = getSwissOpponents(playerId, maxRoundNumber);
        if (opponents.length === 0) {
            if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
            currentStandingsCache[cacheKey].owp = 0;
             if (DEBUG_STANDINGS) console.log(`  DEBUG: OWP CALC for ${cacheKey} (${playersData[playerId]?.name}): 0 (No opponents)`);
            return 0;
        }

        let totalOpponentWinPercentage = 0;
        let validOpponentCount = 0;
         if (DEBUG_STANDINGS) console.log(`  DEBUG: OWP CALC for ${cacheKey} (${playersData[playerId]?.name}), Opponents: [${opponents.join(', ')}]`);

        opponents.forEach(oppId => {
            try {
                // Get opponent's WP *for the same round limit*
                const opponentWinPerc = getPlayerSwissWinPercentage(oppId, maxRoundNumber, minPercentage, currentStandingsCache);
                if (typeof opponentWinPerc === 'number' && !isNaN(opponentWinPerc)) {
                    totalOpponentWinPercentage += opponentWinPerc;
                    validOpponentCount++;
                     if (DEBUG_STANDINGS) console.log(`      Opponent ${oppId} WP: ${opponentWinPerc.toFixed(4)}`);
                } else { console.warn(`calculateOWP (${cacheKey}): Invalid Win% (${opponentWinPerc}) for opponent ${oppId}.`); }
            } catch (e) { console.error(`calculateOWP (${cacheKey}): Error getting WP for opponent ${oppId}:`, e); }
        });

        const result = (validOpponentCount > 0) ? (totalOpponentWinPercentage / validOpponentCount) : 0;
        if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
        currentStandingsCache[cacheKey].owp = result;
         if (DEBUG_STANDINGS) console.log(`  DEBUG: OWP RESULT for ${cacheKey} (${playersData[playerId]?.name}): Sum=${totalOpponentWinPercentage.toFixed(4)}, Count=${validOpponentCount}, Avg=${result.toFixed(4)}`);
        return result;
    }

    /** Calculates OOWP up to maxRoundNumber. Uses cache. */
    function calculateOOWP(playerId, maxRoundNumber, minPercentage, currentStandingsCache) {
        const cacheKey = `${playerId}_R${maxRoundNumber}`;
        if (currentStandingsCache[cacheKey]?.oowp !== undefined) {
            // if (DEBUG_STANDINGS) console.log(`DEBUG: OOWP CACHE HIT for ${cacheKey}: ${currentStandingsCache[cacheKey].oowp.toFixed(4)}`);
            return currentStandingsCache[cacheKey].oowp;
        }

        const opponents = getSwissOpponents(playerId, maxRoundNumber);
        if (opponents.length === 0) {
             if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
             currentStandingsCache[cacheKey].oowp = 0;
              if (DEBUG_STANDINGS) console.log(`DEBUG: OOWP CALC for ${cacheKey} (${playersData[playerId]?.name}): 0 (No opponents)`);
             return 0;
        }

        let totalOpponentOWP = 0;
        let validOpponentCount = 0;
        if (DEBUG_STANDINGS) console.log(`DEBUG: OOWP CALC for ${cacheKey} (${playersData[playerId]?.name}), Opponents: [${opponents.join(', ')}]`);

        opponents.forEach(oppId => {
            try {
                // Get opponent's OWP *for the same round limit*
                const oppOWP = calculateOWP(oppId, maxRoundNumber, minPercentage, currentStandingsCache);
                 if (typeof oppOWP === 'number' && !isNaN(oppOWP)) {
                    totalOpponentOWP += oppOWP;
                    validOpponentCount++;
                     if (DEBUG_STANDINGS) console.log(`    Opponent ${oppId} OWP: ${oppOWP.toFixed(4)}`);
                } else { console.warn(`calculateOOWP (${cacheKey}): Invalid OWP (${oppOWP}) for opponent ${oppId}.`); }
            } catch (e) { console.error(`calculateOOWP (${cacheKey}): Error getting OWP for opponent ${oppId}:`, e); }
        });

        const result = (validOpponentCount > 0) ? (totalOpponentOWP / validOpponentCount) : 0;
        if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
        currentStandingsCache[cacheKey].oowp = result;
         if (DEBUG_STANDINGS) console.log(`DEBUG: OOWP RESULT for ${cacheKey} (${playersData[playerId]?.name}): Sum=${totalOpponentOWP.toFixed(4)}, Count=${validOpponentCount}, Avg=${result.toFixed(4)}`);
        return result;
    }


    /** Orchestrates calculation up to maxRoundNumber */
    function calculateSwissStandingsForRound(maxRoundNumber) {
        if (DEBUG_STANDINGS) console.log(`\n--- Calculating Standings for Round ${maxRoundNumber} ---`);
        const currentStandingsCache = {}; // Use a temporary cache for this round's calculation
        const standingsData = [];
        const allPlayerIds = Object.keys(playersData);

        // Pre-calculate Records and WPs (necessary for OWP/OOWP dependencies)
         if (DEBUG_STANDINGS) console.log(`\n--- STEP 1: Calculating Records & WPs for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => {
            getPlayerSwissWinPercentage(playerId, maxRoundNumber, OWP_MINIMUM, currentStandingsCache);
        });

         if (DEBUG_STANDINGS) console.log(`\n--- STEP 2: Calculating OWPs for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => {
             calculateOWP(playerId, maxRoundNumber, OWP_MINIMUM, currentStandingsCache);
        });

         if (DEBUG_STANDINGS) console.log(`\n--- STEP 3: Calculating OOWPs & Final Data for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => {
            const cacheKey = `${playerId}_R${maxRoundNumber}`;
            const playerInfo = playersData[playerId];
            const cachedData = currentStandingsCache[cacheKey];

            if (cachedData && cachedData.record && cachedData.wp !== undefined && cachedData.owp !== undefined && playerInfo) {
                try {
                    const oowp = calculateOOWP(playerId, maxRoundNumber, OWP_MINIMUM, currentStandingsCache);
                    cachedData.oowp = oowp; // Ensure it's cached

                    const record = cachedData.record;
                    standingsData.push({
                        playerInfo: playerInfo,
                        matchPoints: record.matchPoints,
                        recordString: `${record.wins}-${record.losses}${record.ties > 0 ? '-' + record.ties : ''}`,
                        owp: cachedData.owp,
                        oowp: oowp
                    });
                } catch (error) { console.error(`Error in final OOWP calc for ${cacheKey}:`, error); /* Handle error, maybe push default data */ }
            } else { console.warn(`calculateSwissStandingsForRound: Skipping ${playerId} - missing critical cached data.`); }
        });

         if (DEBUG_STANDINGS) console.log(`--- Standings Calculation Complete for Round ${maxRoundNumber} ---`);
        return standingsData;
    }

    /** Sorts standings data based on standard tiebreakers. */
    function sortStandings(standingsData) {
        // ... (Keep the existing sortStandings function - standard tiebreakers) ...
         return standingsData.sort((a, b) => {
            if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
            const owpDiff = b.owp - a.owp; if (Math.abs(owpDiff) > 1e-9) return owpDiff;
            const oowpDiff = b.oowp - a.oowp; if (Math.abs(oowpDiff) > 1e-9) return oowpDiff;
            return a.playerInfo.name.localeCompare(b.playerInfo.name);
        });
    }

    /** Displays standings in the table. */
    function displayStandings(sortedStandings) {
         // ... (Keep the existing displayStandings function - populates the table) ...
         console.log("displayStandings: Starting display...");
         if (!standingsTableBody) { /* ... error ... */ return; }
         standingsTableBody.innerHTML = '';
         if (!Array.isArray(sortedStandings) || sortedStandings.length === 0) { /* ... handle no data ... */ return; }
         if (standingsContainer) standingsContainer.style.display = 'block';
         sortedStandings.forEach((data, index) => {
             try {
                const rank = index + 1; const row = standingsTableBody.insertRow();
                const cellRank = row.insertCell(); cellRank.textContent = rank; cellRank.style.textAlign = 'center';
                const cellName = row.insertCell(); cellName.textContent = data.playerInfo?.name || 'Unknown';
                const cellRecord = row.insertCell(); cellRecord.textContent = data.recordString; cellRecord.style.textAlign = 'center';
                const cellOWP = row.insertCell(); cellOWP.textContent = (data.owp * 100).toFixed(2); cellOWP.style.textAlign = 'right';
                const cellOOWP = row.insertCell(); cellOOWP.textContent = (data.oowp * 100).toFixed(2); cellOOWP.style.textAlign = 'right';
            } catch (error) { console.error(`Error displaying standings row ${index+1}:`, error); }
         });
         console.log("displayStandings: Display finished.");
    }


    // --- UI Update and Display Functions (Minor changes to call standings calc) ---

    function updateUI() {
        console.log("updateUI: Starting UI update...");
        // ... (Keep existing pairings update logic: check data, update tabs, displayRound, filterTable) ...
        try {
             if (Object.keys(playersData).length === 0 || roundsData.length === 0) { /* ... handle no data ... */ return; }
             const latestRoundNumber = roundsData.length > 0 ? roundsData[roundsData.length - 1].roundNumber : 1;
             // ... update tabs if needed ...
             displayRound(currentRound); updateActiveTab();
             if (loadingMessage) loadingMessage.style.display = 'none';
             if (pairingsTable) pairingsTable.style.display = 'table';
             if (currentRoundTitle) currentRoundTitle.style.display = 'block';
             filterTable();
        } catch (error) { /* ... handle pairings error ... */ return; }


        // --- Update Standings Section ---
        if (Object.keys(playersData).length > 0 && roundsData.length > 0) {
            try {
                console.log("updateUI: >>> Starting Standings Update Logic <<<");
                // Determine the *latest completed Swiss round* to calculate standings for
                const swissRounds = roundsData.filter(r => r.type === "3");
                if (swissRounds.length > 0) {
                    const latestSwissRoundNumber = swissRounds[swissRounds.length - 1].roundNumber;
                    console.log(`updateUI: Calculating standings as of Round ${latestSwissRoundNumber}`);

                    // Calculate standings FOR THAT SPECIFIC ROUND
                    const standingsData = calculateSwissStandingsForRound(latestSwissRoundNumber);
                    const sortedStandings = sortStandings(standingsData);
                    displayStandings(sortedStandings);

                    if (standingsContainer) standingsContainer.style.display = 'block';
                    if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
                    if (noStandingsMsg) noStandingsMsg.style.display = 'none';

                } else {
                    // No Swiss rounds found
                    console.log("updateUI: No swiss rounds exist, hiding standings.");
                    if (standingsContainer) standingsContainer.style.display = 'none';
                    if (noStandingsMsg) { noStandingsMsg.style.display = 'block'; noStandingsMsg.textContent = "No Swiss rounds found to calculate standings."; }
                    if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
                    if (standingsTableBody) standingsTableBody.innerHTML = '';
                }
                console.log("updateUI: >>> Standings section processing complete <<<");
            } catch (error) { /* ... handle standings error ... */ }
        } else { /* ... hide standings if no data ... */ }

        if (updateStatusElement) { /* ... update status ... */ }
        console.log("updateUI: Update finished.");
    }

    // ... (Keep existing getPlayerScoreBeforeRound, displayRound, updateActiveTab, filterTable, checkClearButtonVisibility) ...
    function getPlayerScoreBeforeRound(playerId, targetRoundNumber) { /* ... unchanged ... */
        let wins = 0; let losses = 0; if (!playerId) return { wins, losses };
        for (const pastRound of roundsData) { if (pastRound.roundNumber >= targetRoundNumber) continue;
            for (const match of pastRound.matches) { /* ... find match and increment W/L ... */ } }
        return { wins, losses };
    }
    function displayRound(roundNumber) { /* ... unchanged ... */ }
    function updateActiveTab() { /* ... unchanged ... */ }
    function filterTable() { /* ... unchanged ... */ }
    function checkClearButtonVisibility() { /* ... unchanged ... */ }


    // --- Automatic Update Check (Unchanged) ---
    async function checkForUpdates() {
        // ... (Keep existing checkForUpdates function - calls loadTournamentData and updateUI if needed) ...
        if (updateStatusElement) { updateStatusElement.textContent = `Checking...`; /* ... */ }
        const newDataProcessed = await loadTournamentData();
        if (newDataProcessed) { console.log("checkForUpdates: New data processed, updating UI."); updateUI(); }
    }

    // --- Initialisation (Unchanged) ---
    async function initialize() {
         // ... (Keep existing initialize function - calls loadTournamentData, updateUI, checkClearButtonVisibility, setInterval) ...
         console.log("initialize: Starting initialization...");
         if(updateStatusElement) updateStatusElement.textContent = `Loading...`;
         await loadTournamentData();
         updateUI();
         checkClearButtonVisibility();
         if (updateIntervalId) clearInterval(updateIntervalId);
         updateIntervalId = setInterval(checkForUpdates, refreshInterval);
         console.log(`initialize: Started checking for updates every ${refreshInterval / 1000} seconds.`);
    }

    // --- Event Listeners (Unchanged) ---
    // ... (Keep existing event listeners for searchInput and clearSearchBtn) ...
    if(searchInput) { searchInput.addEventListener('input', () => { filterTable(); checkClearButtonVisibility(); }); }
    if (clearSearchBtn) { clearSearchBtn.addEventListener('click', () => { /* ... clear search ... */ }); }


    // --- Start the application ---
    initialize();

}); // End of DOMContentLoaded
