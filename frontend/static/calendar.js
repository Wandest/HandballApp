// DATEI: frontend/static/calendar.js (KORRIGIERT: Behebt 404-Fehler bei leerer Team-ID)

(function() {
    
    // Globale Variablen
    var selectedTeamId = localStorage.getItem('selected_team_id');
    var selectedTeamName = localStorage.getItem('selected_team_name');

    // DOM-Elemente
    var calendarTeamName, addEventButton, eventMessageDiv, createEventForm;
    var eventTitle, eventType, eventStartTime, eventEndTime, eventLocation, eventDescription;
    var eventListContainer;
    var attendanceModal, attendanceModalTitle, attendanceModalStats, attendanceList;

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

    // ==================================================
    // --- L A D E N   &   A N Z E I G E N ---
    // ==================================================

    async function loadEvents(teamId) {
        
        // --- KORREKTUR: Robuste Schutzprüfung (Guard Clause) ---
        // Verhindert API-Aufrufe mit "null", "undefined" oder leeren Strings
        if (!teamId || teamId === 'null' || teamId === 'undefined') {
            console.warn("loadEvents: Keine gültige team_id ausgewählt. Breche Ladevorgang ab.");
            eventListContainer.innerHTML = '<p style="opacity: 0.6;">Bitte im Team Management ein Team auswählen.</p>';
            if (addEventButton) addEventButton.disabled = true; // Sicherstellen, dass der Button deaktiviert ist
            return;
        }
        // --- ENDE KORREKTUR ---

        eventListContainer.innerHTML = '<p style="opacity: 0.6;">Lade Termine...</p>';
        if (addEventButton) addEventButton.disabled = false; // Team ist gültig, Button aktivieren
        
        try {
            const response = await fetch(`/calendar/list/${teamId}`);
            if (response.status === 401) { window.logout(); return; }

            // --- KORREKTUR: Detailliertere Fehlerbehandlung ---
            if (!response.ok) {
                let errorMsg = `Status: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.detail || JSON.stringify(errorData);
                } catch (e) {
                    // Fallback, wenn response.json() fehlschlägt
                    errorMsg = await response.text() || errorMsg;
                }
                // Werfe einen Fehler mit der sauberen Server-Nachricht
                throw new Error(errorMsg);
            }
            // --- ENDE KORREKTUR ---
            
            const events = await response.json();
            renderEvents(events);
            
        } catch (error) {
            console.error('Fehler beim Laden der Termine:', error);
            // Zeigt jetzt die saubere Fehlermeldung statt [object Response]
            eventListContainer.innerHTML = `<p class="error">Fehler: ${error.message}</p>`;
        }
    }
    window.loadEvents = loadEvents;

    function renderEvents(events) {
        eventListContainer.innerHTML = '';
        if (events.length === 0) {
            eventListContainer.innerHTML = '<p style="opacity: 0.6;">Keine Termine für dieses Team erstellt.</p>';
            return;
        }
        
        // Sortiere Events, neueste zuerst (oder asc() im Backend)
        events.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
        
        events.forEach(event => {
            const item = document.createElement('div');
            // KORREKTUR (aus deinem Upload übernommen): event.event_type ist ein String
            item.className = `event-item event-type-${event.event_type.replace(' ', '-')}`;
            
            const startTime = formatDateTime(event.start_time);
            const endTime = event.end_time ? ` - ${formatDateTime(event.end_time)}` : '';
            const location = event.location ? `<br>Ort: ${event.location}` : '';

            item.innerHTML = `
                <div class="event-info">
                    <h4>${event.title}</h4>
                    <p>Typ: ${event.event_type}</p>
                    <p>Zeit: ${startTime}${endTime}${location}</p>
                </div>
                <div class="event-actions">
                    <button class="btn btn-info btn-inline" onclick="showAttendance(${event.id}, '${event.title.replace(/'/g, "\\'")}')">Anwesenheit</button>
                    <button class="btn btn-danger btn-inline-delete" onclick="deleteEvent(${event.id})">Löschen</button>
                </div>
            `;
            eventListContainer.appendChild(item);
        });
    }

    // ==================================================
    // --- T E R M I N - E R S T E L L U N G ---
    // ==================================================

    async function handleCreateEvent(event) {
        event.preventDefault();
        // KORREKTUR: Prüfe auf selectedTeamId, *bevor* checkVerification aufgerufen wird
        if (!selectedTeamId || selectedTeamId === 'null' || !window.checkVerification()) {
            eventMessageDiv.textContent = '❌ Bitte zuerst ein Team auswählen.';
            eventMessageDiv.className = 'message error';
            return;
        }
        
        addEventButton.disabled = true;
        eventMessageDiv.textContent = 'Erstelle Termin...';
        eventMessageDiv.className = 'message';
        
        const payload = {
            team_id: parseInt(selectedTeamId),
            title: eventTitle.value,
            event_type: eventType.value, // "Training", "Spiel", "Sonstiges"
            start_time: eventStartTime.value,
            end_time: eventEndTime.value || null,
            location: eventLocation.value || null,
            description: eventDescription.value || null
        };

        try {
            const response = await fetch('/calendar/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (response.status === 401) { window.logout(); return; }
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.detail || 'Fehler beim Erstellen des Termins.');
            }
            
            window.showToast('✅ Termin erfolgreich erstellt.', 'success');
            eventMessageDiv.textContent = '✅ Termin erfolgreich erstellt.';
            eventMessageDiv.className = 'message success';
            createEventForm.reset();
            loadEvents(selectedTeamId);
            
        } catch (error) {
            console.error('Fehler beim Erstellen des Termins:', error);
            eventMessageDiv.textContent = `❌ ${error.message}`;
            eventMessageDiv.className = 'message error';
        } finally {
            addEventButton.disabled = false;
        }
    }

    async function deleteEvent(eventId) {
        if (!window.checkVerification()) return;
        if (!confirm('Sind Sie sicher, dass Sie diesen Termin löschen möchten? Alle Anwesenheitsdaten gehen verloren.')) return;

        try {
            const response = await fetch(`/calendar/delete/${eventId}`, {
                method: 'DELETE'
            });
            
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Fehler beim Löschen.');
            }
            
            window.showToast('✅ Termin gelöscht.', 'success');
            loadEvents(selectedTeamId);
            
        } catch (error) {
            console.error('Fehler beim Löschen:', error);
            window.showToast(`❌ ${error.message}`, 'error');
        }
    }
    window.deleteEvent = deleteEvent;

    // ==================================================
    // --- A N W E S E N H E I T ---
    // ==================================================
    
    function closeAttendanceModal() {
        if (attendanceModal) {
            attendanceModal.style.display = 'none';
        }
    }
    window.closeAttendanceModal = closeAttendanceModal;

    async function showAttendance(eventId, eventTitleStr) {
        attendanceModal.style.display = 'block';
        attendanceModalTitle.textContent = `Anwesenheit für: ${eventTitleStr}`;
        attendanceList.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Anwesenheitsliste...</p>';
        attendanceModalStats.textContent = '';
        
        try {
            const response = await fetch(`/calendar/attendance/${eventId}`);
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) throw new Error('Anwesenheit konnte nicht geladen werden.');
            
            const attendanceData = await response.json();
            
            let attending = 0;
            let declined = 0;
            let tentative = 0;
            let notResponded = 0;
            
            attendanceList.innerHTML = '';
            
            if (attendanceData.length === 0) {
                 attendanceList.innerHTML = '<p style="opacity: 0.6;">Keine Spieler im Team für diesen Termin.</p>';
                 return;
            }

            attendanceData.forEach(item => {
                const itemEl = document.createElement('div');
                itemEl.className = 'attendance-item';
                
                // +++ KORREKTUR (aus deinem Upload übernommen): item.status ist ein String +++
                const statusKey = item.status; 
                const statusValue = statusKey.replace("_", " "); // z.B. "NOT RESPONDED"
                const statusClass = `attendance-status-${statusKey}`; 
                // +++ ENDE KORREKTUR +++

                const reasonHtml = item.reason ? `<span class="attendance-reason">(${item.reason})</span>` : '';
                
                itemEl.innerHTML = `
                    <span>#${item.player_number || '?'} <strong>${item.player_name}</strong></span>
                    <span>
                        <span class="${statusClass}">${statusValue}</span>
                        ${reasonHtml}
                    </span>
                `;
                attendanceList.appendChild(itemEl);
                
                // +++ KORREKTUR (aus deinem Upload übernommen): Vergleiche mit dem String-Wert +++
                if (statusKey === 'ATTENDING') attending++;
                else if (statusKey === 'DECLINED') declined++;
                else if (statusKey === 'TENTATIVE') tentative++;
                else notResponded++;
            });
            
            attendanceModalStats.innerHTML = `
                <span style="color: #38E838;">Zugesagt: ${attending}</span> | 
                <span style="color: #f44336;">Abgesagt: ${declined}</span> | 
                <span style="color: #ffcc00;">Vielleicht: ${tentative}</span> | 
                <span style="color: #9e9e9e;">Offen: ${notResponded}</span>
            `;
            
        } catch (error) {
            console.error('Fehler beim Laden der Anwesenheit:', error);
            attendanceList.innerHTML = `<p class="error">${error.message}</p>`;
        }
    }
    window.showAttendance = showAttendance;

    // ==================================================
    // --- I N I T I A L I S I E R U N G ---
    // ==================================================
    function initCalendar() {
        // DOM-Zuweisung
        calendarTeamName = document.getElementById('calendar-team-name');
        addEventButton = document.getElementById('add-event-button');
        eventMessageDiv = document.getElementById('event-message');
        createEventForm = document.getElementById('create-event-form');
        eventTitle = document.getElementById('event-title');
        eventType = document.getElementById('event-type');
        eventStartTime = document.getElementById('event-start-time');
        eventEndTime = document.getElementById('event-end-time');
        eventLocation = document.getElementById('event-location');
        eventDescription = document.getElementById('event-description');
        eventListContainer = document.getElementById('event-list-container');
        attendanceModal = document.getElementById('attendance-modal');
        attendanceModalTitle = document.getElementById('attendance-modal-title');
        attendanceModalStats = document.getElementById('attendance-modal-stats');
        attendanceList = document.getElementById('attendance-list');

        console.log("initCalendar() wird aufgerufen.");
        
        // Globale Variablen neu aus LocalStorage lesen (für den Fall, dass sie sich geändert haben)
        selectedTeamId = localStorage.getItem('selected_team_id');
        selectedTeamName = localStorage.getItem('selected_team_name');
        
        // --- KORREKTUR: Robuste Prüfung beim Initialisieren ---
        if (selectedTeamId && selectedTeamName && selectedTeamId !== 'null' && selectedTeamName !== 'null') {
            calendarTeamName.textContent = selectedTeamName;
            // addEventButton.disabled = false; // Wird jetzt von loadEvents() gesteuert
            loadEvents(selectedTeamId);
        } else {
            calendarTeamName.textContent = "(Team wählen)";
            addEventButton.disabled = true;
            eventListContainer.innerHTML = '<p style="opacity: 0.6;">Bitte im Team Management ein Team auswählen.</p>';
        }
        // --- ENDE KORREKTUR ---

        // Event Listeners
        if(createEventForm) {
            createEventForm.addEventListener('submit', handleCreateEvent);
        }
        
        if(attendanceModal) {
            attendanceModal.addEventListener('click', function(event) {
                if (event.target == attendanceModal) {
                    closeAttendanceModal();
                }
            });
        }
    }

    document.addEventListener('DOMContentLoaded', initCalendar);
    
})(); // ENDE IIFE