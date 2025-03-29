document.addEventListener('DOMContentLoaded', () => {
    console.log("App Initializing...");

    const appContainer = document.getElementById('app');
    const loadingMessage = document.querySelector('.loading-app'); // Initial loading message

    // --- State ---
    let currentView = null; // 'list' or 'tournament'
    let currentTournamentSlug = null;
    let tournamentsData = []; // Holds data from tournaments.json
    // Keep calculation/display functions from previous script, they will be called by render functions
    let playersData = {}; // For currently loaded tournament
    let roundsData = []; // For currently loaded tournament
    let currentRound = 1; // For currently loaded tournament

    // --- Configuration (Keep relevant ones) ---
    const WP_MINIMUM = 0.25;

    // --- Routing ---
    function handleRouteChange() {
        const hash = window.location.hash.substring(1); // Remove #
        console.log("Route changed:", hash);

        if (hash && hash.startsWith('tournament/')) {
            const slug = hash.substring('tournament/'.length);
            if (slug) {
                showTournamentView(slug);
            } else {
                showListView(); // Fallback if slug is missing
            }
        } else {
            showListView(); // Default to list view
        }
    }

    // --- View Rendering ---

    // Render the list of tournaments
    async function renderListView() {
        console.log("Rendering List View");
        if (!appContainer) return;
        currentView = 'list';
        currentTournamentSlug = null;
        appContainer.innerHTML = `
            <div class="container">
                <section id="tournament-list">
                    <h2>Select Tournament</h2>
                    <div class="tournament-grid" id="tournament-grid-container">
                        <p class="loading-list">Loading tournaments...</p>
                    </div>
                </section>
            </div>`;

        try {
            if (tournamentsData.length === 0) {
                console.log("Fetching tournaments.json...");
                const response = await fetch('data/tournaments.json?t=' + new Date().getTime()); // Prevent cache
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                tournamentsData = await response.json();
                console.log(`Loaded ${tournamentsData.length} tournaments.`);
            }

            const gridContainer = document.getElementById('tournament-grid-container');
            if (tournamentsData.length > 0) {
                gridContainer.innerHTML = tournamentsData.map(tournament => `
                    <a href="#tournament/${tournament.slug}" class="tournament-card">
                        ${escapeHtml(tournament.name)}
                        <span class="tournament-date">${tournament.date || ''}</span>
                    </a>
                `).join('');
            } else {
                gridContainer.innerHTML = '<p>No tournaments found.</p>';
            }
        } catch (error) {
            console.error("Error loading or rendering tournament list:", error);
            const gridContainer = document.getElementById('tournament-grid-container');
            if (gridContainer) gridContainer.innerHTML = '<p class="error">Could not load tournament list.</p>';
        }
    }

    // Render the view for a specific tournament
    async function renderTournamentView(slug) {
        console.log("Rendering Tournament View for:", slug);
        if (!appContainer) return;
        currentView = 'tournament';
        currentTournamentSlug = slug;
        // Reset data for the new tournament
        playersData = {};
        roundsData = [];
        currentRound = 1; // Default to round 1 on load

        // Basic structure for the tournament view
        appContainer.innerHTML = `
            <div class="container tournament-view-container">
                 <!-- Header content will be dynamically generated -->
                 <div id="tournament-header-info">
                    <h1 id="tournament-name">Loading...</h1>
                    <p id="tournament-info"></p>
                    <p style="margin-top: 5px;"><a href="#" style="font-size: 0.9em;">← Back to Tournament List</a></p>
                    <span id="update-status"></span>
                 </div>

                 <!-- Controls -->
                 <div class="controls">
                     <nav id="round-tabs"></nav>
                     <div class="search-container">
                         <input type="text" id="search-input" placeholder="Search by Player Name...">
                         <button type="button" id="clear-search-btn" class="clear-search-button" title="Clear search">×</button>
                     </div>
                 </div>

                 <!-- Pairings -->
                 <div id="pairings-container">
                     <h2 id="current-round-title"></h2>
                     <table id="pairings-table" class="results-table">
                         <thead> <tr> <th>Table</th> <th>Player 1</th> <th>Player 2</th> </tr> </thead>
                         <tbody id="pairings-body"></tbody>
                     </table>
                     <p id="loading-message">Loading pairings...</p>
                     <p id="no-search-results" style="display: none;">No players found matching your search.</p>
                 </div>

                 <!-- Standings -->
                 <div id="standings-container" style="display: none; margin-top: 40px;">
                     <h2 id="standings-title">Swiss Standings</h2>
                     <table id="standings-table" class="results-table">
                         <thead> <tr> <th>Rank</th> <th>Player</th> <th>Record</th> <th>OWP %</th> <th>OOWP %</th> </tr> </thead>
                         <tbody id="standings-body"></tbody>
                     </table>
                     <p id="standings-loading-message" style="display: none;">Calculating standings...</p>
                     <p id="no-standings-message" style="display: none;">Standings will be available after the final Swiss round concludes.</p>
                 </div>
            </div>`;

        // Add event listener for the back button
        appContainer.querySelector('a[href="#"]').addEventListener('click', (e) => {
            e.preventDefault();
            window.location.hash = ''; // Go back to the list view
        });

        // Fetch and display data for this tournament slug
        await loadAndDisplayTournamentData(slug);
    }

    // Fetch, parse, and display data for a specific tournament
    async function loadAndDisplayTournamentData(slug) {
        const xmlPath = `${slug}/data/tournament_data.xml`; // Construct path
        console.log(`Fetching data for ${slug} from ${xmlPath}`);

        try {
            const response = await fetch(`${xmlPath}?t=${new Date().getTime()}`); // Prevent cache
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}, file: ${xmlPath}`);

            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");
            const parseError = xmlDoc.querySelector("parsererror");
            if (parseError) throw new Error(`XML Parsing Error: ${parseError.textContent}`);

            console.log("XML parsed successfully.");
            extractTournamentDataFromXML(xmlDoc); // Populate playersData, roundsData
            console.log(`Extracted ${Object.keys(playersData).length} players, ${roundsData.length} rounds.`);

            // --- Now call the UI update logic ---
            // Update header info
            const headerInfo = document.getElementById('tournament-header-info');
            if(headerInfo) {
                const nameEl = headerInfo.querySelector('#tournament-name');
                const infoEl = headerInfo.querySelector('#tournament-info');
                // Attempt to find name/info from extracted data or fallback
                const tData = xmlDoc.querySelector('tournament > data');
                if (nameEl) nameEl.textContent = tData?.querySelector('name')?.textContent || slug.replace(/-/g, ' ');
                if (infoEl) infoEl.textContent = `${tData?.querySelector('city')?.textContent || ''}${tData?.querySelector('city')?.textContent && tData?.querySelector('country')?.textContent ? ', ' : ''}${tData?.querySelector('country')?.textContent || ''}`;
                const statusEl = headerInfo.querySelector('#update-status');
                if(statusEl) statusEl.textContent = 'Loaded'; // Initial status
            }

            // Populate Tabs, Pairings, Standings (using adapted functions)
            updateTournamentUI(); // This function will contain the logic previously in updateUI

            // Add listeners for dynamically created elements
            setupTournamentEventListeners();

        } catch (error) {
            console.error(`Error loading/displaying tournament ${slug}:`, error);
            appContainer.innerHTML = `<div class="container"><p class="error">Error loading tournament data: ${error.message}</p><p><a href="#">← Back to list</a></p></div>`;
            // Add back button listener for error state too
            appContainer.querySelector('a[href="#"]').addEventListener('click', (e) => { e.preventDefault(); window.location.hash = ''; });
        }
    }

     // --- Data Extraction (adapted from previous 'extractData') ---
     function extractTournamentDataFromXML(xmlDoc) {
        // Reset global data stores for the current tournament
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

    // --- Standings Calculation Logic (Keep your working functions v4.10/v4.11 logic) ---
    // calculatePlayerSwissRecord, getSwissOpponents, getPlayerSwissWinPercentage,
    // calculateOWP, calculateOOWP, calculateSwissStandingsForRound, sortStandings
    // (These functions remain the same as the last working version)
    function calculatePlayerSwissRecord(playerId, maxRoundNumber) { /* ... */ return {matchWins, losses, ties, byes, matchPoints, roundsParticipated, highestRoundParticipated}; }
    function getSwissOpponents(playerId, maxRoundNumber) { /* ... */ return Array.from(opps); }
    function getPlayerSwissWinPercentage(playerId, maxRoundNumber, currentStandingsCache) { /* ... */ return finalWP; }
    function calculateOWP(playerId, maxRoundNumber, currentStandingsCache) { /* ... */ return result; }
    function calculateOOWP(playerId, maxRoundNumber, currentStandingsCache) { /* ... */ return result; }
    function calculateSwissStandingsForRound(maxRoundNumber) { /* ... */ return standingsData; }
    function sortStandings(standingsData) { /* ... */ return standingsData.sort(/*...*/); }


    // --- UI Update Functions (For Tournament View) ---
    function updateTournamentUI() {
        // console.log("updateTournamentUI: Starting...");
        if (Object.keys(playersData).length === 0 || roundsData.length === 0) { console.log("updateTournamentUI: No data to display."); return; }

        // Generate Tabs
        generateTabs();

        // Display current round pairings
        displayRound(currentRound);
        updateActiveTab();

        // Calculate and Display Standings (if applicable)
        updateStandingsDisplay();

        // Hide main loading message
        const initialLoading = appContainer.querySelector('.loading-app');
        if (initialLoading) initialLoading.style.display = 'none';
        const pairingLoading = document.getElementById('loading-message');
        if(pairingLoading) pairingLoading.style.display = 'none';

        // console.log("updateTournamentUI: Finished.");
    }

    function generateTabs() {
        const roundTabsContainer = document.getElementById('round-tabs'); // Get container dynamically
        if (!roundTabsContainer) return;
        roundTabsContainer.innerHTML = ''; // Clear existing tabs

        let stages = {};
        roundsData.forEach(round => { if (round.type === "3") { if (!stages["Swiss"]) stages["Swiss"] = []; stages["Swiss"].push(round.roundNumber); } else { const matchCount = round.matches.filter(m => !m.isBye).length; let stageLabel = "Top Cut"; if (matchCount === 1) stageLabel = "Finals"; else if (matchCount === 2) stageLabel = "Top 4"; else if (matchCount === 4) stageLabel = "Top 8"; else if (matchCount === 8) stageLabel = "Top 16"; if (!stages[stageLabel]) stages[stageLabel] = []; stages[stageLabel].push(round.roundNumber); } });
        if (stages["Swiss"]) { stages["Swiss"].sort((a, b) => a - b).forEach(roundNum => { const button = document.createElement('button'); button.textContent = `Round ${roundNum}`; button.dataset.roundNumber = roundNum; button.addEventListener('click', handleTabClick); roundTabsContainer.appendChild(button); }); }
        const stageOrder = ["Top 16", "Top 8", "Top 4", "Finals", "Top Cut"];
        stageOrder.forEach(stageLabel => { if (stages[stageLabel]) { const roundsInStage = stages[stageLabel].sort((a, b) => a - b); const startRoundOfStage = roundsInStage[0]; const button = document.createElement('button'); button.textContent = stageLabel; button.dataset.roundNumber = startRoundOfStage; button.dataset.stageRounds = roundsInStage.join(','); button.addEventListener('click', handleTabClick); roundTabsContainer.appendChild(button); } });
        console.log("Generated tabs.");
    }

     function displayStandings(sortedStandings) {
        const standingsTableBody = document.getElementById('standings-body'); // Get dynamic element
        const noStandingsMsg = document.getElementById('no-standings-message');
        const standingsContainer = document.getElementById('standings-container');
        // console.log("displayStandings: Starting...");
        if (!standingsTableBody) { return; } standingsTableBody.innerHTML = ''; if (!Array.isArray(sortedStandings) || sortedStandings.length === 0) { if (standingsContainer) standingsContainer.style.display = 'block'; if(noStandingsMsg) noStandingsMsg.style.display = 'block'; return; }
        if(noStandingsMsg) noStandingsMsg.style.display = 'none'; if (standingsContainer) standingsContainer.style.display = 'block'; sortedStandings.forEach((data, index) => { try { const rank = index + 1; const row = standingsTableBody.insertRow(); const cellRank = row.insertCell(); cellRank.textContent = rank; cellRank.style.textAlign = 'center'; const cellName = row.insertCell(); cellName.textContent = data.playerInfo?.name || 'Unknown'; const cellRecord = row.insertCell(); cellRecord.textContent = data.recordString; cellRecord.style.textAlign = 'center'; const cellOWP = row.insertCell(); cellOWP.textContent = (data.owp * 100).toFixed(2); cellOWP.style.textAlign = 'right'; const cellOOWP = row.insertCell(); cellOOWP.textContent = (data.oowp * 100).toFixed(2); cellOOWP.style.textAlign = 'right'; } catch (error) { console.error(`Error displaying standings row ${index + 1}:`, error); } });
        // console.log("displayStandings: Finished.");
    }

    function updateStandingsDisplay() {
        const standingsContainer = document.getElementById('standings-container');
        const standingsLoadingMsg = document.getElementById('standings-loading-message');
        const noStandingsMsg = document.getElementById('no-standings-message');
        const standingsTableBody = document.getElementById('standings-body');

        if (!standingsContainer || !standingsLoadingMsg || !noStandingsMsg || !standingsTableBody) return;

        try {
            // console.log("updateStandingsDisplay: Updating...");
            const swissRounds = roundsData.filter(r => r.type === "3");
            const totalSwissRounds = swissRounds.length > 0 ? Math.max(...swissRounds.map(r => r.roundNumber)) : 0;
            let latestCompletedSwissRoundNumber = 0;
            for (const round of swissRounds) { const isCompleted = !round.matches.some(m => m.outcome === 0 && !m.isBye); if (isCompleted && round.roundNumber > latestCompletedSwissRoundNumber) { latestCompletedSwissRoundNumber = round.roundNumber; } }

            if (totalSwissRounds > 0 && latestCompletedSwissRoundNumber === totalSwissRounds) {
                standingsLoadingMsg.style.display = 'block'; // Show loading message
                // Use setTimeout to allow UI to update before heavy calculation
                setTimeout(() => {
                    try {
                         console.log(`updateStandingsDisplay: Calculating final standings (R${latestCompletedSwissRoundNumber}).`);
                         const standingsData = calculateSwissStandingsForRound(latestCompletedSwissRoundNumber);
                         const sortedStandings = sortStandings(standingsData);
                         displayStandings(sortedStandings); // Display the calculated standings
                         standingsLoadingMsg.style.display = 'none';
                         noStandingsMsg.style.display = 'none';
                         standingsContainer.style.display = 'block';
                    } catch (calcError) {
                         console.error("Error during standings calculation/display:", calcError);
                         standingsLoadingMsg.style.display = 'none';
                         noStandingsMsg.textContent = "Error calculating standings.";
                         noStandingsMsg.style.display = 'block';
                         standingsContainer.style.display = 'block';
                    }
                }, 10); // Short delay
            } else {
                console.log(`updateStandingsDisplay: Hiding standings (not final Swiss).`);
                standingsContainer.style.display = 'none';
                noStandingsMsg.style.display = 'block'; noStandingsMsg.textContent = "Standings will be available after the final Swiss round concludes.";
                standingsLoadingMsg.style.display = 'none'; standingsTableBody.innerHTML = '';
            }
        } catch (error) { console.error("Error in updateStandingsDisplay:", error); }
    }

    function getPlayerScoreBeforeRound(playerId, targetRoundNumber) {
        let wins = 0, losses = 0; const effectivePlayerId = String(playerId); if (!effectivePlayerId) return { wins, losses };
        for (const pastRound of roundsData) { if (pastRound.roundNumber >= targetRoundNumber) continue; for (const match of pastRound.matches) { const matchP1Id = String(match.player1Id); const matchP2Id = String(match.player2Id); if (match.isBye && matchP1Id === effectivePlayerId) { wins++; continue; } if (matchP1Id === effectivePlayerId) { if (match.outcome === 1) wins++; else if (match.outcome === 2) losses++; continue; } if (matchP2Id === effectivePlayerId) { if (match.outcome === 2) wins++; else if (match.outcome === 1) losses++; continue; } } }
        return { wins, losses };
    }
    function displayRound(roundNumber) {
         const round = roundsData.find(r => r.roundNumber === roundNumber);
         const currentRoundTitle = document.getElementById('current-round-title'); // Get dynamic element
         const pairingsTableBody = document.getElementById('pairings-body'); // Get dynamic element
         if (!round || !currentRoundTitle || !pairingsTableBody) { console.error("Missing elements for displayRound"); return; }
         const cutInfo = getTopCutInfoForRound(roundNumber); const titleText = cutInfo ? `${cutInfo.label} - Round ${roundNumber}` : `Round ${roundNumber} Pairings`; currentRoundTitle.textContent = titleText; pairingsTableBody.innerHTML = ''; if (round.matches.length === 0) { pairingsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center;">No matches reported yet.</td></tr>'; return; }
         round.matches.forEach(match => { try { const row = pairingsTableBody.insertRow(); const p1IdStr = String(match.player1Id); const p2IdStr = String(match.player2Id); const player1Info = playersData[p1IdStr] || { name: `Unknown (${p1IdStr})` }; const player2Info = match.isBye ? { name: "BYE" } : (playersData[p2IdStr] || { name: `Unknown (${p2IdStr})` }); const scoreP1 = getPlayerScoreBeforeRound(p1IdStr, roundNumber); const scoreP2 = match.isBye ? { wins: '-', losses: '-' } : getPlayerScoreBeforeRound(p2IdStr, roundNumber); const player1DisplayText = `${player1Info.name} (${scoreP1.wins}-${scoreP1.losses})`; const player2DisplayText = match.isBye ? player2Info.name : `${player2Info.name} (${scoreP2.wins}-${scoreP2.losses})`; row.dataset.player1Name = player1Info.name.toLowerCase(); row.dataset.player2Name = match.isBye ? 'bye' : player2Info.name.toLowerCase(); const cellTable = row.insertCell(); cellTable.textContent = match.table === 0 ? "N/A" : match.table; cellTable.style.textAlign = 'center'; const cellP1 = row.insertCell(); if (match.outcome === 1) { cellP1.innerHTML = `<span class="winner">${player1DisplayText}</span>`; } else { cellP1.textContent = player1DisplayText; } const cellP2 = row.insertCell(); if (match.isBye) { cellP2.textContent = player2DisplayText; cellP2.style.fontStyle = 'italic'; cellP2.style.color = '#6c757d'; } else { if (match.outcome === 2) { cellP2.innerHTML = `<span class="winner">${player2DisplayText}</span>`; } else { cellP2.textContent = player2DisplayText; } } } catch (error) { console.error(`Error displaying match row: ${JSON.stringify(match)}`, error); } });
    }
    function updateActiveTab() {
        const roundTabsContainer = document.getElementById('round-tabs'); // Get dynamic element
        if(!roundTabsContainer) return; const buttons = roundTabsContainer.querySelectorAll('button'); let activeSet = false; buttons.forEach(btn => btn.classList.remove('active'));
        buttons.forEach(button => { const stageRounds = button.dataset.stageRounds; if (stageRounds) { const roundsInStage = stageRounds.split(',').map(Number); if (roundsInStage.includes(currentRound)) { button.classList.add('active'); activeSet = true; } } });
        if (!activeSet) { buttons.forEach(button => { if (!button.dataset.stageRounds && parseInt(button.dataset.roundNumber, 10) === currentRound) { button.classList.add('active'); } }); }
    }
    function getTopCutInfoForRound(roundNumber) {
         const round = roundsData.find(r => r.roundNumber === roundNumber); if (!round || round.type === "3") return null; const matchCount = round.matches.filter(m => !m.isBye).length; if (matchCount === 1) return { label: "Finals" }; if (matchCount === 2) return { label: "Top 4" }; if (matchCount === 4) return { label: "Top 8" }; if (matchCount === 8) return { label: "Top 16" }; return { label: "Top Cut" };
    }
    function filterTable() {
        const searchInput = document.getElementById('search-input'); // Get dynamic element
        const pairingsTableBody = document.getElementById('pairings-body'); // Get dynamic element
        const noResultsMessage = document.getElementById('no-search-results'); // Get dynamic element
        if(!pairingsTableBody || !searchInput) return; const searchTerm = searchInput.value.toLowerCase().trim(); const rows = pairingsTableBody.querySelectorAll('tr'); let visibleRows = 0; rows.forEach(row => { if (row.cells.length === 1 && row.cells[0].colSpan === 3) { row.classList.remove('hidden-row'); visibleRows++; return; } const p1Name = row.dataset.player1Name || ''; const p2Name = row.dataset.player2Name || ''; if (!searchTerm || p1Name.includes(searchTerm) || (p2Name && p2Name.includes(searchTerm))) { row.classList.remove('hidden-row'); visibleRows++; } else { row.classList.add('hidden-row'); } }); if (noResultsMessage) noResultsMessage.style.display = (visibleRows === 0 && searchTerm) ? 'block' : 'none';
    }
    function checkClearButtonVisibility() {
        const searchInput = document.getElementById('search-input'); // Get dynamic element
        const clearSearchBtn = document.getElementById('clear-search-btn'); // Get dynamic element
        if (!clearSearchBtn || !searchInput) return; if (searchInput.value.length > 0) clearSearchBtn.style.display = 'inline-block'; else clearSearchBtn.style.display = 'none';
    }

    // --- Event Handling Setup ---
    function setupTournamentEventListeners() {
        const searchInput = document.getElementById('search-input');
        const clearSearchBtn = document.getElementById('clear-search-btn');

        if(searchInput) { searchInput.addEventListener('input', () => { filterTable(); checkClearButtonVisibility(); }); }
        if (clearSearchBtn) { clearSearchBtn.addEventListener('click', () => { if(searchInput) searchInput.value = ''; filterTable(); checkClearButtonVisibility(); if(searchInput) searchInput.focus(); }); }
        // Tab click listeners are added during tab generation
    }
    function handleTabClick(event) {
         const button = event.currentTarget;
         currentRound = parseInt(button.dataset.roundNumber, 10); // Use the stored round number
         displayRound(currentRound);
         updateActiveTab();
         filterTable();
    }


    // --- Helper Functions ---
    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
             .replace(/&/g, "&")
             .replace(/</g, "<")
             .replace(/>/g, ">")
             .replace(/"/g, """)
             .replace(/'/g, "'");
    }

    // --- Routing and Initialization ---
    function showListView() { renderListView(); }
    function showTournamentView(slug) { renderTournamentView(slug); }

    window.addEventListener('hashchange', handleRouteChange); // Listen for hash changes

    // Initial load
    handleRouteChange(); // Render view based on initial URL hash

}); // End of DOMContentLoaded
