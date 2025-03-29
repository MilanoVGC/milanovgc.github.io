// Wait for the HTML document to be fully loaded before running script
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");
    console.log("--- Initializing Pairing/Standings Script (TPCi Rules - v4.4 Include Byes in WP + Intermediate Rounding) ---");

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
    const ROUNDING_PRECISION = 4; // Number of decimal places for intermediate rounding
    const CURRENT_YEAR = new Date().getFullYear();
    const DEBUG_STANDINGS = true; // <<< SET TO true TO ENABLE DETAILED LOGGING


    // --- Core Data Loading and Parsing (Identical to v4.3.1) ---
    async function loadTournamentData() {
        console.log("loadTournamentData: Starting fetch..."); try { const response = await fetch(`${xmlFilePath}?t=${new Date().getTime()}`); console.log(`loadTournamentData: Fetch status: ${response.status}`); if (!response.ok) { if (response.status === 404) { console.log(`Data file not found.`); updateStatusElement.textContent = `Waiting for data...`; } else { console.error(`HTTP error ${response.status}`); updateStatusElement.textContent = `Error (${response.status})`; } return false; } const xmlText = await response.text(); const parser = new DOMParser(); const xmlDoc = parser.parseFromString(xmlText, "application/xml"); const parseError = xmlDoc.querySelector("parsererror"); if (parseError) { console.error("XML Parsing Error:", parseError.textContent); updateStatusElement.textContent = `Parse Error`; return false; } console.log("loadTournamentData: XML parsed."); const currentTimeElapsedElement = xmlDoc.querySelector('tournament > timeelapsed'); const currentTimeElapsed = currentTimeElapsedElement ? parseInt(currentTimeElapsedElement.textContent, 10) : -1; if (currentTimeElapsed !== -1 && currentTimeElapsed === lastKnownTimeElapsed) { console.log("loadTournamentData: No change detected."); updateStatusElement.textContent = `Up to date`; return false; } console.log("loadTournamentData: Change detected. Processing..."); extractData(xmlDoc); lastKnownTimeElapsed = currentTimeElapsed; console.log("loadTournamentData: Data extraction complete."); return true; } catch (error) { console.error("loadTournamentData: Error:", error); updateStatusElement.textContent = `Fetch Error`; return false; }
    }
    function extractData(xmlDoc) {
         console.log("extractData: Starting..."); playersData = {}; roundsData = []; let extractionError = false; try { /* Extract location */ const tournamentData = xmlDoc.querySelector('tournament > data'); if (tournamentData && tournamentInfoElement) { const city = tournamentData.querySelector('city')?.textContent; const country = tournamentData.querySelector('country')?.textContent; tournamentInfoElement.textContent = `${city ? city + ', ' : ''}${country || ''}`.trim(); } const tempPlayersData = {}; const playerElements = xmlDoc.querySelectorAll('tournament > players > player'); console.log(`extractData: Found ${playerElements.length} players.`); playerElements.forEach((player, index) => { const userId = player.getAttribute('userid'); const firstName = player.querySelector('firstname')?.textContent || ''; const lastName = player.querySelector('lastname')?.textContent || ''; let birthYear = null; const birthdateElement = player.querySelector('birthdate'); if (birthdateElement) { /* parse birth year */ } if (userId) { tempPlayersData[String(userId)] = { id: String(userId), firstName, lastName, name: `${firstName} ${lastName}`.trim(), birthYear }; } else { console.warn(`extractData: Player index ${index} missing userid.`); } }); playersData = tempPlayersData; console.log(`extractData: Extracted ${Object.keys(playersData).length} players.`); const tempRoundsData = []; const roundElements = xmlDoc.querySelectorAll('tournament > pods > pod > rounds > round'); console.log(`extractData: Found ${roundElements.length} rounds.`); roundElements.forEach((round, roundIndex) => { const roundNumber = parseInt(round.getAttribute('number'), 10); const roundType = round.getAttribute('type'); if (isNaN(roundNumber)) { console.warn(`Skipping round index ${roundIndex}.`); return; } const matches = []; const matchElements = round.querySelectorAll('matches > match'); matchElements.forEach((match, matchIndex) => { const tableNumber = parseInt(match.querySelector('tablenumber')?.textContent || '0', 10); const outcome = parseInt(match.getAttribute('outcome'), 10); const player1Element = match.querySelector('player1'); const player2Element = match.querySelector('player2'); const singlePlayerElement = match.querySelector('player'); let matchData = { table: tableNumber, player1Id: null, player2Id: null, outcome: outcome, isBye: false }; if (outcome === 5 && singlePlayerElement) { matchData.player1Id = String(singlePlayerElement.getAttribute('userid')); matchData.isBye = true; } else if (player1Element && player2Element) { matchData.player1Id = String(player1Element.getAttribute('userid')); matchData.player2Id = String(player2Element.getAttribute('userid')); } else { console.warn(`Skipping malformed match R ${roundNumber} index ${matchIndex}.`); return; } matches.push(matchData); }); matches.sort((a, b) => a.table - b.table); tempRoundsData.push({ roundNumber, type: roundType, matches }); }); tempRoundsData.sort((a, b) => a.roundNumber - b.roundNumber); roundsData = tempRoundsData; console.log(`extractData: Extracted ${roundsData.length} rounds.`); } catch (error) { console.error("extractData: CRITICAL Error:", error); extractionError = true; playersData = {}; roundsData = []; } finally { console.log(`extractData: Finished. players: ${Object.keys(playersData).length}, rounds: ${roundsData.length}, Error: ${extractionError}`); }
    }


    // --- Standings Calculation Logic (TPCi Rules - v4.4 - Include Byes + Intermediate Rounding) ---

    /** Helper: Rounds a number to specified precision */
    function roundToPrecision(value, precision) { const factor = Math.pow(10, precision); return Math.round(value * factor) / factor; }
    /** Helper to get total Swiss rounds */
    function getTotalSwissRounds() { let max = 0; for(const r of roundsData) if(r.type === "3" && r.roundNumber > max) max = r.roundNumber; return max; }

    /** Calculates record & participation */
    function calculatePlayerSwissRecord(playerId, maxRoundNumber) {
         let w=0, l=0, t=0, b=0, mp=0, rp=0, hr=0; const pid=String(playerId); if(!pid) return {wins:w,losses:l,ties:t,byes:b,matchPoints:mp,roundsParticipated:rp,highestRoundParticipated:hr};
         for(const rnd of roundsData){ if(rnd.type!=="3"||rnd.roundNumber>maxRoundNumber) continue; let played=false; for(const m of rnd.matches){ let found=false; const p1=String(m.player1Id), p2=String(m.player2Id); if(m.isBye&&p1===pid){w++;b++;mp+=3;found=true;}else if(p1===pid){if(m.outcome===1){w++;mp+=3;}else if(m.outcome===2){l++;mp+=0;}else if(m.outcome===3||m.outcome===4){t++;mp+=1;}else{mp+=0;}found=true;}else if(p2===pid){if(m.outcome===1){l++;mp+=0;}else if(m.outcome===2){w++;mp+=3;}else if(m.outcome===3||m.outcome===4){t++;mp+=1;}else{mp+=0;}found=true;}if(found){played=true;break;}}if(played){rp++;hr=rnd.roundNumber;}}
         // Removed debug log from here for brevity, logic is unchanged
         return {wins:w,losses:l,ties:t,byes:b,matchPoints:mp,roundsParticipated:rp,highestRoundParticipated:hr};
    }

    /** Gets opponents */
    function getSwissOpponents(playerId, maxRoundNumber) {
        const opps = new Set(); const pid=String(playerId); if(!pid) return [];
        for(const rnd of roundsData){ if(rnd.type!=="3"||rnd.roundNumber>maxRoundNumber) continue; for(const m of rnd.matches){ if(m.isBye) continue; const p1=String(m.player1Id), p2=String(m.player2Id); if(p1===pid&&p2) opps.add(p2); else if(p2===pid&&p1) opps.add(p1); }}
        return Array.from(opps);
    }

    /** Calculates WP based on TPCi rules (INCLUDING byes in wins), uses cache. (v4.4) */
    function getPlayerSwissWinPercentage(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache) {
        const effectivePlayerId = String(playerId); const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`; if (currentStandingsCache[cacheKey]?.wp !== undefined) { return currentStandingsCache[cacheKey].wp; }
        let record = currentStandingsCache[cacheKey]?.record || calculatePlayerSwissRecord(effectivePlayerId, maxRoundNumber); if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].record = record;

        // >>>>>> CHANGE: Include byes in wins for WP calculation <<<<<<
        const totalWins = record.wins + record.byes;

        const completedStage = record.highestRoundParticipated >= maxRoundNumber; let divisor, maxWP; if (completedStage) { divisor = totalSwissRounds; maxWP = WP_MAX_COMPLETED; } else { divisor = record.roundsParticipated; maxWP = WP_MAX_DROPPED; }
        let finalWP; if (divisor === 0) { finalWP = WP_MINIMUM; } else { const rawWP = totalWins / divisor; finalWP = Math.min(Math.max(rawWP, WP_MINIMUM), maxWP); }
        currentStandingsCache[cacheKey].wp = finalWP;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`    DEBUG: WP CALC for ${cacheKey} (${playersData[effectivePlayerId]?.name}): TotalWins(incl Bye)=${totalWins}, Divisor=${divisor}, MaxWP=${maxWP} => Final=${finalWP.toFixed(ROUNDING_PRECISION + 2)}`);
        return finalWP;
    }

    /** Calculates OWP with intermediate rounding. (v4.4) */
    function calculateOWP(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache) {
        const effectivePlayerId = String(playerId); const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`; if (currentStandingsCache[cacheKey]?.owp !== undefined) { return currentStandingsCache[cacheKey].owp; }
        const opponents = getSwissOpponents(effectivePlayerId, maxRoundNumber); if (opponents.length === 0) { if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].owp = 0; return 0; }
        let totalOpponentWinPercentageRounded = 0; let validOpponentCount = 0;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`  DEBUG: OWP CALC for ${cacheKey} (${playersData[effectivePlayerId]?.name}), Opponents: [${opponents.join(', ')}]`);
        opponents.forEach(oppId => {
            try {
                const opponentWinPerc = getPlayerSwissWinPercentage(oppId, maxRoundNumber, totalSwissRounds, currentStandingsCache); // Calls WP calc (v4.4)
                if (typeof opponentWinPerc === 'number' && !isNaN(opponentWinPerc)) {
                    const roundedOppWP = roundToPrecision(opponentWinPerc, ROUNDING_PRECISION); totalOpponentWinPercentageRounded += roundedOppWP; validOpponentCount++;
                    if (DEBUG_STANDINGS) console.log(`      Opponent ${oppId} WP: ${opponentWinPerc.toFixed(ROUNDING_PRECISION + 2)} => Rounded: ${roundedOppWP.toFixed(ROUNDING_PRECISION)}`);
                } else { console.warn(`OWP (${cacheKey}): Invalid WP for opp ${oppId}.`); }
            } catch (e) { console.error(`OWP (${cacheKey}): Error for opp ${oppId}:`, e); }
        });
        const result = (validOpponentCount > 0) ? (totalOpponentWinPercentageRounded / validOpponentCount) : 0;
        if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].owp = result;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`  DEBUG: OWP RESULT for ${cacheKey} (${playersData[effectivePlayerId]?.name}): RoundedSum=${totalOpponentWinPercentageRounded.toFixed(ROUNDING_PRECISION)}, Count=${validOpponentCount}, Avg=${result.toFixed(ROUNDING_PRECISION + 2)}`);
        return result;
    }

    /** Calculates OOWP with intermediate rounding. (v4.4) */
    function calculateOOWP(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache) {
         const effectivePlayerId = String(playerId); const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`; if (currentStandingsCache[cacheKey]?.oowp !== undefined) { return currentStandingsCache[cacheKey].oowp; }
        const opponents = getSwissOpponents(effectivePlayerId, maxRoundNumber); if (opponents.length === 0) { if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].oowp = 0; return 0; }
        let totalOpponentOWPRounded = 0; let validOpponentCount = 0;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`DEBUG: OOWP CALC for ${cacheKey} (${playersData[effectivePlayerId]?.name}), Opponents: [${opponents.join(', ')}]`);
        opponents.forEach(oppId => {
            try {
                const oppOWP = calculateOWP(oppId, maxRoundNumber, totalSwissRounds, currentStandingsCache); // Calls OWP calc (v4.4)
                 if (typeof oppOWP === 'number' && !isNaN(oppOWP)) {
                    const roundedOppOWP = roundToPrecision(oppOWP, ROUNDING_PRECISION); totalOpponentOWPRounded += roundedOppOWP; validOpponentCount++;
                     if (DEBUG_STANDINGS) console.log(`    Opponent ${oppId} OWP: ${oppOWP.toFixed(ROUNDING_PRECISION + 2)} => Rounded: ${roundedOppOWP.toFixed(ROUNDING_PRECISION)}`);
                } else { console.warn(`OOWP (${cacheKey}): Invalid OWP for opp ${oppId}.`); }
            } catch (e) { console.error(`OOWP (${cacheKey}): Error for opp ${oppId}:`, e); }
        });
        const result = (validOpponentCount > 0) ? (totalOpponentOWPRounded / validOpponentCount) : 0;
        if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].oowp = result;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`DEBUG: OOWP RESULT for ${cacheKey} (${playersData[effectivePlayerId]?.name}): RoundedSum=${totalOpponentOWPRounded.toFixed(ROUNDING_PRECISION)}, Count=${validOpponentCount}, Avg=${result.toFixed(ROUNDING_PRECISION + 2)}`);
        return result;
    }

    /** Orchestrates calculation up to maxRoundNumber (v4.4) */
    function calculateSwissStandingsForRound(maxRoundNumber) {
        if (DEBUG_STANDINGS) console.log(`\n--- Calculating Standings for Round ${maxRoundNumber} (TPCi Rules - Incl Byes + Intermediate Rounding) ---`);
        const currentStandingsCache = {}; const standingsData = []; const allPlayerIds = Object.keys(playersData);
        if (allPlayerIds.length === 0) { return []; } const totalSwissRounds = getTotalSwissRounds(); if (totalSwissRounds === 0) { return []; }
        if (DEBUG_STANDINGS) console.log(`   Detected Total Swiss Rounds: ${totalSwissRounds}`);
        if (DEBUG_STANDINGS) console.log(`\n--- STEP 1: Calculating Records & WPs (Incl Byes) for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => { getPlayerSwissWinPercentage(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache); });
        if (DEBUG_STANDINGS) console.log(`\n--- STEP 2: Calculating OWPs (Intermediate Rounding) for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => { calculateOWP(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache); });
        if (DEBUG_STANDINGS) console.log(`\n--- STEP 3: Calculating OOWPs (Intermediate Rounding) & Final Data for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => {
            const cacheKey = `${playerId}_R${maxRoundNumber}`; const playerInfo = playersData[playerId]; const cachedData = currentStandingsCache[cacheKey];
            if (cachedData?.record && cachedData.wp !== undefined && cachedData.owp !== undefined && playerInfo) {
                try { const oowp = calculateOOWP(playerId, maxRoundNumber, totalSwissRounds, currentStandingsCache); const record = cachedData.record; standingsData.push({ playerInfo, matchPoints: record.matchPoints, recordString: `${record.wins}-${record.losses}${record.ties > 0 ? '-' + record.ties : ''}`, owp: cachedData.owp, oowp }); }
                catch (error) { console.error(`Error final OOWP step ${cacheKey}:`, error); }
            } else { console.warn(`calculateSwissStandingsForRound: Skipping ${playerId} - missing data.`); }
        });
        if (DEBUG_STANDINGS) console.log(`--- Standings Calculation Complete for Round ${maxRoundNumber} ---`);
        return standingsData;
    }

    /** Sorts standings */
    function sortStandings(standingsData) {
        return standingsData.sort((a, b) => { if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints; const owpDiff = b.owp - a.owp; if (Math.abs(owpDiff) > 1e-9) return owpDiff; const oowpDiff = b.oowp - a.oowp; if (Math.abs(oowpDiff) > 1e-9) return oowpDiff; return a.playerInfo.name.localeCompare(b.playerInfo.name); });
    }

    /** Displays standings */
    function displayStandings(sortedStandings) {
        console.log("displayStandings: Starting display..."); if (!standingsTableBody) { return; } standingsTableBody.innerHTML = ''; if (!Array.isArray(sortedStandings) || sortedStandings.length === 0) { if (standingsContainer) standingsContainer.style.display = roundsData.some(r => r.type === "3") ? 'block' : 'none'; if(noStandingsMsg) noStandingsMsg.style.display = 'block'; return; } console.log(`displayStandings: Received ${sortedStandings.length} players.`); if(noStandingsMsg) noStandingsMsg.style.display = 'none'; if (standingsContainer) standingsContainer.style.display = 'block'; sortedStandings.forEach((data, index) => { try { const rank = index + 1; const row = standingsTableBody.insertRow(); const cellRank = row.insertCell(); cellRank.textContent = rank; cellRank.style.textAlign = 'center'; const cellName = row.insertCell(); cellName.textContent = data.playerInfo?.name || 'Unknown'; const cellRecord = row.insertCell(); cellRecord.textContent = data.recordString; cellRecord.style.textAlign = 'center'; const cellOWP = row.insertCell(); cellOWP.textContent = (data.owp * 100).toFixed(2); cellOWP.style.textAlign = 'right'; const cellOOWP = row.insertCell(); cellOOWP.textContent = (data.oowp * 100).toFixed(2); cellOOWP.style.textAlign = 'right'; } catch (error) { console.error(`Error displaying standings row ${index + 1}:`, error); } }); console.log("displayStandings: Display finished.");
    }


    // --- UI Update and Display Functions (FULL - v4.4) ---
    function updateUI() {
        console.log("updateUI: Starting UI update...");
        try { // Pairings update
             if (Object.keys(playersData).length === 0 || roundsData.length === 0) { console.log("updateUI: No player/round data."); /* ... No data handling ... */ return; }
             const latestRoundNumber = roundsData.length > 0 ? roundsData[roundsData.length - 1].roundNumber : 1; const currentRoundExists = roundsData.some(r => r.roundNumber === currentRound); if (!currentRoundExists || currentRound < 1) { currentRound = latestRoundNumber; }
             let existingTabNumbers = Array.from(roundTabsContainer.querySelectorAll('button')).map(btn => parseInt(btn.dataset.roundNumber, 10)); let newRoundNumbers = roundsData.map(r => r.roundNumber);
             if (JSON.stringify(existingTabNumbers) !== JSON.stringify(newRoundNumbers)) {
                 if (roundTabsContainer) roundTabsContainer.innerHTML = ''; roundsData.forEach(round => { const button = document.createElement('button'); button.textContent = `Round ${round.roundNumber}`; button.dataset.roundNumber = round.roundNumber; button.addEventListener('click', () => { currentRound = round.roundNumber; displayRound(currentRound); updateActiveTab(); filterTable(); }); if (roundTabsContainer) roundTabsContainer.appendChild(button); }); console.log("updateUI: Round tabs updated.");
             }
             displayRound(currentRound); updateActiveTab();
             if (loadingMessage) loadingMessage.style.display = 'none'; if (pairingsTable) pairingsTable.style.display = 'table'; if (currentRoundTitle) currentRoundTitle.style.display = 'block';
             filterTable(); console.log("updateUI: Pairings section updated.");
        } catch (error) { console.error("updateUI: Error pairings update:", error); return; }

        // Standings update
        if (Object.keys(playersData).length > 0 && roundsData.length > 0) {
            try {
                console.log("updateUI: >>> Starting Standings Update Logic <<<"); const swissRounds = roundsData.filter(r => r.type === "3");
                if (swissRounds.length > 0) { const latestSwissRoundNumber = swissRounds[swissRounds.length - 1].roundNumber; console.log(`updateUI: Calculating standings as of Round ${latestSwissRoundNumber} (TPCi Rules - Incl Byes + Intermediate Rounding)`); const standingsData = calculateSwissStandingsForRound(latestSwissRoundNumber); const sortedStandings = sortStandings(standingsData); displayStandings(sortedStandings); if (standingsContainer) standingsContainer.style.display = 'block'; if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none'; if (noStandingsMsg) noStandingsMsg.style.display = 'none'; }
                else { console.log("updateUI: No swiss rounds."); /* ... No swiss rounds handling ... */ }
                console.log("updateUI: >>> Standings section processing complete <<<");
            } catch (error) { console.error("updateUI: CRITICAL Error standings update:", error); /* ... Standings error handling ... */ }
        } else { console.log("updateUI: Skipping standings."); if (standingsContainer) standingsContainer.style.display = 'none'; }
        if (updateStatusElement) { updateStatusElement.textContent = `Updated`; updateStatusElement.title = `Last update: ${new Date().toLocaleTimeString()}`; } console.log("updateUI: Update finished.");
    }

    function getPlayerScoreBeforeRound(playerId, targetRoundNumber) {
        let wins = 0, losses = 0; const effectivePlayerId = String(playerId); if (!effectivePlayerId) return { wins, losses };
        for (const pastRound of roundsData) { if (pastRound.roundNumber >= targetRoundNumber) continue; for (const match of pastRound.matches) { const matchP1Id = String(match.player1Id); const matchP2Id = String(match.player2Id); if (match.isBye && matchP1Id === effectivePlayerId) { wins++; continue; } if (matchP1Id === effectivePlayerId) { if (match.outcome === 1) wins++; else if (match.outcome === 2) losses++; continue; } if (matchP2Id === effectivePlayerId) { if (match.outcome === 2) wins++; else if (match.outcome === 1) losses++; continue; } } }
        return { wins, losses };
    }
    function displayRound(roundNumber) {
         const round = roundsData.find(r => r.roundNumber === roundNumber); if (!round) { if(pairingsTableBody) pairingsTableBody.innerHTML = '<tr><td colspan="3">Error loading round.</td></tr>'; if(currentRoundTitle) currentRoundTitle.textContent = `Round ${roundNumber} (Error)`; return; } if (currentRoundTitle) currentRoundTitle.textContent = `Round ${roundNumber} Pairings`; if (!pairingsTableBody) { return; } pairingsTableBody.innerHTML = ''; if (round.matches.length === 0) { pairingsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center;">No matches reported yet.</td></tr>'; return; }
         round.matches.forEach(match => { try { const row = pairingsTableBody.insertRow(); const p1IdStr = String(match.player1Id); const p2IdStr = String(match.player2Id); const player1Info = playersData[p1IdStr] || { name: `Unknown (${p1IdStr})` }; const player2Info = match.isBye ? { name: "BYE" } : (playersData[p2IdStr] || { name: `Unknown (${p2IdStr})` }); const scoreP1 = getPlayerScoreBeforeRound(p1IdStr, roundNumber); const scoreP2 = match.isBye ? { wins: '-', losses: '-' } : getPlayerScoreBeforeRound(p2IdStr, roundNumber); const player1DisplayText = `${player1Info.name} (${scoreP1.wins}-${scoreP1.losses})`; const player2DisplayText = match.isBye ? player2Info.name : `${player2Info.name} (${scoreP2.wins}-${scoreP2.losses})`; row.dataset.player1Name = player1Info.name.toLowerCase(); row.dataset.player2Name = match.isBye ? 'bye' : player2Info.name.toLowerCase(); const cellTable = row.insertCell(); cellTable.textContent = match.table === 0 ? "N/A" : match.table; cellTable.style.textAlign = 'center'; const cellP1 = row.insertCell(); if (match.outcome === 1) { cellP1.innerHTML = `<span class="winner">${player1DisplayText}</span>`; } else { cellP1.textContent = player1DisplayText; } const cellP2 = row.insertCell(); if (match.isBye) { cellP2.textContent = player2DisplayText; cellP2.style.fontStyle = 'italic'; cellP2.style.color = '#6c757d'; } else { if (match.outcome === 2) { cellP2.innerHTML = `<span class="winner">${player2DisplayText}</span>`; } else { cellP2.textContent = player2DisplayText; } } } catch (error) { console.error(`Error displaying match row: ${JSON.stringify(match)}`, error); } });
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
