// DATEI: frontend/static/player_stats.js

/**
 * Verantwortlichkeit: Enthält die gesamte Logik für die Spieler-Statistiken
 * (Laden, Rendern, Sektions-Steuerung) und die Video-Clips-Playlist.
 */

(function() {
    
    // Globale Variablen
    var myActionData = []; // Speichert ALLE geladenen Clips
    
    // Video Cutter Variablen (aus video_cutter.js)
    var activePlaylistItem = null; 
    
    // DOM-Elemente
    // Wir verwenden die umschließenden Sektions-Divs, um die Sichtbarkeit zu steuern
    var fieldSection, goalieSection, customSection;
    var statsContainerField, statsContainerGoalie, statsContainerCustom, playerStatsMessage;
    var cutterActionSelect, cutterGameSelect, cutterPlaylistContainer;
    
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

    // YouTube Video-ID Extraktion (wird aus global.js/video_cutter.js importiert)
    function playCut(item) {
        if (typeof window.playCut === 'function') {
             window.playCut(item);
        } else {
             showToast("Video-Player-Logik nicht geladen.", "error");
        }
    }


    // ==================================================
    // --- S T A T I S T I K - L O G I K ---
    // ==================================================
    
    /**
     * Lädt die HTML-formatierten persönlichen Statistiken vom Backend.
     */
    async function loadMyStats() {
        if (!statsContainerField) return; 

        try {
            // Initialen Ladezustand setzen
            statsContainerField.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade deine Feld-Statistik...</p>';
            statsContainerGoalie.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade deine Torwart-Statistik...</p>';
            statsContainerCustom.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade deine Team-Aktionen...</p>';
            
            const response = await fetch('/portal/stats');
            if (response.status === 401) { logout(); return; }
            
            const stats = await response.json(); 
            
            if (!response.ok) {
                 const errorMsg = stats.detail || `Fehler beim Laden der Statistik: Status ${response.status}`;
                 throw new Error(errorMsg);
            }
            
            // Setze die Fehler-Nachricht zurück
            if (playerStatsMessage) {
                 playerStatsMessage.textContent = '';
                 playerStatsMessage.className = 'message';
            }

            displayMyStats(stats); // Nutzt die neuen HTML-Daten
            
        } catch (error) {
            console.error("Fehler beim Laden meiner Statistik:", error);
            
            if (playerStatsMessage) {
                 playerStatsMessage.textContent = `❌ ${error.message}`;
                 playerStatsMessage.className = 'message error';
            }
            
            // Bei Fehler: ALLE SEKTIONEN AUSBLENDEN
            if (fieldSection) fieldSection.style.display = 'none';
            if (goalieSection) goalieSection.style.display = 'none';
            if (customSection) customSection.style.display = 'none';
        }
    }
    window.loadMyStats = loadMyStats;

    /**
     * Rendert die Statistiken und BLENDET NICHT-RELEVANTE SEKTIONEN AUS.
     */
    function displayMyStats(stats) {
        
        // --- 1. Feldspieler-Statistik ---
        const fieldData = stats.field_stats || '';
        if (fieldData.trim().includes('<table')) { // Prüfe auf das Vorhandensein einer HTML-Tabelle
            statsContainerField.innerHTML = fieldData;
            if (fieldSection) fieldSection.style.display = 'block';
        } else {
            if (fieldSection) fieldSection.style.display = 'none';
        }

        // --- 2. Torwart-Statistik ---
        const goalieData = stats.goalie_stats || '';
        if (goalieData.trim().includes('<table')) {
            statsContainerGoalie.innerHTML = goalieData;
            if (goalieSection) goalieSection.style.display = 'block';
        } else {
            if (goalieSection) goalieSection.style.display = 'none';
        }
        
        // --- 3. Team-Aktionen Statistik ---
        const customData = stats.custom_stats || '';
        if (customData.trim().includes('<table')) {
            statsContainerCustom.innerHTML = customData;
            if (customSection) customSection.style.display = 'block';
        } else {
            if (customSection) customSection.style.display = 'none';
        }
    }


    // ==================================================
    // --- V I D E O - C L I P S - L O G I K ---
    // ==================================================
    
    /**
     * Füllt die Filter-Dropdowns (Aktion und Spiel).
     */
    function populateCutterFilters() {
        if (myActionData.length === 0) return;

        const games = new Map();
        const actions = new Set();

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

    /**
     * Rendert die Playlist basierend auf den aktuellen Filtern.
     */
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

    /**
     * Lädt alle verfügbaren Video-Clips für den eingeloggten Spieler.
     */
    async function loadMyClips() {
        if (!cutterPlaylistContainer) return; 
        cutterPlaylistContainer.innerHTML = '<p style="opacity: 0.6; text-align: center; padding: 20px;">Lade deine Video-Clips...</p>';
        
        try {
            const response = await fetch('/portal/clips');
            if (response.status === 401) { logout(); return; }
            if (!response.ok) throw new Error('Video-Clips konnten nicht geladen werden.');
            
            myActionData = await response.json(); // Speichert die Daten global
            
            if (myActionData.length > 0) {
                 populateCutterFilters(); 
                 renderCutterPlaylist();
            } else {
                 cutterPlaylistContainer.innerHTML = '<p style="opacity: 0.6; text-align: center; padding: 20px;">Keine Video-Clips gefunden.</p>';
            }
            
        } catch (error) {
            console.error("Fehler beim Laden meiner Clips:", error);
            cutterPlaylistContainer.innerHTML = `<p class="error">Fehler: ${error.message}</p>`;
        }
    }
    window.loadMyClips = loadMyClips;
    
    // --- Initialisierung ---
    function initPlayerStats() {
        // DOM-Zuweisung
        statsContainerField = document.getElementById('stats-table-container-field-season');
        statsContainerGoalie = document.getElementById('stats-table-container-goalie-season');
        statsContainerCustom = document.getElementById('stats-table-container-custom-season');
        playerStatsMessage = document.getElementById('player-stats-message');
        cutterActionSelect = document.getElementById('cutter-action-select');
        cutterGameSelect = document.getElementById('cutter-game-select');
        cutterPlaylistContainer = document.getElementById('cutter-playlist-container');
        
        // NEUE DOM-Zuweisungen für Sektionen
        fieldSection = document.getElementById('field-stats-section');
        goalieSection = document.getElementById('goalie-stats-section');
        customSection = document.getElementById('custom-stats-section');

        // Lade Logik nur auf der Dashboard-Seite
        if (window.location.pathname === '/player-dashboard') {
             loadMyStats();
             loadMyClips();
        }
        
        // Event Listeners für Filter
        if (cutterActionSelect) cutterActionSelect.addEventListener('change', renderCutterPlaylist);
        if (cutterGameSelect) cutterGameSelect.addEventListener('change', renderCutterPlaylist);
    }

    document.addEventListener('DOMContentLoaded', initPlayerStats);
    
})(); // ENDE IIFE