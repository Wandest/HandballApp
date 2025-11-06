// DATEI: frontend/static/player_calendar.js

/**
 * Verantwortlichkeit: Enthält die gesamte Logik für den Spieler-Kalender
 * (Laden der Events, Filtern nach 7 Tagen/Alle, Anwesenheits-Antwort).
 */

(function() {
    
    // Globale Variablen
    var myEventsData = []; // Speichert ALLE geladenen Termine
    var currentCalendarFilter = 'week'; // 'week' oder 'all'

    // DOM-Elemente
    var playerCalendarContainer;
    var playerCalendarMessage;
    
    // ==================================================
    // --- H I L F S F U N K T I O N E N ---
    // ==================================================
    
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
        if (typeof window.logout === 'function') {
            window.logout();
        } else {
             window.location.href = "/";
        }
    }

    /**
     * Prüft, ob die Antwortfrist für ein Event abgelaufen ist.
     */
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
    // --- K A L E N D E R - L O G I K ---
    // ==================================================
    
    /**
     * Lädt alle Termine des Spielers vom Backend.
     */
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
    window.loadMyCalendar = loadMyCalendar; 
    
    /**
     * Rendert die Termine basierend auf dem aktuellen Filter.
     */
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
            
            // Vergangene Events (ältere als 5 Minuten) ausblenden
            const fiveMinutesAgo = now.getTime() - 5 * 60 * 1000;
            if (eventEnd < fiveMinutesAgo) { 
                return false;
            }
            
            if (filter === 'week') {
                return eventStart < endOfFilterWeek.getTime();
            }
            // filter 'all' zeigt alle zukünftigen/laufenden Events
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
                    <h4>${event.title} (${event.event_type})</h4>
                    <p>Zeit: ${startTime}${endTime}${deadlineHtml}${location}${description}</p>
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

    /**
     * Setzt den Filter und rendert den Kalender neu.
     */
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
    
    /**
     * Sendet die Anwesenheits-Antwort an das Backend.
     */
    async function respondToEvent(eventId, status) {
        const event = myEventsData.find(e => e.id === eventId);
        if (event && isDeadlinePassed(event)) {
             showToast("❌ Die Antwortfrist ist abgelaufen. Wende dich an deinen Trainer.", "error");
             return;
        }

        let reason = null;
        if (status === 'DECLINED' || status === 'TENTATIVE') {
            reason = prompt(`Grund für '${status === 'DECLINED' ? 'Absage' : 'Vielleicht'}' (erforderlich):`, '');
            if (!reason) { 
                showToast("❌ Ein Grund ist erforderlich.", "error");
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
                 showToast(`❌ ${updatedEvent.detail || 'Frist abgelaufen.'}`, "error");
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
            showToast("Antwort gespeichert!", "success");

            // Lokales Event-Daten-Objekt aktualisieren
            const index = myEventsData.findIndex(e => e.id === eventId);
            if (index !== -1) {
                myEventsData[index].my_status = updatedEvent.my_status;
                myEventsData[index].my_reason = updatedEvent.my_reason;
            }

        } catch (error) {
            console.error("Fehler beim Antworten:", error);
            showToast(`❌ ${error.message}`, "error");
            loadMyCalendar(); 
        }
    }
    window.respondToEvent = respondToEvent;


    // ==================================================
    // --- I N I T I A L I S I E R U N G ---
    // ==================================================
    function initPlayerCalendar() {
        // DOM-Zuweisung
        playerCalendarContainer = document.getElementById('player-calendar-container');
        playerCalendarMessage = document.getElementById('player-calendar-message');
        
        // Initialer Filter-Status basierend auf der geladenen Seite
        if (window.location.pathname === '/player-calendar') {
            // Seite 'Alle Termine'
            currentCalendarFilter = 'all';
            
            // Tabs für 'Alle Termine' auf aktiv setzen, falls vorhanden
            if (document.getElementById('tab-week')) document.getElementById('tab-week').classList.remove('active');
            if (document.getElementById('tab-all')) document.getElementById('tab-all').classList.add('active');
            
        } else {
            // Dashboard-Seite (7 Tage Ansicht)
            currentCalendarFilter = 'week';
        }

        console.log(`initPlayerCalendar() wird aufgerufen (Filter: ${currentCalendarFilter}).`);
        loadMyCalendar(); 
    }

    document.addEventListener('DOMContentLoaded', initPlayerCalendar);
    
})(); // ENDE IIFE