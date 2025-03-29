// Wait for the HTML document to be fully loaded before running script
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");
    console.log("--- Initializing Pairing/Standings Script (Debug Mode - v3 Full w/ Record Debug) ---");

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
    const OWP_MINIMUM = 1 / 3; // Use precise fraction for minimum WP (Standard Rule)
    const CURRENT_YEAR = new Date().getFullYear();
    const DEBUG_STANDINGS = true; // <<< SET TO true TO ENABLE DETAILED LOGGING


    // --- Core Data Loading and Parsing (FULL VERSION) ---
    async function loadTournamentData() {
        console.log("loadTournamentData: Starting fetch...");
        try {
            // Append timestamp to prevent browser caching of the XML file
            const response = await fetch(`${xmlFilePath}?t=${new Date().getTime()}`);
            console.log(`loadTournamentData: Fetch status: ${response.status}`);

            if (!response.ok) {
                if (response.status === 404) {
                    console.log(`Tournament data file not found at ${xmlFilePath}. Waiting...`);
                    updateStatusElement.textContent = `Waiting for data...`;
                } else {
                    console.error(`HTTP error! status: ${response.status}, file: ${xmlFilePath}`);
                    updateStatusElement.textContent = `Error (${response.status})`;
                }
                updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                return false; // Indicate failure or no data yet
            }

            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");

            // Check for XML parsing errors
            const parseError = xmlDoc.querySelector("parsererror");
            if (parseError) {
                console.error("XML Parsing Error:", parseError.textContent);
                updateStatusElement.textContent = `Parse Error`;
                updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                if (lastKnownTimeElapsed !== -1 && loadingMessage) { /* ... error message ... */ }
                return false; // Indicate parse failure
            }
            console.log("loadTournamentData: XML parsed successfully.");

            // Check if the file content has actually changed using <timeelapsed>
            const currentTimeElapsedElement = xmlDoc.querySelector('tournament > timeelapsed');
            const currentTimeElapsed = currentTimeElapsedElement ? parseInt(currentTimeElapsedElement.textContent, 10) : -1;

            if (currentTimeElapsed !== -1 && currentTimeElapsed === lastKnownTimeElapsed) {
                console.log("loadTournamentData: No change detected (timeelapsed).");
                updateStatusElement.textContent = `Up to date`; updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                return false; // Indicate no new data processed
            }

            console.log("loadTournamentData: Change detected or initial load. Processing XML...");
            // >>>>>> CALL THE FULL extractData function <<<<<<
            extractData(xmlDoc);
            lastKnownTimeElapsed = currentTimeElapsed; // Update the last known time
            console.log("loadTournamentData: Data extraction call complete.");
            return true; // Indicate new data was processed

        } catch (error) {
            console.error("loadTournamentData: Error during fetch/parse:", error);
            updateStatusElement.textContent = `Fetch Error`; updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
            if (lastKnownTimeElapsed !== -1 && loadingMessage) { /* ... error message ... */ }
            return false; // Indicate fetch/parse error
        }
    }

    function extractData(xmlDoc) {
         console.log("extractData: Starting extraction...");
         // Reset global data stores
         playersData = {};
         roundsData = [];
         let extractionError = false;

         try {
             // Extract Tournament Info
             const tournamentData = xmlDoc.querySelector('tournament > data');
             if (tournamentData && tournamentInfoElement) {
                 const city = tournamentData.querySelector('city')?.textContent;
                 const country = tournamentData.querySelector('country')?.textContent;
                 tournamentInfoElement.textContent = `${city ? city + ', ' : ''}${country || ''}`.trim();
             }

             // Extract Players
             const tempPlayersData = {};
             const playerElements = xmlDoc.querySelectorAll('tournament > players > player');
             console.log(`extractData: Found ${playerElements.length} player elements using selector.`);

             playerElements.forEach((player, index) => {
                 const userId = player.getAttribute('userid'); // UserId is likely a string from XML attribute
                 const firstName = player.querySelector('firstname')?.textContent || '';
                 const lastName = player.querySelector('lastname')?.textContent || '';
                 const birthdateElement = player.querySelector('birthdate');
                 const birthdateText = birthdateElement?.textContent;
                 let birthYear = null;

                 if (birthdateText) { /* ... parsing logic ... */ }

                 if (userId) {
                     // Ensure player ID is stored consistently (e.g., as string)
                     tempPlayersData[String(userId)] = { id: String(userId), firstName, lastName, name: `${firstName} ${lastName}`.trim(), birthYear: birthYear };
                 } else { console.warn(`extractData: Player at index ${index} missing userid attribute.`); }
             });
             playersData = tempPlayersData; // Assign to global variable
             console.log(`extractData: Extracted ${Object.keys(playersData).length} players successfully into playersData.`);

             // Extract Rounds and Matches
             const tempRoundsData = [];
             const roundElements = xmlDoc.querySelectorAll('tournament > pods > pod > rounds > round');
             console.log(`extractData: Found ${roundElements.length} round elements using selector.`);

             roundElements.forEach((round, roundIndex) => {
                 const roundNumber = parseInt(round.getAttribute('number'), 10);
                 const roundType = round.getAttribute('type'); // Keep as string ('3', '1', etc.)

                 if (isNaN(roundNumber)) { console.warn(`extractData: Skipping round index ${roundIndex} invalid number.`); return; }

                 const matches = [];
                 const matchElements = round.querySelectorAll('matches > match');

                 matchElements.forEach((match, matchIndex) => {
                     const tableNumber = parseInt(match.querySelector('tablenumber')?.textContent || '0', 10);
                     const outcome = parseInt(match.getAttribute('outcome'), 10);
                     const player1Element = match.querySelector('player1');
                     const player2Element = match.querySelector('player2');
                     const singlePlayerElement = match.querySelector('player'); // For Byes

                     let matchData = { table: tableNumber, player1Id: null, player2Id: null, outcome: outcome, isBye: false };

                     // Ensure IDs extracted from matches are also stored as strings for consistent comparison
                     if (outcome === 5 && singlePlayerElement) {
                         matchData.player1Id = String(singlePlayerElement.getAttribute('userid')); // Ensure string
                         matchData.isBye = true;
                     } else if (player1Element && player2Element) {
                         matchData.player1Id = String(player1Element.getAttribute('userid')); // Ensure string
                         matchData.player2Id = String(player2Element.getAttribute('userid')); // Ensure string
                     } else {
                         console.warn(`extractData: Skipping malformed match R ${roundNumber} index ${matchIndex}.`);
                         return;
                     }

                     matches.push(matchData);
                 });
                 matches.sort((a, b) => a.table - b.table);
                 tempRoundsData.push({ roundNumber, type: roundType, matches });
             });
             tempRoundsData.sort((a, b) => a.roundNumber - b.roundNumber);
             roundsData = tempRoundsData; // Assign to global variable
             console.log(`extractData: Extracted ${roundsData.length} rounds successfully into roundsData.`);

         } catch (error) { console.error("extractData: CRITICAL Error during extraction:", error); extractionError = true; playersData = {}; roundsData = []; /* ... show error message ... */ }
         finally { console.log(`extractData: Finished extraction. playersData size: ${Object.keys(playersData).length}, roundsData size: ${roundsData.length}, Error occurred: ${extractionError}`); }
    }


    // --- Standings Calculation Logic (Functions START here) ---

    /** Calculates record ONLY from Swiss rounds up to maxRoundNumber. (DEBUG v3) */
    function calculatePlayerSwissRecord(playerId, maxRoundNumber) {
        let wins = 0, losses = 0, ties = 0, byes = 0, matchPoints = 0, roundsPlayed = 0;
        const effectivePlayerId = String(playerId); // Ensure we are comparing strings

        if (DEBUG_STANDINGS) console.log(`      --> Entering calculatePlayerSwissRecord for Player ${effectivePlayerId} (Target R${maxRoundNumber})`);

        if (!effectivePlayerId) {
             if (DEBUG_STANDINGS) console.warn(`      --> calculatePlayerSwissRecord called with null/undefined playerId`);
             return { wins, losses, ties, byes, matchPoints, roundsPlayed };
        }

        for (const round of roundsData) {
            // Round Type '3' is Swiss
            const isSwissRound = round.type === "3";
            const isWithinLimit = round.roundNumber <= maxRoundNumber;
            const shouldProcessRound = isSwissRound && isWithinLimit;

            if (DEBUG_STANDINGS) console.log(`        Processing Round ${round.roundNumber} (Type: ${round.type}). IsSwiss=${isSwissRound}, IsWithinLimit=${isWithinLimit}. ShouldProcess=${shouldProcessRound}`);

            if (!shouldProcessRound) continue; // Skip non-Swiss or future rounds

            let playedThisRound = false;
            let matchFoundForPlayerThisRound = false; // Specific flag for debugging

            for (const match of round.matches) {
                let playerFoundInThisMatch = false; // Flag for *this specific match*
                const matchP1Id = String(match.player1Id); // Ensure string comparison
                const matchP2Id = String(match.player2Id); // Ensure string comparison

                if (DEBUG_STANDINGS) console.log(`          Checking Match: P1=${matchP1Id}, P2=${matchP2Id}, Bye=${match.isBye}, Outcome=${match.outcome}`);
                if (DEBUG_STANDINGS) console.log(`            Comparing against Player ID: ${effectivePlayerId} (Type: ${typeof effectivePlayerId})`);


                if (match.isBye && matchP1Id === effectivePlayerId) {
                    if (DEBUG_STANDINGS) console.log(`            MATCH FOUND: Player ${effectivePlayerId} has a BYE in R${round.roundNumber}`);
                    wins++; byes++; matchPoints += 3;
                    playerFoundInThisMatch = true;
                } else if (matchP1Id === effectivePlayerId) {
                     if (DEBUG_STANDINGS) console.log(`            MATCH FOUND: Player ${effectivePlayerId} is P1 in R${round.roundNumber} vs ${matchP2Id}`);
                     if (match.outcome === 1) { wins++; matchPoints += 3; if (DEBUG_STANDINGS) console.log(`              Result: Win`); }
                     else if (match.outcome === 2) { losses++; matchPoints += 0; if (DEBUG_STANDINGS) console.log(`              Result: Loss`); }
                     else if (match.outcome === 3 || match.outcome === 4) { ties++; matchPoints += 1; if (DEBUG_STANDINGS) console.log(`              Result: Tie/DoubleLoss`); }
                     else { matchPoints += 0; if (DEBUG_STANDINGS) console.log(`              Result: Unknown/No Points`); }
                     playerFoundInThisMatch = true;
                } else if (matchP2Id === effectivePlayerId) { // Check P2, ensure matchP2Id is not null/empty for non-byes
                     if (DEBUG_STANDINGS) console.log(`            MATCH FOUND: Player ${effectivePlayerId} is P2 in R${round.roundNumber} vs ${matchP1Id}`);
                     if (match.outcome === 1) { losses++; matchPoints += 0; if (DEBUG_STANDINGS) console.log(`              Result: Loss`); }
                     else if (match.outcome === 2) { wins++; matchPoints += 3; if (DEBUG_STANDINGS) console.log(`              Result: Win`); }
                     else if (match.outcome === 3 || match.outcome === 4) { ties++; matchPoints += 1; if (DEBUG_STANDINGS) console.log(`              Result: Tie/DoubleLoss`); }
                     else { matchPoints += 0; if (DEBUG_STANDINGS) console.log(`              Result: Unknown/No Points`); }
                     playerFoundInThisMatch = true;
                }

                if (playerFoundInThisMatch) {
                    playedThisRound = true; // Mark that the player participated in this round
                    matchFoundForPlayerThisRound = true; // Mark specific match found
                    break; // IMPORTANT: Stop checking other matches in this round for this player
                }
            } // End inner loop (matches)

            if (!matchFoundForPlayerThisRound && isSwissRound && isWithinLimit) {
                 if (DEBUG_STANDINGS) console.warn(`        WARNING: No match found for Player ${effectivePlayerId} in Round ${round.roundNumber}, although round should be counted.`);
            }

            if (playedThisRound) {
                 if (DEBUG_STANDINGS) console.log(`        Player ${effectivePlayerId} played in Round ${round.roundNumber}. Incrementing roundsPlayed.`);
                roundsPlayed++;
            }

        } // End outer loop (rounds)

        if (DEBUG_STANDINGS) console.log(`      <-- Exiting calculatePlayerSwissRecord for Player ${effectivePlayerId} (Target R${maxRoundNumber}). Final Record: ${wins}-${losses}-${ties} (${matchPoints}pts, ${roundsPlayed} rounds)`);
        return { wins, losses, ties, byes, matchPoints, roundsPlayed };
    }

    /** Gets opponents from Swiss rounds up to maxRoundNumber. Excludes byes. */
    function getSwissOpponents(playerId, maxRoundNumber) {
        const opponents = new Set();
        const effectivePlayerId = String(playerId); // Ensure string
        if (!effectivePlayerId) return [];

        for (const round of roundsData) {
            if (round.type !== "3" || round.roundNumber > maxRoundNumber) continue;
            for (const match of round.matches) {
                if (match.isBye) continue;
                const matchP1Id = String(match.player1Id); // Ensure string
                const matchP2Id = String(match.player2Id); // Ensure string
                if (matchP1Id === effectivePlayerId && matchP2Id) opponents.add(matchP2Id);
                else if (matchP2Id === effectivePlayerId && matchP1Id) opponents.add(matchP1Id);
            }
        }
        const opponentList = Array.from(opponents);
         if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`      DEBUG: Opponents for ${playersData[effectivePlayerId]?.name} (${effectivePlayerId}) up to R${maxRoundNumber}: [${opponentList.join(', ')}]`);
        return opponentList;
    }


    /** Calculates WP up to maxRoundNumber. Uses cache if available for that round. */
    function getPlayerSwissWinPercentage(playerId, maxRoundNumber, minPercentage, currentStandingsCache) {
         const effectivePlayerId = String(playerId); // Ensure string
        const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`;
        if (currentStandingsCache[cacheKey]?.wp !== undefined) {
             if (DEBUG_STANDINGS) console.log(`    DEBUG: WP CACHE HIT for ${cacheKey}: ${currentStandingsCache[cacheKey].wp.toFixed(4)}`);
            return currentStandingsCache[cacheKey].wp;
        }

        let record;
        if (currentStandingsCache[cacheKey]?.record) { record = currentStandingsCache[cacheKey].record; }
        else {
             record = calculatePlayerSwissRecord(effectivePlayerId, maxRoundNumber); // Use effectivePlayerId
             if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
             currentStandingsCache[cacheKey].record = record; // Cache the calculated record
        }

        const totalPossiblePoints = record.roundsPlayed * 3;
        let finalWP;
        if (totalPossiblePoints === 0) { finalWP = minPercentage; }
        else { const winRate = record.matchPoints / totalPossiblePoints; finalWP = Math.max(winRate, minPercentage); }

        if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
        currentStandingsCache[cacheKey].wp = finalWP;

         if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`    DEBUG: WP CALC for ${cacheKey} (${playersData[effectivePlayerId]?.name}): MP=${record.matchPoints}, Rounds=${record.roundsPlayed}, Raw=${(totalPossiblePoints === 0 ? 'N/A' : (record.matchPoints / totalPossiblePoints).toFixed(4))}, Final=${finalWP.toFixed(4)}`);
        return finalWP;
    }


    /** Calculates OWP up to maxRoundNumber. Uses cache. */
    function calculateOWP(playerId, maxRoundNumber, minPercentage, currentStandingsCache) {
        const effectivePlayerId = String(playerId); // Ensure string
        const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`;
        if (currentStandingsCache[cacheKey]?.owp !== undefined) { return currentStandingsCache[cacheKey].owp; }

        const opponents = getSwissOpponents(effectivePlayerId, maxRoundNumber); // Use effectivePlayerId
        if (opponents.length === 0) { /* ... set owp=0 ... */ return 0; }

        let totalOpponentWinPercentage = 0; let validOpponentCount = 0;
         if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`  DEBUG: OWP CALC for ${cacheKey} (${playersData[effectivePlayerId]?.name}), Opponents: [${opponents.join(', ')}]`);

        opponents.forEach(oppId => { // oppId should already be string from getSwissOpponents
            try {
                const opponentWinPerc = getPlayerSwissWinPercentage(oppId, maxRoundNumber, minPercentage, currentStandingsCache); // Pass oppId directly
                if (typeof opponentWinPerc === 'number' && !isNaN(opponentWinPerc)) {
                    totalOpponentWinPercentage += opponentWinPerc; validOpponentCount++;
                    if (DEBUG_STANDINGS) console.log(`      Opponent ${oppId} WP: ${opponentWinPerc.toFixed(4)}`);
                } else { console.warn(`calculateOWP (${cacheKey}): Invalid Win% (${opponentWinPerc}) for opponent ${oppId}.`); }
            } catch (e) { console.error(`calculateOWP (${cacheKey}): Error getting WP for opponent ${oppId}:`, e); }
        });

        const result = (validOpponentCount > 0) ? (totalOpponentWinPercentage / validOpponentCount) : 0;
        if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
        currentStandingsCache[cacheKey].owp = result;
         if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`  DEBUG: OWP RESULT for ${cacheKey} (${playersData[effectivePlayerId]?.name}): Sum=${totalOpponentWinPercentage.toFixed(4)}, Count=${validOpponentCount}, Avg=${result.toFixed(4)}`);
        return result;
    }

    /** Calculates OOWP up to maxRoundNumber. Uses cache. */
    function calculateOOWP(playerId, maxRoundNumber, minPercentage, currentStandingsCache) {
         const effectivePlayerId = String(playerId); // Ensure string
        const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`;
        if (currentStandingsCache[cacheKey]?.oowp !== undefined) { return currentStandingsCache[cacheKey].oowp; }

        const opponents = getSwissOpponents(effectivePlayerId, maxRoundNumber); // Use effectivePlayerId
        if (opponents.length === 0) { /* ... set oowp=0 ... */ return 0; }

        let totalOpponentOWP = 0; let validOpponentCount = 0;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`DEBUG: OOWP CALC for ${cacheKey} (${playersData[effectivePlayerId]?.name}), Opponents: [${opponents.join(', ')}]`);

        opponents.forEach(oppId => { // oppId should already be string
            try {
                const oppOWP = calculateOWP(oppId, maxRoundNumber, minPercentage, currentStandingsCache); // Pass oppId directly
                 if (typeof oppOWP === 'number' && !isNaN(oppOWP)) {
                    totalOpponentOWP += oppOWP; validOpponentCount++;
                    if (DEBUG_STANDINGS) console.log(`    Opponent ${oppId} OWP: ${oppOWP.toFixed(4)}`);
                } else { console.warn(`calculateOOWP (${cacheKey}): Invalid OWP (${oppOWP}) for opponent ${oppId}.`); }
            } catch (e) { console.error(`calculateOOWP (${cacheKey}): Error getting OWP for opponent ${oppId}:`, e); }
        });

        const result = (validOpponentCount > 0) ? (totalOpponentOWP / validOpponentCount) : 0;
        if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
        currentStandingsCache[cacheKey].oowp = result;
         if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`DEBUG: OOWP RESULT for ${cacheKey} (${playersData[effectivePlayerId]?.name}): Sum=${totalOpponentOWP.toFixed(4)}, Count=${validOpponentCount}, Avg=${result.toFixed(4)}`);
        return result;
    }


    /** Orchestrates calculation up to maxRoundNumber */
    function calculateSwissStandingsForRound(maxRoundNumber) {
        if (DEBUG_STANDINGS) console.log(`\n--- Calculating Standings for Round ${maxRoundNumber} ---`);
        const currentStandingsCache = {}; // Use a temporary cache for this round's calculation
        const standingsData = [];
        const allPlayerIds = Object.keys(playersData); // These are strings

        if (allPlayerIds.length === 0) {
            console.warn("calculateSwissStandingsForRound: No players found in playersData.");
            return [];
        }

        // Pre-calculate Records and WPs
         if (DEBUG_STANDINGS) console.log(`\n--- STEP 1: Calculating Records & WPs for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => { // playerId is a string here
            getPlayerSwissWinPercentage(playerId, maxRoundNumber, OWP_MINIMUM, currentStandingsCache);
        });

         if (DEBUG_STANDINGS) console.log(`\n--- STEP 2: Calculating OWPs for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => { // playerId is a string here
             calculateOWP(playerId, maxRoundNumber, OWP_MINIMUM, currentStandingsCache);
        });

         if (DEBUG_STANDINGS) console.log(`\n--- STEP 3: Calculating OOWPs & Final Data for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => { // playerId is a string here
            const cacheKey = `${playerId}_R${maxRoundNumber}`;
            const playerInfo = playersData[playerId]; // Use string playerId to access playersData
            const cachedData = currentStandingsCache[cacheKey];

            if (cachedData && cachedData.record && cachedData.wp !== undefined && cachedData.owp !== undefined && playerInfo) {
                try {
                    const oowp = calculateOOWP(playerId, maxRoundNumber, OWP_MINIMUM, currentStandingsCache);
                    // Note: calculateOOWP already caches, no need for cachedData.oowp = oowp;

                    const record = cachedData.record;
                    standingsData.push({
                        playerInfo: playerInfo,
                        matchPoints: record.matchPoints,
                        recordString: `${record.wins}-${record.losses}${record.ties > 0 ? '-' + record.ties : ''}`,
                        owp: cachedData.owp,
                        oowp: oowp // Use the value returned by calculateOOWP
                    });
                } catch (error) { console.error(`Error in final OOWP step for ${cacheKey}:`, error); }
            } else { console.warn(`calculateSwissStandingsForRound: Skipping ${playerId} - missing critical cached data (Record: ${!!cachedData?.record}, WP: ${cachedData?.wp}, OWP: ${cachedData?.owp}, Info: ${!!playerInfo}).`); }
        });

         if (DEBUG_STANDINGS) console.log(`--- Standings Calculation Complete for Round ${maxRoundNumber} ---`);
        return standingsData;
    }

    /** Sorts standings data based on standard tiebreakers. */
    function sortStandings(standingsData) {
        return standingsData.sort((a, b) => {
            if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
            const owpDiff = b.owp - a.owp; if (Math.abs(owpDiff) > 1e-9) return owpDiff;
            const oowpDiff = b.oowp - a.oowp; if (Math.abs(oowpDiff) > 1e-9) return oowpDiff;
            return a.playerInfo.name.localeCompare(b.playerInfo.name);
        });
    }

    /** Displays standings in the table. */
    function displayStandings(sortedStandings) {
         console.log("displayStandings: Starting display..."); if (!standingsTableBody) { console.error("displayStandings: Standings table body NOT FOUND!"); return; } standingsTableBody.innerHTML = ''; if (!Array.isArray(sortedStandings) || sortedStandings.length === 0) { console.log("displayStandings: No valid standings data."); if (standingsContainer) standingsContainer.style.display = roundsData.some(r => r.type === "3") ? 'block' : 'none'; return; } console.log(`displayStandings: Received ${sortedStandings.length} players.`); if (standingsContainer) standingsContainer.style.display = 'block'; sortedStandings.forEach((data, index) => { try { const rank = index + 1; const row = standingsTableBody.insertRow(); const cellRank = row.insertCell(); cellRank.textContent = rank; cellRank.style.textAlign = 'center'; const cellName = row.insertCell(); cellName.textContent = data.playerInfo?.name || 'Unknown'; const cellRecord = row.insertCell(); cellRecord.textContent = data.recordString; cellRecord.style.textAlign = 'center'; const cellOWP = row.insertCell(); cellOWP.textContent = (data.owp * 100).toFixed(2); cellOWP.style.textAlign = 'right'; const cellOOWP = row.insertCell(); cellOOWP.textContent = (data.oowp * 100).toFixed(2); cellOOWP.style.textAlign = 'right'; } catch (error) { console.error(`Error displaying standings row ${index + 1}:`, error); } }); console.log("displayStandings: Display finished.");
    }


    // --- UI Update and Display Functions (FULL VERSION) ---
    function updateUI() {
        console.log("updateUI: Starting UI update...");
        // --- Update Pairings Section ---
        try {
             if (Object.keys(playersData).length === 0 || roundsData.length === 0) {
                 console.log("updateUI: No player or round data available.");
                 // ... (rest of no-data handling) ...
                 return;
             }
             // ... (Update pairings table, tabs etc. as before) ...
             const latestRoundNumber = roundsData.length > 0 ? roundsData[roundsData.length - 1].roundNumber : 1;
             const currentRoundExists = roundsData.some(r => r.roundNumber === currentRound);
             if (!currentRoundExists || currentRound < 1) { currentRound = latestRoundNumber; }
             let existingTabNumbers = Array.from(roundTabsContainer.querySelectorAll('button')).map(btn => parseInt(btn.dataset.roundNumber, 10));
             let newRoundNumbers = roundsData.map(r => r.roundNumber);
             if (JSON.stringify(existingTabNumbers) !== JSON.stringify(newRoundNumbers)) { /* ... update tabs ... */ }
             displayRound(currentRound); updateActiveTab();
             if (loadingMessage) loadingMessage.style.display = 'none';
             if (pairingsTable) pairingsTable.style.display = 'table';
             if (currentRoundTitle) currentRoundTitle.style.display = 'block';
             filterTable();
             console.log("updateUI: Pairings section updated successfully.");
        } catch (error) { console.error("updateUI: Error during pairings update:", error); /* ... error handling ... */ return; }

        // --- Update Standings Section ---
        if (Object.keys(playersData).length > 0 && roundsData.length > 0) {
            try {
                console.log("updateUI: >>> Starting Standings Update Logic <<<");
                const swissRounds = roundsData.filter(r => r.type === "3");
                if (swissRounds.length > 0) {
                    const latestSwissRoundNumber = swissRounds[swissRounds.length - 1].roundNumber;
                    console.log(`updateUI: Calculating standings as of Round ${latestSwissRoundNumber}`);

                    const standingsData = calculateSwissStandingsForRound(latestSwissRoundNumber);
                    const sortedStandings = sortStandings(standingsData);
                    displayStandings(sortedStandings); // Display the calculated standings

                    if (standingsContainer) standingsContainer.style.display = 'block';
                    if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
                    if (noStandingsMsg) noStandingsMsg.style.display = 'none';
                } else { /* ... handle no swiss rounds ... */ }
                console.log("updateUI: >>> Standings section processing complete <<<");
            } catch (error) { console.error("updateUI: CRITICAL Error during standings update block:", error); /* ... error handling ... */ }
        } else { /* ... hide standings if no data ... */ }

        if (updateStatusElement) { updateStatusElement.textContent = `Updated`; updateStatusElement.title = `Last update: ${new Date().toLocaleTimeString()}`; }
        console.log("updateUI: Update finished.");
    }

    function getPlayerScoreBeforeRound(playerId, targetRoundNumber) { /* ... unchanged ... */
        let wins = 0, losses = 0; const effectivePlayerId = String(playerId); if (!effectivePlayerId) return { wins, losses };
        for (const pastRound of roundsData) { if (pastRound.roundNumber >= targetRoundNumber) continue; for (const match of pastRound.matches) { const matchP1Id = String(match.player1Id); const matchP2Id = String(match.player2Id); if (match.isBye && matchP1Id === effectivePlayerId) { wins++; continue; } if (matchP1Id === effectivePlayerId) { if (match.outcome === 1) wins++; else if (match.outcome === 2) losses++; continue; } if (matchP2Id === effectivePlayerId) { if (match.outcome === 2) wins++; else if (match.outcome === 1) losses++; continue; } } }
        return { wins, losses };
    }
    function displayRound(roundNumber) { /* ... unchanged, ensures IDs used for lookup are strings */
        const round = roundsData.find(r => r.roundNumber === roundNumber); if (!round) { /* error handling */ return; } if (currentRoundTitle) currentRoundTitle.textContent = `Round ${roundNumber} Pairings`; if (!pairingsTableBody) { return; } pairingsTableBody.innerHTML = ''; if (round.matches.length === 0) { /* no matches message */ return; } round.matches.forEach(match => { try { const row = pairingsTableBody.insertRow(); const p1IdStr = String(match.player1Id); const p2IdStr = String(match.player2Id); const player1Info = playersData[p1IdStr] || { name: `Unknown (${p1IdStr})` }; const player2Info = match.isBye ? { name: "BYE" } : (playersData[p2IdStr] || { name: `Unknown (${p2IdStr})` }); const scoreP1 = getPlayerScoreBeforeRound(p1IdStr, roundNumber); const scoreP2 = match.isBye ? { wins: '-', losses: '-' } : getPlayerScoreBeforeRound(p2IdStr, roundNumber); const player1DisplayText = `${player1Info.name} (${scoreP1.wins}-${scoreP1.losses})`; const player2DisplayText = match.isBye ? player2Info.name : `${player2Info.name} (${scoreP2.wins}-${scoreP2.losses})`; row.dataset.player1Name = player1Info.name.toLowerCase(); row.dataset.player2Name = match.isBye ? 'bye' : player2Info.name.toLowerCase(); const cellTable = row.insertCell(); cellTable.textContent = match.table === 0 ? "N/A" : match.table; cellTable.style.textAlign = 'center'; const cellP1 = row.insertCell(); if (match.outcome === 1) { cellP1.innerHTML = `<span class="winner">${player1DisplayText}</span>`; } else { cellP1.textContent = player1DisplayText; } const cellP2 = row.insertCell(); if (match.isBye) { cellP2.textContent = player2DisplayText; cellP2.style.fontStyle = 'italic'; cellP2.style.color = '#6c757d'; } else { if (match.outcome === 2) { cellP2.innerHTML = `<span class="winner">${player2DisplayText}</span>`; } else { cellP2.textContent = player2DisplayText; } } } catch (error) { console.error(`Error displaying match row: ${JSON.stringify(match)}`, error); } });
    }
    function updateActiveTab() { /* ... unchanged ... */ }
    function filterTable() { /* ... unchanged ... */ }
    function checkClearButtonVisibility() { /* ... unchanged ... */ }


    // --- Automatic Update Check (Unchanged) ---
    async function checkForUpdates() {
        if (updateStatusElement) { updateStatusElement.textContent = `Checking...`; /* ... */ }
        const newDataProcessed = await loadTournamentData();
        if (newDataProcessed) { console.log("checkForUpdates: New data processed, updating UI."); updateUI(); }
    }

    // --- Initialisation (Unchanged) ---
    async function initialize() {
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
    if(searchInput) { searchInput.addEventListener('input', () => { filterTable(); checkClearButtonVisibility(); }); }
    if (clearSearchBtn) { clearSearchBtn.addEventListener('click', () => { if(searchInput) searchInput.value = ''; filterTable(); checkClearButtonVisibility(); if(searchInput) searchInput.focus(); }); }


    // --- Start the application ---
    initialize();

}); // End of DOMContentLoaded
