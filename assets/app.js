// Wait for the HTML document to be fully loaded before running script
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");
    console.log("--- Initializing Pairing/Standings Script (v4.14.1 - Fixed Syntax Error) ---");

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
     if (!appContainer || !loadingMessage) { // Check only essential core elements initially
          console.error("CRITICAL ERROR: Missing #app container or initial loading message. Stopping script.");
          // Can't reliably show error if container is missing
          return;
     }
     console.log("Essential DOM elements (#app, initial loading message) found.");

    // --- Global Data Storage ---
    let playersData = {}; let roundsData = []; let currentRound = 1; let lastKnownTimeElapsed = -1; let updateIntervalId = null; let standingsCache = {};

    // --- Configuration ---
    const xmlFilePath = 'data/tournament_data.xml'; // Used dynamically based on slug
    const refreshInterval = 15000;
    const WP_MINIMUM = 0.25;
    const CURRENT_YEAR = new Date().getFullYear();
    const DEBUG_STANDINGS = false; // Keep calculation logs off

    // --- Core Data Loading and Parsing ---
    async function loadTournamentData(slug) { // Pass slug to construct path
        const xmlPath = `${slug}/data/tournament_data.xml`;
        const statusEl = document.getElementById('update-status'); // Get dynamically
        // console.log(`loadTournamentData: Starting fetch for ${xmlPath}...`);
        try {
            const response = await fetch(`${xmlPath}?t=${new Date().getTime()}`);
            // console.log(`loadTournamentData: Fetch status: ${response.status}`);
            if (!response.ok) { if (response.status === 404) { console.log(`Data file not found.`); if(statusEl) statusEl.textContent = `Waiting for data...`; } else { console.error(`HTTP error ${response.status}`); if(statusEl) statusEl.textContent = `Error (${response.status})`; } return false; }
            const xmlText = await response.text(); const parser = new DOMParser(); const xmlDoc = parser.parseFromString(xmlText, "application/xml"); const parseError = xmlDoc.querySelector("parsererror"); if (parseError) { console.error("XML Parsing Error:", parseError.textContent); if(statusEl) statusEl.textContent = `Parse Error`; return false; }
            // console.log("loadTournamentData: XML parsed.");
            const currentTimeElapsedElement = xmlDoc.querySelector('tournament > timeelapsed'); const currentTimeElapsed = currentTimeElapsedElement ? parseInt(currentTimeElapsedElement.textContent, 10) : -1; if (currentTimeElapsed !== -1 && currentTimeElapsed === lastKnownTimeElapsed) { /* console.log("loadTournamentData: No change."); */ if(statusEl) statusEl.textContent = `Up to date`; return false; }
            console.log("loadTournamentData: Change detected. Processing...");
            extractTournamentDataFromXML(xmlDoc); // Use the specific extraction function
            lastKnownTimeElapsed = currentTimeElapsed;
            console.log("loadTournamentData: Data extraction complete.");
            if(statusEl) statusEl.textContent = 'Processing...'; // Indicate processing after load
            return true;
        } catch (error) { console.error("loadTournamentData: Error:", error); if(statusEl) statusEl.textContent = `Fetch Error`; return false; }
    }

    function extractTournamentDataFromXML(xmlDoc) {
        // console.log("extractData: Starting...");
        playersData = {}; roundsData = []; let extractionError = false;
        try {
            const tempPlayersData = {}; const playerElements = xmlDoc.querySelectorAll('tournament > players > player');
            playerElements.forEach((player) => { const userId = player.getAttribute('userid'); const firstName = player.querySelector('firstname')?.textContent || ''; const lastName = player.querySelector('lastname')?.textContent || ''; if (userId) { tempPlayersData[String(userId)] = { id: String(userId), firstName, lastName, name: `${firstName} ${lastName}`.trim() }; }});
            playersData = tempPlayersData;

            const tempRoundsData = []; const roundElements = xmlDoc.querySelectorAll('tournament > pods > pod > rounds > round');
            roundElements.forEach((round) => {
                const roundNumber = parseInt(round.getAttribute('number'), 10); const roundType = round.getAttribute('type'); if (isNaN(roundNumber)) return;
                const matches = []; const matchElements = round.querySelectorAll('matches > match');
                matchElements.forEach((match) => { const tableNumber = parseInt(match.querySelector('tablenumber')?.textContent || '0', 10); const outcome = parseInt(match.getAttribute('outcome'), 10); const p1El = match.querySelector('player1'); const p2El = match.querySelector('player2'); const singleP = match.querySelector('player'); let matchData = { table: tableNumber, player1Id: null, player2Id: null, outcome: outcome, isBye: false }; if (outcome === 5 && singleP) { matchData.player1Id = String(singleP.getAttribute('userid')); matchData.isBye = true; } else if (p1El && p2El) { matchData.player1Id = String(p1El.getAttribute('userid')); matchData.player2Id = String(p2El.getAttribute('userid')); } else { if (p1El) matchData.player1Id = String(p1El.getAttribute('userid')); if (p2El) matchData.player2Id = String(p2El.getAttribute('userid')); if(!matchData.player1Id && !matchData.player2Id) return; } matches.push(matchData); });
                matches.sort((a, b) => a.table - b.table); tempRoundsData.push({ roundNumber, type: roundType, matches });
            });
            tempRoundsData.sort((a, b) => a.roundNumber - b.roundNumber); roundsData = tempRoundsData;
        } catch (error) { console.error("extractData: CRITICAL Error:", error); extractionError = true; playersData = {}; roundsData = []; }
        // console.log(`extractData: Finished. players: ${Object.keys(playersData).length}, rounds: ${roundsData.length}, Error: ${extractionError}`);
    }


    // --- Standings Calculation Logic (Using v4.10/v4.11 Logic - No Intermediate Rounding) ---
    function calculatePlayerSwissRecord(playerId, maxRoundNumber) {
         let matchWins = 0, losses = 0, ties = 0, byes = 0, matchPoints = 0, roundsParticipated = 0, highestRoundParticipated = 0; const pid=String(playerId); if(!pid) return {matchWins,losses,ties,byes,matchPoints,roundsParticipated,highestRoundParticipated};
         for(const rnd of roundsData){ if(rnd.type!=="3"||rnd.roundNumber>maxRoundNumber) continue; let played=false; for(const m of rnd.matches){ let found=false; const p1=String(m.player1Id), p2=String(m.player2Id); if(m.isBye&&p1===pid){ byes++; matchPoints+=3; found=true; } else if(p1===pid){ if(m.outcome===1){ matchWins++; matchPoints+=3; } else if(m.outcome===2){ losses++; matchPoints+=0; } else if(m.outcome===3||m.outcome===4){ ties++; matchPoints+=1; } else{ matchPoints+=0; } found=true; } else if(p2===pid){ if(m.outcome===1){ losses++; matchPoints+=0; } else if(m.outcome===2){ matchWins++; matchPoints+=3; } else if(m.outcome===3||m.outcome===4){ ties++; matchPoints+=1; } else{ matchPoints+=0; } found=true; } if(found){ played=true; break; } } if(played){ roundsParticipated++; highestRoundParticipated=rnd.roundNumber; } }
         if (DEBUG_STANDINGS && playersData[pid]) console.log(`      DEBUG: Record for ${playersData[pid]?.name} (${pid}) up to R${maxRoundNumber}: MatchWins=${matchWins}, Byes=${byes}, Losses=${losses}, Ties=${ties} (${matchPoints}pts). RoundsParticipated=${roundsParticipated}`);
         return {matchWins:matchWins, losses:losses, ties:ties, byes:byes, matchPoints:matchPoints, roundsParticipated:roundsParticipated, highestRoundParticipated:highestRoundParticipated};
    }
    function getSwissOpponents(playerId, maxRoundNumber) { const opps = new Set(); const pid=String(playerId); if(!pid) return []; for(const rnd of roundsData){ if(rnd.type!=="3"||rnd.roundNumber>maxRoundNumber) continue; for(const m of rnd.matches){ if(m.isBye) continue; const p1=String(m.player1Id), p2=String(m.player2Id); if(p1===pid&&p2) opps.add(p2); else if(p2===pid&&p1) opps.add(p1); }} return Array.from(opps); }
    function getPlayerSwissWinPercentage(playerId, maxRoundNumber, currentStandingsCache) {
        const effectivePlayerId = String(playerId); const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`; if (currentStandingsCache[cacheKey]?.wp !== undefined) { return currentStandingsCache[cacheKey].wp; }
        let record = currentStandingsCache[cacheKey]?.record || calculatePlayerSwissRecord(effectivePlayerId, maxRoundNumber); if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].record = record;
        const matchWins = record.matchWins; const divisor = record.roundsParticipated - record.byes; let finalWP; if (divisor <= 0) { finalWP = WP_MINIMUM; } else { const rawWP = matchWins / divisor; finalWP = Math.max(rawWP, WP_MINIMUM); } currentStandingsCache[cacheKey].wp = finalWP;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`    DEBUG: WP CALC for ${cacheKey} (${playersData[effectivePlayerId]?.name}): MatchWins=${matchWins}, Divisor(Rounds-Byes)=${divisor}, Raw=${(divisor > 0 ? (matchWins/divisor) : 'N/A').toFixed(6)} => Final=${finalWP.toFixed(6)}`);
        return finalWP;
    }
    function calculateOWP(playerId, maxRoundNumber, currentStandingsCache) {
        const effectivePlayerId = String(playerId); const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`; if (currentStandingsCache[cacheKey]?.owp !== undefined) { return currentStandingsCache[cacheKey].owp; }
        const opponents = getSwissOpponents(effectivePlayerId, maxRoundNumber); if (opponents.length === 0) { if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].owp = 0; return 0; }
        let totalOpponentWinPercentage = 0; let validOpponentCount = 0;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`  DEBUG: OWP CALC for ${cacheKey} (${playersData[effectivePlayerId]?.name}), Opponents: [${opponents.join(', ')}]`);
        opponents.forEach(oppId => { try { const opponentWinPerc = getPlayerSwissWinPercentage(oppId, maxRoundNumber, currentStandingsCache); if (typeof opponentWinPerc === 'number' && !isNaN(opponentWinPerc)) { totalOpponentWinPercentage += opponentWinPerc; validOpponentCount++; if (DEBUG_STANDINGS) console.log(`      Opponent ${oppId} WP: ${opponentWinPerc.toFixed(6)}`); } else { console.warn(`OWP (${cacheKey}): Invalid WP for opp ${oppId}.`); } } catch (e) { console.error(`OWP (${cacheKey}): Error for opp ${oppId}:`, e); } });
        const result = (validOpponentCount > 0) ? (totalOpponentWinPercentage / validOpponentCount) : 0; if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].owp = result;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`  DEBUG: OWP RESULT for ${cacheKey} (${playersData[effectivePlayerId]?.name}): Sum=${totalOpponentWinPercentage.toFixed(6)}, Count=${validOpponentCount}, Avg=${result.toFixed(6)}`);
        return result;
    }
    function calculateOOWP(playerId, maxRoundNumber, currentStandingsCache) {
         const effectivePlayerId = String(playerId); const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`; if (currentStandingsCache[cacheKey]?.oowp !== undefined) { return currentStandingsCache[cacheKey].oowp; }
        const opponents = getSwissOpponents(effectivePlayerId, maxRoundNumber); if (opponents.length === 0) { if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].oowp = 0; return 0; }
        let totalOpponentOWP = 0; let validOpponentCount = 0;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`DEBUG: OOWP CALC for ${cacheKey} (${playersData[effectivePlayerId]?.name}), Opponents: [${opponents.join(', ')}]`);
        opponents.forEach(oppId => { try { const oppOWP = calculateOWP(oppId, maxRoundNumber, currentStandingsCache); if (typeof oppOWP === 'number' && !isNaN(oppOWP)) { totalOpponentOWP += oppOWP; validOpponentCount++; if (DEBUG_STANDINGS) console.log(`    Opponent ${oppId} OWP: ${oppOWP.toFixed(6)}`); } else { console.warn(`OOWP (${cacheKey}): Invalid OWP for opp ${oppId}.`); } } catch (e) { console.error(`OOWP (${cacheKey}): Error for opp ${oppId}:`, e); } });
        const result = (validOpponentCount > 0) ? (totalOpponentOWP / validOpponentCount) : 0; if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].oowp = result;
        if (DEBUG_STANDINGS && playersData[effectivePlayerId]) console.log(`DEBUG: OOWP RESULT for ${cacheKey} (${playersData[effectivePlayerId]?.name}): Sum=${totalOpponentOWP.toFixed(6)}, Count=${validOpponentCount}, Avg=${result.toFixed(6)}`);
        return result;
    }
    function calculateSwissStandingsForRound(maxRoundNumber) {
        if (DEBUG_STANDINGS) console.log(`\n--- Calculating Standings FOR COMPLETED ROUND ${maxRoundNumber} ---`);
        const currentStandingsCache = {}; const standingsData = []; const allPlayerIds = Object.keys(playersData); if (allPlayerIds.length === 0) { return []; }
        if (DEBUG_STANDINGS) console.log(`\n--- STEP 1: Records & WPs for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => { getPlayerSwissWinPercentage(playerId, maxRoundNumber, currentStandingsCache); });
        if (DEBUG_STANDINGS) console.log(`\n--- STEP 2: OWPs for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => { calculateOWP(playerId, maxRoundNumber, currentStandingsCache); });
        if (DEBUG_STANDINGS) console.log(`\n--- STEP 3: OOWPs & Final Data for R${maxRoundNumber} ---`);
        allPlayerIds.forEach(playerId => {
            const cacheKey = `${playerId}_R${maxRoundNumber}`; const playerInfo = playersData[playerId]; const cachedData = currentStandingsCache[cacheKey];
            if (cachedData?.record && cachedData.wp !== undefined && cachedData.owp !== undefined && playerInfo) {
                try { const oowp = calculateOOWP(playerId, maxRoundNumber, currentStandingsCache); const record = cachedData.record; const displayWins = record.matchWins + record.byes; standingsData.push({ playerInfo, matchPoints: record.matchPoints, recordString: `${displayWins}-${record.losses}${record.ties > 0 ? '-' + record.ties : ''}`, owp: cachedData.owp, oowp }); }
                catch (error) { console.error(`Error final OOWP step ${cacheKey}:`, error); }
            } else { console.warn(`calculateSwissStandingsForRound: Skipping ${playerId} - missing data.`); }
        });
        if (DEBUG_STANDINGS) console.log(`--- Standings Calculation Complete ---`);
        return standingsData;
    }
    // >>>>> FIXED: Corrected sortStandings function definition <<<<<
    function sortStandings(standingsData) {
        return standingsData.sort((a, b) => {
            if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
            const owpDiff = b.owp - a.owp; if (Math.abs(owpDiff) > 1e-9) return owpDiff;
            const oowpDiff = b.oowp - a.oowp; if (Math.abs(oowpDiff) > 1e-9) return oowpDiff;
            return a.playerInfo.name.localeCompare(b.playerInfo.name);
        });
    }
    function displayStandings(sortedStandings) {
        const standingsTableBody = document.getElementById('standings-body');
        const noStandingsMsg = document.getElementById('no-standings-message');
        const standingsContainer = document.getElementById('standings-container');
        // console.log("displayStandings: Starting display...");
        if (!standingsTableBody) { console.error("displayStandings: Missing table body!"); return; }
        standingsTableBody.innerHTML = ''; if (!Array.isArray(sortedStandings) || sortedStandings.length === 0) { if (standingsContainer) standingsContainer.style.display = 'block'; if(noStandingsMsg) noStandingsMsg.style.display = 'block'; return; }
        if(noStandingsMsg) noStandingsMsg.style.display = 'none'; if (standingsContainer) standingsContainer.style.display = 'block'; sortedStandings.forEach((data, index) => { try { const rank = index + 1; const row = standingsTableBody.insertRow(); const cellRank = row.insertCell(); cellRank.textContent = rank; cellRank.style.textAlign = 'center'; const cellName = row.insertCell(); cellName.textContent = data.playerInfo?.name || 'Unknown'; const cellRecord = row.insertCell(); cellRecord.textContent = data.recordString; cellRecord.style.textAlign = 'center'; const cellOWP = row.insertCell(); cellOWP.textContent = (data.owp * 100).toFixed(2); cellOWP.style.textAlign = 'right'; const cellOOWP = row.insertCell(); cellOOWP.textContent = (data.oowp * 100).toFixed(2); cellOOWP.style.textAlign = 'right'; } catch (error) { console.error(`Error displaying standings row ${index + 1}:`, error); } });
        // console.log("displayStandings: Display finished.");
    }

    // --- UI Update Functions (For Tournament View) ---
    function updateTournamentUI() {
        // console.log("updateTournamentUI: Starting...");
        if (Object.keys(playersData).length === 0 || roundsData.length === 0) { console.log("updateTournamentUI: No data to display."); return; }
        generateTabs();
        displayRound(currentRound);
        updateActiveTab();
        updateStandingsDisplay();
        const pairingLoading = document.getElementById('loading-message'); if(pairingLoading) pairingLoading.style.display = 'none';
        // console.log("updateTournamentUI: Finished.");
    }

    function generateTabs() {
        const roundTabsContainer = document.getElementById('round-tabs'); if (!roundTabsContainer) return;
        roundTabsContainer.innerHTML = ''; let stages = {};
        roundsData.forEach(round => { if (round.type === "3") { if (!stages["Swiss"]) stages["Swiss"] = []; stages["Swiss"].push(round.roundNumber); } else { const matchCount = round.matches.filter(m => !m.isBye).length; let stageLabel = "Top Cut"; if (matchCount === 1) stageLabel = "Finals"; else if (matchCount === 2) stageLabel = "Top 4"; else if (matchCount === 4) stageLabel = "Top 8"; else if (matchCount === 8) stageLabel = "Top 16"; if (!stages[stageLabel]) stages[stageLabel] = []; stages[stageLabel].push(round.roundNumber); } });
        if (stages["Swiss"]) { stages["Swiss"].sort((a, b) => a - b).forEach(roundNum => { const button = document.createElement('button'); button.textContent = `Round ${roundNum}`; button.dataset.roundNumber = roundNum; button.addEventListener('click', handleTabClick); roundTabsContainer.appendChild(button); }); }
        const stageOrder = ["Top 16", "Top 8", "Top 4", "Finals", "Top Cut"];
        stageOrder.forEach(stageLabel => { if (stages[stageLabel]) { const roundsInStage = stages[stageLabel].sort((a, b) => a - b); const startRoundOfStage = roundsInStage[0]; const button = document.createElement('button'); button.textContent = stageLabel; button.dataset.roundNumber = startRoundOfStage; button.dataset.stageRounds = roundsInStage.join(','); button.addEventListener('click', handleTabClick); roundTabsContainer.appendChild(button); } });
        console.log("Generated tabs.");
    }

    function updateStandingsDisplay() {
        const standingsContainer = document.getElementById('standings-container'); const standingsLoadingMsg = document.getElementById('standings-loading-message'); const noStandingsMsg = document.getElementById('no-standings-message'); const standingsTableBody = document.getElementById('standings-body'); if (!standingsContainer || !standingsLoadingMsg || !noStandingsMsg || !standingsTableBody) return;
        try {
            const swissRounds = roundsData.filter(r => r.type === "3"); const totalSwissRounds = swissRounds.length > 0 ? Math.max(...swissRounds.map(r => r.roundNumber)) : 0; let latestCompletedSwissRoundNumber = 0; for (const round of swissRounds) { const isCompleted = !round.matches.some(m => m.outcome === 0 && !m.isBye); if (isCompleted && round.roundNumber > latestCompletedSwissRoundNumber) { latestCompletedSwissRoundNumber = round.roundNumber; } }
            if (totalSwissRounds > 0 && latestCompletedSwissRoundNumber === totalSwissRounds) {
                standingsLoadingMsg.style.display = 'block'; noStandingsMsg.style.display = 'none'; standingsTableBody.innerHTML = ''; // Clear previous potentially
                setTimeout(() => {
                    try { console.log(`Calculating final standings (R${latestCompletedSwissRoundNumber}).`); const standingsData = calculateSwissStandingsForRound(latestCompletedSwissRoundNumber); const sortedStandings = sortStandings(standingsData); displayStandings(sortedStandings); standingsLoadingMsg.style.display = 'none'; }
                    catch (calcError) { console.error("Error during standings calculation/display:", calcError); standingsLoadingMsg.style.display = 'none'; noStandingsMsg.textContent = "Error calculating standings."; noStandingsMsg.style.display = 'block'; standingsContainer.style.display = 'block'; }
                }, 10);
            } else { console.log(`Hiding standings. Last completed Swiss: ${latestCompletedSwissRoundNumber}, Total Swiss: ${totalSwissRounds}`); standingsContainer.style.display = 'none'; noStandingsMsg.style.display = 'block'; noStandingsMsg.textContent = "Standings will be available after the final Swiss round concludes."; standingsLoadingMsg.style.display = 'none'; standingsTableBody.innerHTML = ''; }
        } catch (error) { console.error("Error in updateStandingsDisplay:", error); }
    }

    function getPlayerScoreBeforeRound(playerId, targetRoundNumber) {
        let wins = 0, losses = 0; const effectivePlayerId = String(playerId); if (!effectivePlayerId) return { wins, losses };
        for (const pastRound of roundsData) { if (pastRound.roundNumber >= targetRoundNumber) continue; for (const match of pastRound.matches) { const matchP1Id = String(match.player1Id); const matchP2Id = String(match.player2Id); if (match.isBye && matchP1Id === effectivePlayerId) { wins++; continue; } if (matchP1Id === effectivePlayerId) { if (match.outcome === 1) wins++; else if (match.outcome === 2) losses++; continue; } if (matchP2Id === effectivePlayerId) { if (match.outcome === 2) wins++; else if (match.outcome === 1) losses++; continue; } } }
        return { wins, losses };
    }
    function displayRound(roundNumber) {
         const round = roundsData.find(r => r.roundNumber === roundNumber); const currentRoundTitleEl = document.getElementById('current-round-title'); const pairingsTableBodyEl = document.getElementById('pairings-body'); if (!round || !currentRoundTitleEl || !pairingsTableBodyEl) { console.error("Missing elements for displayRound"); return; }
         const cutInfo = getTopCutInfoForRound(roundNumber); const titleText = cutInfo ? `${cutInfo.label} - Round ${roundNumber}` : `Round ${roundNumber} Pairings`; currentRoundTitleEl.textContent = titleText; pairingsTableBodyEl.innerHTML = ''; if (round.matches.length === 0) { pairingsTableBodyEl.innerHTML = '<tr><td colspan="3" style="text-align: center;">No matches reported yet.</td></tr>'; return; }
         round.matches.forEach(match => { try { const row = pairingsTableBodyEl.insertRow(); const p1IdStr = String(match.player1Id); const p2IdStr = String(match.player2Id); const player1Info = playersData[p1IdStr] || { name: `Unknown (${p1IdStr})` }; const player2Info = match.isBye ? { name: "BYE" } : (playersData[p2IdStr] || { name: `Unknown (${p2IdStr})` }); const scoreP1 = getPlayerScoreBeforeRound(p1IdStr, roundNumber); const scoreP2 = match.isBye ? { wins: '-', losses: '-' } : getPlayerScoreBeforeRound(p2IdStr, roundNumber); const player1DisplayText = `${player1Info.name} (${scoreP1.wins}-${scoreP1.losses})`; const player2DisplayText = match.isBye ? player2Info.name : `${player2Info.name} (${scoreP2.wins}-${scoreP2.losses})`; row.dataset.player1Name = player1Info.name.toLowerCase(); row.dataset.player2Name = match.isBye ? 'bye' : player2Info.name.toLowerCase(); const cellTable = row.insertCell(); cellTable.textContent = match.table === 0 ? "N/A" : match.table; cellTable.style.textAlign = 'center'; const cellP1 = row.insertCell(); if (match.outcome === 1) { cellP1.innerHTML = `<span class="winner">${player1DisplayText}</span>`; } else { cellP1.textContent = player1DisplayText; } const cellP2 = row.insertCell(); if (match.isBye) { cellP2.textContent = player2DisplayText; cellP2.style.fontStyle = 'italic'; cellP2.style.color = '#6c757d'; } else { if (match.outcome === 2) { cellP2.innerHTML = `<span class="winner">${player2DisplayText}</span>`; } else { cellP2.textContent = player2DisplayText; } } } catch (error) { console.error(`Error displaying match row: ${JSON.stringify(match)}`, error); } });
    }
    function updateActiveTab() {
        const roundTabsContainerEl = document.getElementById('round-tabs'); if(!roundTabsContainerEl) return; const buttons = roundTabsContainerEl.querySelectorAll('button'); let activeSet = false; buttons.forEach(btn => btn.classList.remove('active'));
        buttons.forEach(button => { const stageRounds = button.dataset.stageRounds; if (stageRounds) { const roundsInStage = stageRounds.split(',').map(Number); if (roundsInStage.includes(currentRound)) { button.classList.add('active'); activeSet = true; } } });
        if (!activeSet) { buttons.forEach(button => { if (!button.dataset.stageRounds && parseInt(button.dataset.roundNumber, 10) === currentRound) { button.classList.add('active'); } }); }
    }
    function getTopCutInfoForRound(roundNumber) { const round = roundsData.find(r => r.roundNumber === roundNumber); if (!round || round.type === "3") return null; const matchCount = round.matches.filter(m => !m.isBye).length; if (matchCount === 1) return { label: "Finals" }; if (matchCount === 2) return { label: "Top 4" }; if (matchCount === 4) return { label: "Top 8" }; if (matchCount === 8) return { label: "Top 16" }; return { label: "Top Cut" }; }
    function filterTable() { const searchInputEl = document.getElementById('search-input'); const pairingsTableBodyEl = document.getElementById('pairings-body'); const noResultsMessageEl = document.getElementById('no-search-results'); if(!pairingsTableBodyEl || !searchInputEl) return; const searchTerm = searchInputEl.value.toLowerCase().trim(); const rows = pairingsTableBodyEl.querySelectorAll('tr'); let visibleRows = 0; rows.forEach(row => { if (row.cells.length === 1 && row.cells[0].colSpan === 3) { row.classList.remove('hidden-row'); visibleRows++; return; } const p1Name = row.dataset.player1Name || ''; const p2Name = row.dataset.player2Name || ''; if (!searchTerm || p1Name.includes(searchTerm) || (p2Name && p2Name.includes(searchTerm))) { row.classList.remove('hidden-row'); visibleRows++; } else { row.classList.add('hidden-row'); } }); if (noResultsMessageEl) noResultsMessageEl.style.display = (visibleRows === 0 && searchTerm) ? 'block' : 'none'; }
    function checkClearButtonVisibility() { const searchInputEl = document.getElementById('search-input'); const clearSearchBtnEl = document.getElementById('clear-search-btn'); if (!clearSearchBtnEl || !searchInputEl) return; if (searchInputEl.value.length > 0) clearSearchBtnEl.style.display = 'inline-block'; else clearSearchBtnEl.style.display = 'none'; }

    // --- Event Handling Setup ---
    function setupTournamentEventListeners() {
        const searchInputEl = document.getElementById('search-input'); const clearSearchBtnEl = document.getElementById('clear-search-btn');
        if(searchInputEl) { searchInputEl.addEventListener('input', () => { filterTable(); checkClearButtonVisibility(); }); }
        if (clearSearchBtnEl) { clearSearchBtnEl.addEventListener('click', () => { if(searchInputEl) searchInputEl.value = ''; filterTable(); checkClearButtonVisibility(); if(searchInputEl) searchInputEl.focus(); }); }
        // Tab listeners added in generateTabs
    }
    function handleTabClick(event) { const button = event.currentTarget; currentRound = parseInt(button.dataset.roundNumber, 10); displayRound(currentRound); updateActiveTab(); filterTable(); }

    // --- Helper Functions ---
    function escapeHtml(unsafe) { if (!unsafe) return ''; return unsafe.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, """).replace(/'/g, "'"); }

    // --- Routing and Initialization ---
    const appContainer = document.getElementById('app'); // Get app container ref once
    function showListView() { renderListView(); }
    function showTournamentView(slug) { renderTournamentView(slug); }

    function handleRouteChange() {
        const hash = window.location.hash.substring(1); console.log("Route changed:", hash);
        if (hash && hash.startsWith('tournament/')) { const slug = hash.substring('tournament/'.length); if (slug) { showTournamentView(slug); } else { showListView(); } }
        else { showListView(); }
    }

    window.addEventListener('hashchange', handleRouteChange);

    // Initial load
    handleRouteChange();

}); // End of DOMContentLoaded
