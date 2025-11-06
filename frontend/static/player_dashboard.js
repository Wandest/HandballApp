// DATEI: frontend/static/player_dashboard.js (NEUE DATEI)

(function() {
    
    // Globale Variablen
    var myActionData = []; // Speichert die Clips des Spielers
    var cutterPlayer = null; 
    var cutterPlayerReady = false; 
    var activePlaylistItem = null; 
    var lastLoadedVideoId = null; 

    // DOM-Elemente
    var statsContainerField, statsContainerGoalie, statsContainerCustom, playerStatsMessage;
    var cutterActionSelect, cutterGameSelect, cutterPlaylistContainer, cutterVideoTitle, cutterYouTubePlayerEl;

    // ==================================================
    // --- H I L F S F U N K T I O N E N ---
    // (Wiederverwendet aus season_analysis.js und global.js)
    // ==================================================
    
    function formatSeconds(seconds) {
        if (seconds < 0 || isNaN(seconds)) return 'N/A';
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }
    
    // Wir definieren showToast lokal, falls global.js noch nicht geladen ist
    // (obwohl es sollte, via app_layout.html)
    function showToast(message, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
        } else {
            console.warn("showToast not global:", message);
        }
    }
    
    // Wir definieren logout lokal
    function logout() {
        fetch('/auth/logout', { method: 'POST' })
        .finally(() => {
            localStorage.clear();
            window.location.href = "/"; 
        });
    }

    // ==================================================
    // --- S T A T I S T I K   L O G I K ---
    // ==================================================

    async function loadMyStats() {
        statsContainerField.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade...</p>';
        statsContainerGoalie.innerHTML = '';
        statsContainerCustom.innerHTML = '';
        playerStatsMessage.textContent = 'Lade deine Saison-Statistik...';
        playerStatsMessage.className = 'message';

        try {
            const response = await fetch('/portal/my-stats');
            
            if (response.status === 401 || response.status === 403) { logout(); return; }
            if (!response.ok) throw new Error('Statistikdaten konnten nicht abgerufen werden.');
            
            const myStats = await response.json(); // Kommt als Array mit einem Element
            
            if (myStats.length === 0) {
                 playerStatsMessage.textContent = 'Noch keine Saison-Statistiken für dich erfasst.';
                 playerStatsMessage.className = 'message';
                 statsContainerField.innerHTML = '<p style="opacity: 0.6; text-align: center;">Keine Daten.</p>';
                 return;
            }
            
            playerStatsMessage.textContent = '✅ Statistik erfolgreich geladen.';
            playerStatsMessage.className = 'message success';
            
            // Wir verwenden die exakt gleiche Render-Funktion wie in season_analysis.js
            // (Hier vereinfacht, da wir wissen, dass es nur 1 Spieler ist)
            displayMyStats(myStats); 
            
        } catch (error) {
            playerStatsMessage.textContent = `❌ FEHLER: ${error.message}`;
            playerStatsMessage.className = 'message error';
            statsContainerField.innerHTML = `<p class="error">FEHLER beim Laden der Statistik.</p>`;
            console.error("Meine-Statistikfehler:", error);
        }
    }
    
    function displayMyStats(stats) {
        // Diese Funktion ist eine 1:1 Kopie von displaySeasonPlayerStats aus season_analysis.js,
        // angepasst, um die Container direkt anzusprechen.
        
        let fieldHeaders = ['#', 'Spiele', 'Zeit (M:S)', 'Tore (Quote)', 'Tore/Spiel', 'Fehlwürfe', 'Tech. Fehler / Fehlpässe', '7m Tor', '7m Fehl', '7m Verursacht'];
        let goalieHeaders = ['#', 'Spiele', 'Zeit (M:S)', 'Paraden Ges. (Quote)', '7m-Quote'];
        
        let fieldTableHtml = `<table class="stats-table"><thead><tr>`;
        fieldHeaders.forEach(h => { fieldTableHtml += `<th>${h}</th>`; });
        fieldTableHtml += `</tr></thead><tbody>`;
        
        let goalieTableHtml = `<table class="stats-table"><thead><tr>`;
        goalieHeaders.forEach(h => { goalieTableHtml += `<th>${h}</th>`; });
        goalieTableHtml += `</tr></thead><tbody>`;
        
        let fieldPlayersFound = false, goaliesFound = false;
        
        const player = stats[0]; // Wir haben nur einen Spieler
        
        if (player.position === 'Torwart') {
            goaliesFound = true;
            const totalSaves = player.saves + player.seven_meter_saves; 
            const totalGoalsReceived = player.opponent_goals_received + player.seven_meter_received; 
            const totalShotsOnGoal = totalSaves + totalGoalsReceived; 
            const quote = totalShotsOnGoal > 0 ? ((totalSaves / totalShotsOnGoal) * 100).toFixed(0) + '%' : '—'; 
            const totalSevenMetersOnGoal = player.seven_meter_saves + player.seven_meter_received; 
            const quote7m = totalSevenMetersOnGoal > 0 ? ((player.seven_meter_saves / totalSevenMetersOnGoal) * 100).toFixed(0) + '%' : '—';
            
            goalieTableHtml += `
                <tr>
                    <td>${player.player_number || ''}</td>
                    <td>${player.games_played}</td>
                    <td>${player.time_on_court_display}</td>
                    <td>${totalSaves} (${quote})</td>
                    <td>${player.seven_meter_saves} / ${totalSevenMetersOnGoal} (${quote7m})</td>
                </tr>
            `;
        } else {
            fieldPlayersFound = true;
            const totalGoals = player.goals + player.seven_meter_goals;
            const totalShots = totalGoals + player.misses + player.seven_meter_misses;
            const quote = totalShots > 0 ? ((totalGoals / totalShots) * 100).toFixed(0) + '%' : '—';
            const goalsPerGame = player.games_played > 0 ? (totalGoals / player.games_played).toFixed(1) : '0.0';
            const totalMisses = player.misses + player.seven_meter_misses;

            fieldTableHtml += `
                <tr>
                    <td>${player.player_number || ''}</td>
                    <td>${player.games_played}</td>
                    <td>${player.time_on_court_display}</td>
                    <td>${totalGoals} (${quote})</td>
                    <td>${goalsPerGame}</td>
                    <td>${totalMisses}</td>
                    <td>${player.tech_errors} / ${player.fehlpaesse}</td>
                    <td>${player.seven_meter_goals}</td>
                    <td>${player.seven_meter_misses}</td>
                    <td>${player.seven_meter_caused}</td>
                </tr>
            `;
        }
        
        fieldTableHtml += `</tbody></table>`;
        goalieTableHtml += `</tbody></table>`;
        
        statsContainerField.innerHTML = fieldPlayersFound ? fieldTableHtml : '<p style="opacity: 0.6; text-align: center;">(Keine Feldspieler-Statistik)</p>';
        statsContainerGoalie.innerHTML = goaliesFound ? goalieTableHtml : '<p style="opacity: 0.6; text-align: center;">(Keine Torwart-Statistik)</p>';
        
        const customActionNames = (stats.length > 0 && stats[0].custom_counts) ? Object.keys(stats[0].custom_counts) : [];
        if (customActionNames.length === 0) { 
            statsContainerCustom.innerHTML = '<p style="opacity: 0.6; text-align: center;">Keine Team-Aktionen definiert.</p>'; 
        } else {
            let customTableHtml = `<table class="stats-table"><thead><tr>`;
            customActionNames.forEach(name => { customTableHtml += `<th>${name}</th>`; });
            customTableHtml += `</tr></thead><tbody><tr>`;
            customActionNames.forEach(name => { customTableHtml += `<td>${player.custom_counts[name] || 0}</td>`; });
            customTableHtml += `</tr></tbody></table>`; 
            statsContainerCustom.innerHTML = customTableHtml;
        }
    }


    // ==================================================
    // --- V I D E O - C U T T E R   L O G I K ---
    // (Wiederverwendet aus season_analysis.js)
    // ==================================================
    
    function populateCutterFilters() {
        if (myActionData.length === 0) return;

        const actions = new Set();
        const games = new Map();

        myActionData.forEach(item => {
            actions.add(item.action_type);
            games.set(item.game_id, `vs. ${item.game_opponent}`);
        });

        // Aktionen-Dropdown
        cutterActionSelect.innerHTML = '<option value="all" selected>Alle Aktionen</option>';
        actions.forEach(name => {
            cutterActionSelect.innerHTML += `<option value="${name}">${name}</option>`;
        });
        
        // Spiele-Dropdown
        cutterGameSelect.innerHTML = '<option value="all" selected>Alle Spiele</option>';
        games.forEach((name, id) => {
            cutterGameSelect.innerHTML += `<option value="${id}">${name}</option>`;
        });
    }

    function renderCutterPlaylist() {
        const filterActionType = cutterActionSelect.value;
        const filterGameId = cutterGameSelect.value;

        const filteredData = myActionData.filter(item => {
            const actionMatch = filterActionType === 'all' || item.action_type === filterActionType;
            const gameMatch = filterGameId === 'all' || item.game_id == filterGameId;
            return actionMatch && gameMatch;
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
                </div>
                <span class="opponent">Spiel: vs. ${item.game_opponent} (${item.time_in_game})</span>
            `;
            itemEl.onclick = () => playCut(item); 
            cutterPlaylistContainer.appendChild(itemEl);
        });
    }

    function getYouTubeId(url) {
        if (!url) return null;
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    function onYouTubeIframeAPIReady() {
        cutterPlayerReady = true; 
    }
    window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

    function createPlayer(videoId) {
        if (!cutterPlayerReady) { return; }
        if (cutterPlayer) { cutterPlayer.destroy(); }
        cutterYouTubePlayerEl.innerHTML = ''; 
        cutterPlayer = new YT.Player('cutter-youtube-player', {
            height: '100%', width: '100%',
            videoId: videoId,
            playerVars: { 'playsinline': 1, 'controls': 1 },
        });
    }
    
    function timeToSeconds(timeStr) {
        if (!timeStr) return 0;
        const parts = timeStr.split(':').map(Number);
        let seconds = 0;
        if (parts.length === 3) { seconds += parts[0] * 3600 + parts[1] * 60 + parts[2]; } 
        else if (parts.length === 2) { seconds += parts[0] * 60 + parts[1]; }
        return seconds;
    }

    function playCut(item) {
        if (!item) return;
        const videoId = getYouTubeId(item.game_video_url);
        if (!videoId) {
            showToast("Keine gültige YouTube-URL für dieses Spiel.", "error");
            return;
        }
        if (videoId !== lastLoadedVideoId) {
            if (cutterPlayerReady) { createPlayer(videoId); } 
            else { showToast("YouTube-Player ist noch nicht bereit.", "error"); return; }
            lastLoadedVideoId = videoId;
            cutterVideoTitle.textContent = `Spiel: vs. ${item.game_opponent}`;
        }
        const startTime = timeToSeconds(item.video_timestamp);
        if (cutterPlayer && typeof cutterPlayer.seekTo === 'function') {
            cutterPlayer.seekTo(startTime, true);
            cutterPlayer.playVideo();
            if (activePlaylistItem) { activePlaylistItem.classList.remove('active'); }
            activePlaylistItem = document.getElementById(`playlist-item-${item.id}`);
            if (activePlaylistItem) { activePlaylistItem.classList.add('active'); }
        } else {
             setTimeout(() => playCut(item), 500);
        }
    }
    window.playCut = playCut; // Mache es global für onclick

    async function loadMyClips() {
        cutterPlaylistContainer.innerHTML = '<p style="opacity: 0.6; text-align: center; padding: 20px;">Lade deine Video-Clips...</p>';
        
        try {
            const response = await fetch('/portal/my-clips'); 
            if (response.status === 401) { logout(); return; }
            if (!response.ok) throw new Error(`Clip-Daten konnten nicht geladen werden (Status: ${response.status}).`);
            
            myActionData = await response.json(); 
            
            populateCutterFilters();
            renderCutterPlaylist();
            
        } catch (error) {
            console.error("Fehler beim Laden meiner Clips:", error);
            cutterPlaylistContainer.innerHTML = `<p class="error">Fehler beim Laden der Clip-Daten.</p>`;
        }
    }

    // --- Initialisierung ---
    function initPlayerDashboard() {
        // DOM-Zuweisung
        statsContainerField = document.getElementById('stats-table-container-field-season');
        statsContainerGoalie = document.getElementById('stats-table-container-goalie-season');
        statsContainerCustom = document.getElementById('stats-table-container-custom-season');
        playerStatsMessage = document.getElementById('player-stats-message');
        cutterActionSelect = document.getElementById('cutter-action-select');
        cutterGameSelect = document.getElementById('cutter-game-select');
        cutterPlaylistContainer = document.getElementById('cutter-playlist-container');
        cutterVideoTitle = document.getElementById('cutter-video-title');
        cutterYouTubePlayerEl = document.getElementById('cutter-youtube-player'); 

        console.log("initPlayerDashboard() wird aufgerufen.");
        
        // Lade Daten
        loadMyStats();
        loadMyClips();
        
        // Event Listeners
        cutterActionSelect.addEventListener('change', renderCutterPlaylist);
        cutterGameSelect.addEventListener('change', renderCutterPlaylist);
    }

    document.addEventListener('DOMContentLoaded', initPlayerDashboard);
    
})(); // ENDE IIFE