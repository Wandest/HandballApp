// DATEI: frontend/static/season_analysis.js
// +++ GEMINI KORREKTUR 3: Spiel-Filter wird jetzt korrekt über eine eigene Funktion geladen,
// anstatt vom Video-Cutter abhängig zu sein.

(function() {
    
    // Globale Variablen
    var selectedTeamId = localStorage.getItem('selected_team_id');
    var selectedTeamName = localStorage.getItem('selected_team_name');
    var seasonShotData = [];
    var seasonErrorData = [];
    var seasonOpponentShotData = [];

    // Globale Variablen für Video-Schnitt-Center
    var seasonActionData = []; 
    var cutterPlayer = null; 
    var cutterPlayerReady = false; 
    var activePlaylistItem = null; 
    var lastLoadedVideoId = null; 

    // DOM-Elemente
    var seasonStatsTeamName, loadSeasonStatsBtn, seasonStatsMessage, statsContainerFieldSeason, statsContainerGoalieSeason, statsContainerCustomSeason, statsContainerOpponentSeason, archiveNameInput, archiveSeasonBtn, archiveMessageDiv;
    var shotChartPlayerSelect, shotChartOverlay;
    var errorChartPlayerSelect, errorChartOverlay;
    var opponentShotChartOverlay;
    var opponentShotChartGameSelect; 
    var cutterPlayerSelect, cutterActionSelect, cutterGameSelect, cutterPlaylistContainer, cutterVideoTitle, cutterYouTubePlayerEl;


    // ==================================================
    // --- H I L F S F U N K T I O N E N ---
    // ==================================================
    
    function formatSeconds(seconds) {
        if (seconds < 0 || isNaN(seconds)) return 'N/A';
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }
    window.formatSeconds = formatSeconds;
    

    // ==================================================
    // --- S H O T   C H A R T   R E N D E R E R ---
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


    // ==================================================
    // --- V I D E O - C U T T E R   L O G I K ---
    // ==================================================
    
    // KORREKTUR: Füllt nur noch Spieler- und Aktionen-Filter
    function populateCutterFilters() {
        if (seasonActionData.length === 0) return;

        const players = new Map();
        const actions = new Set();
        // const games = new Map(); // Game-Logik wurde entfernt und in loadSeasonGamesFilter verschoben

        seasonActionData.forEach(item => {
            if (item.player_name) {
                players.set(item.player_id, `#${item.player_number || '?'} ${item.player_name}`);
            }
            actions.add(item.action_type);
            // games.set(item.game_id, `vs. ${item.game_opponent}`);
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

    function renderCutterPlaylist() {
        const filterPlayerId = cutterPlayerSelect.value;
        const filterActionType = cutterActionSelect.value;
        const filterGameId = cutterGameSelect.value;

        const filteredData = seasonActionData.filter(item => {
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
            itemEl.innerHTML = `
                <div>
                    <span class="time">[${item.video_timestamp}]</span>
                    <strong>${item.action_type}</strong>
                    (${item.player_name || 'Team'})
                </div>
                <span class="opponent">Spiel: vs. ${item.game_opponent} (${item.time_in_game})</span>
            `;
            itemEl.onclick = () => playCut(item); 
            cutterPlaylistContainer.appendChild(itemEl);
        });
    }

    // YouTube Video-ID Extraktion
    function getYouTubeId(url) {
        if (!url) return null;
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    // YouTube Player Initialisierung
    function onYouTubeIframeAPIReady() {
        cutterPlayerReady = true; 
    }
    window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

    function createPlayer(videoId) {
        if (!cutterPlayerReady) {
            console.warn("YouTube API ist noch nicht bereit.");
            return;
        }
        if (cutterPlayer) {
            cutterPlayer.destroy();
        }
        cutterYouTubePlayerEl.innerHTML = ''; 
        cutterPlayer = new YT.Player('cutter-youtube-player', {
            height: '100%',
            width: '100%',
            videoId: videoId,
            playerVars: { 'playsinline': 1, 'controls': 1 },
        });
    }
    
    // Konvertiert MM:SS oder HH:MM:SS in Sekunden
    function timeToSeconds(timeStr) {
        if (!timeStr) return 0;
        const parts = timeStr.split(':').map(Number);
        let seconds = 0;
        if (parts.length === 3) { // HH:MM:SS
            seconds += parts[0] * 3600;
            seconds += parts[1] * 60;
            seconds += parts[2];
        } else if (parts.length === 2) { // MM:SS
            seconds += parts[0] * 60;
            seconds += parts[1];
        }
        return seconds;
    }

    function playCut(item) {
        if (!item) return;

        const videoId = getYouTubeId(item.game_video_url);
        if (!videoId) {
            window.showToast("Keine gültige YouTube-URL für dieses Spiel.", "error");
            return;
        }

        if (videoId !== lastLoadedVideoId) {
            if (cutterPlayerReady) {
                createPlayer(videoId);
            } else {
                window.showToast("YouTube-Player ist noch nicht bereit.", "error");
                return;
            }
            lastLoadedVideoId = videoId;
            cutterVideoTitle.textContent = `Spiel: vs. ${item.game_opponent}`;
        }
        
        const startTime = timeToSeconds(item.video_timestamp);
        
        if (cutterPlayer && typeof cutterPlayer.seekTo === 'function') {
            cutterPlayer.seekTo(startTime, true);
            cutterPlayer.playVideo();
            
            if (activePlaylistItem) {
                activePlaylistItem.classList.remove('active');
            }
            activePlaylistItem = document.getElementById(`playlist-item-${item.id}`);
            if (activePlaylistItem) {
                activePlaylistItem.classList.add('active');
            }
        } else {
             setTimeout(() => playCut(item), 500);
        }
    }
    window.playCut = playCut;

    async function loadSeasonActionData() {
        if (!selectedTeamId) return;
        cutterPlaylistContainer.innerHTML = '<p style="opacity: 0.6; text-align: center; padding: 20px;">Lade Aktionsdaten...</p>';
        
        try {
            const response = await fetch(`/actions/list/season/${selectedTeamId}`); 
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) throw new Error(`Aktions-Rohdaten konnten nicht geladen werden (Status: ${response.status}).`);
            
            seasonActionData = await response.json(); 
            
            populateCutterFilters(); // Füllt Spieler- & Aktionen-Filter
            renderCutterPlaylist();
            
        } catch (error) {
            console.error("Fehler beim Laden der Saison-Aktionen:", error);
            cutterPlaylistContainer.innerHTML = '<p class="error">Fehler beim Laden der Aktionsdaten.</p>';
        }
    }


    // ==================================================
    // --- S T A T I S T I K   L O G I K ---
    // ==================================================
    
    // +++ NEUE FUNKTION +++
    // Lädt alle Spiele und füllt BEIDE Spiel-Filter (Cutter + Gegner-Chart)
    async function loadSeasonGamesFilter() {
        if (!selectedTeamId) return;

        try {
            // Holt *alle* Spiele vom Team
            const response = await fetch(`/games/list/${selectedTeamId}`);
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) throw new Error('Saison-Spiele konnten nicht geladen werden.');
            
            const allGames = await response.json();
            
            // Filtert nur "Saison"-Spiele heraus
            const seasonGames = allGames.filter(g => g.game_category === 'Saison');
            
            // Leere beide Dropdowns
            cutterGameSelect.innerHTML = '<option value="all" selected>Alle Saisonspiele</option>';
            opponentShotChartGameSelect.innerHTML = '<option value="all" selected>Alle Saisonspiele</option>';

            if (seasonGames.length === 0) {
                 // Kein Fehler, nur keine Spiele
                 return;
            }

            // Fülle beide Dropdowns
            seasonGames.forEach(game => {
                const optionHtml = `<option value="${game.id}">vs. ${game.opponent} (${game.date})</option>`;
                cutterGameSelect.innerHTML += optionHtml;
                opponentShotChartGameSelect.innerHTML += optionHtml;
            });

        } catch (error) {
            console.error("Fehler beim Laden der Saison-Spiele-Filter:", error);
            cutterGameSelect.innerHTML = '<option value="all" selected>Fehler</option>';
            opponentShotChartGameSelect.innerHTML = '<option value="all" selected>Fehler</option>';
        }
    }

    async function loadSeasonStats() {
        if (!selectedTeamId) {
             seasonStatsMessage.textContent = '❌ Fehler: Bitte zuerst Team auswählen.';
             seasonStatsMessage.className = 'message error';
             return;
        }
        seasonStatsMessage.textContent = 'Lade Saison-Statistik...';
        seasonStatsMessage.className = 'message';
        statsContainerOpponentSeason.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade...</p>';
        statsContainerFieldSeason.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade...</p>';
        statsContainerGoalieSeason.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade...</p>';
        statsContainerCustomSeason.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade...</p>';
        
        // KORRIGIERTER AUFRUF: Lade die Spielfilter ZUERST
        await loadSeasonGamesFilter();
        
        // Lade den Rest
        loadShotChartData();
        loadErrorChartData();
        loadOpponentShotChartData(); 
        loadSeasonActionData(); // Lädt jetzt nur noch Video-Clips + Spieler/Aktion-Filter

        try {
            const [playerStatsResponse, opponentStatsResponse] = await Promise.all([
                fetch(`/actions/stats/season/${selectedTeamId}`), 
                fetch(`/actions/stats/opponent/season/${selectedTeamId}`)
            ]);
            
            if (playerStatsResponse.status === 401 || opponentStatsResponse.status === 401) { window.logout(); }
            
            if (!playerStatsResponse.ok) throw new Error('Spieler-Statistikdaten konnten nicht abgerufen werden.');
            if (!opponentStatsResponse.ok) throw new Error('Gegner-Statistikdaten konnten nicht abgerufen werden.');
            
            const playerStats = await playerStatsResponse.json();
            const opponentStats = await opponentStatsResponse.json();
            seasonStatsMessage.textContent = '✅ Statistik erfolgreich geladen.';
            seasonStatsMessage.className = 'message success';
            
            displaySeasonPlayerStats(playerStats, 'stats-table-container-');
            displaySeasonOpponentStats(opponentStats, statsContainerOpponentSeason); 
        } catch (error) {
            seasonStatsMessage.textContent = '❌ FEHLER beim Laden der Statistik.';
            seasonStatsMessage.className = 'message error';
            statsContainerFieldSeason.innerHTML = `<p class="error">FEHLER beim Laden der Statistik.</p>`;
            statsContainerOpponentSeason.innerHTML = `<p class="error">FEHLER beim Laden der Statistik.</p>`;
            statsContainerGoalieSeason.innerHTML = '';
            statsContainerCustomSeason.innerHTML = '';
            console.error("Saison-Statistikfehler:", error);
        }
    }
    window.loadSeasonStats = loadSeasonStats;

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
        const totalTimeDisplay = window.formatSeconds(totalTimeOnCourt); 
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
                if (player.position !== 'Torwart' && player.games_played > 0) {
                    customTableHtml += `<tr><td>${player.player_name}</td><td>${player.player_number || ''}</td><td>${player.games_played}</td>`; 
                    customActionNames.forEach(name => { customTableHtml += `<td>${player.custom_counts[name] || 0}</td>`; });
                    customTableHtml += `</tr>`;
                }
            });
            customTableHtml += `</tbody></table>`; customContainer.innerHTML = customTableHtml;
        }
    }
    window.displaySeasonPlayerStats = displaySeasonPlayerStats;


    // ==================================================
    // --- A R C H I V I E R U N G ---
    // ==================================================

    async function handleArchiveSeason() {
        if (!window.checkVerification()) { return; }
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
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) throw new Error(data.detail || 'Fehler beim Archivieren.');
            
            archiveMessageDiv.textContent = `✅ ${data.message}`;
            archiveMessageDiv.className = 'message success';
            archiveNameInput.value = '';
            
            loadSeasonStats(); 

        } catch (error) {
            archiveMessageDiv.textContent = `❌ Fehler: ${error.message}`;
            archiveMessageDiv.className = 'message error';
        } finally {
            archiveSeasonBtn.disabled = false;
        }
    }


    // ==================================================
    // --- S H O T   C H A R T S   L O G I K ---
    // ==================================================
    
    function populateShotChartDropdown(selectElement, dataStore) {
        selectElement.innerHTML = '<option value="all" selected>Alle Spieler</option>';
        dataStore.forEach(playerData => {
            const option = document.createElement('option');
            option.value = playerData.player_id;
            option.textContent = `#${playerData.player_number || '?'} ${playerData.player_name}`;
            selectElement.appendChild(option);
        });
    }

    async function loadShotChartData() {
        if (!selectedTeamId) {
            shotChartPlayerSelect.innerHTML = '<option value="" disabled selected>Team wählen...</option>';
            return;
        }
        shotChartPlayerSelect.innerHTML = '<option value="" disabled selected>Lade Wurfdaten...</option>';
        shotChartOverlay.innerHTML = '';
        try {
            const response = await fetch(`/actions/shots/season/${selectedTeamId}`);
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) throw new Error('Wurfdaten konnten nicht geladen werden.');
            
            seasonShotData = await response.json();
            
            populateShotChartDropdown(shotChartPlayerSelect, seasonShotData);
            renderShotChart('all', shotChartOverlay, seasonShotData);
            
        } catch (error) {
            shotChartPlayerSelect.innerHTML = '<option value="" disabled selected>Fehler beim Laden</option>';
            shotChartOverlay.innerHTML = '<p class="error" style="text-align: center; padding-top: 45%; color: black;">Fehler beim Laden der Wurfdaten.</p>';
            console.error("Shot Chart Error:", error);
        }
    }

    async function loadErrorChartData() {
        if (!selectedTeamId) {
            errorChartPlayerSelect.innerHTML = '<option value="" disabled selected>Team wählen...</option>';
            return;
        }
        errorChartPlayerSelect.innerHTML = '<option value="" disabled selected>Lade Fehlerdaten...</option>';
        errorChartOverlay.innerHTML = '';
        try {
            const response = await fetch(`/actions/shots/errors/season/${selectedTeamId}`);
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) { throw new Error(`Fehlerdaten konnten nicht geladen werden.`); }
            
            seasonErrorData = await response.json(); 
            
            populateShotChartDropdown(errorChartPlayerSelect, seasonErrorData);
            renderErrorChart('all', errorChartOverlay, seasonErrorData);
            
        } catch (error) {
            errorChartPlayerSelect.innerHTML = '<option value="" disabled selected>Fehler beim Laden</option>';
            errorChartOverlay.innerHTML = '<p class="error" style="text-align: center; padding-top: 22%; color: black;">Fehler beim Laden der Fehlerdaten.</p>';
            console.error("Error Chart Error:", error);
        }
    }

    async function loadOpponentShotChartData() {
        if (!selectedTeamId) {
            opponentShotChartOverlay.innerHTML = '';
            return;
        }
        opponentShotChartOverlay.innerHTML = '<p style="opacity: 0.6; text-align: center; padding-top: 45%; color: black;">Lade Gegner-Wurfdaten...</p>';
        try {
            const response = await fetch(`/actions/shots/opponent/season/${selectedTeamId}`);
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) { throw new Error(`Gegner-Wurfdaten konnten nicht geladen werden.`); }
            
            seasonOpponentShotData = await response.json(); 
            
            renderOpponentShotChart(opponentShotChartOverlay, seasonOpponentShotData, 'all');
            
        } catch (error) {
            opponentShotChartOverlay.innerHTML = '<p class="error" style="text-align: center; padding-top: 45%; color: black;">Fehler beim Laden der Gegner-Wurfdaten.</p>';
            console.error("Opponent Shot Chart Error:", error);
        }
    }


    // --- Initialisierung ---
    function initSeasonAnalysis() {
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
        cutterVideoTitle = document.getElementById('cutter-video-title');
        cutterYouTubePlayerEl = document.getElementById('cutter-youtube-player'); 

        console.log("initSeasonAnalysis() wird aufgerufen.");
        
        const storedId = localStorage.getItem('selected_team_id');
        const storedName = localStorage.getItem('selected_team_name');
        
        if (storedId && storedName) {
            selectedTeamId = storedId;
            selectedTeamName = storedName;
            seasonStatsTeamName.textContent = storedName;
            loadSeasonStatsBtn.disabled = false;
            archiveSeasonBtn.disabled = false;
            
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

    document.addEventListener('DOMContentLoaded', initSeasonAnalysis);
    
})(); // ENDE IIFE