// DATEI: frontend/static/calendar.js
// +++ NEU: Logik zur Trennung von anstehenden und vergangenen Terminen (Tabs) +++

(function() {
    
    // Globale Variablen
    var selectedTeamId = localStorage.getItem('selected_team_id');
    var selectedTeamName = localStorage.getItem('selected_team_name');
    var currentTeamDeadlines = {}; 
    var currentEventToCancel = null; 
    var allEventsCache = []; // Speichert alle Events für schnelles Filtern

    // DOM-Elemente
    var calendarTeamName, addEventButton, eventMessageDiv, createEventForm;
    var eventTitle, eventType, eventStartTime, eventEndTime, eventLocation, eventDescription;
    var defaultStatusSelect, responseDeadlineInput; 
    
    // NEU: Container für Listen und Tabs
    var eventListContainer, pastEventListContainer, tabBtnUpcoming, tabBtnPast;
    
    var attendanceModal, attendanceModalTitle, attendanceModalStats, attendanceList;
    
    // Regeltermine
    var isRecurringCheckbox, recurringOptionsDiv, repeatFrequencySelect, repeatUntilInput, repeatIntervalInput;

    // Bearbeiten-Modal
    var editEventModal, editEventForm, editEventId, editEventTitle, editEventType, editEventStartTime, editEventEndTime, editEventLocation, editEventDescription, editDefaultStatusSelect, editResponseDeadlineInput, editMessageDiv, editModalTitle;
    
    // Absage-Modal
    var cancelEventModal, cancelEventModalTitle, cancelReasonInput, confirmCancelButton, cancelMessageDiv;


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

    function getDefaultDeadline(eventType) {
        if (!currentTeamDeadlines) return 0;
        
        if (eventType === 'Training') return currentTeamDeadlines.training_deadline_hours || 0;
        if (eventType === 'Spiel') return currentTeamDeadlines.game_deadline_hours || 0;
        if (eventType === 'Turnier') return currentTeamDeadlines.tournament_deadline_hours || 0;
        if (eventType === 'Testspiel') return currentTeamDeadlines.testspiel_deadline_hours || 0;
        if (eventType === 'Sonstiges') return currentTeamDeadlines.other_deadline_hours || 0;
        
        return 0;
    }
    
    // ==================================================
    // --- A N W E S E N H E I T - M O D A L ---
    // ==================================================

    function closeAttendanceModal() {
        if (attendanceModal) attendanceModal.style.display = 'none';
    }
    window.closeAttendanceModal = closeAttendanceModal; // Global machen

    async function showAttendance(eventId, eventTitle) {
        if (!attendanceModal) return;
        
        attendanceModalTitle.textContent = `Anwesenheit für: ${eventTitle}`;
        attendanceModalStats.textContent = 'Lade Anwesenheit...';
        attendanceList.innerHTML = '';
        attendanceModal.style.display = 'block';

        try {
            const response = await fetch(`/calendar/attendance/${eventId}`);
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) throw new Error('Anwesenheitsliste konnte nicht geladen werden.');
            
            const attendanceData = await response.json();
            
            renderAttendanceList(attendanceData);

        } catch (error) {
            attendanceModalStats.textContent = `❌ Fehler: ${error.message}`;
            attendanceModalStats.className = 'message error';
        }
    }
    window.showAttendance = showAttendance; // Global machen

    function renderAttendanceList(attendanceData) {
        attendanceList.innerHTML = '';
        let attending = 0;
        let declined = 0;
        let tentative = 0;
        let noResponse = 0;
        let staffCount = 0;

        attendanceData.forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.className = 'attendance-item';
            
            const number = item.player_number ? `#${item.player_number}` : '';
            const reason = item.reason ? `<span class="attendance-reason">(${item.reason})</span>` : '';
            
            let statusText = item.status;
            let statusClass = `attendance-status-${item.status}`;
            
            if (item.status === 'ATTENDING') { attending++; }
            else if (item.status === 'DECLINED') { declined++; }
            else if (item.status === 'TENTATIVE') { tentative++; }
            else if (item.status === 'NOT_RESPONDED') { noResponse++; }
            else { 
                statusClass = `attendance-status-${item.status}`; 
                statusText = item.status.replace('_', ' '); 
                staffCount++;
            }

            itemEl.innerHTML = `
                <span>${number} <strong>${item.player_name}</strong></span>
                <span class="${statusClass}">${statusText} ${reason}</span>
            `;
            attendanceList.appendChild(itemEl);
        });

        attendanceModalStats.textContent = `Zusagen: ${attending} | Absagen: ${declined} | Vielleicht: ${tentative} | Keine Antwort: ${noResponse} | Staff: ${staffCount}`;
    }


    // ==================================================
    // --- L A D E N   &   A N Z E I G E N ---
    // ==================================================

    async function loadEvents(teamId) {
        if (!teamId || teamId === 'null' || teamId === 'undefined') {
            eventListContainer.innerHTML = '<p style="opacity: 0.6;">Bitte im Team Management ein Team auswählen.</p>';
            if (addEventButton) addEventButton.disabled = true;
            return;
        }
        
        eventListContainer.innerHTML = '<p style="opacity: 0.6;">Lade Termine...</p>';
        pastEventListContainer.innerHTML = '<p style="opacity: 0.6;">Lade vergangene Termine...</p>';
        if (addEventButton) addEventButton.disabled = false;
        
        await loadTeamDeadlines(teamId); 

        try {
            const response = await fetch(`/calendar/list/${teamId}`);
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) throw new Error('Terminliste konnte nicht geladen werden.');
            
            allEventsCache = await response.json();
            
            // Initiales Rendern (Standard-Tab ist 'upcoming')
            switchCalendarView('upcoming');
            
        } catch (error) {
            console.error('Fehler beim Laden der Termine:', error);
            eventListContainer.innerHTML = `<p class="error">Fehler: ${error.message}</p>`;
        }
    }
    window.loadEvents = loadEvents;


    async function loadTeamDeadlines(teamId) {
        try {
            const response = await fetch(`/teams/settings/${teamId}`);
            if (response.status === 401) { window.logout(); return; }
            
            if (response.status === 404) {
                 currentTeamDeadlines = {};
                 responseDeadlineInput.value = 0;
                 return;
            }
            if (!response.ok) throw new Error("Deadlines konnten nicht geladen werden.");

            const settings = await response.json();
            currentTeamDeadlines = settings;
            
            const selectedType = eventType.value;
            responseDeadlineInput.value = getDefaultDeadline(selectedType);

        } catch (error) {
            console.error('Fehler beim Laden der Standard-Deadlines:', error);
            currentTeamDeadlines = {}; 
            responseDeadlineInput.value = 0;
        }
    }

    // NEU: Logik zum Umschalten der Tabs
    function switchCalendarView(view) {
        if (view === 'upcoming') {
            tabBtnUpcoming.classList.add('active');
            tabBtnPast.classList.remove('active');
            eventListContainer.classList.add('active');
            pastEventListContainer.classList.remove('active');
            renderEvents(allEventsCache, 'upcoming');
        } else {
            tabBtnUpcoming.classList.remove('active');
            tabBtnPast.classList.add('active');
            eventListContainer.classList.remove('active');
            pastEventListContainer.classList.add('active');
            renderEvents(allEventsCache, 'past');
        }
    }
    window.switchCalendarView = switchCalendarView;


    function renderEvents(events, filter) {
        let targetContainer = (filter === 'upcoming') ? eventListContainer : pastEventListContainer;
        
        targetContainer.innerHTML = '';
        const now = new Date();
        
        let filteredEvents = [];
        
        if (filter === 'upcoming') {
            // Anstehend: Alle, deren Startzeit noch nicht vorbei ist (oder gerade läuft)
            // (Wir geben 1 Stunde Puffer, falls ein Training noch läuft)
            const cutoffTime = now.getTime() - (60 * 60 * 1000); 
            
            filteredEvents = events.filter(e => new Date(e.start_time).getTime() >= cutoffTime);
            // Sortierung: Anstehende zuerst (aufsteigend)
            filteredEvents.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
        } else {
            // Vergangen: Alle, deren Startzeit bereits vorbei ist
            const cutoffTime = now.getTime() - (60 * 60 * 1000);
            
            filteredEvents = events.filter(e => new Date(e.start_time).getTime() < cutoffTime);
            // Sortierung: Neueste vergangene zuerst (absteigend)
            filteredEvents.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
        }

        if (filteredEvents.length === 0) {
            targetContainer.innerHTML = `<p style="opacity: 0.6;">Keine Termine in dieser Ansicht.</p>`;
            return;
        }
        
        filteredEvents.forEach(event => {
            const isCanceled = event.status === 'CANCELED';
            const statusClass = isCanceled ? 'event-type-Abgesagt' : `event-type-${event.event_type.replace(' ', '-')}`;
            const statusLabel = isCanceled ? 'ABGESAGT' : event.event_type;
            const statusColor = isCanceled ? '#f44336' : (event.event_type === 'Training' ? '#00bcd4' : (event.event_type === 'Spiel' ? '#38E838' : '#607d8b'));

            const item = document.createElement('div');
            // Füge 'past-event' Klasse hinzu, wenn im Vergangen-Tab
            item.className = `event-item ${statusClass} ${filter === 'past' ? 'past-event' : ''}`;
            item.style.borderLeftColor = statusColor; 

            const startTime = formatDateTime(event.start_time);
            const endTime = event.end_time ? ` - ${formatDateTime(event.end_time)}` : '';
            const location = event.location ? `<br>Ort: ${event.location}` : '';
            
            let deadlineHtml = '';
            if (event.response_deadline_hours && filter === 'upcoming' && !isCanceled) {
                 deadlineHtml = `<br><span style="color:#ffcc00; font-size:0.9em;">Frist: ${event.response_deadline_hours}h vorher</span>`;
            }

            let isRecurringEvent = event.end_time && (new Date(event.end_time).getDate() !== new Date(event.start_time).getDate() || new Date(event.end_time).getMonth() !== new Date(event.start_time).getMonth());
            
            const isRecurringDisplay = isRecurringEvent ? ' (Regeltermin)' : '';
            const recurringClass = isRecurringEvent ? 'recurring' : '';

            // Buttons anpassen
            let editButton = (isCanceled || filter === 'past')
                ? `<button class="btn btn-secondary btn-inline" disabled title="Abgesagte/Vergangene Termine können nicht bearbeitet werden.">Bearbeiten</button>` 
                : `<button class="btn btn-secondary btn-inline" onclick="openEditModal(${event.id})">Bearbeiten</button>`;
                
            let cancelButton = isCanceled
                ? `<button class="btn btn-info btn-inline" onclick="openReactivateModal(${event.id}, '${event.title.replace(/'/g, "\\'")}')">Reaktivieren</button>`
                : `<button class="btn btn-danger btn-inline" onclick="openCancelModal(${event.id}, '${event.title.replace(/'/g, "\\'")}')">Absagen</button>`;

            // Vergangene Termine können nicht abgesagt werden
            if (filter === 'past' && !isCanceled) {
                cancelButton = `<button class="btn btn-danger btn-inline" disabled title="Vergangene Termine können nicht abgesagt werden.">Absagen</button>`;
            }

            item.innerHTML = `
                <div class="event-info">
                    <h4 class="${recurringClass}" style="color: ${isCanceled ? '#f44336' : '#fff'};">${event.title}${isRecurringDisplay}</h4>
                    <p>Status: <strong>${statusLabel}</strong>${deadlineHtml}</p>
                    <p>Zeit: ${startTime}${endTime}${location}</p>
                </div>
                <div class="event-actions">
                    <button class="btn btn-info btn-inline" onclick="showAttendance(${event.id}, '${event.title.replace(/'/g, "\\'")}')">Anwesenheit</button>
                    ${editButton}
                    ${cancelButton}
                    <button class="btn btn-danger btn-inline-delete" onclick="deleteEvent(${event.id})" title="Termin endgültig löschen">Löschen</button>
                </div>
            `;
            targetContainer.appendChild(item);
        });
    }


    // ==================================================
    // --- T E R M I N - C R U D (unverändert) ---
    // ==================================================

    async function handleCreateEvent(event) {
        event.preventDefault();
        
        if (!window.checkVerification() || !selectedTeamId) {
             eventMessageDiv.textContent = '❌ Fehler: Team nicht ausgewählt oder Konto nicht verifiziert.';
             eventMessageDiv.className = 'message error';
             addEventButton.disabled = false;
             return;
        }
        
        addEventButton.disabled = true;
        eventMessageDiv.textContent = 'Erstelle Termin...';
        eventMessageDiv.className = 'message';
        
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
             deadlineHours = null;
        }
        
        const isRecurring = isRecurringCheckbox.checked;
        let repeatUntilValue = null;
        let repeatFrequency = null;
        let repeatInterval = null; 

        if (isRecurring) {
            repeatUntilValue = repeatUntilInput.value;
            repeatFrequency = repeatFrequencySelect.value;
            repeatInterval = parseInt(repeatIntervalInput.value) || 1; 
            
            if (!repeatUntilValue) {
                 eventMessageDiv.textContent = '❌ Fehler: Für Regeltermine muss ein Enddatum gewählt werden.';
                 eventMessageDiv.className = 'message error';
                 addEventButton.disabled = false;
                 return;
            }
            if (repeatInterval <= 0) {
                 eventMessageDiv.textContent = '❌ Fehler: Wiederholungsintervall muss größer als 0 sein.';
                 eventMessageDiv.className = 'message error';
                 addEventButton.disabled = false;
                 return;
            }
        }
        
        if (!eventStartTime.value) {
            eventMessageDiv.textContent = '❌ Fehler: Startzeit ist erforderlich.';
            eventMessageDiv.className = 'message error';
            addEventButton.disabled = false;
            return;
        }


        const payload = {
            team_id: parseInt(selectedTeamId),
            title: eventTitle.value,
            event_type: eventType.value,
            start_time: eventStartTime.value,
            end_time: eventEndTime.value || null,
            location: eventLocation.value || null,
            description: eventDescription.value || null,
            default_status: defaultStatusSelect.value, 
            response_deadline_hours: deadlineHours,
            
            is_recurring: isRecurring,
            repeat_until: repeatUntilValue ? new Date(repeatUntilValue + 'T23:59:59').toISOString() : null,
            repeat_frequency: repeatFrequency,
            repeat_interval: repeatInterval
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
            
            const count = Array.isArray(data) ? data.length : 1;
            window.showToast(`✅ ${count} Termin(e) erfolgreich erstellt.`, "success");
            eventMessageDiv.textContent = `✅ ${count} Termin(e) erfolgreich erstellt.`;
            eventMessageDiv.className = 'message success';
            createEventForm.reset();
            
            if(isRecurringCheckbox) isRecurringCheckbox.checked = false;
            if(recurringOptionsDiv) recurringOptionsDiv.style.display = 'none';
            if(repeatIntervalInput) repeatIntervalInput.value = 1; 

            loadEvents(selectedTeamId); // Lädt neu und rendert (Standard: upcoming)
            
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
        if (!confirm('Sind Sie sicher, dass Sie diesen Termin endgültig löschen möchten? Alle Anwesenheitsdaten gehen verloren.')) return;

        try {
            const response = await fetch(`/calendar/delete/${eventId}`, {
                method: 'DELETE'
            });
            
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Fehler beim Löschen.');
            }
            
            window.showToast('✅ Termin gelöscht.', "success");
            loadEvents(selectedTeamId);
            
        } catch (error) {
            console.error('Fehler beim Löschen:', error);
            window.showToast(`❌ ${error.message}`, "error");
        }
    }
    window.deleteEvent = deleteEvent;
    
    // ... (openEditModal, handleEditEvent, closeCancelModal, openCancelModal, handleCancelEvent, openReactivateModal unverändert) ...
    function closeEditModal() {
        editEventModal.style.display = 'none';
        editMessageDiv.textContent = '';
    }
    window.closeEditModal = closeEditModal;

    async function openEditModal(eventId) {
        // ... (Logik unverändert) ...
        editMessageDiv.textContent = 'Lade Event-Daten...';
        editEventModal.style.display = 'block';

        try {
            const event = allEventsCache.find(e => e.id === eventId);
            
            if (!event) throw new Error('Termin nicht gefunden.');
            
            if (event.status === 'CANCELED') {
                closeEditModal();
                window.showToast("Abgesagte Termine können nicht bearbeitet werden.", "error");
                return;
            }

            const formatForInput = (dt) => {
                 if (!dt) return '';
                 const date = new Date(dt);
                 return date.toISOString().substring(0, 16);
            };

            editEventId.value = event.id;
            editEventTitle.value = event.title;
            editEventType.value = event.event_type;
            editEventStartTime.value = formatForInput(event.start_time);
            editEventEndTime.value = event.end_time ? formatForInput(event.end_time) : '';
            editEventLocation.value = event.location || '';
            editEventDescription.value = event.description || '';
            editDefaultStatusSelect.value = event.default_status;
            editResponseDeadlineInput.value = event.response_deadline_hours || 0;

            editMessageDiv.textContent = '';
            editModalTitle.textContent = `Termin bearbeiten: ${event.title}`;

        } catch (error) {
            editMessageDiv.textContent = `❌ Fehler beim Laden: ${error.message}`;
            editMessageDiv.className = 'message error';
        }
    }
    window.openEditModal = openEditModal;
    
    async function handleEditEvent(event) {
        // ... (Logik unverändert) ...
        event.preventDefault();
        if (!window.checkVerification()) return;
        
        const eventId = editEventId.value;
        const saveButton = document.getElementById('save-edit-button');

        saveButton.disabled = true;
        editMessageDiv.textContent = 'Speichere Änderungen...';
        editMessageDiv.className = 'message';
        
        const hoursInput = editResponseDeadlineInput.value;
        let deadlineHours = null;
        
        if (hoursInput !== "") {
             const parsedHours = parseInt(hoursInput);
             if (isNaN(parsedHours) || parsedHours < 0) {
                 editMessageDiv.textContent = '❌ Fehler: Frist muss eine positive Zahl (Stunden) sein.';
                 editMessageDiv.className = 'message error';
                 saveButton.disabled = false;
                 return;
             }
             deadlineHours = parsedHours;
        }
        
        const payload = {
            title: editEventTitle.value,
            event_type: editEventType.value,
            start_time: editEventStartTime.value,
            end_time: editEventEndTime.value || null,
            location: editEventLocation.value || null,
            description: editEventDescription.value || null,
            default_status: editDefaultStatusSelect.value, 
            response_deadline_hours: deadlineHours
        };
        
        try {
            const response = await fetch(`/calendar/update/${eventId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            
            if (response.status === 401) { window.logout(); return; }
            
            if (!response.ok) {
                const detail = data.detail ? (Array.isArray(data.detail) ? data.detail.map(d => d.msg).join('; ') : data.detail) : 'Unbekannter Fehler beim Bearbeiten des Termins.';
                throw new Error(detail);
            }
            
            window.showToast('✅ Termin erfolgreich aktualisiert.', "success");
            editMessageDiv.textContent = '✅ Termin erfolgreich aktualisiert.';
            editMessageDiv.className = 'message success';
            loadEvents(selectedTeamId);
            setTimeout(closeEditModal, 1500);

        } catch (error) {
            console.error('Fehler beim Bearbeiten des Termins:', error);
            editMessageDiv.textContent = `❌ ${error.message}`;
            editMessageDiv.className = 'message error';
        } finally {
            saveButton.disabled = false;
        }
    }

    function closeCancelModal() {
        cancelEventModal.style.display = 'none';
        cancelMessageDiv.textContent = '';
        currentEventToCancel = null;
    }
    window.closeCancelModal = closeCancelModal;

    function openCancelModal(eventId, title) {
        currentEventToCancel = eventId;
        cancelEventModalTitle.textContent = `Termin absagen: ${title}`;
        cancelReasonInput.value = '';
        cancelMessageDiv.textContent = '';
        cancelEventModal.style.display = 'block';
    }
    window.openCancelModal = openCancelModal;

    async function handleCancelEvent() {
        // ... (Logik unverändert) ...
        if (!window.checkVerification() || !currentEventToCancel) return;
        
        confirmCancelButton.disabled = true;
        cancelMessageDiv.textContent = 'Sende Absage...';
        cancelMessageDiv.className = 'message';
        
        const reason = cancelReasonInput.value || null;
        
        try {
            const response = await fetch(`/calendar/cancel/${currentEventToCancel}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cancel_reason: reason })
            });
            
            const data = await response.json();
            
            if (response.status === 401) { window.logout(); return; }
            
            if (!response.ok) {
                const detail = data.detail || 'Unbekannter Fehler bei der Absage.';
                throw new Error(detail);
            }
            
            window.showToast('✅ Termin wurde abgesagt.', "success");
            cancelMessageDiv.textContent = '✅ Absage erfolgreich.';
            cancelMessageDiv.className = 'message success';
            
            loadEvents(selectedTeamId);
            setTimeout(closeCancelModal, 1500);

        } catch (error) {
            console.error('Fehler beim Absagen des Termins:', error);
            cancelMessageDiv.textContent = `❌ ${error.message}`;
            cancelMessageDiv.className = 'message error';
        } finally {
            confirmCancelButton.disabled = false;
        }
    }
    
    async function openReactivateModal(eventId, title) {
         if (!window.checkVerification()) return;
         if (!confirm(`Soll der Termin "${title}" wirklich reaktiviert werden? Die Anwesenheiten werden auf den Standard zurückgesetzt.`)) return;

        try {
            const response = await fetch(`/calendar/update/${eventId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'PLANNED' }) 
            });

            const data = await response.json();
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) throw new Error(data.detail || 'Fehler beim Reaktivieren.');
            
            window.showToast('✅ Termin wurde reaktiviert.', "success");
            loadEvents(selectedTeamId);

        } catch (error) {
            console.error('Fehler beim Reaktivieren:', error);
            window.showToast(`❌ ${error.message}`, "error");
        }
    }
    window.openReactivateModal = openReactivateModal;

    // ==================================================
    // --- I N I T I A L I S I E R U N G ---
    // ==================================================
    function initCalendar() {
        // DOM-Zuweisung (Erstellung)
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
        
        // NEU: Listen-Container
        eventListContainer = document.getElementById('event-list-container');
        pastEventListContainer = document.getElementById('past-event-list-container');
        tabBtnUpcoming = document.getElementById('tab-btn-upcoming');
        tabBtnPast = document.getElementById('tab-btn-past');
        
        attendanceModal = document.getElementById('attendance-modal');
        attendanceModalTitle = document.getElementById('attendance-modal-title');
        attendanceModalStats = document.getElementById('attendance-modal-stats');
        attendanceList = document.getElementById('attendance-list');
        defaultStatusSelect = document.getElementById('default-status-select');
        responseDeadlineInput = document.getElementById('response-deadline-input');
        
        // DOM-Zuweisung (Absage)
        cancelEventModal = document.getElementById('cancel-event-modal');
        cancelEventModalTitle = document.getElementById('cancel-modal-title');
        cancelReasonInput = document.getElementById('cancel-reason-input');
        confirmCancelButton = document.getElementById('confirm-cancel-button');
        cancelMessageDiv = document.getElementById('cancel-message');

        // DOM-Zuweisung (Regeltermine)
        isRecurringCheckbox = document.getElementById('is-recurring-checkbox');
        recurringOptionsDiv = document.getElementById('recurring-options');
        repeatFrequencySelect = document.getElementById('repeat-frequency-select');
        repeatUntilInput = document.getElementById('repeat-until');
        repeatIntervalInput = document.getElementById('repeat-interval-input'); 
        
        // DOM-Zuweisung (Bearbeiten)
        editEventModal = document.getElementById('edit-event-modal');
        editEventForm = document.getElementById('edit-event-form');
        editEventId = document.getElementById('edit-event-id');
        editEventTitle = document.getElementById('edit-event-title');
        editEventType = document.getElementById('edit-event-type');
        editEventStartTime = document.getElementById('edit-event-start-time');
        editEventEndTime = document.getElementById('edit-event-end-time');
        editEventLocation = document.getElementById('edit-event-location');
        editEventDescription = document.getElementById('edit-event-description');
        editDefaultStatusSelect = document.getElementById('edit-default-status-select');
        editResponseDeadlineInput = document.getElementById('edit-response-deadline-input');
        editMessageDiv = document.getElementById('edit-message');
        editModalTitle = document.getElementById('edit-modal-title');


        console.log("initCalendar() wird aufgerufen.");
        
        // Initialer Ladezustand
        selectedTeamId = localStorage.getItem('selected_team_id');
        selectedTeamName = localStorage.getItem('selected_team_name');
        
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
        
        if(confirmCancelButton) {
            confirmCancelButton.addEventListener('click', handleCancelEvent);
        }
        
        if(isRecurringCheckbox) {
             isRecurringCheckbox.addEventListener('change', function() {
                 if (recurringOptionsDiv) {
                     recurringOptionsDiv.style.display = this.checked ? 'block' : 'none';
                 }
             });
        }
        
        if(eventType) {
            eventType.addEventListener('change', function() {
                responseDeadlineInput.value = getDefaultDeadline(this.value);
            });
        }
        
        if(editEventForm) {
             editEventForm.addEventListener('submit', handleEditEvent);
        }
        
        // Event Listener für Modal-Klicks (Schließen)
        window.addEventListener('click', function(event) {
            if (event.target == attendanceModal) {
                 closeAttendanceModal();
            }
            if (event.target == editEventModal) {
                closeEditModal();
            }
            if (event.target == cancelEventModal) {
                closeCancelModal();
            }
        });
    }

    document.addEventListener('DOMContentLoaded', initCalendar);
    
})(); // ENDE IIFE