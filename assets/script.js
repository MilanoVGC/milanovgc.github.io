// Wait for the HTML document to be fully loaded before running script
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");

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
    let playersData = {};
    let roundsData = [];
    let currentRound = 1;
    let lastKnownTimeElapsed = -1;
    let updateIntervalId = null;
    let standingsCache = {};

    // --- Configuration ---
    const xmlFilePath = 'data/tournament_data.xml';
    const refreshInterval = 15000;
    const OWP_MINIMUM = 0.25;
    const JUNIOR_SENIOR_WEIGHT = 0.25;
    const MASTERS_WEIGHT = 1.0;
    const CURRENT_YEAR = new Date().getFullYear();

    // --- Core Functions ---

    async function loadTournamentData() {
        console.log("loadTournamentData: Starting fetch...");
        try {
            const response = await fetch(`${xmlFilePath}?t=${new Date().getTime()}`);
            console.log(`loadTournamentData: Fetch status: ${response.status}`);
            if (!response.ok) {
                 if (response.status === 404) { console.log(`Tournament data file not found at ${xmlFilePath}. Waiting...`); updateStatusElement.textContent = `Waiting for data...`; }
                 else { console.error(`HTTP error! status: ${response.status}, file: ${xmlFilePath}`); updateStatusElement.textContent = `Error (${response.status})`; }
                 updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`; return false;
            }
            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");
            const parseError = xmlDoc.querySelector("parsererror");
            if (parseError) {
                console.error("XML Parsing Error:", parseError.textContent);
                updateStatusElement.textContent = `Parse Error`; updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                if (lastKnownTimeElapsed !== -1) { loadingMessage.textContent = "Error parsing updated tournament data. Check console."; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545'; }
                return false;
            }
            console.log("loadTournamentData: XML parsed successfully.");

            const currentTimeElapsedElement = xmlDoc.querySelector('tournament > timeelapsed');
            const currentTimeElapsed = currentTimeElapsedElement ? parseInt(currentTimeElapsedElement.textContent, 10) : -1;

            if (currentTimeElapsed !== -1 && currentTimeElapsed === lastKnownTimeElapsed) {
                console.log("loadTournamentData: No change detected (timeelapsed).");
                updateStatusElement.textContent = `Up to date`; updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
                return false; // No change
            }

            console.log("loadTournamentData: Change detected or initial load. Processing XML...");
            extractData(xmlDoc);
            lastKnownTimeElapsed = currentTimeElapsed;
            standingsCache = {};
            console.log("loadTournamentData: Data extraction seems complete.");
            return true; // New data processed

        } catch (error) {
             console.error("loadTournamentData: Error during fetch/parse:", error);
             updateStatusElement.textContent = `Fetch Error`; updateStatusElement.title = `Last check: ${new Date().toLocaleTimeString()}`;
             if (lastKnownTimeElapsed !== -1) { loadingMessage.textContent = `Error loading data: ${error.message}`; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545'; }
             return false;
        }
    }

    function extractData(xmlDoc) {
        console.log("extractData: Starting extraction...");
        playersData = {}; roundsData = []; let extractionError = false;
        try {
            const tournamentData = xmlDoc.querySelector('tournament > data');
            if (tournamentData) { const city = tournamentData.querySelector('city')?.textContent; const country = tournamentData.querySelector('country')?.textContent; tournamentInfoElement.textContent = `${city ? city + ', ' : ''}${country || ''}`.trim(); }

            const tempPlayersData = {};
            const playerElements = xmlDoc.querySelectorAll('tournament > players > player');
            console.log(`extractData: Found ${playerElements.length} player elements.`);

            playerElements.forEach((player, index) => {
                const userId = player.getAttribute('userid'); const firstName = player.querySelector('firstname')?.textContent || ''; const lastName = player.querySelector('lastname')?.textContent || '';
                const birthdateElement = player.querySelector('birthdate'); const birthdateText = birthdateElement?.textContent; let birthYear = null;
                // console.log(`extractData: Processing Player Index ${index}, ID: ${userId}, Name: ${firstName} ${lastName}, Birthdate Text: '${birthdateText}'`); // Less verbose log

                if (birthdateText) {
                    try { const yearMatch = birthdateText.match(/(\d{4})$/); if (yearMatch && yearMatch[1]) { birthYear = parseInt(yearMatch[1], 10); /* console.log(`extractData:  -> Parsed Year: ${birthYear}`); */ } else { console.warn(`extractData:  -> Could not parse year from birthdate="${birthdateText}" for player ${userId}. Expected MM/DD/YYYY.`); } }
                    catch (e) { console.warn(`extractData:  -> Error parsing birthdate="${birthdateText}" for player ${userId}`, e); }
                } else { console.warn(`extractData:  -> Missing '<birthdate>' tag or content for player ${userId}`); }

                if (userId) { tempPlayersData[userId] = { id: userId, firstName, lastName, name: `${firstName} ${lastName}`.trim(), birthYear: birthYear }; }
                else { console.warn(`extractData: Player at index ${index} missing userid attribute.`); }
            });
            playersData = tempPlayersData;
            console.log(`extractData: Extracted ${Object.keys(playersData).length} players successfully into playersData.`);

            const tempRoundsData = [];
            const roundElements = xmlDoc.querySelectorAll('tournament > pods > pod > rounds > round');
            console.log(`extractData: Found ${roundElements.length} round elements.`);

            roundElements.forEach((round, roundIndex) => {
                const roundNumber = parseInt(round.getAttribute('number'), 10); const roundType = round.getAttribute('type');
                // console.log(`extractData: Processing Round ${roundNumber}, Type: ${roundType}`);

                if (isNaN(roundNumber)) { console.warn(`extractData: Skipping round at index ${roundIndex} with invalid number:`, round); return; }

                const matches = [];
                const matchElements = round.querySelectorAll('matches > match');
                matchElements.forEach((match, matchIndex) => {
                    const tableNumber = parseInt(match.querySelector('tablenumber')?.textContent || '0', 10); const outcome = parseInt(match.getAttribute('outcome'), 10); const player1Element = match.querySelector('player1'); const player2Element = match.querySelector('player2'); const singlePlayerElement = match.querySelector('player'); let matchData = { table: tableNumber, player1Id: null, player2Id: null, outcome: outcome, isBye: false }; if (outcome === 5 && singlePlayerElement) { matchData.player1Id = singlePlayerElement.getAttribute('userid'); matchData.isBye = true; } else if (player1Element && player2Element) { matchData.player1Id = player1Element.getAttribute('userid'); matchData.player2Id = player2Element.getAttribute('userid'); } else { console.warn(`extractData: Skipping malformed match element in round ${roundNumber} (index ${matchIndex}):`, match); return; } if (matchData.player1Id && !playersData[matchData.player1Id]) console.warn(`extractData: Player ID ${matchData.player1Id} from match in round ${roundNumber} not found in players list.`); if (matchData.player2Id && !playersData[matchData.player2Id]) console.warn(`extractData: Player ID ${matchData.player2Id} from match in round ${roundNumber} not found in players list.`); matches.push(matchData);
                });
                matches.sort((a, b) => a.table - b.table);
                tempRoundsData.push({ roundNumber, type: roundType, matches });
            });
            roundsData = tempRoundsData;
            console.log(`extractData: Extracted ${roundsData.length} rounds successfully into roundsData.`);

        } catch (error) {
             console.error("extractData: CRITICAL Error during extraction:", error); extractionError = true;
             playersData = {}; roundsData = [];
             if(loadingMessage) { loadingMessage.textContent = `Critical Error processing data: ${error.message}. Check console.`; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545'; }
        } finally {
             console.log(`extractData: Finished extraction. playersData size: ${Object.keys(playersData).length}, roundsData size: ${roundsData.length}, Error occurred: ${extractionError}`);
        }
    }

    // --- Standings Calculation Functions ---
    function getPlayerDivision(playerId) { const player = playersData[playerId]; if (!player || !player.birthYear) { return 'Masters'; } const birthYear = player.birthYear; if (birthYear >= 2013) { return 'Junior'; } else if (birthYear >= 2009 && birthYear <= 2012) { return 'Senior'; } else { return 'Masters'; } }
    function calculatePlayerSwissRecord(playerId) { let wins = 0; let losses = 0; let matchesPlayed = 0; if (!playerId) return { wins, losses, matchesPlayed }; for (const round of roundsData) { if (round.type !== "3") continue; for (const match of round.matches) { let playedInMatch = false; let winInMatch = false; let lossInMatch = false; if (match.isBye && match.player1Id === playerId) { winInMatch = true; playedInMatch = true; } else if (match.player1Id === playerId) { playedInMatch = true; if (match.outcome === 1) winInMatch = true; else if (match.outcome === 2 || match.outcome === 4) lossInMatch = true; } else if (match.player2Id === playerId) { playedInMatch = true; if (match.outcome === 2) winInMatch = true; else if (match.outcome === 1 || match.outcome === 4) lossInMatch = true; } if(playedInMatch) { matchesPlayed++; if(winInMatch) wins++; if(lossInMatch) losses++; } } } return { wins, losses, matchesPlayed }; }
    function getSwissOpponents(playerId) { const opponents = new Set(); if (!playerId) return []; for (const round of roundsData) { if (round.type !== "3") continue; for (const match of round.matches) { if (match.isBye) continue; if (match.player1Id === playerId && match.player2Id) opponents.add(match.player2Id); else if (match.player2Id === playerId && match.player1Id) opponents.add(match.player1Id); } } return Array.from(opponents); }
    function getPlayerSwissWinPercentage(playerId, minPercentage) { const record = (standingsCache[playerId]?.record) ? standingsCache[playerId].record : calculatePlayerSwissRecord(playerId); const totalGames = record.wins + record.losses; if (totalGames === 0) return minPercentage; const winRate = record.wins / totalGames; return Math.max(winRate, minPercentage); }

    // --- OWP Calculation with Logging ---
    function calculateOWP(playerId, minPercentage) {
        console.log(`>>> calculateOWP started for Player ${playerId}`); // Log Start
        const opponents = getSwissOpponents(playerId);
        console.log(`>>> calculateOWP (${playerId}): Found ${opponents.length} Swiss opponents:`, JSON.stringify(opponents)); // Log Opponents

        if (opponents.length === 0) {
            console.log(`>>> calculateOWP (${playerId}): No opponents, returning 0.`); // Log Zero Opponent case
            return 0;
        }

        let totalWeightedOpponentWinPercentage = 0;
        let validOpponentCount = 0; // Keep track of opponents we could calculate for

        opponents.forEach(oppId => {
            try { // Add try-catch around each opponent
                const opponentWinPerc = getPlayerSwissWinPercentage(oppId, minPercentage);
                const opponentDivision = getPlayerDivision(oppId);
                let weight = MASTERS_WEIGHT;

                if (opponentDivision === 'Junior' || opponentDivision === 'Senior') {
                    weight = JUNIOR_SENIOR_WEIGHT;
                }
                console.log(`>>> calculateOWP (${playerId}): Processing Opponent ${oppId} (Div: ${opponentDivision}), WP: ${opponentWinPerc.toFixed(3)}, Weight: ${weight}`); // Log Each Opponent

                // Ensure the result is a valid number before adding
                if (typeof opponentWinPerc === 'number' && !isNaN(opponentWinPerc)) {
                    totalWeightedOpponentWinPercentage += (opponentWinPerc * weight);
                    validOpponentCount++;
                } else {
                    console.warn(`>>> calculateOWP (${playerId}): Invalid Win% (${opponentWinPerc}) calculated for opponent ${oppId}. Skipping opponent.`);
                }

            } catch (opponentError) {
                 console.error(`>>> calculateOWP (${playerId}): Error processing opponent ${oppId}:`, opponentError);
                 // Continue to next opponent if one fails
            }
        });

        // Calculate average based on valid opponents only
        const result = (validOpponentCount > 0) ? (totalWeightedOpponentWinPercentage / validOpponentCount) : 0; // Avoid division by zero if all opponents failed
        console.log(`>>> calculateOWP (${playerId}): Finished. TotalWeightedWP: ${totalWeightedOpponentWinPercentage}, ValidOpponents: ${validOpponentCount}, Final OWP: ${result.toFixed(3)}`); // Log Result

        return result;
    }
    // --- End OWP Calculation ---


    function calculateOOWP(playerId, minPercentage) { const opponents = getSwissOpponents(playerId); if (opponents.length === 0) return 0; let totalOpponentOWP = 0; opponents.forEach(oppId => { let oppOWP = 0; if (standingsCache[oppId] && typeof standingsCache[oppId].owp === 'number') { oppOWP = standingsCache[oppId].owp; } else { oppOWP = calculateOWP(oppId, minPercentage); } totalOpponentOWP += oppOWP; }); return totalOpponentOWP / opponents.length; }
    function calculateSwissStandings() { console.log("calculateSwissStandings: Starting calculation..."); if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'block'; if (noStandingsMsg) noStandingsMsg.style.display = 'none'; standingsCache = {}; const standingsData = []; let hasSwissRounds = roundsData.some(r => r.type === "3"); if (!hasSwissRounds) { console.log("calculateSwissStandings: No Swiss rounds found."); if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none'; if (noStandingsMsg) noStandingsMsg.style.display = 'block'; if (standingsContainer) standingsContainer.style.display = 'block'; return []; } console.log("calculateSwissStandings: Pre-calculating records..."); for (const playerId in playersData) { standingsCache[playerId] = { record: calculatePlayerSwissRecord(playerId) }; } console.log("calculateSwissStandings: Pre-calculating OWP..."); for (const playerId in playersData) { if (standingsCache[playerId]) { try { standingsCache[playerId].owp = calculateOWP(playerId, OWP_MINIMUM); } catch (error) { console.error(`Error calculating OWP for player ${playerId}:`, error); standingsCache[playerId].owp = 0; } } } console.log("calculateSwissStandings: Calculating OOWP and final list..."); for (const playerId in playersData) { const playerInfo = playersData[playerId]; const cachedData = standingsCache[playerId]; if (cachedData && playerInfo) { try { const oowp = calculateOOWP(playerId, OWP_MINIMUM); standingsData.push({ playerInfo: playerInfo, wins: cachedData.record.wins, losses: cachedData.record.losses, owp: cachedData.owp ?? 0, oowp: oowp }); } catch (error) { console.error(`Error calculating OOWP for player ${playerId}:`, error); standingsData.push({ playerInfo: playerInfo, wins: cachedData.record.wins, losses: cachedData.record.losses, owp: cachedData.owp ?? 0, oowp: 0 }); } } else { console.warn(`calculateSwissStandings: Skipping player ID ${playerId} - not found in cached data or playerInfo.`); } } console.log(`calculateSwissStandings: Calculation finished. ${standingsData.length} players processed for standings.`); if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none'; return standingsData; }
    function sortStandings(standingsData) { return standingsData.sort((a, b) => { if (b.wins !== a.wins) return b.wins - a.wins; if (b.owp !== a.owp) return b.owp - a.owp; if (b.oowp !== a.oowp) return b.oowp - a.oowp; return a.playerInfo.name.localeCompare(b.playerInfo.name); }); }
    function displayStandings(sortedStandings) { console.log("displayStandings: Starting display..."); if (!standingsTableBody) { console.error("displayStandings: Standings table body NOT FOUND!"); return; } standingsTableBody.innerHTML = ''; if (!Array.isArray(sortedStandings) || sortedStandings.length === 0) { console.log("displayStandings: No valid standings data (or empty array) received."); if (standingsContainer) standingsContainer.style.display = roundsData.some(r => r.type === "3") ? 'block' : 'none'; return; } console.log(`displayStandings: Received ${sortedStandings.length} players to display.`); if (standingsContainer) standingsContainer.style.display = 'block'; sortedStandings.forEach((data, index) => { console.log(`displayStandings: Processing row ${index + 1}, Data:`, JSON.stringify(data)); try { const rank = index + 1; const row = standingsTableBody.insertRow(); const cellRank = row.insertCell(); cellRank.textContent = rank; cellRank.style.textAlign = 'center'; const cellName = row.insertCell(); cellName.textContent = data.playerInfo?.name || 'Unknown Player'; const cellRecord = row.insertCell(); cellRecord.textContent = `${data.wins}-${data.losses}`; cellRecord.style.textAlign = 'center'; const cellOWP = row.insertCell(); cellOWP.textContent = (data.owp * 100).toFixed(2); cellOWP.style.textAlign = 'right'; const cellOOWP = row.insertCell(); cellOOWP.textContent = (data.oowp * 100).toFixed(2); cellOOWP.style.textAlign = 'right'; } catch (error) { console.error(`displayStandings: Error displaying standings row ${index+1} for player ${data?.playerInfo?.id}:`, error); } }); console.log("displayStandings: Display finished."); }
    // --- End Standings Functions ---

    function updateUI() {
        console.log("updateUI: Starting UI update...");
        console.log(`updateUI: Data state - Players: ${Object.keys(playersData).length}, Rounds: ${roundsData.length}`);

        // --- Pairings Update Logic ---
        try {
            if (Object.keys(playersData).length === 0 || roundsData.length === 0) {
                 console.log("updateUI: No player or round data available for pairings.");
                 if (lastKnownTimeElapsed === -1) { if(loadingMessage){ loadingMessage.textContent = "Waiting for tournament data..."; loadingMessage.style.display = 'block';} }
                 else { if(loadingMessage){ loadingMessage.textContent = "No player/round data found. Check console for errors."; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545'; } }
                 if(pairingsTable) pairingsTable.style.display = 'none'; if(currentRoundTitle) currentRoundTitle.style.display = 'none'; if(roundTabsContainer) roundTabsContainer.innerHTML = '';
                 if (standingsContainer) standingsContainer.style.display = 'none'; return;
            }
            const latestRoundNumber = roundsData.length > 0 ? roundsData[roundsData.length - 1].roundNumber : 1; const currentRoundExists = roundsData.some(r => r.roundNumber === currentRound); if (!currentRoundExists || currentRound < 1) { currentRound = latestRoundNumber; }
            let existingTabs = Array.from(roundTabsContainer.querySelectorAll('button')).map(btn => parseInt(btn.dataset.roundNumber, 10)); let newRounds = roundsData.map(r => r.roundNumber);
            if (JSON.stringify(existingTabs) !== JSON.stringify(newRounds)) { if (roundTabsContainer) roundTabsContainer.innerHTML = ''; roundsData.forEach(round => { const button = document.createElement('button'); button.textContent = `Round ${round.roundNumber}`; button.dataset.roundNumber = round.roundNumber; button.addEventListener('click', () => { currentRound = round.roundNumber; displayRound(currentRound); updateActiveTab(); filterTable(); }); if (roundTabsContainer) roundTabsContainer.appendChild(button); }); console.log("updateUI: Round tabs updated."); }
            displayRound(currentRound); updateActiveTab(); if (loadingMessage) loadingMessage.style.display = 'none'; if (pairingsTable) pairingsTable.style.display = 'table'; if (currentRoundTitle) currentRoundTitle.style.display = 'block'; filterTable();
            console.log("updateUI: Pairings section updated successfully.");
        } catch (error) {
             console.error("updateUI: Error during pairings update:", error);
             if (loadingMessage) { loadingMessage.textContent = `Error displaying pairings: ${error.message}. Check console.`; loadingMessage.style.display = 'block'; loadingMessage.style.color = '#dc3545'; }
             if (pairingsTable) pairingsTable.style.display = 'none';
        }

        // --- Standings Update Logic ---
        if (Object.keys(playersData).length > 0 && roundsData.length > 0) {
            try {
                console.log("updateUI: >>> Starting Standings Update Logic <<<");
                const swissRoundsExist = roundsData.some(r => r.type === "3");
                console.log(`updateUI: Swiss rounds exist? ${swissRoundsExist}`);

                if (swissRoundsExist) {
                    const standingsData = calculateSwissStandings();
                    console.log(`updateUI: Calculated standings data length: ${standingsData ? standingsData.length : 'null'}`);
                    const sortedStandings = sortStandings(standingsData);
                    console.log(`updateUI: Sorted standings data length: ${sortedStandings ? sortedStandings.length : 'null'}`);
                    displayStandings(sortedStandings);
                    console.log("updateUI: Called displayStandings.");
                } else {
                     console.log("updateUI: No swiss rounds exist, ensuring standings are hidden.");
                     if (standingsContainer) standingsContainer.style.display = 'none';
                     if (noStandingsMsg) noStandingsMsg.style.display = 'block';
                     if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
                }
                console.log("updateUI: >>> Standings section processing complete <<<");
            } catch (error) {
                 console.error("updateUI: CRITICAL Error during standings update block:", error);
                 if (standingsLoadingMsg) standingsLoadingMsg.style.display = 'none';
                 if (noStandingsMsg) { noStandingsMsg.style.display = 'block'; noStandingsMsg.textContent = `Error updating standings: ${error.message}. Check console.`; }
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

    // --- Helper Functions ---
    function getPlayerScoreBeforeRound(playerId, targetRoundNumber) { let wins = 0; let losses = 0; if (!playerId) return { wins, losses }; for (const pastRound of roundsData) { if (pastRound.roundNumber >= targetRoundNumber) continue; for (const match of pastRound.matches) { if (match.isBye && match.player1Id === playerId) { wins++; continue; } if (match.player1Id === playerId) { if (match.outcome === 1) wins++; else if (match.outcome === 2 || match.outcome === 4) losses++; continue; } if (match.player2Id === playerId) { if (match.outcome === 2) wins++; else if (match.outcome === 1 || match.outcome === 4) losses++; continue; } } } return { wins, losses }; }
    function displayRound(roundNumber) { console.log(`displayRound: Displaying round ${roundNumber}`); const round = roundsData.find(r => r.roundNumber === roundNumber); if (!round) { console.error(`Round data not found for round: ${roundNumber}`); if (pairingsTableBody) pairingsTableBody.innerHTML = '<tr><td colspan="3">Could not load data for this round.</td></tr>'; if (currentRoundTitle) currentRoundTitle.textContent = `Round ${roundNumber} (Error)`; return; } if (currentRoundTitle) currentRoundTitle.textContent = `Round ${roundNumber} Pairings`; if (pairingsTableBody) pairingsTableBody.innerHTML = ''; if (round.matches.length === 0) { if (pairingsTableBody) pairingsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: #6c757d;">No matches reported for this round yet.</td></tr>'; return; } round.matches.forEach(match => { try { const row = pairingsTableBody.insertRow(); const player1Info = playersData[match.player1Id] || { name: `Unknown (${match.player1Id})` }; const player2Info = match.isBye ? { name: "BYE" } : (playersData[match.player2Id] || { name: `Unknown (${match.player2Id})` }); const scoreP1 = getPlayerScoreBeforeRound(match.player1Id, roundNumber); const scoreP2 = match.isBye ? { wins: 0, losses: 0 } : getPlayerScoreBeforeRound(match.player2Id, roundNumber); const player1DisplayText = `${player1Info.name} (${scoreP1.wins}-${scoreP1.losses})`; const player2DisplayText = match.isBye ? player2Info.name : `${player2Info.name} (${scoreP2.wins}-${scoreP2.losses})`; row.dataset.player1Name = player1Info.name.toLowerCase(); row.dataset.player2Name = match.isBye ? 'bye' : player2Info.name.toLowerCase(); const cellTable = row.insertCell(); cellTable.textContent = match.table === 0 ? "N/A" : match.table; const cellP1 = row.insertCell(); if (match.outcome === 1) { cellP1.innerHTML = `<span class="winner">${player1DisplayText}</span>`; } else { cellP1.textContent = player1DisplayText; } const cellP2 = row.insertCell(); if (match.isBye) { cellP2.textContent = player2DisplayText; cellP2.style.color = '#6c757d'; } else { if (match.outcome === 2) { cellP2.innerHTML = `<span class="winner">${player2DisplayText}</span>`; } else { cellP2.textContent = player2DisplayText; } } } catch (error) { console.error(`Error displaying match row: ${JSON.stringify(match)}`, error); } }); }
    function updateActiveTab() { if(!roundTabsContainer) return; const buttons = roundTabsContainer.querySelectorAll('button'); buttons.forEach(button => { if (parseInt(button.dataset.roundNumber, 10) === currentRound) button.classList.add('active'); else button.classList.remove('active'); }); }
    function filterTable() { if(!pairingsTableBody || !searchInput) return; const searchTerm = searchInput.value.toLowerCase().trim(); const rows = pairingsTableBody.querySelectorAll('tr'); let visibleRows = 0; rows.forEach(row => { if (row.cells.length === 1 && row.cells[0].colSpan === 3) { row.classList.remove('hidden-row'); visibleRows++; return; } const p1Name = row.dataset.player1Name || ''; const p2Name = row.dataset.player2Name || ''; if (!searchTerm || p1Name.includes(searchTerm) || (p2Name && p2Name.includes(searchTerm))) { row.classList.remove('hidden-row'); visibleRows++; } else { row.classList.add('hidden-row'); } }); const noResultsMessage = document.getElementById('no-search-results'); if (noResultsMessage) noResultsMessage.style.display = (visibleRows === 0 && searchTerm) ? 'block' : 'none'; }
    function checkClearButtonVisibility() { if (!clearSearchBtn || !searchInput) return; if (searchInput.value.length > 0) clearSearchBtn.style.display = 'inline-block'; else clearSearchBtn.style.display = 'none'; }


    async function checkForUpdates() {
        if (updateStatusElement) { updateStatusElement.textContent = `Checking...`; updateStatusElement.title = `Checking at: ${new Date().toLocaleTimeString()}`; }
        const newDataProcessed = await loadTournamentData();
        if (newDataProcessed) { console.log("checkForUpdates: New data processed, updating UI."); updateUI(); }
    }

    async function initialize() {
        console.log("initialize: Starting initialization...");
        if(updateStatusElement) updateStatusElement.textContent = `Loading...`;
        await loadTournamentData();
        updateUI(); // Initial UI update attempt

        checkClearButtonVisibility();

        if (updateIntervalId) clearInterval(updateIntervalId);
        updateIntervalId = setInterval(checkForUpdates, refreshInterval);
        console.log(`initialize: Started checking for updates every ${refreshInterval / 1000} seconds.`);
    }

    // --- Event Listeners ---
    if(searchInput) searchInput.addEventListener('input', () => { filterTable(); checkClearButtonVisibility(); });
    if (clearSearchBtn) { clearSearchBtn.addEventListener('click', () => { if(searchInput) searchInput.value = ''; filterTable(); checkClearButtonVisibility(); if(searchInput) searchInput.focus(); }); }

    // --- Initialisation ---
    initialize();

}); // End of DOMContentLoaded
