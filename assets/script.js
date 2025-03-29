// Wait for the HTML document to be fully loaded before running script
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");

    // --- DOM Element References ---
    console.log("Attempting to get DOM elements...");
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

    console.log("[DEBUG] searchInput element after getElementById:", searchInput);

    // Guard: Check essential elements
     if (!pairingsTableBody || !searchInput || !loadingMessage || !standingsTableBody || !standingsContainer) {
          console.error("CRITICAL ERROR: Essential DOM elements not found. Stopping script.");
          if(loadingMessage) { loadingMessage.textContent = "Critical page error: Required elements missing."; loadingMessage.style.display = 'block'; loadingMessage.style.color = 'red'; }
          return;
     }
     console.log("Essential elements seem to be found.");

    // --- Global Data Storage ---
    let playersData = {}; // { playerId: { id, firstName, lastName, name, birthYear } }
    let roundsData = []; // [ { roundNumber, type, matches: [ { table, player1Id, player2Id, outcome, isBye } ] } ]
    let currentRound = 1;
    let lastKnownTimeElapsed = -1;
    let updateIntervalId = null;
    let standingsCache = {}; // Cache for calculated standings data: { playerId: { record: { wins, losses, ties, byes, matchPoints, roundsPlayed }, wp: number, owp: number, oowp: number } }


    // --- Configuration ---
    const xmlFilePath = 'data/tournament_data.xml';
    const refreshInterval = 15000; // 15 seconds
    // const OWP_MINIMUM = 0.33; // Original
    const OWP_MINIMUM = 1 / 3; // Use precise fraction for minimum WP
    const CURRENT_YEAR = new Date().getFullYear();


    // --- Core Data Loading and Parsing ---

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
                // Show error on page if data was previously loaded
                if (lastKnownTimeElapsed !== -1 && loadingMessage) {
                    loadingMessage.textContent = "Error parsing updated tournament data. Check console.";
                    loadingMessage.style.display = 'block';
                    loadingMessage.style.color = '#dc3545';
                }
                return false; // Indicate parse failure
            }
            console.log("loadTournamentData: XML parsed successfully.");

            // Check if the file content has actually changed using <timeelapsed>
            const currentTimeElapsedElement = xmlDoc.querySelector('tournament > timeelapsed');
            const currentTimeElapsed = currentTimeElapsedElement ? parseInt(currentTimeElapsedElement.textContent, 10) : -1;

            // If timeelapsed hasn't changed since last check, no need to re-process
            if (currentTimeElapsed !== -1 && currentTimeElapsed === lastKnownTimeElapsed) {
                console.log("loadTournamentData: No change detected (timeelapsed).");
                updateStatusElement.textContent = `Up to date`;
                updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                return false; // Indicate no new data processed
            }

            console.log("loadTournamentData: Change detected or initial load. Processing XML...");
            // Extract data from the XML document
            extractData(xmlDoc);
            lastKnownTimeElapsed = currentTimeElapsed; // Update the last known time
            standingsCache = {}; // Clear standings cache as data has changed
            console.log("loadTournamentData: Data extraction seems complete.");
            return true; // Indicate new data was processed

        } catch (error) {
            console.error("loadTournamentData: Error during fetch/parse:", error);
            updateStatusElement.textContent = `Fetch Error`;
            updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
            // Show error on page if data was previously loaded
            if (lastKnownTimeElapsed !== -1 && loadingMessage) {
                loadingMessage.textContent = `Error loading data: ${error.message}`;
                loadingMessage.style.display = 'block';
                loadingMessage.style.color = '#dc3545';
            }
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
            // Extract Tournament Info (Name is already in HTML h1, get location)
            const tournamentData = xmlDoc.querySelector('tournament > data');
            if (tournamentData && tournamentInfoElement) {
                const city = tournamentData.querySelector('city')?.textContent;
                const country = tournamentData.querySelector('country')?.textContent;
                tournamentInfoElement.textContent = `${city ? city + ', ' : ''}${country || ''}`.trim();
            }

            // Extract Players
            const tempPlayersData = {};
            const playerElements = xmlDoc.querySelectorAll('tournament > players > player');
            console.log(`extractData: Found ${playerElements.length} player elements.`);
            playerElements.forEach((player, index) => {
                const userId = player.getAttribute('userid');
                const firstName = player.querySelector('firstname')?.textContent || '';
                const lastName = player.querySelector('lastname')?.textContent || '';
                const birthdateElement = player.querySelector('birthdate');
                const birthdateText = birthdateElement?.textContent;
                let birthYear = null;

                // Attempt to parse birth year (optional)
                if (birthdateText) {
                    try {
                        // Assumes MM/DD/YYYY format from sample
                        const yearMatch = birthdateText.match(/(\d{4})$/);
                        if (yearMatch && yearMatch[1]) {
                            birthYear = parseInt(yearMatch[1], 10);
                        } else {
                            console.warn(`extractData: Could not parse year from birthdate="${birthdateText}" for player ${userId}. Expected MM/DD/YYYY format.`);
                        }
                    } catch (e) {
                        console.warn(`extractData: Error parsing birthdate="${birthdateText}" for player ${userId}`, e);
                    }
                } else {
                   // console.warn(`extractData: Missing '<birthdate>' tag or content for player ${userId}`); // Reduce noise
                }

                if (userId) {
                    tempPlayersData[userId] = {
                        id: userId,
                        firstName,
                        lastName,
                        name: `${firstName} ${lastName}`.trim(),
                        birthYear: birthYear
                    };
                } else {
                    console.warn(`extractData: Player at index ${index} missing userid attribute.`);
                }
            });
            playersData = tempPlayersData; // Assign to global variable
            console.log(`extractData: Extracted ${Object.keys(playersData).length} players successfully into playersData.`);

            // Extract Rounds and Matches
            const tempRoundsData = [];
            const roundElements = xmlDoc.querySelectorAll('tournament > pods > pod > rounds > round'); // Path from sample XML
            console.log(`extractData: Found ${roundElements.length} round elements.`);

            roundElements.forEach((round, roundIndex) => {
                const roundNumber = parseInt(round.getAttribute('number'), 10);
                const roundType = round.getAttribute('type'); // "3" for Swiss, "1" for Top Cut?

                if (isNaN(roundNumber)) {
                    console.warn(`extractData: Skipping round at index ${roundIndex} with invalid number:`, round);
                    return; // Skip this round
                }

                const matches = [];
                const matchElements = round.querySelectorAll('matches > match');

                matchElements.forEach((match, matchIndex) => {
                    const tableNumber = parseInt(match.querySelector('tablenumber')?.textContent || '0', 10);
                    const outcome = parseInt(match.getAttribute('outcome'), 10); // 1=P1Win, 2=P2Win, 3=Tie, 4=DoubleLoss, 5=Bye(P1)
                    const player1Element = match.querySelector('player1');
                    const player2Element = match.querySelector('player2');
                    const singlePlayerElement = match.querySelector('player'); // For Byes (outcome 5)

                    let matchData = {
                        table: tableNumber,
                        player1Id: null,
                        player2Id: null,
                        outcome: outcome,
                        isBye: false
                    };

                    if (outcome === 5 && singlePlayerElement) {
                        // It's a Bye for player 1
                        matchData.player1Id = singlePlayerElement.getAttribute('userid');
                        matchData.isBye = true;
                    } else if (player1Element && player2Element) {
                        // Standard match
                        matchData.player1Id = player1Element.getAttribute('userid');
                        matchData.player2Id = player2Element.getAttribute('userid');
                    } else {
                        // Malformed match data? Skip it.
                        console.warn(`extractData: Skipping malformed match element in round ${roundNumber} (index ${matchIndex}):`, match);
                        return; // Skip this match
                    }

                    // Optional: Warn if a player ID in a match isn't in the player list
                    if (matchData.player1Id && !playersData[matchData.player1Id]) console.warn(`extractData: Player ID ${matchData.player1Id} from match in round ${roundNumber} not found in players list.`);
                    if (matchData.player2Id && !playersData[matchData.player2Id]) console.warn(`extractData: Player ID ${matchData.player2Id} from match in round ${roundNumber} not found in players list.`);

                    matches.push(matchData);
                });

                // Sort matches within the round by table number
                matches.sort((a, b) => a.table - b.table);

                tempRoundsData.push({ roundNumber, type: roundType, matches });
            });

            // Sort rounds by round number
            tempRoundsData.sort((a, b) => a.roundNumber - b.roundNumber);
            roundsData = tempRoundsData; // Assign to global variable
            console.log(`extractData: Extracted ${roundsData.length} rounds successfully into roundsData.`);

        } catch (error) {
            console.error("extractData: CRITICAL Error during extraction:", error);
            extractionError = true;
            // Clear data on error to prevent showing inconsistent state
            playersData = {};
            roundsData = [];
            if(loadingMessage){
                loadingMessage.textContent = `Critical Error processing data: ${error.message}. Check console.`;
                loadingMessage.style.display = 'block';
                loadingMessage.style.color = '#dc3545';
            }
        } finally {
            console.log(`extractData: Finished extraction. playersData size: ${Object.keys(playersData).length}, roundsData size: ${roundsData.length}, Error occurred: ${extractionError}`);
        }
    }


    // --- Standings Calculation Logic (REVISED) ---

    /**
     * Calculates a player's detailed record ONLY from Swiss rounds.
     * Swiss rounds have type = "3".
     * Outcome codes: 1=P1Win, 2=P2Win, 3=Tie(Draw), 4=DoubleLoss, 5=Bye(for P1)
     */
    function calculatePlayerSwissRecord(playerId) {
        let wins = 0;
        let losses = 0;
        let ties = 0; // Includes Double Losses based on standard rules (1pt each)
        let byes = 0;
        let matchPoints = 0;
        let roundsPlayed = 0; // Counts rounds with a pairing or bye

        if (!playerId) return { wins, losses, ties, byes, matchPoints, roundsPlayed };

        for (const round of roundsData) {
            // Only consider Swiss rounds for standings calculation
            if (round.type !== "3") continue;

            let playedThisRound = false;
            for (const match of round.matches) {
                if (match.isBye && match.player1Id === playerId) {
                    wins++; // Byes count as wins for points/WP typically
                    byes++;
                    matchPoints += 3;
                    playedThisRound = true;
                    break; // Found player's match for this round
                } else if (match.player1Id === playerId) {
                    if (match.outcome === 1) { // Player 1 (this player) won
                        wins++;
                        matchPoints += 3;
                    } else if (match.outcome === 2) { // Player 1 (this player) lost
                        losses++;
                        matchPoints += 0;
                    } else if (match.outcome === 3 || match.outcome === 4) { // Tie or Double Loss
                        ties++;
                        matchPoints += 1; // Standard VGC rule gives 1pt for a tie/double-loss
                    } else {
                        // Other outcomes (0?) might mean no result yet - treat as 0 points? Assume reported matches have valid outcomes.
                        matchPoints += 0;
                    }
                    playedThisRound = true;
                    break; // Found player's match for this round
                } else if (match.player2Id === playerId) {
                     if (match.outcome === 1) { // Player 2 (this player) lost
                        losses++;
                        matchPoints += 0;
                    } else if (match.outcome === 2) { // Player 2 (this player) won
                        wins++;
                        matchPoints += 3;
                     } else if (match.outcome === 3 || match.outcome === 4) { // Tie or Double Loss
                         ties++;
                         matchPoints += 1;
                    } else {
                         matchPoints += 0;
                     }
                     playedThisRound = true;
                     break; // Found player's match for this round
                }
            }
            if (playedThisRound) {
                roundsPlayed++;
            }
        }

        // Return detailed record
        return { wins, losses, ties, byes, matchPoints, roundsPlayed };
    }

    /**
     * Gets the list of unique opponent IDs for a player from Swiss rounds.
     * Excludes byes.
     */
    function getSwissOpponents(playerId) {
        const opponents = new Set();
        if (!playerId) return [];

        for (const round of roundsData) {
            if (round.type !== "3") continue;

            for (const match of round.matches) {
                // Skip bye rounds, they don't have an opponent
                if (match.isBye) continue;

                // If player 1 is the target player, add player 2 (if exists)
                if (match.player1Id === playerId && match.player2Id) {
                    opponents.add(match.player2Id);
                }
                // If player 2 is the target player, add player 1 (if exists)
                else if (match.player2Id === playerId && match.player1Id) {
                    opponents.add(match.player1Id);
                }
            }
        }
        return Array.from(opponents);
    }


    /**
     * Calculates a player's Win Percentage (WP) based on official rules.
     * WP = Match Points / (Rounds Played * 3)
     * Minimum WP is applied.
     * Uses cached record if available.
     */
    function getPlayerSwissWinPercentage(playerId, minPercentage) {
        // Check cache first
        if (standingsCache[playerId] && typeof standingsCache[playerId].wp === 'number') {
           // console.log(`>>> WP CACHE HIT for ${playerId}: ${standingsCache[playerId].wp}`);
            return standingsCache[playerId].wp;
        }

        // Calculate record if not cached (should ideally be pre-calculated)
        const record = (standingsCache[playerId]?.record) ? standingsCache[playerId].record : calculatePlayerSwissRecord(playerId);

        // Cache the record if we just calculated it
        if (!standingsCache[playerId]) standingsCache[playerId] = {};
        standingsCache[playerId].record = record;


        const totalPossiblePoints = record.roundsPlayed * 3;

        if (totalPossiblePoints === 0) {
            // If no rounds played, WP is technically undefined, return minimum.
            standingsCache[playerId].wp = minPercentage;
           // console.log(`>>> WP CALC (0 rounds) for ${playerId}: ${minPercentage}`);
            return minPercentage;
        }

        const winRate = record.matchPoints / totalPossiblePoints;
        const finalWP = Math.max(winRate, minPercentage);

        // Cache the calculated WP
        standingsCache[playerId].wp = finalWP;
       // console.log(`>>> WP CALC for ${playerId}: MP=${record.matchPoints}, Rounds=${record.roundsPlayed}, Raw=${winRate.toFixed(4)}, Final=${finalWP.toFixed(4)}`);
        return finalWP;
    }


    /**
     * Calculates Opponent Win Percentage (OWP).
     * Average of opponents' WPs (with minimum applied).
     * Uses cached WP values if available.
     */
    function calculateOWP(playerId, minPercentage) {
        // Check cache first
        if (standingsCache[playerId] && typeof standingsCache[playerId].owp === 'number') {
            //console.log(`>>> OWP CACHE HIT for ${playerId}: ${standingsCache[playerId].owp}`);
            return standingsCache[playerId].owp;
        }

        const opponents = getSwissOpponents(playerId);

        if (opponents.length === 0) {
            if (!standingsCache[playerId]) standingsCache[playerId] = {};
            standingsCache[playerId].owp = 0; // No opponents, OWP is 0
            //console.log(`>>> OWP CALC (0 opponents) for ${playerId}: 0`);
            return 0;
        }

        let totalOpponentWinPercentage = 0;
        let validOpponentCount = 0; // Should equal opponents.length if no errors

        //console.log(`>>> OWP CALC for ${playerId}, Opponents: [${opponents.join(', ')}]`);
        opponents.forEach(oppId => {
            try {
                // Get opponent's WP (uses cache internally if available)
                const opponentWinPerc = getPlayerSwissWinPercentage(oppId, minPercentage);

                if (typeof opponentWinPerc === 'number' && !isNaN(opponentWinPerc)) {
                    totalOpponentWinPercentage += opponentWinPerc;
                    validOpponentCount++;
                  // console.log(`>>>   - Opponent ${oppId} WP: ${opponentWinPerc.toFixed(4)}`);
                } else {
                    console.warn(`>>> calculateOWP (${playerId}): Invalid Win% (${opponentWinPerc}) received for opponent ${oppId}. Skipping opponent.`);
                }
            } catch (opponentError) {
                console.error(`>>> calculateOWP (${playerId}): Error processing opponent ${oppId} WP:`, opponentError);
                // Decide if you want to skip or assign a default? Skipping is safer.
            }
        });

        const result = (validOpponentCount > 0) ? (totalOpponentWinPercentage / validOpponentCount) : 0;

        // Cache the result
        if (!standingsCache[playerId]) standingsCache[playerId] = {};
        standingsCache[playerId].owp = result;
        //console.log(`>>> OWP CALC RESULT for ${playerId}: Sum=${totalOpponentWinPercentage.toFixed(4)}, Count=${validOpponentCount}, Avg=${result.toFixed(4)}`);
        return result;
    }

    /**
     * Calculates Opponent's Opponent Win Percentage (OOWP).
     * Average of opponents' OWPs.
     * Uses cached OWP values if available.
     */
    function calculateOOWP(playerId, minPercentage) {
         // Check cache first (OOWP is less likely to be cached unless calculated already)
         if (standingsCache[playerId] && typeof standingsCache[playerId].oowp === 'number') {
           // console.log(`>>> OOWP CACHE HIT for ${playerId}: ${standingsCache[playerId].oowp}`);
            return standingsCache[playerId].oowp;
        }

        const opponents = getSwissOpponents(playerId);

        if (opponents.length === 0) {
             if (!standingsCache[playerId]) standingsCache[playerId] = {};
             standingsCache[playerId].oowp = 0; // No opponents, OOWP is 0
             //console.log(`>>> OOWP CALC (0 opponents) for ${playerId}: 0`);
             return 0;
        }

        let totalOpponentOWP = 0;
        let validOpponentCount = 0;

       // console.log(`>>> OOWP CALC for ${playerId}, Opponents: [${opponents.join(', ')}]`);
        opponents.forEach(oppId => {
            try {
                // Get opponent's OWP (uses cache internally if available)
                const oppOWP = calculateOWP(oppId, minPercentage); // Calculate opponent's OWP

                if (typeof oppOWP === 'number' && !isNaN(oppOWP)) {
                    totalOpponentOWP += oppOWP;
                    validOpponentCount++;
                  //  console.log(`>>>   - Opponent ${oppId} OWP: ${oppOWP.toFixed(4)}`);
                } else {
                    console.warn(`calculateOOWP (${playerId}): Invalid OWP (${oppOWP}) received for opponent ${oppId}. Skipping.`);
                }
            } catch (opponentError) {
                console.error(`calculateOOWP (${playerId}): Error processing OOWP for opponent ${oppId}:`, opponentError);
            }
        });

        const result = (validOpponentCount > 0) ? (totalOpponentOWP / validOpponentCount) : 0;

        // Cache result
        if (!standingsCache[playerId]) standingsCache[playerId] = {};
        standingsCache[playerId].oowp = result;
        //console.log(`>>> OOWP CALC RESULT for ${playerId}: Sum=${totalOpponentOWP.toFixed(4)}, Count=${validOpponentCount}, Avg=${result.toFixed(4)}`);
        return result;
    }


    /**
     * Orchestrates the calculation of standings for all players.
     * Calculates Record -> WP -> OWP -> OOWP
     */
    function calculateSwissStandings() {
        console.log("calculateSwissStandings: Starting calculation (using revised logic)...");
        if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'block';
        if (noStandingsMsg) noStandingsMsg.style.display = 'none';

        // Clear previous cache ONLY for standings calculation run
        standingsCache = {};

        const standingsData = [];
        let hasSwissRounds = roundsData.some(r => r.type === "3");

        if (!hasSwissRounds) {
            console.log("calculateSwissStandings: No Swiss rounds found.");
            if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
            if (noStandingsMsg) noStandingsMsg.style.display = 'block';
            if (standingsContainer) standingsContainer.style.display = 'block'; // Show container but with "no standings" message
            if (standingsTableBody) standingsTableBody.innerHTML = ''; // Clear old standings
            return [];
        }

        const allPlayerIds = Object.keys(playersData);

        // --- Step 1: Pre-calculate all player records ---
        console.log("calculateSwissStandings: Step 1 - Calculating Records...");
        allPlayerIds.forEach(playerId => {
            if (!standingsCache[playerId]) standingsCache[playerId] = {};
            standingsCache[playerId].record = calculatePlayerSwissRecord(playerId);
           // const rec = standingsCache[playerId].record;
           // console.log(`  Record ${playerId}: ${rec.wins}-${rec.losses}-${rec.ties} (${rec.matchPoints} pts, ${rec.roundsPlayed} rounds)`);
        });

        // --- Step 2: Pre-calculate all player Win Percentages (WP) ---
        console.log("calculateSwissStandings: Step 2 - Calculating WPs (includes caching)...");
        allPlayerIds.forEach(playerId => {
            getPlayerSwissWinPercentage(playerId, OWP_MINIMUM); // This calculates and caches WP
        });

        // --- Step 3: Pre-calculate all player Opponent Win Percentages (OWP) ---
        console.log("calculateSwissStandings: Step 3 - Calculating OWPs (includes caching)...");
        allPlayerIds.forEach(playerId => {
            calculateOWP(playerId, OWP_MINIMUM); // This calculates and caches OWP
        });

        // --- Step 4: Calculate all player Opponent's Opponent Win Percentages (OOWP) and build final list ---
        console.log("calculateSwissStandings: Step 4 - Calculating OOWPs and building final list...");
        allPlayerIds.forEach(playerId => {
            const playerInfo = playersData[playerId];
            const cachedData = standingsCache[playerId];

            if (cachedData && cachedData.record && playerInfo) {
                 try {
                     // Calculate OOWP (uses cached OWPs of opponents internally)
                     const oowp = calculateOOWP(playerId, OWP_MINIMUM);
                     // Ensure OOWP is cached as well
                     cachedData.oowp = oowp;

                     // Add to final list for sorting/display
                     standingsData.push({
                         playerInfo: playerInfo,
                         matchPoints: cachedData.record.matchPoints, // Use match points for primary sort
                         // Create W-L-T string (Ties are uncommon in VGC, but included for correctness)
                         recordString: `${cachedData.record.wins}-${cachedData.record.losses}${cachedData.record.ties > 0 ? '-' + cachedData.record.ties : ''}`,
                         owp: cachedData.owp ?? 0, // Use cached OWP
                         oowp: oowp // Use the calculated OOWP
                     });
                } catch (error) {
                    console.error(`Error calculating OOWP for player ${playerId}:`, error);
                    // Add with 0 OOWP if error occurs
                     standingsData.push({
                         playerInfo: playerInfo,
                         matchPoints: cachedData.record.matchPoints,
                         recordString: `${cachedData.record.wins}-${cachedData.record.losses}${cachedData.record.ties > 0 ? '-' + cachedData.record.ties : ''}`,
                         owp: cachedData.owp ?? 0,
                         oowp: 0
                     });
                }
            } else {
                console.warn(`calculateSwissStandings: Skipping player ID ${playerId} - missing cached data or playerInfo.`);
            }
        });


        console.log(`calculateSwissStandings: Calculation finished. ${standingsData.length} players processed.`);
        if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
        return standingsData; // Return data ready for sorting
    }


    /**
     * Sorts standings data based on standard tiebreakers:
     * 1. Match Points (Descending)
     * 2. OWP (Descending)
     * 3. OOWP (Descending)
     * 4. Player Name (Ascending - alphabetical)
     */
    function sortStandings(standingsData) {
        return standingsData.sort((a, b) => {
            // 1. Match Points
            if (b.matchPoints !== a.matchPoints) {
                return b.matchPoints - a.matchPoints;
            }
            // 2. OWP
            // Add tolerance for floating point comparisons
            const owpDiff = b.owp - a.owp;
            if (Math.abs(owpDiff) > 1e-9) { // 1e-9 is a small tolerance
                 return owpDiff;
            }
            // 3. OOWP
            const oowpDiff = b.oowp - a.oowp;
             if (Math.abs(oowpDiff) > 1e-9) {
                 return oowpDiff;
             }
            // 4. Player Name (Alphabetical as final tiebreaker)
            return a.playerInfo.name.localeCompare(b.playerInfo.name);
        });
    }


    // --- UI Update and Display Functions ---

    function updateUI() {
        console.log("updateUI: Starting UI update...");
        console.log(`updateUI: Data state - Players: ${Object.keys(playersData).length}, Rounds: ${roundsData.length}`);

        try {
            // --- Update Pairings Section ---
            if (Object.keys(playersData).length === 0 || roundsData.length === 0) {
                // No data loaded yet or error during extraction
                console.log("updateUI: No player or round data available for pairings.");
                if (lastKnownTimeElapsed === -1) { // Initial load state
                    if(loadingMessage){ loadingMessage.textContent = "Waiting for tournament data..."; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#6c757d';}
                } else { // Data was loaded previously but might be empty/corrupt now
                    if(loadingMessage){ loadingMessage.textContent = "No player/round data found. Check console for errors."; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545'; }
                }
                // Hide or clear pairings elements
                if(pairingsTable) pairingsTable.style.display = 'none';
                if(currentRoundTitle) currentRoundTitle.style.display = 'none';
                if(roundTabsContainer) roundTabsContainer.innerHTML = '';
                // Also hide standings if no pairings data
                if (standingsContainer) standingsContainer.style.display = 'none';
                return; // Stop UI update here if no basic data
            }

            // Determine latest round and ensure currentRound is valid
            const latestRoundNumber = roundsData.length > 0 ? roundsData[roundsData.length - 1].roundNumber : 1;
            const currentRoundExists = roundsData.some(r => r.roundNumber === currentRound);
            if (!currentRoundExists || currentRound < 1) {
                currentRound = latestRoundNumber; // Default to latest round if current is invalid
            }

            // Update Round Tabs only if rounds have changed
            let existingTabNumbers = Array.from(roundTabsContainer.querySelectorAll('button')).map(btn => parseInt(btn.dataset.roundNumber, 10));
            let newRoundNumbers = roundsData.map(r => r.roundNumber);
            if (JSON.stringify(existingTabNumbers) !== JSON.stringify(newRoundNumbers)) {
                if (roundTabsContainer) roundTabsContainer.innerHTML = ''; // Clear existing tabs
                roundsData.forEach(round => {
                    const button = document.createElement('button');
                    button.textContent = `Round ${round.roundNumber}`;
                    button.dataset.roundNumber = round.roundNumber;
                    button.addEventListener('click', () => {
                        currentRound = round.roundNumber;
                        displayRound(currentRound); // Update pairings table
                        updateActiveTab(); // Highlight clicked tab
                        filterTable(); // Apply search filter to new pairings
                    });
                    if (roundTabsContainer) roundTabsContainer.appendChild(button);
                });
                console.log("updateUI: Round tabs updated.");
            }

            // Display the pairings for the selected round
            displayRound(currentRound);
            updateActiveTab(); // Ensure correct tab is highlighted

            // Hide loading message and show table
            if (loadingMessage) loadingMessage.style.display = 'none';
            if (pairingsTable) pairingsTable.style.display = 'table';
            if (currentRoundTitle) currentRoundTitle.style.display = 'block';

            // Apply search filter
            if (searchInput) {
                filterTable();
            } else {
                console.warn("updateUI: searchInput element not found, skipping filterTable call.");
            }
            console.log("updateUI: Pairings section updated successfully.");

        } catch (error) {
            console.error("updateUI: Error during pairings update:", error);
            if (loadingMessage) {
                loadingMessage.textContent = `Error displaying pairings: ${error.message}. Check console.`;
                loadingMessage.style.display = 'block';
                loadingMessa

            }
            return; // Skip the standings update if pairings failed
        }

        // --- Update Standings Section ---
        // Only attempt if we have player and round data
        if (Object.keys(playersData).length > 0 && roundsData.length > 0) {
            try {
                console.log("updateUI: >>> Starting Standings Update Logic <<<");
                const swissRoundsExist = roundsData.some(r => r.type === "3");
                console.log(`updateUI: Swiss rounds exist? ${swissRoundsExist}`);

                if (swissRoundsExist) {
                    // Calculate, Sort, and Display Standings
                    const standingsData = calculateSwissStandings(); // Uses revised logic
                    console.log(`updateUI: Calculated standings data length: ${standingsData ? standingsData.length : 'null'}`);
                    const sortedStandings = sortStandings(standingsData); // Uses revised logic
                    console.log(`updateUI: Sorted standings data length: ${sortedStandings ? sortedStandings.length : 'null'}`);
                    displayStandings(sortedStandings); // Uses revised logic
                    console.log("updateUI: Called displayStandings.");
                    if (standingsContainer) standingsContainer.style.display = 'block'; // Make sure it's visible
                } else {
                    // No Swiss rounds, hide standings section and show appropriate message
                    console.log("updateUI: No swiss rounds exist, ensuring standings are hidden.");
                    if (standingsContainer) standingsContainer.style.display = 'none';
                    if (noStandingsMsg) {
                        noStandingsMsg.style.display = 'block';
                        noStandingsMsg.textContent = "No Swiss rounds found to calculate standings.";
                    }
                    if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
                    if (standingsTableBody) standingsTableBody.innerHTML = ''; // Clear any old data
                }
                console.log("updateUI: >>> Standings section processing complete <<<");

            } catch (error) {
                console.error("updateUI: CRITICAL Error during standings update block:", error);
                // Display error state for standings
                if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
                if (noStandingsMsg) {
                    noStandingsMsg.style.display = 'block';
                    noStandingsMsg.textContent = `Error updating standings: ${error.message}. Check console.`;
                    noStandingsMsg.style.color = '#dc3545';
                }
                if (standingsContainer) standingsContainer.style.display = 'block'; // Show container to display error msg
                if (standingsTableBody) standingsTableBody.innerHTML = ''; // Clear potentially broken table
            }
        } else {
            // Hide standings if no player/round data was available initially
            console.log("updateUI: Skipping standings update due to lack of player/round data.");
            if (standingsContainer) standingsContainer.style.display = 'none';
        }

        // Update status indicator in header
        if (updateStatusElement) {
            updateStatusElement.textContent = `Updated`;
            updateStatusElement.title = `Last update: ${new Date().toLocaleTimeString()}`;
        }
        console.log("updateUI: Update finished.");
    }

    /**
     * Calculates W-L record *before* a specific round (for display in pairings).
     * Does NOT use match points or ties for this simple display.
     */
    function getPlayerScoreBeforeRound(playerId, targetRoundNumber) {
        let wins = 0;
        let losses = 0;
        // Note: This simple version doesn't account for ties in the display string.
        // It's just for the (W-L) next to player names in pairings.

        if (!playerId) return { wins, losses };

        for (const pastRound of roundsData) {
            // Only count rounds *before* the target round
            if (pastRound.roundNumber >= targetRoundNumber) continue;
            // Skip non-Swiss rounds if necessary? Or count all previous rounds?
            // Let's count all previous rounds for score display.

            for (const match of pastRound.matches) {
                if (match.isBye && match.player1Id === playerId) {
                    wins++;
                    continue; // Found player's match (bye)
                }
                if (match.player1Id === playerId) {
                    if (match.outcome === 1) wins++;
                    else if (match.outcome === 2) losses++; // Outcome 3/4 (Tie/DL) ignored here
                    continue; // Found player's match
                }
                if (match.player2Id === playerId) {
                    if (match.outcome === 2) wins++;
                    else if (match.outcome === 1) losses++; // Outcome 3/4 (Tie/DL) ignored here
                    continue; // Found player's match
                }
            }
        }
        return { wins, losses };
    }

    /**
     * Populates the pairings table for a specific round number.
     */
    function displayRound(roundNumber) {
        /* console.log(`displayRound: Displaying round ${roundNumber}`); */ // Reduce console noise
        const round = roundsData.find(r => r.roundNumber === roundNumber);

        if (!round) {
            console.error(`Round data not found for round: ${roundNumber}`);
            if (pairingsTableBody) pairingsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px;">Could not load data for this round.</td></tr>';
            if (currentRoundTitle) currentRoundTitle.textContent = `Round ${roundNumber} (Error)`;
            return;
        }

        if (currentRoundTitle) currentRoundTitle.textContent = `Round ${roundNumber} Pairings`;
        if (!pairingsTableBody) { console.error("displayRound: pairingsTableBody not found!"); return; }
        pairingsTableBody.innerHTML = ''; // Clear previous pairings

        if (round.matches.length === 0) {
            // Display a message if no matches reported yet
            pairingsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: #6c757d;">No matches reported for this round yet.</td></tr>';
            return;
        }

        // Populate table rows
        round.matches.forEach(match => {
            try {
                const row = pairingsTableBody.insertRow();

                // Get player info, providing fallbacks
                const player1Info = playersData[match.player1Id] || { name: `Unknown ID (${match.player1Id})` };
                const player2Info = match.isBye ? { name: "BYE" } : (playersData[match.player2Id] || { name: `Unknown ID (${match.player2Id})` });

                // Get simple W-L score before this round for display
                const scoreP1 = getPlayerScoreBeforeRound(match.player1Id, roundNumber);
                // BYE doesn't need a score display
                const scoreP2 = match.isBye ? { wins: '-', losses: '-' } : getPlayerScoreBeforeRound(match.player2Id, roundNumber);

                // Construct display strings
                const player1DisplayText = `${player1Info.name} (${scoreP1.wins}-${scoreP1.losses})`;
                const player2DisplayText = match.isBye ? player2Info.name : `${player2Info.name} (${scoreP2.wins}-${scoreP2.losses})`;

                // Add player names to dataset for search filtering
                row.dataset.player1Name = player1Info.name.toLowerCase();
                row.dataset.player2Name = match.isBye ? 'bye' : player2Info.name.toLowerCase();

                // Table Number Cell
                const cellTable = row.insertCell();
                cellTable.textContent = match.table === 0 ? "N/A" : match.table; // Handle table 0 (often BYE or unassigned)
                cellTable.style.textAlign = 'center';

                // Player 1 Cell
                const cellP1 = row.insertCell();
                if (match.outcome === 1) { // Player 1 won
                    cellP1.innerHTML = `<span class="winner">${player1DisplayText}</span>`;
                } else {
                    cellP1.textContent = player1DisplayText;
                }

                // Player 2 Cell
                const cellP2 = row.insertCell();
                if (match.isBye) {
                    cellP2.textContent = player2DisplayText;
                    cellP2.style.fontStyle = 'italic'; // Style BYE differently
                    cellP2.style.color = '#6c757d';
                } else {
                    if (match.outcome === 2) { // Player 2 won
                        cellP2.innerHTML = `<span class="winner">${player2DisplayText}</span>`;
                    } else {
                        cellP2.textContent = player2DisplayText;
                    }
                }

            } catch (error) {
                console.error(`Error displaying match row: ${JSON.stringify(match)}`, error);
                // Optionally insert an error row?
            }
        });
    }

     /**
     * Displays the sorted standings in the table. (Revised to match new data structure)
     */
     function displayStandings(sortedStandings) {
        console.log("displayStandings: Starting display...");
        if (!standingsTableBody) { console.error("displayStandings: Standings table body NOT FOUND!"); return; }

        standingsTableBody.innerHTML = ''; // Clear previous standings

        if (!Array.isArray(sortedStandings) || sortedStandings.length === 0) {
            console.log("displayStandings: No valid standings data (or empty array) received.");
            // Message should be handled by calculateSwissStandings logic (noStandingsMsg)
            if (standingsContainer) standingsContainer.style.display = roundsData.some(r => r.type === "3") ? 'block' : 'none'; // Show container if Swiss rounds exist, even if empty
            return;
        }

        console.log(`displayStandings: Received ${sortedStandings.length} players to display.`);
        if (standingsContainer) standingsContainer.style.display = 'block'; // Ensure container is visible

        sortedStandings.forEach((data, index) => {
            try {
                const rank = index + 1;
                const row = standingsTableBody.insertRow();

                // Rank Cell
                const cellRank = row.insertCell();
                cellRank.textContent = rank;
                cellRank.style.textAlign = 'center';

                // Player Name Cell
                const cellName = row.insertCell();
                cellName.textContent = data.playerInfo?.name || 'Unknown Player';

                // Record Cell (W-L or W-L-T)
                const cellRecord = row.insertCell();
                cellRecord.textContent = data.recordString; // Use the pre-formatted string
                cellRecord.style.textAlign = 'center';

                // OWP % Cell
                const cellOWP = row.insertCell();
                cellOWP.textContent = (data.owp * 100).toFixed(2); // Display OWP
                cellOWP.style.textAlign = 'right';

                // OOWP % Cell
                const cellOOWP = row.insertCell();
                cellOOWP.textContent = (data.oowp * 100).toFixed(2); // Display OOWP
                cellOOWP.style.textAlign = 'right';

            } catch (error) {
                console.error(`Error displaying standings row ${index+1} for player ${data?.playerInfo?.id}:`, error);
                // Optionally insert an error row in the standings table
            }
        });
        console.log("displayStandings: Display finished.");
    }


    /**
     * Updates the visual state (active class) of the round tabs.
     */
    function updateActiveTab() {
        if(!roundTabsContainer) return;
        const buttons = roundTabsContainer.querySelectorAll('button');
        buttons.forEach(button => {
            if (parseInt(button.dataset.roundNumber, 10) === currentRound) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }

    /**
     * Filters the pairings table rows based on the search input value.
     */
    function filterTable() {
        if(!pairingsTableBody || !searchInput) {
            console.warn("filterTable: Skipping filter, pairingsTableBody or searchInput not found.");
            return;
        }
        const searchTerm = searchInput.value.toLowerCase().trim();
        const rows = pairingsTableBody.querySelectorAll('tr');
        let visibleRows = 0;

        rows.forEach(row => {
            // Handle special rows like "No matches" or error messages
            if (row.cells.length === 1 && row.cells[0].colSpan === 3) {
                row.classList.remove('hidden-row'); // Always show these messages
                visibleRows++;
                return;
            }

            // Get player names from dataset attributes
            const p1Name = row.dataset.player1Name || '';
            const p2Name = row.dataset.player2Name || ''; // Includes 'bye'

            // Show row if search term is empty or matches either player name
            if (!searchTerm || p1Name.includes(searchTerm) || (p2Name && p2Name.includes(searchTerm))) {
                row.classList.remove('hidden-row');
                visibleRows++;
            } else {
                row.classList.add('hidden-row');
            }
        });

        // Optional: Display a "No results" message if search term yields nothing
        const noResultsMessage = document.getElementById('no-search-results'); // Assuming you add <p id="no-search-results" style="display: none;">No players match your search.</p>
        if (noResultsMessage) {
            noResultsMessage.style.display = (visibleRows === 0 && searchTerm) ? 'block' : 'none';
        }
    }

    /**
     * Shows or hides the clear search button based on input content.
     */
    function checkClearButtonVisibility() {
        if (!clearSearchBtn || !searchInput) return;
        if (searchInput.value.length > 0) {
            clearSearchBtn.style.display = 'inline-block';
        } else {
            clearSearchBtn.style.display = 'none';
        }
    }


    // --- Automatic Update Check ---

    async function checkForUpdates() {
        if (updateStatusElement) {
            updateStatusElement.textContent = `Checking...`;
            updateStatusElement.title = `Checking at: ${new Date().toLocaleTimeString()}`;
        }
        // Attempt to load data; returns true if new data was processed
        const newDataProcessed = await loadTournamentData();
        if (newDataProcessed) {
            console.log("checkForUpdates: New data processed, updating UI.");
            updateUI(); // Refresh the entire UI with the new data
        }
        // If loadTournamentData returned false, it means either no change or an error occurred.
        // Status element would have been updated within loadTournamentData.
    }


    // --- Initialisation ---

    async function initialize() {
        console.log("initialize: Starting initialization...");
        if(updateStatusElement) updateStatusElement.textContent = `Loading...`;

        // Initial data load
        await loadTournamentData();
        // Initial UI setup based on loaded data (or lack thereof)
        updateUI();
        // Set initial state of clear search button
        checkClearButtonVisibility();

        // Start the periodic update check
        if (updateIntervalId) clearInterval(updateIntervalId); // Clear any existing interval
        updateIntervalId = setInterval(checkForUpdates, refreshInterval);
        console.log(`initialize: Started checking for updates every ${refreshInterval / 1000} seconds.`);
    }

    // --- Event Listeners ---

    // Search input listener
    if(searchInput) {
        searchInput.addEventListener('input', () => {
            filterTable(); // Filter pairings as user types
            checkClearButtonVisibility(); // Show/hide clear button
        });
    } else {
        console.warn("Could not find searchInput to attach listener.");
    }

    // Clear search button listener
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            if(searchInput) searchInput.value = ''; // Clear the input
            filterTable(); // Re-apply filter (will show all rows)
            checkClearButtonVisibility(); // Hide the clear button
            if(searchInput) searchInput.focus(); // Return focus to input
        });
    } else {
         console.warn("Could not find clearSearchBtn to attach click listener.");
    }

    // --- Start the application ---
    initialize();

}); // End of DOMContentLoaded
