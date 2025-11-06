// DATEI: frontend/static/trainer_stats.js
// +++ FIX: Aktualisiert alle Fetch URLs auf die neuen, gekürzten Pfade. +++

/**
 * Verantwortlichkeit: Enthält die gesamte Logik für die Trainer-Statistiken,
 * Wurfbilder (Shot Charts), Fehlerbilder (Error Charts) und Saison-Archivierung.
 */

(function() {
    
    // Globale Variablen
    var selectedTeamId = localStorage.getItem('selected_team_id');
    var selectedTeamName = localStorage.getItem('selected_team_name');
    var seasonShotData = [];
    var seasonErrorData = [];
    var seasonOpponentShotData = [];
    var seasonActionData = []; // Für den Video-Cutter (wird hier nur geladen)

    // DOM-Elemente
    var seasonStatsTeamName, loadSeasonStatsBtn, seasonStatsMessage, statsContainerFieldSeason, statsContainerGoalieSeason, statsContainerCustomSeason, statsContainerOpponentSeason, archiveNameInput, archiveSeasonBtn, archiveMessageDiv;
    var shotChartPlayerSelect, shotChartOverlay;
    var errorChartPlayerSelect, errorChartOverlay;
    var opponentShotChartOverlay;
    var opponentShotChartGameSelect; 
    var cutterPlayerSelect, cutterActionSelect, cutterGameSelect, cutterPlaylistContainer;


    // ==================================================
    // --- H I L F S F U N K T I O N E N ---
    // ==================================================
    
    function showToast(message, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
        } else {
            console.warn("showToast not global:", message);
        }
    }
    
    function logout() {
        if (typeof window.logout === 'function') {
            window.logout();
        } else {
             window.location.href = "/";
        }
    }
    
    function checkVerification() {
         if (typeof window.checkVerification === 'function') {
            return window.checkVerification();
        }
        return true;
    }

    function formatSeconds(seconds) {
        if (seconds < 0 || isNaN(seconds)) return 'N/A';
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }
    window.formatSeconds = formatSeconds;


    // ==================================================
    // --- R E N D E R - F U N K T I O N E N ---
    // ==================================================
    
    function renderShotChart(selectedPlayerId, overlayElement, dataStore) {
        if (!overlayElement) return;
        overlayElement.innerHTML = '';
        
        let shotsToShow = [];
        if (selectedPlayerId === 'all') {
            dataStore.forEach(playerData => {
                shotsToShow.push(...playerData.shots);
            });
        } else {
            const playerData = dataStore.find(p => p.player_id == selectedPlayerId);
            if (playerData) {
                shotsToShow = playerData.shots;
            }
        }

        if (shotsToShow.length === 0) {
            overlayElement.innerHTML = '<p style="opacity: 0.6; text-align: center; padding-top: 45%; color: black;">Keine Wurfdaten für diese Auswahl.</p>';
            return;
        }

        shotsToShow.forEach(shot => {
            if (shot.x_coordinate === null || shot.y_coordinate === null) return;
            const dot = document.createElement('div');
            const actionClass = shot.action_type.includes('Goal') ? 'goal' : 'miss';
            dot.className = `shot-dot ${actionClass}`;
            dot.style.left = `${shot.x_coordinate}%`;
            dot.style.top = `${shot.y_coordinate}%`;
            dot.title = `Wurf (${actionClass})`;
            overlayElement.appendChild(dot);
        });
    }
    window.renderShotChart = renderShotChart;

    function renderErrorChart(selectedPlayerId, overlayElement, dataStore) {
        if (!overlayElement) return;
        overlayElement.innerHTML = '';
        
        let errorsToShow = [];
        if (selectedPlayerId === 'all') {
            dataStore.forEach(playerData => {
                errorsToShow.push(...playerData.shots); // 'shots' ist hier 'errors'
            });
        } else {
            const playerData = dataStore.find(p => p.player_id == selectedPlayerId);
            if (playerData) {
                errorsToShow = playerData.shots;
            }
        }

        if (errorsToShow.length === 0) {
            overlayElement.innerHTML = '<p style="opacity: 0.6; text-align: center; padding-top: 22%; color: black;">Keine Fehlerdaten für diese Auswahl.</p>';
            return;
        }

        errorsToShow.forEach(error => {
            if (error.x_coordinate === null || error.y_coordinate === null) return;
            const dot = document.createElement('div');
            const actionClass = error.action_type === 'Fehlpass' ? 'tech-error-pass' : 'miss'; 
            dot.className = `shot-dot ${actionClass}`;
            dot.style.left = `${error.x_coordinate}%`;
            dot.style.top = `${error.y_coordinate}%`;
            dot.title = `Fehler (${error.action_type})`;
            overlayElement.appendChild(dot);
        });
    }
    window.renderErrorChart = renderErrorChart;

    function renderOpponentShotChart(overlayElement, dataStore, filterGameId) {
        if (!overlayElement) return;
        overlayElement.innerHTML = '';

        let shotsToShow = dataStore;
        if (filterGameId && filterGameId !== 'all') {
            shotsToShow = dataStore.filter(shot => shot.game_id == filterGameId);
        }

        if (shotsToShow.length === 0) {
            overlayElement.innerHTML = '<p style="opacity: 0.6; text-align: center; padding-top: 45%; color: black;">Keine Gegner-Wurfdaten für diese Auswahl.</p>';
            return;
        }

        shotsToShow.forEach(shot => {
            if (shot.x_coordinate === null || shot.y_coordinate === null) return;
            const dot = document.createElement('div');
            const actionClass = shot.action_type === 'OppGoal' ? 'opp-goal' : 'opp-miss';
            dot.className = `shot-dot ${actionClass}`;
            dot.style.left = `${shot.x_coordinate}%`;
            dot.style.top = `${shot.y_coordinate}%`;
            dot.title = `Gegner-Wurf (${actionClass})`;
            overlayElement.appendChild(dot);
        });
    }
    window.renderOpponentShotChart = renderOpponentShotChart;


    function displaySeasonPlayerStats(stats, containerPrefix) {
        const fieldContainer = document.getElementById(`${containerPrefix}field-season`);
        const goalieContainer = document.getElementById(`${containerPrefix}goalie-season`);
        const customContainer = document.getElementById(`${containerPrefix}custom-season`);
        if (!fieldContainer || !goalieContainer || !customContainer) { console.error("Statistik-Container nicht gefunden. Präfix:", containerPrefix); return; }
        
        let fieldHeaders = [{ key: 'player_name', name: 'Spieler', isFixed: true }, { key: 'player_number', name: '#', isFixed: true },{ key: 'games_played', name: 'Spiele' }, { key: 'time_on_court_display', name: 'Zeit (M:S)' }, { key: 'goals', name: 'Tore (Quote)' }, { key: 'tore_pro_spiel', name: 'Tore/Spiel' }, { key: 'misses', name: 'Fehlwürfe' },{ key: 'tech_errors', name: 'Tech. Fehler / Fehlpässe' }, { key: 'seven_meter_goals', name: '7m Tor' },{ key: 'seven_meter_misses', name: '7m Fehl' }, { key: 'seven_meter_caused', name: '7m Verursacht' }];
        let goalieHeaders = [{ key: 'player_name', name: 'Spieler', isFixed: true }, { key: 'player_number', name: '#', isFixed: true },{ key: 'games_played', name: 'Spiele' }, { key: 'time_on_court_display', name: 'Zeit (M:S)' }, { key: 'saves', name: 'Paraden Ges. (Quote)' }, { key: 'seven_meter_saves', name: '7m-Quote' }];
        
        let fieldTableHtml = `<table class="stats-table"><thead><tr>`;
        fieldHeaders.forEach(h => { fieldTableHtml += `<th>${h.name}</th>`; });
        fieldTableHtml += `</tr></thead><tbody>`;
        let goalieTableHtml = `<table class="stats-table"><thead><tr>`;
        goalieHeaders.forEach(h => { goalieTableHtml += `<th>${h.name}</th>`; });
        goalieTableHtml += `</tr></thead><tbody>`;
        
        let fieldPlayersFound = false, goaliesFound = false;
        let totalGoals = 0, totalShots = 0, totalTechErrors = 0, totalFehlpaesse = 0, totalSevenMeterCaused = 0, totalSevenMeterAttempts = 0, totalSevenMeterGoals = 0, totalGamesPlayed = 0, totalFieldPlayers = 0;
        let totalTimeOnCourt = 0;

        stats.forEach(player => {
            totalTimeOnCourt += player.time_on_court_seconds || 0;
            
            if (player.position === 'Torwart') {
                goaliesFound = true; goalieTableHtml += `<tr>`;
                goalieHeaders.forEach(h => {
                    let value = player[h.key] !== undefined ? player[h.key] : 0;
                    if (h.name === 'Paraden Ges. (Quote)') { const totalSaves = player.saves + player.seven_meter_saves; const totalGoalsReceived = player.opponent_goals_received + player.seven_meter_received; const totalShotsOnGoal = totalSaves + totalGoalsReceived; const quote = totalShotsOnGoal > 0 ? ((totalSaves / totalShotsOnGoal) * 100).toFixed(0) + '%' : '—'; value = `${totalSaves} (${quote})`; }
                    if (h.name === '7m-Quote') { const totalSevenMetersOnGoal = player.seven_meter_saves + player.seven_meter_received; const quote = totalSevenMetersOnGoal > 0 ? ((player.seven_meter_saves / totalSevenMetersOnGoal) * 100).toFixed(0) + '%' : '—'; value = `${player.seven_meter_saves} / ${totalSevenMetersOnGoal} (${quote})`; }
                    if (h.name === 'Tore (Quote)') { const totalShots = player.goals + player.misses + player.seven_meter_goals + player.seven_meter_misses; const totalGoals = player.goals + player.seven_meter_goals; const quote = totalShots > 0 ? ((totalGoals / totalShots) * 100).toFixed(0) + '%' : '—'; value = `${totalGoals} (${quote})`; }
                    if (h.name === 'Tore/Spiel') { if (player.games_played > 0) { const totalGoals = player.goals + player.seven_meter_goals; value = (totalGoals / player.games_played).toFixed(1); } else { value = '0.0'; } }
                    goalieTableHtml += `<td>${value}</td>`;
                });
                goalieTableHtml += `</tr>`;
            } else {
                fieldPlayersFound = true; totalFieldPlayers++; const currentTotalGoals = player.goals + player.seven_meter_goals; const currentTotalShots = currentTotalGoals + player.misses + player.seven_meter_misses;
                fieldTableHtml += `<tr>`;
                fieldHeaders.forEach(h => {
                    let value = player[h.key] !== undefined ? player[h.key] : 0;
                    if (h.name === 'Tore (Quote)') { const quote = currentTotalShots > 0 ? ((currentTotalGoals / currentTotalShots) * 100).toFixed(0) + '%' : '—'; value = `${currentTotalGoals} (${quote})`; }
                    if (h.name === 'Tore/Spiel') { if (player.games_played > 0) { value = (currentTotalGoals / player.games_played).toFixed(1); } else { value = '0.0'; } }
                    if (h.name === 'Fehlwürfe') { value = player.misses + player.seven_meter_misses; }
                    if (h.name === 'Tech. Fehler / Fehlpässe') { value = `${player.tech_errors} / ${player.fehlpaesse}`; }
                    fieldTableHtml += `<td>${value}</td>`;
                });
                fieldTableHtml += `</tr>`;
                totalGoals += currentTotalGoals; totalShots += currentTotalShots; totalTechErrors += player.tech_errors; totalFehlpaesse += player.fehlpaesse; totalSevenMeterCaused += player.seven_meter_caused; totalSevenMeterAttempts += player.seven_meter_goals + player.seven_meter_misses; totalSevenMeterGoals += player.seven_meter_goals; totalGamesPlayed += player.games_played;
            }
        });
        
        const totalShotQuote = totalShots > 0 ? ((totalGoals / totalShots) * 100).toFixed(0) + '%' : '—'; 
        const totalTimeDisplay = formatSeconds(totalTimeOnCourt); 
        const avgGames = totalFieldPlayers > 0 ? (totalGamesPlayed / totalFieldPlayers).toFixed(0) : 0; 
        const avgGoalsPerGame = parseFloat(avgGames) > 0 ? (totalGoals / parseFloat(avgGames)).toFixed(1) : (totalGamesPlayed > 0 ? (totalGoals / totalGamesPlayed).toFixed(1) : "0.0");
        
        fieldTableHtml += `</tbody><tfoot><tr><td>TOTAL TEAM</td><td>-</td><td>${avgGames}</td><td>${totalTimeDisplay}</td><td>${totalGoals} (${totalShotQuote})</td><td>${avgGoalsPerGame}</td><td>${totalShots - totalGoals}</td><td>${totalTechErrors} / ${totalFehlpaesse}</td><td>${totalSevenMeterGoals}</td><td>${totalSevenMeterAttempts - totalSevenMeterGoals}</td><td>${totalSevenMeterCaused}</td></tr></tfoot></table>`;
        goalieTableHtml += `</tbody></table>`;
        fieldContainer.innerHTML = fieldPlayersFound ? fieldTableHtml : '<p style="opacity: 0.6; text-align: center;">Keine Feldspieler im Kader.</p>';
        goalieContainer.innerHTML = goaliesFound ? goalieTableHtml : '<p style="opacity: 0.6; text-align: center;">Keine Torhüter im Kader.</p>';
        const customActionNames = (stats.length > 0 && stats[0].custom_counts) ? Object.keys(stats[0].custom_counts) : [];
        if (customActionNames.length === 0) { customContainer.innerHTML = '<p style="opacity: 0.6; text-align: center;">Keine Team-Aktionen definiert.</p>'; } else {
            let customTableHtml = `<table class="stats-table"><thead><tr><th>Spieler</th><th>#</th><th>Spiele</th>`;
            customActionNames.forEach(name => { customTableHtml += `<th>${name}</th>`; });
            customTableHtml += `</tr></thead><tbody>`;
            stats.forEach(player => {
                if (player.games_played > 0) {
                    customTableHtml += `<tr><td>${player.player_name}</td><td>${player.player_number || ''}</td><td>${player.games_played}</td>`; 
                    customActionNames.forEach(name => { customTableHtml += `<td>${player.custom_counts[name] || 0}</td>`; });
                    customTableHtml += `</tr>`;
                }
            });
            customTableHtml += `</tbody></table>`; customContainer.innerHTML = customTableHtml;
        }
    }
    window.displaySeasonPlayerStats = displaySeasonPlayerStats;

    function displaySeasonOpponentStats(stats, targetContainer) {
        if (!targetContainer) { return; }
        let tableHtml = `<table class="opponent-stats-table"><tbody>
            <tr><td>🟡 Gegner Tore (Gesamt)</td><td>${stats.opponent_goals}</td></tr>
            <tr><td>💨 Gegner Fehlwürfe</td><td>${stats.opponent_misses}</td></tr>
            <tr><td>🚫 Gegner Tech. Fehler</td><td>${stats.opponent_tech_errors}</td></tr>
        </tbody></table>`;
        targetContainer.innerHTML = tableHtml;
    }
    window.displaySeasonOpponentStats = displaySeasonOpponentStats;


    // ==================================================
    // --- L A D E - F U N K T I O N E N ---
    // ==================================================

    /**
     * Lädt alle Spiele und füllt BEIDE Spiel-Filter (Cutter + Gegner-Chart).
     */
    async function loadSeasonGamesFilter() {
        if (!selectedTeamId) return;

        try {
            const response = await fetch(`/games/list/${selectedTeamId}`);
            if (response.status === 401) { logout(); return; }
            if (!response.ok) throw new Error('Saison-Spiele konnten nicht geladen werden.');
            
            const allGames = await response.json();
            
            const seasonGames = allGames.filter(g => g.game_category === 'Saison');
            
            cutterGameSelect.innerHTML = '<option value="all" selected>Alle Saisonspiele</option>';
            opponentShotChartGameSelect.innerHTML = '<option value="all" selected>Alle Saisonspiele</option>';

            if (seasonGames.length > 0) {
                 seasonGames.forEach(game => {
                    const optionHtml = `<option value="${game.id}">vs. ${game.opponent} (${game.date.split('T')[0]})</option>`;
                    cutterGameSelect.innerHTML += optionHtml;
                    opponentShotChartGameSelect.innerHTML += optionHtml;
                });
            }

        } catch (error) {
            console.error("Fehler beim Laden der Saison-Spiele-Filter:", error);
            showToast("Fehler beim Laden der Spiel-Filter.", "error");
        }
    }


    /**
     * Lädt alle Saison-Statistiken und Wurfbilder in einem Rutsch.
     */
    async function loadSeasonStats() {
        if (!selectedTeamId) {
             seasonStatsMessage.textContent = '❌ Fehler: Bitte zuerst Team auswählen.';
             seasonStatsMessage.className = 'message error';
             return;
        }
        seasonStatsMessage.textContent = 'Lade Saison-Statistik...';
        seasonStatsMessage.className = 'message';
        
        // UI reset
        statsContainerOpponentSeason.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade...</p>';
        statsContainerFieldSeason.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade...</p>';
        statsContainerGoalieSeason.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade...</p>';
        statsContainerCustomSeason.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade...</p>';
        
        loadSeasonGamesFilter(); // Lädt Spiele-Filter
        
        try {
            // FIX: Verwendung der korrekten Destrukturierung
            const [
                playerStatsResponse, 
                opponentStatsResponse,
                shotDataResponse,
                errorDataResponse,
                opponentShotDataResponse,
                actionDataResponse
            ] = await Promise.all([
                fetch(`/actions/stats/season/${selectedTeamId}`), 
                fetch(`/actions/stats/opponent/season/${selectedTeamId}`),
                // KORREKTE URLS: Verwenden die neuen, kürzeren Endpunkte
                fetch(`/actions/shots/team/${selectedTeamId}`), 
                fetch(`/actions/errors/team/${selectedTeamId}`), 
                fetch(`/actions/shots/opponent/team/${selectedTeamId}`), 
                fetch(`/actions/clips/season/${selectedTeamId}`) // Der Clips-Endpunkt wurde auch umbenannt!
            ]);

            if (!playerStatsResponse.ok) throw new Error('Spieler-Statistikdaten konnten nicht abgerufen werden.');
            if (!opponentStatsResponse.ok) throw new Error('Gegner-Statistikdaten konnten nicht abgerufen werden.');
            if (!shotDataResponse.ok) throw new Error('Wurfdaten (Eigen) konnten nicht abgerufen werden.');
            if (!errorDataResponse.ok) throw new Error('Fehlerdaten konnten nicht abgerufen werden.');
            if (!opponentShotDataResponse.ok) throw new Error('Wurfdaten (Gegner) konnten nicht abgerufen werden.');
            if (!actionDataResponse.ok) throw new Error('Video Clips konnten nicht abgerufen werden.');


            // 1. STATISTIK-TABELLEN
            const playerStats = await playerStatsResponse.json();
            const opponentStats = await opponentStatsResponse.json();
            displaySeasonPlayerStats(playerStats, 'stats-table-container-');
            displaySeasonOpponentStats(opponentStats, statsContainerOpponentSeason); 
            
            // 2. WURFBILDER
            seasonShotData = await shotDataResponse.json();
            seasonErrorData = await errorDataResponse.json();
            seasonOpponentShotData = await opponentShotDataResponse.json();
            
            // Player Selectors füllen
            populateShotChartDropdown(shotChartPlayerSelect, seasonShotData);
            populateShotChartDropdown(errorChartPlayerSelect, seasonErrorData);
            
            // Charts initial rendern (Standard: Alle Spieler / Alle Spiele)
            renderShotChart('all', shotChartOverlay, seasonShotData);
            renderErrorChart('all', errorChartOverlay, seasonErrorData);
            renderOpponentShotChart(opponentShotChartOverlay, seasonOpponentShotData, 'all');

            // 3. VIDEO-CUTTER DATEN
            seasonActionData = await actionDataResponse.json();
            populateCutterFilters();
            renderCutterPlaylist();
            
            seasonStatsMessage.textContent = '✅ Saison-Statistik erfolgreich geladen.';
            seasonStatsMessage.className = 'message success';
            
        } catch (error) {
            seasonStatsMessage.textContent = '❌ FEHLER beim Laden der Statistik. ' + error.message;
            seasonStatsMessage.className = 'message error';
            console.error("Saison-Statistikfehler:", error);
            // Fallback für Charts
            shotChartPlayerSelect.innerHTML = '<option value="" disabled selected>Fehler</option>';
            errorChartPlayerSelect.innerHTML = '<option value="" disabled selected>Fehler</option>';
        }
    }
    window.loadSeasonStats = loadSeasonStats;

    /**
     * Füllt das Spieler-Dropdown für die Wurfbilder.
     */
    function populateShotChartDropdown(selectElement, dataStore) {
        selectElement.innerHTML = '<option value="all" selected>Alle Spieler</option>';
        dataStore.forEach(playerData => {
            const option = document.createElement('option');
            option.value = playerData.player_id;
            option.textContent = `#${playerData.player_number || '?'} ${playerData.player_name}`;
            selectElement.appendChild(option);
        });
    }

    // ==================================================
    // --- V I D E O - C U T T E R - H I L F E R ---
    // ==================================================

    /**
     * Füllt die Cutter-Filter (Spieler, Aktionen).
     */
    function populateCutterFilters() {
        if (seasonActionData.length === 0) return;

        const players = new Map();
        const actions = new Set();

        seasonActionData.forEach(item => {
            if (item.player_name) {
                players.set(item.player_id, `#${item.player_number || '?'} ${item.player_name}`);
            }
            actions.add(item.action_type);
        });

        // Spieler-Dropdown
        cutterPlayerSelect.innerHTML = '<option value="all" selected>Alle Spieler</option>';
        players.forEach((name, id) => {
            cutterPlayerSelect.innerHTML += `<option value="${id}">${name}</option>`;
        });

        // Aktionen-Dropdown
        cutterActionSelect.innerHTML = '<option value="all" selected>Alle Aktionen</option>';
        actions.forEach(name => {
            cutterActionSelect.innerHTML += `<option value="${name}">${name}</option>`;
        });
    }
    
    /**
     * Rendert die Cutter-Playlist (nutzt die globale playCut Funktion).
     */
    function renderCutterPlaylist() {
        const filterPlayerId = cutterPlayerSelect.value;
        const filterActionType = cutterActionSelect.value;
        const filterGameId = cutterGameSelect.value;

        const filteredData = seasonActionData.filter(item => {
            // NUR Aktionen, die einen Video-Zeitstempel haben
            if (!item.video_timestamp) return false;
            
            const playerMatch = filterPlayerId === 'all' || item.player_id == filterPlayerId;
            const actionMatch = filterActionType === 'all' || item.action_type === filterActionType;
            const gameMatch = filterGameId === 'all' || item.game_id == filterGameId;
            return playerMatch && actionMatch && gameMatch;
        });

        cutterPlaylistContainer.innerHTML = '';
        if (filteredData.length === 0) {
            cutterPlaylistContainer.innerHTML = '<p style="opacity: 0.6; text-align: center; padding: 20px;">Keine Szenen für diese Filterung.</p>';
            return;
        }

        filteredData.forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.className = 'playlist-item';
            itemEl.id = `playlist-item-${item.id}`;
            
            const playerNameDisplay = item.player_name ? `(${item.player_name})` : '';
            
            itemEl.innerHTML = `
                <div>
                    <span class="time">[${item.video_timestamp}]</span>
                    <strong>${item.action_type}</strong> ${playerNameDisplay}
                </div>
                <span class="opponent">Spiel: vs. ${item.game_opponent} (${item.time_in_game})</span>
            `;
            itemEl.onclick = () => {
                if (typeof window.playCut === 'function') {
                    window.playCut(item); 
                } else {
                    showToast("Video-Cutter nicht initialisiert.", "error");
                }
            }; 
            cutterPlaylistContainer.appendChild(itemEl);
        });
    }


    // ==================================================
    // --- A R C H I V I E R U N G ---
    // ==================================================

    async function handleArchiveSeason() {
        if (!checkVerification()) { return; }
        if (!selectedTeamId) return;
        
        const archiveName = archiveNameInput.value.trim();
        if (!archiveName) {
            archiveMessageDiv.textContent = '❌ Bitte einen Namen für das Archiv eingeben.';
            archiveMessageDiv.className = 'message error';
            return;
        }
        
        if (!confirm(`Sind Sie sicher, dass Sie alle "Saison"-Spiele in das Archiv "${archiveName}" verschieben möchten? Diese Aktion kann nicht rückgängig gemacht werden.`)) {
            return;
        }
        
        archiveMessageDiv.textContent = 'Archiviere Saison...';
        archiveMessageDiv.className = 'message';
        archiveSeasonBtn.disabled = true;

        try {
            const response = await fetch(`/games/archive/season/${selectedTeamId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ archive_name: archiveName })
            });
            
            const data = await response.json();
            if (response.status === 401) { logout(); return; }
            if (!response.ok) throw new Error(data.detail || 'Fehler beim Archivieren.');
            
            archiveMessageDiv.textContent = `✅ ${data.message}`;
            archiveMessageDiv.className = 'message success';
            archiveNameInput.value = '';
            
            loadSeasonStats(); // Lädt die neue (leere) Saison-Statistik

        } catch (error) {
            archiveMessageDiv.textContent = `❌ Fehler: ${error.message}`;
            archiveMessageDiv.className = 'message error';
        } finally {
            archiveSeasonBtn.disabled = false;
        }
    }

    // --- Initialisierung ---
    function initTrainerStats() {
        // Zuweisung aller DOM-Elemente
        seasonStatsTeamName = document.getElementById('season-stats-team-name');
        loadSeasonStatsBtn = document.getElementById('load-season-stats-btn');
        seasonStatsMessage = document.getElementById('season-stats-message');
        statsContainerFieldSeason = document.getElementById('stats-table-container-field-season');
        statsContainerGoalieSeason = document.getElementById('stats-table-container-goalie-season');
        statsContainerCustomSeason = document.getElementById('stats-table-container-custom-season');
        statsContainerOpponentSeason = document.getElementById('stats-table-container-opponent-season');
        archiveNameInput = document.getElementById('archive-name-input');
        archiveSeasonBtn = document.getElementById('archive-season-btn');
        archiveMessageDiv = document.getElementById('archive-message');
        shotChartPlayerSelect = document.getElementById('shot-chart-player-select');
        shotChartOverlay = document.getElementById('shot-chart-overlay');
        errorChartPlayerSelect = document.getElementById('error-chart-player-select');
        errorChartOverlay = document.getElementById('error-chart-overlay');
        opponentShotChartOverlay = document.getElementById('opponent-shot-chart-overlay');
        opponentShotChartGameSelect = document.getElementById('opponent-shot-chart-game-select'); 
        cutterPlayerSelect = document.getElementById('cutter-player-select');
        cutterActionSelect = document.getElementById('cutter-action-select');
        cutterGameSelect = document.getElementById('cutter-game-select');
        cutterPlaylistContainer = document.getElementById('cutter-playlist-container');

        console.log("initTrainerStats() wird aufgerufen.");
        
        const storedId = localStorage.getItem('selected_team_id');
        const storedName = localStorage.getItem('selected_team_name');
        
        if (storedId && storedName) {
            selectedTeamId = storedId;
            selectedTeamName = storedName;
            seasonStatsTeamName.textContent = storedName;
            loadSeasonStatsBtn.disabled = false;
            archiveSeasonBtn.disabled = false;
            
            // Initiales Laden direkt starten, wenn Team ausgewählt ist
            loadSeasonStats();
            
        } else {
            seasonStatsTeamName.textContent = "(Team wählen)";
            loadSeasonStatsBtn.disabled = true;
            archiveSeasonBtn.disabled = true;
            
            shotChartPlayerSelect.innerHTML = '<option value="" disabled selected>Team wählen...</option>';
            errorChartPlayerSelect.innerHTML = '<option value="" disabled selected>Team wählen...</option>';
            cutterPlaylistContainer.innerHTML = '<p style="opacity: 0.6; text-align: center; padding: 20px;">Bitte Team wählen...</p>';
            opponentShotChartOverlay.innerHTML = '';
            opponentShotChartGameSelect.innerHTML = '<option value="all" selected>Team wählen...</option>';
        }
        
        // --- Event Listener ---
        
        loadSeasonStatsBtn.addEventListener('click', loadSeasonStats);
        archiveSeasonBtn.addEventListener('click', handleArchiveSeason);

        shotChartPlayerSelect.addEventListener('change', () => {
            renderShotChart(shotChartPlayerSelect.value, shotChartOverlay, seasonShotData);
        });
        errorChartPlayerSelect.addEventListener('change', () => {
            renderErrorChart(errorChartPlayerSelect.value, errorChartOverlay, seasonErrorData);
        });
        
        opponentShotChartGameSelect.addEventListener('change', () => {
            renderOpponentShotChart(opponentShotChartOverlay, seasonOpponentShotData, opponentShotChartGameSelect.value);
        });
        
        cutterPlayerSelect.addEventListener('change', renderCutterPlaylist);
        cutterActionSelect.addEventListener('change', renderCutterPlaylist);
        cutterGameSelect.addEventListener('change', renderCutterPlaylist);
    }

    document.addEventListener('DOMContentLoaded', initTrainerStats);
    
})(); // ENDE IIFE