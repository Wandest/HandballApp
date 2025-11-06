// DATEI: frontend/static/player_dashboard.js
// +++ FIX: Korrigiert die Initialisierung (loadMyStats/loadMyClips) für die Dashboard-Seite. +++
// +++ UPDATE: Implementiert Logik zum AUSBLENDEN der gesamten Statistik-Sektionen (Feldspieler/Torwart) bei fehlenden Daten. +++
// +++ UPDATE: Entkoppelt Video- und Statistik-Laden. +++

(function() {
    
    // Globale Variablen
    var myActionData = []; 
    var myEventsData = []; // Speichert ALLE geladenen Termine
    var currentCalendarFilter = 'week'; // 'week' oder 'all' (wird durch init gesetzt)
    
    // Video Cutter Variablen (unverändert)
    var cutterPlayer = null; 
    var cutterPlayerReady = false; 
    var activePlaylistItem = null; 
    var lastLoadedVideoId = null; 

    // DOM-Elemente
    // Wir verwenden die umschließenden Sektions-Divs, um die Sichtbarkeit zu steuern
    var fieldSection, goalieSection, customSection;
    var statsContainerField, statsContainerGoalie, statsContainerCustom, playerStatsMessage;
    var cutterPlayerSelect, cutterActionSelect, cutterGameSelect, cutterPlaylistContainer, cutterVideoTitle, cutterYouTubePlayerEl;
    var playerCalendarContainer, playerCalendarMessage;
    var tabWeek, tabAll; 

    // ==================================================
    // --- H I L F S F U N K T I O N E N ---
    // ==================================================
    
    function formatSeconds(seconds) {
        if (seconds < 0 || isNaN(seconds)) return 'N/A';
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }
    
    function formatDateTime(dateTimeStr) {
        if (!dateTimeStr) return 'N/A';
        const date = new Date(dateTimeStr);
        return date.toLocaleString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) + ' Uhr';
    }
    
    function showToast(message, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
        } else {
            console.warn("showToast not global:", message);
        }
    }
    
    function logout() {
        fetch('/auth/logout', { method: 'POST' })
        .finally(() => {
            localStorage.clear();
            window.location.href = "/"; 
        });
    }

    function isDeadlinePassed(event) {
        if (event.response_deadline_hours === null || event.response_deadline_hours === undefined || event.response_deadline_hours <= 0) {
            return false;
        }
        
        const startTime = new Date(event.start_time).getTime();
        const deadlineMs = event.response_deadline_hours * 60 * 60 * 1000;
        const deadlineTime = startTime - deadlineMs;
        
        return Date.now() > deadlineTime;
    }


    // ==================================================
    // --- S P I E L E R - K A L E N D E R ---
    // ==================================================
    
    async function loadMyCalendar() {
        if (!playerCalendarContainer) return;
        playerCalendarContainer.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Termine...</p>';
        if (playerCalendarMessage) playerCalendarMessage.textContent = '';
        
        try {
            const response = await fetch('/portal/calendar/list');
            if (response.status === 401) { logout(); return; }
            
            if (!response.ok) {
                 const errorData = await response.json().catch(() => ({ detail: 'Unbekannter Fehler beim Kalenderladen.' }));
                 throw new Error(errorData.detail || `Fehler beim Laden des Kalenders: Status ${response.status}`);
            }

            const events = await response.json();
            
            myEventsData = events; 
            renderMyCalendar(currentCalendarFilter); 
            
        } catch (error) {
            console.error("Fehler beim Laden meines Kalenders:", error);
            if (playerCalendarMessage) {
                playerCalendarMessage.textContent = `❌ ${error.message}`;
                playerCalendarMessage.className = 'message error';
            }
        }
    }
    window.loadMyCalendar = loadMyCalendar; // Muss global sein, da es von player_calendar.html verwendet wird.
    
    function renderMyCalendar(filter) {
        const now = new Date();
        const startOfFilter = new Date(now);
        startOfFilter.setHours(0, 0, 0, 0);
        myEventsData.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
        const endOfFilterWeek = new Date(startOfFilter);
        endOfFilterWeek.setDate(startOfFilter.getDate() + 7);

        let filteredEvents = myEventsData.filter(event => {
            const eventStart = new Date(event.start_time).getTime();
            const eventEnd = event.end_time ? new Date(event.end_time).getTime() : eventStart + 3600000; 
            
            const fiveMinutesAgo = now.getTime() - 5 * 60 * 1000;
            if (eventEnd < fiveMinutesAgo) { 
                return false;
            }
            
            if (filter === 'week') {
                return eventStart < endOfFilterWeek.getTime();
            }
            return true; 
        });
        
        playerCalendarContainer.innerHTML = '';

        if (filteredEvents.length === 0) {
            playerCalendarContainer.innerHTML = `<p style="opacity: 0.6; text-align: center;">Keine Termine für diesen Filter gefunden.</p>`;
            return;
        }

        filteredEvents.forEach(event => {
            const itemEl = document.createElement('div');
            const deadlinePassed = isDeadlinePassed(event); 
            const statusClass = deadlinePassed ? 'deadline-passed' : '';

            itemEl.className = `player-event-item event-type-${event.event_type.replace(' ', '-')} ${statusClass}`;
            itemEl.id = `player-event-${event.id}`;
            
            const startTime = formatDateTime(event.start_time);
            const endTime = event.end_time ? ` - ${formatDateTime(event.end_time)}` : '';
            const location = event.location ? `<br>Ort: ${event.location}` : '';
            const description = event.description ? `<br>Notiz: ${event.description}` : '';
            
            let deadlineHtml = '';
            if (event.response_deadline_hours && event.response_deadline_hours > 0) {
                 const deadlineTime = new Date(new Date(event.start_time).getTime() - (event.response_deadline_hours * 60 * 60 * 1000));
                 const formattedDeadline = formatDateTime(deadlineTime.toISOString());
                 
                 if (deadlinePassed) {
                      deadlineHtml = `<span style="color: #f44336; font-weight: bold;"> (Frist abgelaufen: ${formattedDeadline})</span>`;
                 } else {
                      deadlineHtml = `<br>Frist: ${formattedDeadline}`;
                 }
            }
            
            const statusText = event.my_status.replace('_', ' ');
            const reasonText = event.my_reason ? ` (${event.my_reason})` : '';
            
            itemEl.innerHTML = `
                <div class="player-event-info">
                    <h4>${event.title}</h4>
                    <p>Typ: ${event.event_type}${deadlineHtml}</p>
                    <p>Zeit: ${startTime}${endTime}${location}${description}</p>
                </div>
                <div class="player-event-status">
                    <span id="status-badge-${event.id}" class="status-badge ${event.my_status}">
                        ${statusText}${reasonText}
                    </span>
                    <div class="status-buttons">
                        <button class="btn btn-secondary btn-reason" onclick="respondToEvent(${event.id}, 'TENTATIVE')" ${deadlinePassed ? 'disabled' : ''}>Vielleicht</button>
                        <button class="btn btn-danger" onclick="respondToEvent(${event.id}, 'DECLINED')" ${deadlinePassed ? 'disabled' : ''}>Absagen</button>
                        <button class="btn btn-primary" onclick="respondToEvent(${event.id}, 'ATTENDING')" ${deadlinePassed ? 'disabled' : ''}>Zusagen</button>
                    </div>
                </div>
            `;
            playerCalendarContainer.appendChild(itemEl);
        });
    }

    function setCalendarFilter(filter) {
        currentCalendarFilter = filter;
        const allTabs = document.querySelectorAll('.calendar-tab-button');
        if (allTabs.length > 0) {
            allTabs.forEach(btn => {
                btn.classList.remove('active');
            });
            const activeTab = document.getElementById(`tab-${filter}`);
            if (activeTab) activeTab.classList.add('active');
        }
        renderMyCalendar(filter);
    }
    window.setCalendarFilter = setCalendarFilter; 
    
    async function respondToEvent(eventId, status) {
        const event = myEventsData.find(e => e.id === eventId);
        if (event && isDeadlinePassed(event)) {
             window.showToast("❌ Die Antwortfrist ist abgelaufen. Wende dich an deinen Trainer.", "error");
             return;
        }

        let reason = null;
        if (status === 'DECLINED' || status === 'TENTATIVE') {
            reason = prompt(`Grund für '${status === 'DECLINED' ? 'Absage' : 'Vielleicht'}' (erforderlich):`, '');
            if (!reason) { 
                window.showToast("❌ Ein Grund ist erforderlich.", "error");
                return;
            }
        }
        
        const payload = {
            status: status,
            reason: reason || null
        };
        
        const badge = document.getElementById(`status-badge-${eventId}`);
        if (badge) {
            badge.textContent = 'Speichere...';
            badge.className = 'status-badge NOT_RESPONDED';
        }

        try {
            const response = await fetch(`/portal/calendar/respond/${eventId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (response.status === 401) { logout(); return; }
            const updatedEvent = await response.json();
            
            if (response.status === 403) {
                 window.showToast(`❌ ${updatedEvent.detail || 'Frist abgelaufen.'}`, "error");
                 loadMyCalendar(); 
                 return;
            }
            if (!response.ok) throw new Error('Antwort konnte nicht gespeichert werden.');
            
            if (badge) {
                const statusText = updatedEvent.my_status.replace('_', ' ');
                const reasonText = updatedEvent.my_reason ? ` (${updatedEvent.my_reason})` : '';
                badge.textContent = `${statusText}${reasonText}`;
                badge.className = `status-badge ${updatedEvent.my_status}`;
            }
            window.showToast("Antwort gespeichert!", "success");

            const index = myEventsData.findIndex(e => e.id === eventId);
            if (index !== -1) {
                myEventsData[index].my_status = updatedEvent.my_status;
                myEventsData[index].my_reason = updatedEvent.my_reason;
            }

        } catch (error) {
            console.error("Fehler beim Antworten:", error);
            window.showToast(`❌ ${error.message}`, "error");
            loadMyCalendar(); 
        }
    }
    window.respondToEvent = respondToEvent;


    // ==================================================
    // --- STATISTIK & VIDEO LOGIK ---
    // ==================================================
    
    // KORRIGIERTE FUNKTION
    async function loadMyStats() {
        if (!statsContainerField) return; 

        try {
            // Initialen Ladezustand setzen
            statsContainerField.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade deine Feld-Statistik...</p>';
            statsContainerGoalie.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade deine Torwart-Statistik...</p>';
            statsContainerCustom.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade deine Team-Aktionen...</p>';
            
            const response = await fetch('/portal/stats'); // <- KORRIGIERTER ENDPUNKT
            if (response.status === 401) { logout(); return; }
            
            const stats = await response.json(); // <- NEU: Stats sind jetzt HTML-Strings
            
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

    /**
     * Rendert die Statistiken und BLENDET NICHT-RELEVANTE SEKTIONEN AUS.
     * @param {Object} stats - Die Statistikdaten (mit HTML-Strings vom Backend).
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

    // YouTube Video-ID Extraktion (muss hier drin bleiben)
    function getYouTubeId(url) {
        if (!url) return null;
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    // YouTube Player Initialisierung (muss hier drin bleiben)
    function onYouTubeIframeAPIReady() {
        if (typeof cutterPlayerReady !== 'undefined') cutterPlayerReady = true;
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
        if (cutterYouTubePlayerEl) cutterYouTubePlayerEl.innerHTML = ''; 
        cutterPlayer = new YT.Player('cutter-youtube-player', {
            height: '100%',
            width: '100%',
            videoId: videoId,
            playerVars: { 'playsinline': 1, 'controls': 1 },
        });
    }

    // Konvertiert MM:SS oder HH:MM:SS in Sekunden (muss hier drin bleiben)
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
    
    // Play Cut (muss hier drin bleiben)
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

    function populateCutterFilters() {
        if (myActionData.length === 0) return;

        const games = new Map();
        const actions = new Set();

        myActionData.forEach(item => {
            actions.add(item.action_type);
            games.set(item.game_id, `vs. ${item.game_opponent} (${item.time_in_game})`);
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

    // KORRIGIERTE FUNKTION
    async function loadMyClips() {
        if (!cutterPlaylistContainer) return; 
        cutterPlaylistContainer.innerHTML = '<p style="opacity: 0.6; text-align: center; padding: 20px;">Lade deine Video-Clips...</p>';
        
        try {
            const response = await fetch('/portal/clips'); // <- KORRIGIERTER ENDPUNKT
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
    function initPlayerDashboard() {
        // DOM-Zuweisung
        statsContainerField = document.getElementById('stats-table-container-field-season');
        statsContainerGoalie = document.getElementById('stats-table-container-goalie-season');
        statsContainerCustom = document.getElementById('stats-table-container-custom-season');
        playerStatsMessage = document.getElementById('player-stats-message');
        cutterPlayerSelect = document.getElementById('cutter-player-select');
        cutterActionSelect = document.getElementById('cutter-action-select');
        cutterGameSelect = document.getElementById('cutter-game-select');
        cutterPlaylistContainer = document.getElementById('cutter-playlist-container');
        cutterVideoTitle = document.getElementById('cutter-video-title');
        cutterYouTubePlayerEl = document.getElementById('cutter-youtube-player'); 
        playerCalendarContainer = document.getElementById('player-calendar-container');
        playerCalendarMessage = document.getElementById('player-calendar-message');
        
        // NEUE DOM-Zuweisungen für Sektionen
        fieldSection = document.getElementById('field-stats-section');
        goalieSection = document.getElementById('goalie-stats-section');
        customSection = document.getElementById('custom-stats-section');
        
        // --- Bestimme den Startfilter basierend auf der geladenen Seite ---
        if (window.location.pathname === '/player-calendar') {
            currentCalendarFilter = 'all';
            
            // FÜR player_calendar.html: Tabs aktivieren und alles laden
            if (document.getElementById('tab-week')) {
                document.getElementById('tab-week').classList.remove('active');
            }
            if (document.getElementById('tab-all')) {
                document.getElementById('tab-all').classList.add('active');
            }
            
        } else {
            currentCalendarFilter = 'week';
        }

        console.log("initPlayerDashboard() wird aufgerufen.");
        
        // FIX: Lade nur Statistik/Video auf dem Dashboard (/player-dashboard)
        if (window.location.pathname === '/player-dashboard') {
             loadMyStats();
             loadMyClips();
        }
        
        // Kalender wird auf beiden Seiten geladen
        loadMyCalendar(); 
        
        // Event Listeners
        if (cutterActionSelect) cutterActionSelect.addEventListener('change', renderCutterPlaylist);
        if (cutterGameSelect) cutterGameSelect.addEventListener('change', renderCutterPlaylist);

        // HINWEIS: cutterPlayerSelect wird im Spielerportal nicht verwendet (da nur eigene Clips)
        if (cutterPlayerSelect) cutterPlayerSelect.style.display = 'none';

    }

    document.addEventListener('DOMContentLoaded', initPlayerDashboard);
    
})(); // ENDE IIFE