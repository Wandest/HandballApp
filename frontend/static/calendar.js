// DATEI: frontend/static/calendar.js
// +++ FIX: Korrigiert die DOM-Zuweisungen (IDs) und die Logik zum Senden der Frist +++
// +++ FIX: Korrigiert die Zähl-Logik im Attendance-Modal (nutzt ENUM NAME) +++

(function() {
    
    // Globale Variablen (müssen im IIFE-Scope deklariert werden)
    var selectedTeamId = localStorage.getItem('selected_team_id');
    var selectedTeamName = localStorage.getItem('selected_team_name');

    // DOM-Elemente
    var calendarTeamName, addEventButton, eventMessageDiv, createEventForm;
    var eventTitle, eventType, eventStartTime, eventEndTime, eventLocation, eventDescription;
    var defaultStatusSelect, responseDeadlineInput; 
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
        if (!teamId || teamId === 'null' || teamId === 'undefined') {
            console.warn("loadEvents: Keine gültige team_id ausgewählt. Breche Ladevorgang ab.");
            eventListContainer.innerHTML = '<p style="opacity: 0.6;">Bitte im Team Management ein Team auswählen.</p>';
            if (addEventButton) addEventButton.disabled = true;
            return;
        }
        
        eventListContainer.innerHTML = '<p style="opacity: 0.6;">Lade Termine...</p>';
        if (addEventButton) addEventButton.disabled = false;
        
        try {
            const response = await fetch(`/calendar/list/${teamId}`);
            if (response.status === 401) { window.logout(); return; }
            
            if (!response.ok) {
                let errorMsg = `Status: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.detail || JSON.stringify(errorData);
                } catch (e) {
                    errorMsg = await response.text() || errorMsg;
                }
                throw new Error(errorMsg);
            }
            
            const events = await response.json();
            renderEvents(events);
            
        } catch (error) {
            console.error('Fehler beim Laden der Termine:', error);
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
        
        // Termine nach Startdatum sortieren (aufsteigend)
        events.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
        
        events.forEach(event => {
            const item = document.createElement('div');
            item.className = `event-item event-type-${event.event_type.replace(' ', '-')}`;
            
            const startTime = formatDateTime(event.start_time);
            const endTime = event.end_time ? ` - ${formatDateTime(event.end_time)}` : '';
            const location = event.location ? `<br>Ort: ${event.location}` : '';
            
            let deadlineHtml = '';
            if (event.response_deadline_hours) {
                 deadlineHtml = `<br><span style="color:#ffcc00; font-size:0.9em;">Frist: ${event.response_deadline_hours}h vorher</span>`;
            }

            item.innerHTML = `
                <div class="event-info">
                    <h4>${event.title}</h4>
                    <p>Typ: ${event.event_type}${deadlineHtml}</p>
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
        
        // KORRIGIERTE NULL-PRÜFUNG: Prüft, ob alle Elemente zugewiesen wurden
        if (!window.checkVerification() || !selectedTeamId || !defaultStatusSelect || !responseDeadlineInput) {
             eventMessageDiv.textContent = '❌ Fehler: Formular-Elemente fehlen. Team ausgewählt?';
             eventMessageDiv.className = 'message error';
             addEventButton.disabled = false;
             return;
        }
        
        addEventButton.disabled = true;
        eventMessageDiv.textContent = 'Erstelle Termin...';
        eventMessageDiv.className = 'message';
        
        // --- KORRIGIERTE LOGIK: Felder auslesen ---
        const hoursInput = responseDeadlineInput.value;
        let deadlineHours = null;
        
        if (hoursInput !== "") {
             const parsedHours = parseInt(hoursInput);
             if (isNaN(parsedHours) || parsedHours < 0) {
                 eventMessageDiv.textContent = '❌ Fehler: Absagefrist muss eine positive Zahl (Stunden) sein.';
                 eventMessageDiv.className = 'message error';
                 addEventButton.disabled = false;
                 return;
             }
             deadlineHours = parsedHours;
        } else {
             deadlineHours = null; // Sende null, wenn Feld leer
        }
        // --- ENDE KORRIGIERTE LOGIK ---
        
        const payload = {
            team_id: parseInt(selectedTeamId),
            title: eventTitle.value,
            event_type: eventType.value,
            start_time: eventStartTime.value,
            end_time: eventEndTime.value || null,
            location: eventLocation.value || null,
            description: eventDescription.value || null,
            
            default_status: defaultStatusSelect.value, 
            response_deadline_hours: deadlineHours
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
                 const detail = data.detail ? (Array.isArray(data.detail) ? data.detail.map(d => d.msg).join('; ') : data.detail) : 'Unbekannter Fehler beim Erstellen des Termins.';
                 throw new Error(detail);
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
            
            // --- FIX: ZÄHLLOGIK mit internen ENUM NAMES ---
            let counts = { ATTENDING: 0, DECLINED: 0, TENTATIVE: 0, NOT_RESPONDED: 0, TRAINER: 0 };
            
            attendanceList.innerHTML = '';
            
            attendanceData.forEach(item => {
                const isPlayer = item.status in counts; // Prüft, ob es ein normaler Status ist
                
                if (!isPlayer) {
                    counts.TRAINER++; // Zählt Trainer und Admins
                } else {
                    counts[item.status]++; // Zählt Spielerstatus
                }
                
                const itemEl = document.createElement('div');
                itemEl.className = 'attendance-item';
                
                // Status-Anzeige
                const statusKey = isPlayer ? item.status : 'TRAINER'; 
                const statusMap = {
                    ATTENDING: 'Zugesagt',
                    DECLINED: 'Abgesagt',
                    TENTATIVE: 'Vielleicht',
                    NOT_RESPONDED: 'Keine Antwort',
                    TRAINER: item.status.replace('_', ' ') // Zeigt die Rolle des Trainers an
                };
                
                const reasonHtml = item.reason ? `<span class="attendance-reason">(${item.reason})</span>` : '';
                const numberDisplay = item.player_number ? `#${item.player_number}` : '';

                itemEl.innerHTML = `
                    <span style="${isPlayer ? '' : 'color: #ffcc00;'}">${numberDisplay} <strong>${item.player_name}</strong></span>
                    <span>
                        <span class="attendance-status-${statusKey}">${statusMap[statusKey] || statusKey}</span>
                        ${reasonHtml}
                    </span>
                `;
                attendanceList.appendChild(itemEl);
            });
            
            attendanceModalStats.innerHTML = `
                <span style="color: #38E838;">Zugesagt: ${counts.ATTENDING}</span> | 
                <span style="color: #f44336;">Abgesagt: ${counts.DECLINED}</span> | 
                <span style="color: #ffcc00;">Vielleicht: ${counts.TENTATIVE}</span> | 
                <span style="color: #9e9e9e;">Offen: ${counts.NOT_RESPONDED}</span> |
                <span style="color: #00bcd4;">Trainer/Admin: ${counts.TRAINER}</span>
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
        
        // +++ KORRIGIERTE ZUWEISUNG DER NEUEN ELEMENTE +++
        defaultStatusSelect = document.getElementById('default-status-select');
        responseDeadlineInput = document.getElementById('response-deadline-input');

        console.log("initCalendar() wird aufgerufen.");
        
        // Initialer Ladezustand
        if (selectedTeamId && selectedTeamName && selectedTeamId !== 'null' && selectedTeamName !== 'null') {
            calendarTeamName.textContent = selectedTeamName;
            loadEvents(selectedTeamId);
        } else {
            calendarTeamName.textContent = "(Team wählen)";
            addEventButton.disabled = true;
            eventListContainer.innerHTML = '<p style="opacity: 0.6;">Bitte im Team Management ein Team auswählen.</p>';
        }

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