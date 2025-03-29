// Wait for the HTML document to be fully loaded before running script
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");
    console.log("--- Initializing Pairing/Standings Script (TPCi Rules - v4.1 Corrected Full) ---");

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


    // --- Core Data Loading and Parsing (FULL VERSION - v4.1) ---
    async function loadTournamentData() {
        console.log("loadTournamentData: Starting fetch...");
        try {
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
                return false;
            }

            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");

            const parseError = xmlDoc.querySelector("parsererror");
            if (parseError) {
                console.error("XML Parsing Error:", parseError.textContent);
                updateStatusElement.textContent = `Parse Error`;
                updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                if (lastKnownTimeElapsed !== -1 && loadingMessage) {
                    loadingMessage.textContent = "Error parsing updated tournament data. Check console.";
                    loadingMessage.style.display = 'block';
                    loadingMessage.style.color = '#dc3545';
                }
                return false;
            }
            console.log("loadTournamentData: XML parsed successfully.");

            const currentTimeElapsedElement = xmlDoc.querySelector('tournament > timeelapsed');
            const currentTimeElapsed = currentTimeElapsedElement ? parseInt(currentTimeElapsedElement.textContent, 10) : -1;

            if (currentTimeElapsed !== -1 && currentTimeElapsed === lastKnownTimeElapsed) {
                console.log("loadTournamentData: No change detected (timeelapsed).");
                updateStatusElement.textContent = `Up to date`;
                updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                return false;
            }

            console.log("loadTournamentData: Change detected or initial load. Processing XML...");
            extractData(xmlDoc); // Call extraction
            lastKnownTimeElapsed = currentTimeElapsed;
            console.log("loadTournamentData: Data extraction call complete.");
            return true;

        } catch (error) {
            console.error("loadTournamentData: Error during fetch/parse:", error);
            updateStatusElement.textContent = `Fetch Error`;
            updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
            if (lastKnownTimeElapsed !== -1 && loadingMessage) {
                loadingMessage.textContent = `Error loading data: ${error.message}`;
                loadingMessage.style.display = 'block';
                loadingMessage.style.color = '#dc3545';
            }
            return false;
        }
    }

    function extractData(xmlDoc) {
         console.log("extractData: Starting extraction...");
         playersData = {}; roundsData = []; let extractionError = false;
         try {
            const tournamentData = xmlDoc.querySelector('tournament > data');
            if (tournamentData && tournamentInfoElement) {
                 const city = tournamentData.querySelector('city')?.textContent;
                 const country = tournamentData.querySelector('country')?.textContent;
                 tournamentInfoElement.textContent = `${city ? city + ', ' : ''}${country || ''}`.trim();
            }
            const tempPlayersData = {};
            const playerElements = xmlDoc.querySelectorAll('tournament > players > player');
            console.log(`extractData: Found ${playerElements.length} player elements using selector.`);

            playerElements.forEach((player, index) => {
                 const userId = player.getAttribute('userid');
                 const firstName = player.querySelector('firstname')?.textContent || '';
                 const lastName = player.querySelector('lastname')?.textContent || '';
                 const birthdateElement = player.querySelector('birthdate');
                 const birthdateText = birthdateElement?.textContent;
                 let birthYear = null;
                 // Optional: Parse birth year
                 if (birthdateText) {
                    try {
                        const yearMatch = birthdateText.match(/(\d{4})$/);
                        if (yearMatch && yearMatch[1]) { birthYear = parseInt(yearMatch[1], 10); }
                    } catch (e) { console.warn(`extractData: Error parsing birthdate for player ${userId}`, e); }
                 }

                 if (userId) {
                     tempPlayersData[String(userId)] = { id: String(userId), firstName, lastName, name: `${firstName} ${lastName}`.trim(), birthYear: birthYear };
                 } else { console.warn(`extractData: Player index ${index} missing userid.`); }
            });
            playersData = tempPlayersData;
            console.log(`extractData: Extracted ${Object.keys(playersData).length} players successfully into playersData.`);

            const tempRoundsData = [];
            const roundElements = xmlDoc.querySelectorAll('tournament > pods > pod > rounds > round');
            console.log(`extractData: Found ${roundElements.length} round elements using selector.`);

            roundElements.forEach((round, roundIndex) => {
                 const roundNumber = parseInt(round.getAttribute('number'), 10);
                 const roundType = round.getAttribute('type');
                 if (isNaN(roundNumber)) { console.warn(`extractData: Skipping round index ${roundIndex} invalid number.`); return; }

                 const matches = [];
                 const matchElements = round.querySelectorAll('matches > match');
                 matchElements.forEach((match, matchIndex) => {
                     const tableNumber = parseInt(match.querySelector('tablenumber')?.textContent || '0', 10);
                     const outcome = parseInt(match.getAttribute('outcome'), 10);
                     const player1Element = match.querySelector('player1');
                     const player2Element = match.querySelector('player2');
                     const singlePlayerElement = match.querySelector('player');
                     let matchData = { table: tableNumber, player1Id: null, player2Id: null, outcome: outcome, isBye: false };

                     if (outcome === 5 && singlePlayerElement) {
                         matchData.player1Id = String(singlePlayerElement.getAttribute('userid')); matchData.isBye = true;
                     } else if (player1Element && player2Element) {
                         matchData.player1Id = String(player1Element.getAttribute('userid')); matchData.player2Id = String(player2Element.getAttribute('userid'));
                     } else { console.warn(`extractData: Skipping malformed match R ${roundNumber} index ${matchIndex}.`); return; }
                     matches.push(matchData);
                 });
                 matches.sort((a, b) => a.table - b.table);
                 tempRoundsData.push({ roundNumber, type: roundType, matches });
            });
            tempRoundsData.sort((a, b) => a.roundNumber - b.roundNumber);
            roundsData = tempRoundsData;
            console.log(`extractData: Extracted ${roundsData.length} rounds successfully into roundsData.`);

         } catch (error) {
             console.error("extractData: CRITICAL Error during extraction:", error); extractionError = true; playersData = {}; roundsData = [];
             if(loadingMessage){ loadingMessage.textContent = `Critical Error processing data: ${error.message}.`; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545'; }
         } finally { console.log(`extractData: Finished extraction. playersData size: ${Object.keys(playersData).length}, roundsData size: ${roundsData.length}, Error occurred: ${extractionError}`); }
    }


    // --- Standings Calculation Logic (TPCi Rules Implementation - v4.1) ---

    /** Helper to get total Swiss rounds in the tournament */
    function getTotalSwissRounds() {
        let maxSwissRound = 0;
        for (const round of roundsData) {
            if (round.type === "3" && round.roundNumber > maxSwissRound) {
                maxSwissRound = round.roundNumber;
            }
        }
        // If no swiss rounds found, maybe default to 1? Or handle upstream? Return 0 for now.
        return maxSwissRound;
    }

    /**
     * Calculates record & participation up to maxRoundNumber. (TPCi v4.1)
     * Returns { wins, losses, ties, byes, matchPoints, roundsParticipated, highestRoundParticipated }
     */
    function calculatePlayerSwissRecord(playerId, maxRoundNumber) {
        let wins = 0, losses = 0, ties = 0, byes = 0, matchPoints = 0, roundsParticipated = 0, highestRoundParticipated = 0;
        const effectivePlayerId = String(playerId);

        // Removed repetitive entry log for brevity in final version if needed
        // if (DEBUG_STANDINGS) console.log(`      --> Entering calculatePlayerSwissRecord for Player ${effectivePlayerId} (Target R${maxRoundNumber})`);
        if (!effectivePlayerId) return { wins, losses, ties, byes, matchPoints, roundsParticipated, highestRoundParticipated };

        for (const round of roundsData) {
            const isSwissRound = round.type === "3";
            const isWithinLimit = round.roundNumber <= maxRoundNumber;
            if (!isSwissRound || !isWithinLimit) continue;

            let playedThisRound = false;
            for (const match of round.matches) {
                let playerFoundInThisMatch = false;
                const matchP1Id = String(match.player1Id);
                const matchP2Id = String(match.player2Id);

                if (match.isBye && matchP1Id === effectivePlayerId) {
                    wins++; byes++; matchPoints += 3; playerFoundInThisMatch = true;
                } else if (matchP1Id === effectivePlayerId) {
                    if (match.outcome === 1) { wins++; matchPoints += 3; }
                    else if (match.outcome === 2) { losses++; matchPoints += 0; }
                    else if (match.outcome === 3 || match.outcome === 4) { ties++; matchPoints += 1; }
                    else { matchPoints += 0; } playerFoundInThisMatch = true;
                } else if (matchP2Id === effectivePlayerId) {
                     if (match.outcome === 1) { losses++; matchPoints += 0; }
                     else if (match.outcome === 2) { wins++; matchPoints += 3; }
                     else if (match.outcome === 3 || match.outcome === 4) { ties++; matchPoints += 1; }
                     else { matchPoints += 0; } playerFoundInThisMatch = true;
                }

                if (playerFoundInThisMatch) { playedThisRound = true; break; }
            }

            if (playedThisRound) {
                roundsParticipated++;
                highestRoundParticipated = round.roundNumber;
            }
        }

        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`      DEBUG: Record for ${playersData[effectivePlayerId]?.name} (${effectivePlayerId}) up to R${maxRoundNumber}: Wins=${wins}, Byes=${byes}, Losses=${losses}, Ties=${ties} (${matchPoints}pts). RoundsParticipated=${roundsParticipated}, HighestRound=${highestRoundParticipated}`);
        return { wins, losses, ties, byes, matchPoints, roundsParticipated, highestRoundParticipated };
    }

    /** Gets opponents from Swiss rounds up to maxRoundNumber. Excludes byes. */
    function getSwissOpponents(playerId, maxRoundNumber) {
        const opponents = new Set(); const effectivePlayerId = String(playerId); if (!effectivePlayerId) return [];
        for (const round of roundsData) { if (round.type !== "3" || round.roundNumber > maxRoundNumber) continue; for (const match of round.matches) { if (match.isBye) continue; const matchP1Id = String(match.player1Id); const matchP2Id = String(match.player2Id); if (matchP1Id === effectivePlayerId && matchP2Id) opponents.add(matchP2Id); else if (matchP2Id === effectivePlayerId && matchP1Id) opponents.add(matchP1Id); } }
        const opponentList = Array.from(opponents);
        // Log removed for brevity if needed
        // if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`      DEBUG: Opponents for ${playersData[effectivePlayerId]?.name} (${effectivePlayerId}) up to R${maxRoundNumber}: [${opponentList.join(', ')}]`);
        return opponentList;
    }


    /** Calculates WP based on TPCi rules up to maxRoundNumber. Uses cache. (TPCi v4.1) */
    function getPlayerSwissWinPercentage(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache) {
        const effectivePlayerId = String(playerId);
        const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`;
        if (currentStandingsCache[cacheKey]?.wp !== undefined) { return currentStandingsCache[cacheKey].wp; }

        let record = currentStandingsCache[cacheKey]?.record || calculatePlayerSwissRecord(effectivePlayerId, maxRoundNumber);
        if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
        currentStandingsCache[cacheKey].record = record;

        const totalWins = record.wins + record.byes; // Assumption: Byes count as wins for WP

        // Player completed *this stage* if they played in the round being calculated for
        const completedStage = record.highestRoundParticipated >= maxRoundNumber;

        let divisor, maxWP;
        if (completedStage) {
            divisor = totalSwissRounds;
            maxWP = WP_MAX_COMPLETED;
            // if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`    DEBUG: Player ${playersData[effectivePlayerId]?.name} (${effectivePlayerId}) considered COMPLETED up to R${maxRoundNumber}. Divisor=${divisor}, MaxWP=${maxWP}`);
        } else {
            divisor = record.roundsParticipated;
            maxWP = WP_MAX_DROPPED;
           // if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`    DEBUG: Player ${playersData[effectivePlayerId]?.name} (${effectivePlayerId}) considered DROPPED before R${maxRoundNumber}. Divisor=${divisor}, MaxWP=${maxWP}`);
        }

        let finalWP;
        if (divisor === 0) {
            finalWP = WP_MINIMUM;
           // if (DEBUG_STANDINGS) console.log(`      WP Calculation: Divisor is 0, using Minimum WP: ${finalWP.toFixed(4)}`);
        } else {
            const rawWP = totalWins / divisor;
            finalWP = Math.min(Math.max(rawWP, WP_MINIMUM), maxWP);
            // if (DEBUG_STANDINGS) console.log(`      WP Calculation: TotalWins=${totalWins}, Divisor=${divisor}, Raw=${rawWP.toFixed(4)}, Min=${WP_MINIMUM}, Max=${maxWP}, Final=${finalWP.toFixed(4)}`);
        }

        currentStandingsCache[cacheKey].wp = finalWP;
        // Log WP result for easier comparison
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`    DEBUG: WP CALC for ${cacheKey} (${playersData[effectivePlayerId]?.name}) Final=${finalWP.toFixed(4)}`);
        return finalWP;
    }


    /** Calculates OWP up to maxRoundNumber using TPCi WP rules. Uses cache. (TPCi v4.1) */
    function calculateOWP(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache) {
        const effectivePlayerId = String(playerId);
        const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`;
        if (currentStandingsCache[cacheKey]?.owp !== undefined) { return currentStandingsCache[cacheKey].owp; }

        const opponents = getSwissOpponents(effectivePlayerId, maxRoundNumber);
        if (opponents.length === 0) {
            if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].owp = 0; return 0;
        }

        let totalOpponentWinPercentage = 0; let validOpponentCount = 0;
        // if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`  DEBUG: OWP CALC for ${cacheKey} (${playersData[effectivePlayerId]?.name}), Opponents: [${opponents.join(', ')}]`);

        opponents.forEach(oppId => {
            try {
                const opponentWinPerc = getPlayerSwissWinPercentage(oppId, maxRoundNumber, totalSwissRounds, currentStandingsCache);
                if (typeof opponentWinPerc === 'number' && !isNaN(opponentWinPerc)) {
                    totalOpponentWinPercentage += opponentWinPerc; validOpponentCount++;
                } else { console.warn(`calculateOWP (${cacheKey}): Invalid Win% for opponent ${oppId}.`); }
            } catch (e) { console.error(`calculateOWP (${cacheKey}): Error getting WP for opponent ${oppId}:`, e); }
        });

        const result = (validOpponentCount > 0) ? (totalOpponentWinPercentage / validOpponentCount) : 0;
        if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
        currentStandingsCache[cacheKey].owp = result;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`  DEBUG: OWP RESULT for ${cacheKey} (${playersData[effectivePlayerId]?.name}): Avg=${result.toFixed(4)}`);
        return result;
    }

    /** Calculates OOWP up to maxRoundNumber using TPCi rules. Uses cache. (TPCi v4.1) */
    function calculateOOWP(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache) {
         const effectivePlayerId = String(playerId);
        const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`;
        if (currentStandingsCache[cacheKey]?.oowp !== undefined) { return currentStandingsCache[cacheKey].oowp; }

        const opponents = getSwissOpponents(effectivePlayerId, maxRoundNumber);
        if (opponents.length === 0) {
            if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].oowp = 0; return 0;
        }

        let totalOpponentOWP = 0; let validOpponentCount = 0;
        // if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`DEBUG: OOWP CALC for ${cacheKey} (${playersData[effectivePlayerId]?.name}), Opponents: [${opponents.join(', ')}]`);

        opponents.forEach(oppId => {
            try {
                const oppOWP = calculateOWP(oppId, maxRoundNumber, totalSwissRounds, currentStandingsCache);
                 if (typeof oppOWP === 'number' && !isNaN(oppOWP)) {
                    totalOpponentOWP += oppOWP; validOpponentCount++;
                } else { console.warn(`calculateOOWP (${cacheKey}): Invalid OWP for opponent ${oppId}.`); }
            } catch (e) { console.error(`calculateOOWP (${cacheKey}): Error getting OWP for opponent ${oppId}:`, e); }
        });

        const result = (validOpponentCount > 0) ? (totalOpponentOWP / validOpponentCount) : 0;
        if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {};
        currentStandingsCache[cacheKey].oowp = result;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`DEBUG: OOWP RESULT for ${cacheKey} (${playersData[effectivePlayerId]?.name}): Avg=${result.toFixed(4)}`);
        return result;
    }


    /** Orchestrates calculation up to maxRoundNumber using TPCi rules (TPCi v4.1) */
    function calculateSwissStandingsForRound(maxRoundNumber) {
        if (DEBUG_STANDINGS) console.log(`\n--- Calculating Standings for Round ${maxRoundNumber} (TPCi Rules) ---`);
        const currentStandingsCache = {}; // Fresh cache for this round's calc
        const standingsData = [];
        const allPlayerIds = Object.keys(playersData);

        if (allPlayerIds.length === 0) { console.warn("calculateSwissStandingsForRound: No players found."); return []; }

        const totalSwissRounds = getTotalSwissRounds();
        if (totalSwissRounds === 0) { console.warn("calculateSwissStandingsForRound: Could not determine total Swiss rounds."); return []; } // Need total rounds
        if (DEBUG_STANDINGS) console.log(`   Detected Total Swiss Rounds in Tournament: ${totalSwissRounds}`);


        // Pre-calculate Records, WPs, OWPs
         if (DEBUG_STANDINGS) console.log(`\n--- STEP 1: Calculating Records & WPs for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => { getPlayerSwissWinPercentage(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache); });

         if (DEBUG_STANDINGS) console.log(`\n--- STEP 2: Calculating OWPs for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => { calculateOWP(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache); });

         if (DEBUG_STANDINGS) console.log(`\n--- STEP 3: Calculating OOWPs & Final Data for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => {
            const cacheKey = `${playerId}_R${maxRoundNumber}`;
            const playerInfo = playersData[playerId];
            const cachedData = currentStandingsCache[cacheKey];

            if (cachedData?.record && cachedData.wp !== undefined && cachedData.owp !== undefined && playerInfo) {
                try {
                    const oowp = calculateOOWP(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache);
                    const record = cachedData.record;
                    standingsData.push({
                        playerInfo: playerInfo,
                        matchPoints: record.matchPoints,
                        recordString: `${record.wins}-${record.losses}${record.ties > 0 ? '-' + record.ties : ''}`,
                        owp: cachedData.owp,
                        oowp: oowp
                    });
                } catch (error) { console.error(`Error in final OOWP step for ${cacheKey}:`, error); }
            } else { console.warn(`calculateSwissStandingsForRound: Skipping ${playerId} - missing critical cached data.`); }
        });

         if (DEBUG_STANDINGS) console.log(`--- Standings Calculation Complete for Round ${maxRoundNumber} ---`);
        return standingsData;
    }

    /** Sorts standings: 1. Match Points, 2. OWP, 3. OOWP, 4. Name */
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
         console.log("displayStandings: Starting display..."); if (!standingsTableBody) { console.error("displayStandings: Standings table body NOT FOUND!"); return; } standingsTableBody.innerHTML = ''; if (!Array.isArray(sortedStandings) || sortedStandings.length === 0) { console.log("displayStandings: No valid standings data."); if (standingsContainer) standingsContainer.style.display = roundsData.some(r => r.type === "3") ? 'block' : 'none'; if(noStandingsMsg) noStandingsMsg.style.display = 'block'; return; } console.log(`displayStandings: Received ${sortedStandings.length} players.`); if(noStandingsMsg) noStandingsMsg.style.display = 'none'; if (standingsContainer) standingsContainer.style.display = 'block'; sortedStandings.forEach((data, index) => { try { const rank = index + 1; const row = standingsTableBody.insertRow(); const cellRank = row.insertCell(); cellRank.textContent = rank; cellRank.style.textAlign = 'center'; const cellName = row.insertCell(); cellName.textContent = data.playerInfo?.name || 'Unknown'; const cellRecord = row.insertCell(); cellRecord.textContent = data.recordString; cellRecord.style.textAlign = 'center'; const cellOWP = row.insertCell(); cellOWP.textContent = (data.owp * 100).toFixed(2); cellOWP.style.textAlign = 'right'; const cellOOWP = row.insertCell(); cellOOWP.textContent = (data.oowp * 100).toFixed(2); cellOOWP.style.textAlign = 'right'; } catch (error) { console.error(`Error displaying standings row ${index + 1}:`, error); } }); console.log("displayStandings: Display finished.");
    }


    // --- UI Update and Display Functions (FULL VERSION - v4.1) ---
    function updateUI() {
        console.log("updateUI: Starting UI update...");
        // --- Update Pairings Section ---
        try {
             if (Object.keys(playersData).length === 0 || roundsData.length === 0) {
                 console.log("updateUI: No player or round data available.");
                 if (lastKnownTimeElapsed === -1) { if(loadingMessage){ loadingMessage.textContent = "Waiting for tournament data..."; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#6c757d';} }
                 else { if(loadingMessage){ loadingMessage.textContent = "No player/round data found. Check console."; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545'; } }
                 if(pairingsTable) pairingsTable.style.display = 'none';
                 if(currentRoundTitle) currentRoundTitle.style.display = 'none';
                 if(roundTabsContainer) roundTabsContainer.innerHTML = '';
                 if (standingsContainer) standingsContainer.style.display = 'none'; // Hide standings too
                 return; // Stop UI update here if no basic data
             }

             const latestRoundNumber = roundsData.length > 0 ? roundsData[roundsData.length - 1].roundNumber : 1;
             const currentRoundExists = roundsData.some(r => r.roundNumber === currentRound);
             if (!currentRoundExists || currentRound < 1) { currentRound = latestRoundNumber; }

             // Update Round Tabs only if necessary
             let existingTabNumbers = Array.from(roundTabsContainer.querySelectorAll('button')).map(btn => parseInt(btn.dataset.roundNumber, 10));
             let newRoundNumbers = roundsData.map(r => r.roundNumber);
             if (JSON.stringify(existingTabNumbers) !== JSON.stringify(newRoundNumbers)) {
                 if (roundTabsContainer) roundTabsContainer.innerHTML = '';
                 roundsData.forEach(round => {
                    const button = document.createElement('button'); button.textContent = `Round ${round.roundNumber}`; button.dataset.roundNumber = round.roundNumber;
                    button.addEventListener('click', () => { currentRound = round.roundNumber; displayRound(currentRound); updateActiveTab(); filterTable(); });
                    if (roundTabsContainer) roundTabsContainer.appendChild(button);
                 });
                 console.log("updateUI: Round tabs updated.");
             }

             displayRound(currentRound); updateActiveTab();
             if (loadingMessage) loadingMessage.style.display = 'none';
             if (pairingsTable) pairingsTable.style.display = 'table';
             if (currentRoundTitle) currentRoundTitle.style.display = 'block';
             filterTable(); // Apply search filter
             console.log("updateUI: Pairings section updated successfully.");

        } catch (error) {
             console.error("updateUI: Error during pairings update:", error);
             if (loadingMessage) { loadingMessage.textContent = `Error displaying pairings: ${error.message}. Check console.`; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545'; }
             return; // Don't proceed to standings if pairings failed
        }

        // --- Update Standings Section ---
        if (Object.keys(playersData).length > 0 && roundsData.length > 0) {
            try {
                console.log("updateUI: >>> Starting Standings Update Logic <<<");
                const swissRounds = roundsData.filter(r => r.type === "3");
                if (swissRounds.length > 0) {
                    const latestSwissRoundNumber = swissRounds[swissRounds.length - 1].roundNumber;
                    console.log(`updateUI: Calculating standings as of Round ${latestSwissRoundNumber} (TPCi Rules)`);

                    const standingsData = calculateSwissStandingsForRound(latestSwissRoundNumber);
                    const sortedStandings = sortStandings(standingsData);
                    displayStandings(sortedStandings); // Display the calculated standings

                    if (standingsContainer) standingsContainer.style.display = 'block';
                    if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
                    if (noStandingsMsg) noStandingsMsg.style.display = 'none';
                } else {
                    console.log("updateUI: No swiss rounds exist, hiding standings.");
                    if (standingsContainer) standingsContainer.style.display = 'none';
                    if (noStandingsMsg) { noStandingsMsg.style.display = 'block'; noStandingsMsg.textContent = "No Swiss rounds found to calculate standings."; }
                    if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
                    if (standingsTableBody) standingsTableBody.innerHTML = '';
                }
                console.log("updateUI: >>> Standings section processing complete <<<");
            } catch (error) {
                console.error("updateUI: CRITICAL Error during standings update block:", error);
                if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
                if (noStandingsMsg) { noStandingsMsg.style.display = 'block'; noStandingsMsg.textContent = `Error updating standings: ${error.message}. Check console.`; noStandingsMsg.style.color = '#dc3545'; }
                if (standingsContainer) standingsContainer.style.display = 'block';
                if (standingsTableBody) standingsTableBody.innerHTML = '';
            }
        } else {
             console.log("updateUI: Skipping standings update due to lack of player/round data.");
             if (standingsContainer) standingsContainer.style.display = 'none';
        }

        if (updateStatusElement) { updateStatusElement.textContent = `Updated`; updateStatusElement.title = `Last update: ${new Date().toLocaleTimeString()}`; }
        console.log("updateUI: Update finished.");
    }

    function getPlayerScoreBeforeRound(playerId, targetRoundNumber) {
        let wins = 0, losses = 0; const effectivePlayerId = String(playerId); if (!effectivePlayerId) return { wins, losses };
        for (const pastRound of roundsData) { if (pastRound.roundNumber >= targetRoundNumber) continue; for (const match of pastRound.matches) { const matchP1Id = String(match.player1Id); const matchP2Id = String(match.player2Id); if (match.isBye && matchP1Id === effectivePlayerId) { wins++; continue; } if (matchP1Id === effectivePlayerId) { if (match.outcome === 1) wins++; else if (match.outcome === 2) losses++; continue; } if (matchP2Id === effectivePlayerId) { if (match.outcome === 2) wins++; else if (match.outcome === 1) losses++; continue; } } }
        return { wins, losses };
    }
    function displayRound(roundNumber) {
         const round = roundsData.find(r => r.roundNumber === roundNumber); if (!round) { if(pairingsTableBody) pairingsTableBody.innerHTML = '<tr><td colspan="3">Error loading round.</td></tr>'; if(currentRoundTitle) currentRoundTitle.textContent = `Round ${roundNumber} (Error)`; return; } if (currentRoundTitle) currentRoundTitle.textContent = `Round ${roundNumber} Pairings`; if (!pairingsTableBody) { return; } pairingsTableBody.innerHTML = ''; if (round.matches.length === 0) { pairingsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center;">No matches reported yet.</td></tr>'; return; } round.matches.forEach(match => { try { const row = pairingsTableBody.insertRow(); const p1IdStr = String(match.player1Id); const p2IdStr = String(match.player2Id); const player1Info = playersData[p1IdStr] || { name: `Unknown (${p1IdStr})` }; const player2Info = match.isBye ? { name: "BYE" } : (playersData[p2IdStr] || { name: `Unknown (${p2IdStr})` }); const scoreP1 = getPlayerScoreBeforeRound(p1IdStr, roundNumber); const scoreP2 = match.isBye ? { wins: '-', losses: '-' } : getPlayerScoreBeforeRound(p2IdStr, roundNumber); const player1DisplayText = `${player1Info.name} (${scoreP1.wins}-${scoreP1.losses})`; const player2DisplayText = match.isBye ? player2Info.name : `${player2Info.name} (${scoreP2.wins}-${scoreP2.losses})`; row.dataset.player1Name = player1Info.name.toLowerCase(); row.dataset.player2Name = match.isBye ? 'bye' : player2Info.name.toLowerCase(); const cellTable = row.insertCell(); cellTable.textContent = match.table === 0 ? "N/A" : match.table; cellTable.style.textAlign = 'center'; const cellP1 = row.insertCell(); if (match.outcome === 1) { cellP1.innerHTML = `<span class="winner">${player1DisplayText}</span>`; } else { cellP1.textContent = player1DisplayText; } const cellP2 = row.insertCell(); if (match.isBye) { cellP2.textContent = player2DisplayText; cellP2.style.fontStyle = 'italic'; cellP2.style.color = '#6c757d'; } else { if (match.outcome === 2) { cellP2.innerHTML = `<span class="winner">${player2DisplayText}</span>`; } else { cellP2.textContent = player2DisplayText; } } } catch (error) { console.error(`Error displaying match row: ${JSON.stringify(match)}`, error); } });
    }
    function updateActiveTab() {
        if(!roundTabsContainer) return; const buttons = roundTabsContainer.querySelectorAll('button'); buttons.forEach(button => { if (parseInt(button.dataset.roundNumber, 10) === currentRound) button.classList.add('active'); else button.classList.remove('active'); });
    }
    function filterTable() {
        if(!pairingsTableBody || !searchInput) return; const searchTerm = searchInput.value.toLowerCase().trim(); const rows = pairingsTableBody.querySelectorAll('tr'); let visibleRows = 0; rows.forEach(row => { if (row.cells.length === 1 && row.cells[0].colSpan === 3) { row.classList.remove('hidden-row'); visibleRows++; return; } const p1Name = row.dataset.player1Name || ''; const p2Name = row.dataset.player2Name || ''; if (!searchTerm || p1Name.includes(searchTerm) || (p2Name && p2Name.includes(searchTerm))) { row.classList.remove('hidden-row'); visibleRows++; } else { row.classList.add('hidden-row'); } }); const noResultsMessage = document.getElementById('no-search-results'); if (noResultsMessage) noResultsMessage.style.display = (visibleRows === 0 && searchTerm) ? 'block' : 'none';
    }
    function checkClearButtonVisibility() {
        if (!clearSearchBtn || !searchInput) return; if (searchInput.value.length > 0) clearSearchBtn.style.display = 'inline-block'; else clearSearchBtn.style.display = 'none';
    }


    // --- Automatic Update Check ---
    async function checkForUpdates() {
        if (updateStatusElement) { updateStatusElement.textContent = `Checking...`; updateStatusElement.title = `Checking at: ${new Date().toLocaleTimeString()}`; }
        const newDataProcessed = await loadTournamentData();
        if (newDataProcessed) { console.log("checkForUpdates: New data processed, updating UI."); updateUI(); }
    }

    // --- Initialisation ---
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

    // --- Event Listeners ---
    if(searchInput) { searchInput.addEventListener('input', () => { filterTable(); checkClearButtonVisibility(); }); }
    if (clearSearchBtn) { clearSearchBtn.addEventListener('click', () => { if(searchInput) searchInput.value = ''; filterTable(); checkClearButtonVisibility(); if(searchInput) searchInput.focus(); }); }


    // --- Start the application ---
    initialize();

}); // End of DOMContentLoaded
