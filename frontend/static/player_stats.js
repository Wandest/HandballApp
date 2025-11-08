// DATEI: frontend/static/player_stats.js
// +++ FIX: Präzise Berechnung des Fortschrittsbalkens für Wellness-Slider +++

(function() {
    
    // Globale Variablen
    var myActionData = []; 
    
    // DOM-Elemente
    var fieldSection, goalieSection, customSection;
    var statsContainerField, statsContainerGoalie, statsContainerCustom, playerStatsMessage;
    var cutterActionSelect, cutterGameSelect, cutterPlaylistContainer;
    
    // Wellness DOM-Elemente
    var wellnessForm, sleepQualityInput, muscleSorenessInput, stressLevelInput, sessionRPEInput, wellnessMessageDiv;
    var wellnessStatusIndicator;
    
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

    function playCut(item) {
        if (typeof window.playCut === 'function') {
             window.playCut(item);
        } else {
             showToast("Video-Player-Logik nicht geladen.", "error");
        }
    }
    
    /**
     * Setzt die Skala (1-5 oder 1-10) visuell und aktualisiert die CSS-Variablen für den Fortschrittsbalken.
     * [FIX] Berechnet jetzt den exakten Prozentwert basierend auf min/max.
     */
    function setScaleValue(elementId, value) {
        const input = document.getElementById(elementId);
        if (input) {
             const max = parseFloat(input.max) || 5;
             const min = parseFloat(input.min) || 0;
             const val = parseFloat(value) || min;
             
             // Wenn min == max, vermeiden wir Division durch Null (sollte nicht vorkommen)
             const range = max - min;
             let percent = 0;
             if (range > 0) {
                 percent = ((val - min) / range) * 100;
             }
             
             input.value = val; 
             // Wir setzen die neue CSS Variable --percent
             input.style.setProperty('--percent', `${percent}%`);
        }
        
        const valueSpan = document.getElementById(`${elementId}-value`);
        if (valueSpan) {
             valueSpan.textContent = value;
        }
    }
    window.setScaleValue = setScaleValue; 


    // ==================================================
    // --- W E L L N E S S   L O G I K ---
    // ==================================================
    
    async function loadLatestWellness() {
        if (!wellnessStatusIndicator) return;
        wellnessStatusIndicator.innerHTML = `Lade Status...`;
        wellnessStatusIndicator.className = 'message';
        try {
            const response = await fetch('/athletic/wellness/latest');
            if (response.status === 401) { logout(); return; }
            if (!response.ok) {
                 if (response.status === 404) { throw new Error('Keine bisherigen Logs gefunden.'); }
                 throw new Error('Wellness-Daten konnten nicht geladen werden.');
            }
            const latestLog = await response.json();
            if (latestLog) {
                const loggedDate = new Date(latestLog.logged_at).toDateString();
                const today = new Date().toDateString();
                if (loggedDate === today) {
                    wellnessStatusIndicator.innerHTML = `✅ **Heute geloggt** (${new Date(latestLog.logged_at).toLocaleTimeString()}). Nur ein Eintrag pro Tag erlaubt.`;
                    wellnessStatusIndicator.className = 'message success';
                    if (wellnessForm) wellnessForm.style.pointerEvents = 'none'; 
                } else {
                    wellnessStatusIndicator.innerHTML = `⚠️ Letzter Eintrag vom ${loggedDate}. Logge heute, um Belastung zu tracken.`;
                    wellnessStatusIndicator.className = 'message error';
                    if (wellnessForm) wellnessForm.style.pointerEvents = 'auto';
                }
            } else {
                wellnessStatusIndicator.innerHTML = `⚠️ Keine bisherigen Logs gefunden. Bitte logge heute deinen Zustand.`;
                wellnessStatusIndicator.className = 'message error';
                if (wellnessForm) wellnessForm.style.pointerEvents = 'auto';
            }
        } catch (error) {
             if (error.message.includes('Keine bisherigen Logs')) {
                 wellnessStatusIndicator.innerHTML = `⚠️ Keine bisherigen Logs gefunden. Bitte logge heute deinen Zustand.`;
                 wellnessStatusIndicator.className = 'message error';
             } else {
                 console.error("Fehler beim Laden der Wellness-Daten:", error);
                 wellnessStatusIndicator.innerHTML = `❌ Fehler beim Laden der Daten.`;
                 wellnessStatusIndicator.className = 'message error';
             }
             if (wellnessForm) wellnessForm.style.pointerEvents = 'auto';
        }
    }
    
    async function handleLogWellness(event) {
        event.preventDefault();
        const sleep = parseInt(sleepQualityInput.value);
        const muscle = parseInt(muscleSorenessInput.value);
        const stress = parseInt(stressLevelInput.value);
        const rpeValue = sessionRPEInput.value ? parseInt(sessionRPEInput.value) : null;
        
        if (isNaN(sleep) || isNaN(muscle) || isNaN(stress)) {
             wellnessMessageDiv.textContent = '❌ Bitte alle Pflichtfelder (1-5) ausfüllen.';
             wellnessMessageDiv.className = 'message error';
             return;
        }
        const payload = { sleep_quality: sleep, muscle_soreness: muscle, stress_level: stress, session_rpe: rpeValue };
        wellnessMessageDiv.textContent = 'Speichere Wellness-Daten...';
        wellnessMessageDiv.className = 'message';
        try {
            const response = await fetch('/athletic/wellness/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (response.status === 401) { logout(); return; }
            const data = await response.json();
            if (response.ok) {
                 showToast('✅ Wellness-Eintrag gespeichert!', "success");
                 // Skalen-Displays zurücksetzen (auf Standardwerte 3 bzw. 5)
                 setScaleValue('sleep-quality-input', 3);
                 setScaleValue('muscle-soreness-input', 3);
                 setScaleValue('stress-level-input', 3);
                 setScaleValue('session-rpe-input', 5);
                 loadLatestWellness(); 
            } else {
                 throw new Error(data.detail || 'Fehler beim Speichern des Logs.');
            }
        } catch (error) {
            wellnessMessageDiv.textContent = `❌ ${error.message}`;
            wellnessMessageDiv.className = 'message error';
        }
    }

    // ==================================================
    // --- S T A T I S T I K   &   C L I P S ---
    // ==================================================
    
    async function loadMyStats() {
        if (!statsContainerField) return; 
        try {
            statsContainerField.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade deine Feld-Statistik...</p>';
            statsContainerGoalie.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade deine Torwart-Statistik...</p>';
            statsContainerCustom.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade deine Team-Aktionen...</p>';
            const response = await fetch('/portal/stats');
            if (response.status === 401) { logout(); return; }
            const stats = await response.json(); 
            if (!response.ok) throw new Error(stats.detail || `Fehler beim Laden der Statistik.`);
            if (playerStatsMessage) { playerStatsMessage.textContent = ''; playerStatsMessage.className = 'message'; }
            displayMyStats(stats); 
        } catch (error) {
            if (playerStatsMessage) { playerStatsMessage.textContent = `❌ ${error.message}`; playerStatsMessage.className = 'message error'; }
            if (fieldSection) fieldSection.style.display = 'none';
            if (goalieSection) goalieSection.style.display = 'none';
            if (customSection) customSection.style.display = 'none';
        }
    }

    function displayMyStats(stats) {
        if (fieldSection) fieldSection.style.display = 'block';
        if (goalieSection) goalieSection.style.display = 'block';
        if (customSection) customSection.style.display = 'block';
        statsContainerField.innerHTML = stats.field_stats || '<p style="opacity: 0.6; text-align: center;">Keine Feldspieler-Statistik vorhanden.</p>';
        statsContainerGoalie.innerHTML = stats.goalie_stats || '<p style="opacity: 0.6; text-align: center;">Keine Torwart-Statistik vorhanden.</p>';
        statsContainerCustom.innerHTML = stats.custom_stats || '<p style="opacity: 0.6; text-align: center;">Keine Team-Aktionen getrackt.</p>';
        if (!stats.field_stats) fieldSection.style.display = 'none';
        if (!stats.goalie_stats) goalieSection.style.display = 'none';
        if (!stats.custom_stats) customSection.style.display = 'none';
    }
    
    async function loadMyClips() {
        if (!cutterPlaylistContainer) return;
        cutterPlaylistContainer.innerHTML = '<p style="opacity: 0.6; text-align: center; padding: 20px;">Lade deine Video-Clips...</p>';
        try {
            const response = await fetch('/portal/clips');
            if (response.status === 401) { logout(); return; }
            const data = await response.json(); 
            if (!response.ok) throw new Error(data.detail || `Fehler beim Laden der Clips.`);
            myActionData = data; 
            if (typeof window.initVideoCutter === 'function') { window.initVideoCutter(); }
            populateCutterFilters();
            renderCutterPlaylist();
        } catch (error) {
            cutterPlaylistContainer.innerHTML = `<p class="error">❌ Fehler: ${error.message}</p>`;
        }
    }

    function populateCutterFilters() {
        if (myActionData.length === 0) return;
        const actions = new Set();
        const games = new Map();
        myActionData.forEach(item => {
            actions.add(item.action_type);
            games.set(item.game_id, item.game_opponent);
        });
        if (cutterGameSelect.options.length <= 1) {
             cutterGameSelect.innerHTML = '<option value="all" selected>Alle Spiele</option>';
             games.forEach((opponent, id) => { cutterGameSelect.innerHTML += `<option value="${id}">vs. ${opponent}</option>`; });
        }
        if (cutterActionSelect.options.length <= 1) {
             cutterActionSelect.innerHTML = '<option value="all" selected>Alle Aktionen</option>';
             actions.forEach(action => { cutterActionSelect.innerHTML += `<option value="${action}">${action}</option>`; });
        }
    }

    function renderCutterPlaylist() {
        if (!cutterActionSelect || !cutterGameSelect || !cutterPlaylistContainer) return;
        const filterActionType = cutterActionSelect.value;
        const filterGameId = cutterGameSelect.value;
        const filteredData = myActionData.filter(item => {
            if (!item.video_timestamp) return false;
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
            const playerNameDisplay = item.player_name ? `(${item.player_name})` : '';
            itemEl.innerHTML = `<div><span class="time">[${item.video_timestamp}]</span><strong>${item.action_type}</strong> ${playerNameDisplay}</div><span class="opponent">Spiel: vs. ${item.game_opponent} (${item.time_in_game})</span>`;
            itemEl.onclick = () => playCut(item); 
            cutterPlaylistContainer.appendChild(itemEl);
        });
    }
    window.renderCutterPlaylist = renderCutterPlaylist; 

    // --- Initialisierung ---
    function initPlayerStats() {
        statsContainerField = document.getElementById('stats-table-container-field-season');
        statsContainerGoalie = document.getElementById('stats-table-container-goalie-season');
        statsContainerCustom = document.getElementById('stats-table-container-custom-season');
        playerStatsMessage = document.getElementById('player-stats-message');
        fieldSection = document.getElementById('field-stats-section');
        goalieSection = document.getElementById('goalie-stats-section');
        customSection = document.getElementById('custom-stats-section');
        cutterActionSelect = document.getElementById('cutter-action-select');
        cutterGameSelect = document.getElementById('cutter-game-select');
        cutterPlaylistContainer = document.getElementById('cutter-playlist-container');
        wellnessForm = document.getElementById('wellness-form');
        sleepQualityInput = document.getElementById('sleep-quality-input');
        muscleSorenessInput = document.getElementById('muscle-soreness-input');
        stressLevelInput = document.getElementById('stress-level-input');
        sessionRPEInput = document.getElementById('session-rpe-input');
        wellnessMessageDiv = document.getElementById('wellness-message');
        wellnessStatusIndicator = document.getElementById('wellness-status-indicator');

        if (window.location.pathname === '/player-dashboard') {
             loadMyStats(); loadMyClips(); loadLatestWellness(); 
             if (wellnessForm) {
                 [sleepQualityInput, muscleSorenessInput, stressLevelInput, sessionRPEInput].forEach(input => {
                    if (input) { input.addEventListener('input', () => setScaleValue(input.id, input.value)); }
                 });
                 wellnessForm.addEventListener('submit', handleLogWellness);
             }
             // Initiale Werte setzen
             if (sleepQualityInput) setScaleValue('sleep-quality-input', sleepQualityInput.value);
             if (muscleSorenessInput) setScaleValue('muscle-soreness-input', muscleSorenessInput.value);
             if (stressLevelInput) setScaleValue('stress-level-input', stressLevelInput.value);
             if (sessionRPEInput) setScaleValue('session-rpe-input', sessionRPEInput.value);
             
             if (cutterActionSelect) cutterActionSelect.addEventListener('change', renderCutterPlaylist);
             if (cutterGameSelect) cutterGameSelect.addEventListener('change', renderCutterPlaylist);
        }
    }
    document.addEventListener('DOMContentLoaded', initPlayerStats);
})();