// --- CONFIGURATION ---
// const OWP_MINIMUM = 0.33; // Original
const OWP_MINIMUM = 1 / 3; // Use precise fraction for minimum WP
// ... rest of config ...

// --- Global Data Storage ---
let playersData = {}; // { playerId: { id, firstName, lastName, name, birthYear } }
let roundsData = []; // [ { roundNumber, type, matches: [ { table, player1Id, player2Id, outcome, isBye } ] } ]
let standingsCache = {}; // Cache for calculated data: { playerId: { record: { wins, losses, ties, byes, matchPoints, roundsPlayed }, wp: number, owp: number } }

// --- FUNCTION REVISIONS ---

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

    // Clear previous cache
    standingsCache = {};

    const standingsData = [];
    let hasSwissRounds = roundsData.some(r => r.type === "3");

    if (!hasSwissRounds) {
        console.log("calculateSwissStandings: No Swiss rounds found.");
        if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
        if (noStandingsMsg) noStandingsMsg.style.display = 'block';
        if (standingsContainer) standingsContainer.style.display = 'block'; // Show container but with "no standings" message
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
                     recordString: `${cachedData.record.wins}-${cachedData.record.losses}-${cachedData.record.ties}`,
                     owp: cachedData.owp ?? 0,
                     oowp: oowp // Use the calculated OOWP
                 });
            } catch (error) {
                console.error(`Error calculating OOWP for player ${playerId}:`, error);
                // Add with 0 OOWP if error occurs
                 standingsData.push({
                     playerInfo: playerInfo,
                     matchPoints: cachedData.record.matchPoints,
                     recordString: `${cachedData.record.wins}-${cachedData.record.losses}-${cachedData.record.ties}`,
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

/**
 * Displays the sorted standings in the table.
 */
function displayStandings(sortedStandings) {
    console.log("displayStandings: Starting display...");
    // ... (rest of the display function remains largely the same) ...

    // Make sure to use the correct fields from the sortedStandings objects:
    // e.g., data.recordString, (data.owp * 100).toFixed(2), (data.oowp * 100).toFixed(2)

    // Inside the loop:
       // ...
       const cellRecord = row.insertCell();
       cellRecord.textContent = data.recordString; // Use the pre-formatted string
       cellRecord.style.textAlign = 'center';

       const cellOWP = row.insertCell();
       cellOWP.textContent = (data.owp * 100).toFixed(2); // Display OWP
       cellOWP.style.textAlign = 'right';

       const cellOOWP = row.insertCell();
       cellOOWP.textContent = (data.oowp * 100).toFixed(2); // Display OOWP
       cellOOWP.style.textAlign = 'right';
       // ...
}

// --- IMPORTANT ---
// You would replace the existing functions in your `assets/script.js`
// with these revised versions. Make sure the rest of the script
// (DOM loading, event listeners, fetching XML, update loop) remains intact.
// Ensure the `updateUI` function calls `calculateSwissStandings`, `sortStandings`,
// and `displayStandings` in the correct order.
