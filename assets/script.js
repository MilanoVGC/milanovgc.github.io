// Wait for the HTML document to be fully loaded before running script
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");
    console.log("--- Initializing Pairing/Standings Script (v5.1 - Corrected DOM Refs) ---");

    // --- DOM Element References (Updated for new HTML structure) ---
    // Elements expected in the tournament-info-header
    const tournamentNameElement = document.getElementById('tournament-name');       // Inside .tournament-info-header
    const tournamentOrganizerElement = document.getElementById('tournament-organizer'); // Inside .tournament-info-header
    const tournamentLocationElement = document.getElementById('tournament-location');  // Inside .tournament-info-header

    // Elements expected in the main content container
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
    // const updateStatusElement = document.getElementById('update-status'); // REMOVED - No longer generated here

    // Guard: Check essential elements needed for basic operation
     if (!pairingsTableBody || !searchInput || !loadingMessage || !standingsTableBody || !standingsContainer || !standingsLoadingMsg || !noStandingsMsg || !roundTabsContainer || !currentRoundTitle ) {
          console.error("CRITICAL ERROR: Essential DOM elements not found in main content. Stopping script.");
          if(loadingMessage) { // Try to show error using loading message placeholder if it exists
              loadingMessage.textContent = "Critical page error: Required page elements are missing.";
              loadingMessage.style.display = 'block';
              loadingMessage.style.color = 'red';
           } else {
              // Fallback if even loading message is gone
              alert("Critical page error: Required elements missing. Cannot load tournament data.");
           }
          return;
     }
     console.log("Essential DOM elements found.");

    // --- Global Data Storage ---
    let playersData = {}; let roundsData = []; let currentRound = 1; let lastKnownTimeElapsed = -1; let updateIntervalId = null; let standingsCache = {};

    // --- Configuration ---
    const xmlFilePath = './data/tournament_data.xml'; // Path relative to tournament's index.html
    const refreshInterval = 15000;
    const WP_MINIMUM = 0.25;
    const CURRENT_YEAR = new Date().getFullYear();
    const DEBUG_STANDINGS = false;

    // --- Core Data Loading and Parsing ---
    async function loadTournamentData() {
        // updateStatusElement logic removed
        try {
            const response = await fetch(`${xmlFilePath}?t=${new Date().getTime()}`);
            if (!response.ok) { if (response.status === 404) { console.log(`Data file not found.`); /* No status element to update */ } else { console.error(`HTTP error ${response.status}`); /* No status element */ } return false; }
            const xmlText = await response.text(); const parser = new DOMParser(); const xmlDoc = parser.parseFromString(xmlText, "application/xml"); const parseError = xmlDoc.querySelector("parsererror"); if (parseError) { console.error("XML Parsing Error:", parseError.textContent); /* No status element */ return false; }
            const currentTimeElapsedElement = xmlDoc.querySelector('tournament > timeelapsed'); const currentTimeElapsed = currentTimeElapsedElement ? parseInt(currentTimeElapsedElement.textContent, 10) : -1; if (currentTimeElapsed !== -1 && currentTimeElapsed === lastKnownTimeElapsed) { /* No status element */ return false; }
            console.log("loadTournamentData: Change detected. Processing...");
            extractTournamentDataFromXML(xmlDoc);
            lastKnownTimeElapsed = currentTimeElapsed; console.log("loadTournamentData: Data extraction complete."); /* No status element */ return true;
        } catch (error) { console.error("loadTournamentData: Error:", error); /* No status element */ return false; }
    }

    function extractTournamentDataFromXML(xmlDoc) {
        playersData = {}; roundsData = []; let extractionError = false;
        try {
             // Update tournament info display using the NEW elements
            const tData = xmlDoc.querySelector('tournament > data');
            const nameFromXML = tData?.querySelector('name')?.textContent;
            const cityFromXML = tData?.querySelector('city')?.textContent;
            const countryFromXML = tData?.querySelector('country')?.textContent;
            const organizerFromXML = xmlDoc.querySelector('tournament > data > organizer')?.getAttribute('name'); // Get attribute

            if (tournamentNameElement && nameFromXML) tournamentNameElement.textContent = nameFromXML;
            if (tournamentOrganizerElement) {
                 tournamentOrganizerElement.textContent = organizerFromXML ? `Organized by: ${organizerFromXML}` : "";
                 tournamentOrganizerElement.style.display = organizerFromXML ? 'block' : 'none'; // Hide if no organizer
            }
            if (tournamentLocationElement) {
                 let locationString = "";
                 if (cityFromXML) locationString += cityFromXML;
                 if (countryFromXML) locationString += (locationString ? ', ' : '') + countryFromXML;
                 tournamentLocationElement.textContent = locationString;
                 tournamentLocationElement.style.display = locationString ? 'block' : 'none'; // Hide if no location
            }

            const tempPlayersData = {}; const playerElements = xmlDoc.querySelectorAll('tournament > players > player');
            playerElements.forEach((player) => { const userId = player.getAttribute('userid'); const firstName = player.querySelector('firstname')?.textContent || ''; const lastName = player.querySelector('lastname')?.textContent || ''; if (userId) { tempPlayersData[String(userId)] = { id: String(userId), firstName, lastName, name: `${firstName} ${lastName}`.trim() }; }}); playersData = tempPlayersData;

            const tempRoundsData = []; const roundElements = xmlDoc.querySelectorAll('tournament > pods > pod > rounds > round');
            roundElements.forEach((round) => {
                const roundNumber = parseInt(round.getAttribute('number'), 10); const roundType = round.getAttribute('type'); if (isNaN(roundNumber)) return; const matches = []; const matchElements = round.querySelectorAll('matches > match');
                matchElements.forEach((match) => { const tableNumber = parseInt(match.querySelector('tablenumber')?.textContent || '0', 10); const outcome = parseInt(match.getAttribute('outcome'), 10); const p1El = match.querySelector('player1'); const p2El = match.querySelector('player2'); const singleP = match.querySelector('player'); let matchData = { table: tableNumber, player1Id: null, player2Id: null, outcome: outcome, isBye: false }; if (outcome === 5 && singleP) { matchData.player1Id = String(singleP.getAttribute('userid')); matchData.isBye = true; } else if (p1El && p2El) { matchData.player1Id = String(p1El.getAttribute('userid')); matchData.player2Id = String(p2El.getAttribute('userid')); } else { if (p1El) matchData.player1Id = String(p1El.getAttribute('userid')); if (p2El) matchData.player2Id = String(p2El.getAttribute('userid')); if(!matchData.player1Id && !matchData.player2Id) return; } matches.push(matchData); }); matches.sort((a, b) => a.table - b.table); tempRoundsData.push({ roundNumber, type: roundType, matches });
            }); tempRoundsData.sort((a, b) => a.roundNumber - b.roundNumber); roundsData = tempRoundsData;
        } catch (error) { console.error("extractData: CRITICAL Error:", error); extractionError = true; playersData = {}; roundsData = []; }
        console.log(`extractData: Finished. players: ${Object.keys(playersData).length}, rounds: ${roundsData.length}, Error: ${extractionError}`);
    }


    // --- Standings Calculation Logic (v4.10/v4.11 logic) ---
    function calculatePlayerSwissRecord(playerId, maxRoundNumber) {
         let matchWins = 0, losses = 0, ties = 0, byes = 0, matchPoints = 0, roundsParticipated = 0, highestRoundParticipated = 0; const pid=String(playerId); if(!pid) return {matchWins,losses,ties,byes,matchPoints,roundsParticipated,highestRoundParticipated};
         for(const rnd of roundsData){ if(rnd.type!=="3"||rnd.roundNumber>maxRoundNumber) continue; let played=false; for(const m of rnd.matches){ let found=false; const p1=String(m.player1Id), p2=String(m.player2Id); if(m.isBye&&p1===pid){ byes++; matchPoints+=3; found=true; } else if(p1===pid){ if(m.outcome===1){ matchWins++; matchPoints+=3; } else if(m.outcome===2){ losses++; matchPoints+=0; } else if(m.outcome===3||m.outcome===4){ ties++; matchPoints+=1; } else{ matchPoints+=0; } found=true; } else if(p2===pid){ if(m.outcome===1){ losses++; matchPoints+=0; } else if(m.outcome===2){ matchWins++; matchPoints+=3; } else if(m.outcome===3||m.outcome===4){ ties++; matchPoints+=1; } else{ matchPoints+=0; } found=true; } if(found){ played=true; break; } } if(played){ roundsParticipated++; highestRoundParticipated=rnd.roundNumber; } }
         return {matchWins:matchWins, losses:losses, ties:ties, byes:byes, matchPoints:matchPoints, roundsParticipated:roundsParticipated, highestRoundParticipated:highestRoundParticipated};
    }
    function getSwissOpponents(playerId, maxRoundNumber) { const opps = new Set(); const pid=String(playerId); if(!pid) return []; for(const rnd of roundsData){ if(rnd.type!=="3"||rnd.roundNumber>maxRoundNumber) continue; for(const m of rnd.matches){ if(m.isBye) continue; const p1=String(m.player1Id), p2=String(m.player2Id); if(p1===pid&&p2) opps.add(p2); else if(p2===pid&&p1) opps.add(p1); }} return Array.from(opps); }
    function getPlayerSwissWinPercentage(playerId, maxRoundNumber, currentStandingsCache) {
        const effectivePlayerId = String(playerId); const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`; if (currentStandingsCache[cacheKey]?.wp !== undefined) { return currentStandingsCache[cacheKey].wp; }
        let record = currentStandingsCache[cacheKey]?.record || calculatePlayerSwissRecord(effectivePlayerId, maxRoundNumber); if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].record = record;
        const matchWins = record.matchWins; const divisor = record.roundsParticipated - record.byes; let finalWP; if (divisor <= 0) { finalWP = WP_MINIMUM; } else { const rawWP = matchWins / divisor; finalWP = Math.max(rawWP, WP_MINIMUM); } currentStandingsCache[cacheKey].wp = finalWP; return finalWP;
    }
    function calculateOWP(playerId, maxRoundNumber, currentStandingsCache) {
        const effectivePlayerId = String(playerId); const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`; if (currentStandingsCache[cacheKey]?.owp !== undefined) { return currentStandingsCache[cacheKey].owp; }
        const opponents = getSwissOpponents(effectivePlayerId, maxRoundNumber); if (opponents.length === 0) { if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].owp = 0; return 0; }
        let totalOpponentWinPercentage = 0; let validOpponentCount = 0;
        opponents.forEach(oppId => { try { const opponentWinPerc = getPlayerSwissWinPercentage(oppId, maxRoundNumber, currentStandingsCache); if (typeof opponentWinPerc === 'number' && !isNaN(opponentWinPerc)) { totalOpponentWinPercentage += opponentWinPerc; validOpponentCount++; } else { console.warn(`OWP (${cacheKey}): Invalid WP for opp ${oppId}.`); } } catch (e) { console.error(`OWP (${cacheKey}): Error for opp ${oppId}:`, e); } });
        const result = (validOpponentCount > 0) ? (totalOpponentWinPercentage / validOpponentCount) : 0; if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].owp = result; return result;
    }
    function calculateOOWP(playerId, maxRoundNumber, currentStandingsCache) {
         const effectivePlayerId = String(playerId); const cacheKey = `${effectivePlayerId}_R${maxRoundNumber}`; if (currentStandingsCache[cacheKey]?.oowp !== undefined) { return currentStandingsCache[cacheKey].oowp; }
        const opponents = getSwissOpponents(effectivePlayerId, maxRoundNumber); if (opponents.length === 0) { if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].oowp = 0; return 0; }
        let totalOpponentOWP = 0; let validOpponentCount = 0;
        opponents.forEach(oppId => { try { const oppOWP = calculateOWP(oppId, maxRoundNumber, currentStandingsCache); if (typeof oppOWP === 'number' && !isNaN(oppOWP)) { totalOpponentOWP += oppOWP; validOpponentCount++; } else { console.warn(`OOWP (${cacheKey}): Invalid OWP for opp ${oppId}.`); } } catch (e) { console.error(`OOWP (${cacheKey}): Error for opp ${oppId}:`, e); } });
        const result = (validOpponentCount > 0) ? (totalOpponentOWP / validOpponentCount) : 0; if (!currentStandingsCache[cacheKey]) currentStandingsCache[cacheKey] = {}; currentStandingsCache[cacheKey].oowp = result; return result;
    }
    function calculateSwissStandingsForRound(maxRoundNumber) {
        // console.log(`--- Calculating Standings R${maxRoundNumber} ---`);
        const currentStandingsCache = {}; const standingsData = []; const allPlayerIds = Object.keys(playersData); if (allPlayerIds.length === 0) { return []; }
        allPlayerIds.forEach(playerId => { getPlayerSwissWinPercentage(playerId, maxRoundNumber, currentStandingsCache); });
        allPlayerIds.forEach(playerId => { calculateOWP(playerId, maxRoundNumber, currentStandingsCache); });
        allPlayerIds.forEach(playerId => {
            const cacheKey = `${playerId}_R${maxRoundNumber}`; const playerInfo = playersData[playerId]; const cachedData = currentStandingsCache[cacheKey];
            if (cachedData?.record && cachedData.wp !== undefined && cachedData.owp !== undefined && playerInfo) {
                try { const oowp = calculateOOWP(playerId, maxRoundNumber, currentStandingsCache); const record = cachedData.record; const displayWins = record.matchWins + record.byes; standingsData.push({ playerInfo, matchPoints: record.matchPoints, recordString: `${displayWins}-${record.losses}${record.ties > 0 ? '-' + record.ties : ''}`, owp: cachedData.owp, oowp }); }
                catch (error) { console.error(`Error final OOWP step ${cacheKey}:`, error); }
            } else { console.warn(`calculateSwissStandingsForRound: Skipping ${playerId} - missing data.`); }
        });
        // console.log(`--- Standings Calculation Complete ---`);
        return standingsData;
    }
    function sortStandings(standingsData) { return standingsData.sort((a, b) => { if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints; const owpDiff = b.owp - a.owp; if (Math.abs(owpDiff) > 1e-9) return owpDiff; const oowpDiff = b.oowp - a.oowp; if (Math.abs(oowpDiff) > 1e-9) return oowpDiff; return a.playerInfo.name.localeCompare(b.playerInfo.name); }); }
    function displayStandings(sortedStandings) {
        if (!standingsTableBody) { console.error("displayStandings: Missing table body!"); return; } standingsTableBody.innerHTML = ''; if (!Array.isArray(sortedStandings) || sortedStandings.length === 0) { if (standingsContainer) standingsContainer.style.display = 'block'; if(noStandingsMsg) noStandingsMsg.style.display = 'block'; console.log("displayStandings: No standings data."); return; }
        if(noStandingsMsg) noStandingsMsg.style.display = 'none'; if (standingsContainer) standingsContainer.style.display = 'block';
        sortedStandings.forEach((data, index) => { try { const rank = index + 1; const row = standingsTableBody.insertRow(); const cellRank = row.insertCell(); cellRank.textContent = rank; cellRank.style.textAlign = 'center'; const cellName = row.insertCell(); cellName.textContent = data.playerInfo?.name || 'Unknown'; const cellRecord = row.insertCell(); cellRecord.textContent = data.recordString; cellRecord.style.textAlign = 'center'; const cellOWP = row.insertCell(); cellOWP.textContent = (data.owp * 100).toFixed(2); cellOWP.style.textAlign = 'right'; const cellOOWP = row.insertCell(); cellOOWP.textContent = (data.oowp * 100).toFixed(2); cellOOWP.style.textAlign = 'right'; } catch (error) { console.error(`Error displaying standings row ${index + 1}:`, error); } });
    }

    // --- UI Update Functions ---
    function updateUI() {
        if (Object.keys(playersData).length === 0 || roundsData.length === 0) { console.log("updateUI: No player/round data."); if(loadingMessage) {loadingMessage.textContent = "Waiting for data..."; loadingMessage.style.display = 'block';} return; }
        const latestRoundNumber = roundsData.length > 0 ? roundsData[roundsData.length - 1].roundNumber : 1; const currentRoundExists = roundsData.some(r => r.roundNumber === currentRound); if (!currentRoundExists || currentRound < 1) { currentRound = latestRoundNumber; }

        generateTabs(); displayRound(currentRound); updateActiveTab(); updateStandingsDisplay();

        if (loadingMessage) loadingMessage.style.display = 'none'; if (pairingsTable) pairingsTable.style.display = 'table'; if (currentRoundTitle) currentRoundTitle.style.display = 'block';
        filterTable();
        // Update status logic removed as element is gone
        // console.log("updateUI: Update finished.");
    }

    function generateTabs() {
        if (!roundTabsContainer) return; roundTabsContainer.innerHTML = ''; let stages = {};
        roundsData.forEach(round => { if (round.type === "3") { if (!stages["Swiss"]) stages["Swiss"] = []; stages["Swiss"].push(round.roundNumber); } else { const matchCount = round.matches.filter(m => !m.isBye).length; let stageLabel = "Top Cut"; if (matchCount === 1) stageLabel = "Finals"; else if (matchCount === 2) stageLabel = "Top 4"; else if (matchCount === 4) stageLabel = "Top 8"; else if (matchCount === 8) stageLabel = "Top 16"; if (!stages[stageLabel]) stages[stageLabel] = []; stages[stageLabel].push(round.roundNumber); } });
        if (stages["Swiss"]) { stages["Swiss"].sort((a, b) => a - b).forEach(roundNum => { const button = document.createElement('button'); button.textContent = `Round ${roundNum}`; button.dataset.roundNumber = roundNum; button.addEventListener('click', handleTabClick); roundTabsContainer.appendChild(button); }); }
        const stageOrder = ["Top 16", "Top 8", "Top 4", "Finals", "Top Cut"];
        stageOrder.forEach(stageLabel => { if (stages[stageLabel]) { const roundsInStage = stages[stageLabel].sort((a, b) => a - b); const startRoundOfStage = roundsInStage[0]; const button = document.createElement('button'); button.textContent = stageLabel; button.dataset.roundNumber = startRoundOfStage; button.dataset.stageRounds = roundsInStage.join(','); button.addEventListener('click', handleTabClick); roundTabsContainer.appendChild(button); } });
    }

    function updateStandingsDisplay() {
        if (!standingsContainer || !standingsLoadingMsg || !noStandingsMsg || !standingsTableBody) return;
        try {
            const swissRounds = roundsData.filter(r => r.type === "3"); const totalSwissRounds = swissRounds.length > 0 ? Math.max(...swissRounds.map(r => r.roundNumber)) : 0; let latestCompletedSwissRoundNumber = 0; for (const round of swissRounds) { const isCompleted = !round.matches.some(m => m.outcome === 0 && !m.isBye); if (isCompleted && round.roundNumber > latestCompletedSwissRoundNumber) { latestCompletedSwissRoundNumber = round.roundNumber; } }
            if (totalSwissRounds > 0 && latestCompletedSwissRoundNumber === totalSwissRounds) {
                standingsLoadingMsg.style.display = 'block'; noStandingsMsg.style.display = 'none'; standingsTableBody.innerHTML = '';
                setTimeout(() => { try { console.log(`Calculating final standings (R${latestCompletedSwissRoundNumber}).`); const standingsData = calculateSwissStandingsForRound(latestCompletedSwissRoundNumber); const sortedStandings = sortStandings(standingsData); displayStandings(sortedStandings); standingsLoadingMsg.style.display = 'none'; } catch (calcError) { console.error("Error during standings calc/display:", calcError); standingsLoadingMsg.style.display = 'none'; noStandingsMsg.textContent = "Error calculating standings."; noStandingsMsg.style.display = 'block'; standingsContainer.style.display = 'block'; } }, 10);
            } else { console.log(`Hiding standings. Last completed Swiss: ${latestCompletedSwissRoundNumber}, Total Swiss: ${totalSwissRounds}`); standingsContainer.style.display = 'none'; noStandingsMsg.style.display = 'block'; noStandingsMsg.textContent = "Standings will be available after the final Swiss round concludes."; standingsLoadingMsg.style.display = 'none'; standingsTableBody.innerHTML = ''; }
        } catch (error) { console.error("Error in updateStandingsDisplay:", error); }
    }

    function getPlayerScoreBeforeRound(playerId, targetRoundNumber) { let wins = 0, losses = 0; const pid=String(playerId); if(!pid) return {wins,losses}; for(const pr of roundsData){ if(pr.roundNumber>=targetRoundNumber) continue; for(const m of pr.matches){ const p1=String(m.player1Id), p2=String(m.player2Id); if(m.isBye&&p1===pid){wins++;continue;} if(p1===pid){if(m.outcome===1)wins++; else if(m.outcome===2)losses++; continue;} if(p2===pid){if(m.outcome===2)wins++; else if(m.outcome===1)losses++; continue;}}} return {wins,losses}; }
    function displayRound(roundNumber) {
         const round = roundsData.find(r => r.roundNumber === roundNumber); if (!round || !currentRoundTitle || !pairingsTableBody) { console.error("Missing elements for displayRound"); return; }
         const cutInfo = getTopCutInfoForRound(roundNumber); const titleText = cutInfo ? `${cutInfo.label} - Round ${roundNumber}` : `Round ${roundNumber} Pairings`; currentRoundTitle.textContent = titleText; pairingsTableBody.innerHTML = ''; if (round.matches.length === 0) { pairingsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center;">No matches reported yet.</td></tr>'; return; }
         round.matches.forEach(match => { try { const row = pairingsTableBody.insertRow(); const p1=String(match.player1Id), p2=String(match.player2Id); const p1Info = playersData[p1]||{name:`Unknown (${p1})`}; const p2Info = match.isBye?{name:"BYE"}:(playersData[p2]||{name:`Unknown (${p2})`}); const s1=getPlayerScoreBeforeRound(p1, roundNumber); const s2=match.isBye?{wins:'-',losses:'-'}:getPlayerScoreBeforeRound(p2, roundNumber); const d1=`${p1Info.name} (${s1.wins}-${s1.losses})`; const d2=match.isBye?p2Info.name:`${p2Info.name} (${s2.wins}-${s2.losses})`; row.dataset.player1Name=p1Info.name.toLowerCase(); row.dataset.player2Name=match.isBye?'bye':p2Info.name.toLowerCase(); const ct=row.insertCell(); ct.textContent=match.table===0?"N/A":match.table; ct.style.textAlign='center'; const cp1=row.insertCell(); if(match.outcome===1){cp1.innerHTML=`<span class="winner">${d1}</span>`;}else{cp1.textContent=d1;} const cp2=row.insertCell(); if(match.isBye){cp2.textContent=d2; cp2.style.fontStyle='italic'; cp2.style.color='#6c757d';}else{if(match.outcome===2){cp2.innerHTML=`<span class="winner">${d2}</span>`;}else{cp2.textContent=d2;}} } catch (e) { console.error(`Error display match: ${JSON.stringify(match)}`, e); } });
    }
    function updateActiveTab() {
        if(!roundTabsContainer) return; const buttons = roundTabsContainer.querySelectorAll('button'); let activeSet = false; buttons.forEach(btn => btn.classList.remove('active'));
        buttons.forEach(button => { const stageRounds = button.dataset.stageRounds; if (stageRounds) { const roundsInStage = stageRounds.split(',').map(Number); if (roundsInStage.includes(currentRound)) { button.classList.add('active'); activeSet = true; } } });
        if (!activeSet) { buttons.forEach(button => { if (!button.dataset.stageRounds && parseInt(button.dataset.roundNumber, 10) === currentRound) { button.classList.add('active'); } }); }
    }
    function getTopCutInfoForRound(roundNumber) { const round = roundsData.find(r => r.roundNumber === roundNumber); if (!round || round.type === "3") return null; const matchCount = round.matches.filter(m => !m.isBye).length; if (matchCount === 1) return { label: "Finals" }; if (matchCount === 2) return { label: "Top 4" }; if (matchCount === 4) return { label: "Top 8" }; if (matchCount === 8) return { label: "Top 16" }; return { label: "Top Cut" }; }
    function filterTable() { if(!pairingsTableBody || !searchInput) return; const searchTerm = searchInput.value.toLowerCase().trim(); const rows = pairingsTableBody.querySelectorAll('tr'); let visibleRows = 0; rows.forEach(row => { if (row.cells.length === 1 && row.cells[0].colSpan === 3) { row.classList.remove('hidden-row'); visibleRows++; return; } const p1Name = row.dataset.player1Name || ''; const p2Name = row.dataset.player2Name || ''; if (!searchTerm || p1Name.includes(searchTerm) || (p2Name && p2Name.includes(searchTerm))) { row.classList.remove('hidden-row'); visibleRows++; } else { row.classList.add('hidden-row'); } }); const noResultsMessage = document.getElementById('no-search-results'); if (noResultsMessage) noResultsMessage.style.display = (visibleRows === 0 && searchTerm) ? 'block' : 'none'; }
    function checkClearButtonVisibility() { if (!clearSearchBtn || !searchInput) return; if (searchInput.value.length > 0) clearSearchBtn.style.display = 'inline-block'; else clearSearchBtn.style.display = 'none'; }

    // --- Event Handling Setup ---
    function handleTabClick(event) { const button = event.currentTarget; currentRound = parseInt(button.dataset.roundNumber, 10); displayRound(currentRound); updateActiveTab(); filterTable(); }
    if(searchInput) { searchInput.addEventListener('input', () => { filterTable(); checkClearButtonVisibility(); }); }
    if (clearSearchBtn) { clearSearchBtn.addEventListener('click', () => { if(searchInput) searchInput.value = ''; filterTable(); checkClearButtonVisibility(); if(searchInput) searchInput.focus(); }); }

    // --- Automatic Update Check ---
    async function checkForUpdates() {
         // Check if updateStatusElement exists before trying to update it
         const statusElement = document.getElementById('update-status');
         if (statusElement) { statusElement.textContent = `Checking...`; statusElement.title = `Checking at: ${new Date().toLocaleTimeString()}`; }
         const newDataProcessed = await loadTournamentData();
         if (newDataProcessed) { console.log("checkForUpdates: New data processed, updating UI."); updateUI(); }
    }
    // --- Initialisation ---
    async function initialize() {
         console.log("initialize: Starting initialization...");
         const initialLoadingMsg = document.querySelector('.loading-app'); // Check if on homepage initially
         if(initialLoadingMsg) initialLoadingMsg.style.display = 'block';
         else if(loadingMessage) loadingMessage.style.display = 'block'; // Show loading on tournament page

         await loadTournamentData(); // Initial load
         updateUI(); // Initial render
         checkClearButtonVisibility();
         if (updateIntervalId) clearInterval(updateIntervalId);
         updateIntervalId = setInterval(checkForUpdates, refreshInterval);
         console.log(`initialize: Started checking for updates every ${refreshInterval / 1000} seconds.`);
    }

    // --- Start the application ---
    initialize();

}); // End of DOMContentLoaded
