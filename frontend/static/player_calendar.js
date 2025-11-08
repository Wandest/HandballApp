// DATEI: frontend/static/player_calendar.js
// +++ FINAL FIX: Korrigiert die `disabled` Logik der Buttons und entfernt die Blockierung bei weicher Absage. +++

/**
 * Verantwortlichkeit: Enthält die gesamte Logik für den Spieler-Kalender
 * (Laden der Events, Filtern nach 7 Tagen/Alle, Anwesenheits-Antwort)
 * UND die Logik für den Abwesenheits-Tracker.
 */

(function() {
    
    // Globale Variablen
    var myEventsData = []; // Speichert ALLE geladenen Termine
    var currentCalendarFilter = 'week'; // 'week' oder 'all'

    // DOM-Elemente
    var playerCalendarContainer;
    var playerCalendarMessage;
    
    // NEU: DOM-Elemente für Abwesenheiten
    var addAbsenceForm, absenceReasonSelect, absenceStartDate, absenceEndDate, absenceNotes, absenceMessage, absenceListContainer;


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
    
    function formatDate(dateStr) {
        if (!dateStr) return 'N/A';
        const date = new Date(dateStr);
        return date.toLocaleDateString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
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
        // HINWEIS: playerCalendarContainer ist auf dem Dashboard-Teilnehmer-Screen nicht vorhanden, aber hier auf der vollen Seite schon.
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
            
            // Vergangene Events (älter als 5 Minuten) ausblenden
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
            const isCanceled = event.status === 'CANCELED'; // Prüfen, ob Event abgesagt ist
            
            let statusClass = deadlinePassed ? 'deadline-passed' : '';
            if (isCanceled) {
                 statusClass += ' event-type-Abgesagt'; // Eigener Stil für Absage
            } else {
                 statusClass += ` event-type-${event.event_type.replace(' ', '-')}`;
            }

            itemEl.className = `player-event-item ${statusClass}`;
            
            const startTime = formatDateTime(event.start_time);
            const endTime = event.end_time ? ` - ${formatDateTime(event.end_time)}` : '';
            const location = event.location ? `<br>Ort: ${event.location}` : '';
            
            // Zeige Absage-Grund statt Notiz, wenn abgesagt
            let description = event.description ? `<br>Notiz: ${event.description}` : '';
            if (isCanceled) {
                description = `<br><strong style="color: #f44336;">ABGESAGT: ${event.description || ''}</strong>`;
            }

            let deadlineHtml = '';
            if (event.response_deadline_hours && event.response_deadline_hours > 0 && !isCanceled) {
                 const deadlineTime = new Date(new Date(event.start_time).getTime() - (event.response_deadline_hours * 60 * 60 * 1000));
                 const formattedDeadline = formatDateTime(deadlineTime.toISOString());
                 
                 if (deadlinePassed) {
                      deadlineHtml = `<span style="color: #f44336; font-weight: bold;"> (Frist abgelaufen: ${formattedDeadline})</span>`;
                 } else {
                      deadlineHtml = `<br>Frist: ${formattedDeadline}`;
                 }
            }
            
            // ************ KORRIGIERTER STATUS TEXT ************
            // Übersetzt Status und fügt Grund hinzu
            let statusText;
            let statusValue = event.my_status;
            
            switch (statusValue) {
                case 'ATTENDING': statusText = 'Zugesagt'; break;
                case 'DECLINED': statusText = 'Abgesagt'; break;
                case 'TENTATIVE': statusText = 'Vielleicht'; break;
                case 'NOT_RESPONDED': statusText = 'Keine Antwort'; break;
                default: statusText = statusValue; 
            }

            const reasonText = event.my_reason ? ` (${event.my_reason})` : '';
            // ************ ENDE KORRIGIERTER STATUS TEXT ************
            
            
            // NEU DEFINIERTE DISABLED LOGIK:
            // isEventLocked = Nur sperren, wenn das Event ABSAGE ist oder Frist abgelaufen ist. 
            // Abwesenheits-DECLINED darf manuell überschrieben werden (deshalb ist er nicht gesperrt).
            const isEventLocked = deadlinePassed || isCanceled; 
            const buttonsDisabled = isEventLocked ? 'disabled' : '';

            // KORRIGIERTE STRUKTUR: Trenne Info von Status und Buttons
            itemEl.innerHTML = `
                <div class="player-event-info">
                    <h4 style="color: ${isCanceled ? '#f44336' : '#fff'};">${event.title} (${event.event_type})</h4>
                    <p>Zeit: ${startTime}${endTime}${deadlineHtml}${location}${description}</p>
                </div>
                
                <div class="player-event-status" style="margin-top: 15px; border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 15px; display: flex; justify-content: space-between; align-items: center;">
                    <span id="status-badge-${event.id}" class="status-badge ${event.my_status}">
                        ${statusText}${reasonText}
                    </span>
                    
                    <div class="status-buttons" style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary btn-reason" onclick="respondToEvent(${event.id}, 'TENTATIVE')" ${buttonsDisabled}>Vielleicht</button>
                        <button class="btn btn-danger" onclick="respondToEvent(${event.id}, 'DECLINED')" ${buttonsDisabled}>Absagen</button>
                        <button class="btn btn-primary" onclick="respondToEvent(${event.id}, 'ATTENDING')" ${buttonsDisabled}>Zusagen</button>
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
        
        let reason = null;
        
        // HIER KORRIGIERT: Abwesenheits-Grund wird nur abgefragt, wenn Status NICHT ATTENDING ist.
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

            const index = myEventsData.findIndex(e => e.id === eventId);
            if (index !== -1) {
                myEventsData[index].my_status = updatedEvent.my_status;
                myEventsData[index].my_reason = updatedEvent.my_reason;
            }
            
            renderMyCalendar(currentCalendarFilter);

        } catch (error) {
            console.error("Fehler beim Antworten:", error);
            showToast(`❌ ${error.message}`, "error");
            loadMyCalendar(); 
        }
    }
    window.respondToEvent = respondToEvent;


    // ==================================================
    // --- A B W E S E N H E I T E N (NEU) ---
    // ==================================================

    /**
     * Lädt die Liste der Abwesenheiten vom neuen /absence/list Endpunkt.
     */
    async function loadAbsences() {
        if (!absenceListContainer) return;
        absenceListContainer.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Abwesenheiten...</p>';

        try {
            const response = await fetch('/absence/list');
            if (response.status === 401) { logout(); return; }
            if (!response.ok) throw new Error('Abwesenheiten konnten nicht geladen werden.');
            
            const absences = await response.json();
            renderAbsences(absences);

        } catch (error) {
            absenceListContainer.innerHTML = `<p class="error">Fehler: ${error.message}</p>`;
        }
    }
    window.loadAbsences = loadAbsences;

    /**
     * Rendert die Abwesenheitsliste.
     */
    function renderAbsences(absences) {
        if (!absenceListContainer) return; // WICHTIG: Nur auf der richtigen Seite rendern
        
        absenceListContainer.innerHTML = '';
        if (absences.length === 0) {
            absenceListContainer.innerHTML = '<p style="opacity: 0.6; text-align: center;">Keine Abwesenheiten gemeldet.</p>';
            return;
        }

        absences.forEach(absence => {
            const itemEl = document.createElement('div');
            itemEl.className = 'absence-item';
            
            const startDate = formatDate(absence.start_date);
            const endDate = absence.end_date ? formatDate(absence.end_date) : 'Unbegrenzt';
            
            itemEl.innerHTML = `
                <div class="absence-info">
                    <span class="reason">${absence.reason}</span>
                    <span>${startDate} - ${endDate}</span>
                    <span style="opacity: 0.7; font-style: italic;">${absence.notes || ''}</span>
                </div>
                <button class="btn btn-danger btn-inline-delete" onclick="deleteAbsence(${absence.id})">Löschen</button>
            `;
            absenceListContainer.appendChild(itemEl);
        });
    }

    /**
     * Löscht eine Abwesenheit.
     */
    async function deleteAbsence(absenceId) {
        if (!confirm("Soll diese Abwesenheit wirklich gelöscht werden? (Hinweis: Bereits abgesagte Termine werden nicht automatisch zurückgesetzt.)")) return;
        
        try {
            const response = await fetch(`/absence/delete/${absenceId}`, {
                method: 'DELETE'
            });
            
            if (response.status === 401) { logout(); return; }
            if (response.status === 204) {
                 showToast("Abwesenheit gelöscht.", "success");
                 loadAbsences(); // Liste neu laden
                 loadMyCalendar(); // Kalender auch neu laden
            } else {
                 const data = await response.json();
                 throw new Error(data.detail || 'Fehler beim Löschen');
            }
        } catch (error) {
            showToast(`❌ ${error.message}`, "error");
        }
    }
    window.deleteAbsence = deleteAbsence;

    /**
     * Handler für das Absenden des Abwesenheitsformulars.
     */
    async function handleAddAbsence(event) {
        event.preventDefault();
        
        // Initialisiere die DOM-Elemente für Abwesenheit, falls noch nicht geschehen
        if (!addAbsenceForm) {
            addAbsenceForm = document.getElementById('add-absence-form');
            absenceReasonSelect = document.getElementById('absence-reason');
            absenceStartDate = document.getElementById('absence-start-date');
            absenceEndDate = document.getElementById('absence-end-date');
            absenceNotes = document.getElementById('absence-notes');
            absenceMessage = document.getElementById('absence-message');
            absenceListContainer = document.getElementById('absence-list-container');
        }


        absenceMessage.textContent = 'Speichere...';
        absenceMessage.className = 'message';

        const startDate = absenceStartDate.value;
        const endDate = absenceEndDate.value || null;
        
        if (!startDate) {
             absenceMessage.textContent = '❌ Ein Startdatum ist erforderlich.';
             absenceMessage.className = 'message error';
             return;
        }
        
        if (endDate && (new Date(endDate) < new Date(startDate))) {
             absenceMessage.textContent = '❌ Enddatum muss nach dem Startdatum liegen.';
             absenceMessage.className = 'message error';
             return;
        }

        const payload = {
            start_date: startDate,
            end_date: endDate,
            reason: absenceReasonSelect.value,
            notes: absenceNotes.value || null
        };

        try {
            const response = await fetch('/absence/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 401) { logout(); return; }
            
            if (!response.ok) {
                 const data = await response.json();
                 throw new Error(data.detail || 'Fehler beim Speichern');
            }
            
            showToast("Abwesenheit gespeichert. Kalender wird aktualisiert...", "success");
            absenceMessage.textContent = '✅ Abwesenheit gespeichert.';
            absenceMessage.className = 'message success';
            addAbsenceForm.reset();
            
            // Lade beide Listen neu
            loadAbsences(); 
            loadMyCalendar(); 

        } catch (error) {
            absenceMessage.textContent = `❌ ${error.message}`;
            absenceMessage.className = 'message error';
        }
    }


    // ==================================================
    // --- I N I T I A L I S I E R U N G ---
    // ==================================================
    function initPlayerCalendar() {
        // DOM-Zuweisung (Kalender)
        playerCalendarContainer = document.getElementById('player-calendar-container');
        playerCalendarMessage = document.getElementById('player-calendar-message');
        
        // DOM-Zuweisung (Abwesenheit)
        addAbsenceForm = document.getElementById('add-absence-form');
        // WICHTIG: Prüfen, ob die Elemente existieren, bevor sie zugewiesen werden (nur auf player_calendar.html)
        if (addAbsenceForm) {
            absenceReasonSelect = document.getElementById('absence-reason');
            absenceStartDate = document.getElementById('absence-start-date');
            absenceEndDate = document.getElementById('absence-end-date');
            absenceNotes = document.getElementById('absence-notes');
            absenceMessage = document.getElementById('absence-message');
            absenceListContainer = document.getElementById('absence-list-container');
        }
        
        // Initialer Filter-Status basierend auf der geladenen Seite
        if (window.location.pathname === '/player-calendar') {
            currentCalendarFilter = 'all';
            
            if (document.getElementById('tab-week')) document.getElementById('tab-week').classList.remove('active');
            if (document.getElementById('tab-all')) document.getElementById('tab-all').classList.add('active');
            
        } else {
            currentCalendarFilter = 'week';
        }

        console.log(`initPlayerCalendar() wird aufgerufen (Filter: ${currentCalendarFilter}).`);
        
        // Lade Kalender
        loadMyCalendar(); 
        
        // Lade Abwesenheiten nur, wenn das Formular auf der Seite ist
        if (addAbsenceForm) {
            loadAbsences();
            // Event Listener für das neue Formular
            addAbsenceForm.addEventListener('submit', handleAddAbsence);
        }
    }

    document.addEventListener('DOMContentLoaded', initPlayerCalendar);
    
})(); // ENDE IIFE