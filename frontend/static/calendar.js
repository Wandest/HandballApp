// DATEI: frontend/static/calendar.js
// +++ ERWEITERT: Absage-Funktionalität, Modal und Event-Status-Anzeige +++

(function() {
    
    // Globale Variablen
    var selectedTeamId = localStorage.getItem('selected_team_id');
    var selectedTeamName = localStorage.getItem('selected_team_name');
    var currentTeamDeadlines = {}; 
    var currentEventToCancel = null; // Speichert Event-ID für die Absage

    // DOM-Elemente
    var calendarTeamName, addEventButton, eventMessageDiv, createEventForm;
    var eventTitle, eventType, eventStartTime, eventEndTime, eventLocation, eventDescription;
    var defaultStatusSelect, responseDeadlineInput; 
    var eventListContainer;
    var attendanceModal, attendanceModalTitle, attendanceModalStats, attendanceList;
    
    // Regeltermine
    var isRecurringCheckbox, recurringOptionsDiv, repeatFrequencySelect, repeatUntilInput, repeatIntervalInput;

    // Bearbeiten-Modal
    var editEventModal, editEventForm, editEventId, editEventTitle, editEventType, editEventStartTime, editEventEndTime, editEventLocation, editEventDescription, editDefaultStatusSelect, editResponseDeadlineInput, editMessageDiv, editModalTitle;
    
    // NEU: Absage-Modal
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

    /**
     * Wählt die korrekte Standard-Deadline aus den Team Settings.
     * @param {string} eventType 
     */
    function getDefaultDeadline(eventType) {
        if (!currentTeamDeadlines) return 0;
        
        // Annahme, dass die Schlüssel in currentTeamDeadlines den Attributnamen von TeamSettings entsprechen
        if (eventType === 'Training') return currentTeamDeadlines.training_deadline_hours || 0;
        if (eventType === 'Spiel') return currentTeamDeadlines.game_deadline_hours || 0;
        if (eventType === 'Turnier') return currentTeamDeadlines.tournament_deadline_hours || 0;
        if (eventType === 'Testspiel') return currentTeamDeadlines.testspiel_deadline_hours || 0;
        if (eventType === 'Sonstiges') return currentTeamDeadlines.other_deadline_hours || 0;
        
        return 0;
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
        
        // Lade Deadlines VOR Events (um Standardwerte setzen zu können)
        await loadTeamDeadlines(teamId); 

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
            
            // Setzt den Standardwert in der Erstellungsmaske
            const selectedType = eventType.value;
            responseDeadlineInput.value = getDefaultDeadline(selectedType);

        } catch (error) {
            console.error('Fehler beim Laden der Standard-Deadlines:', error);
            currentTeamDeadlines = {}; 
            responseDeadlineInput.value = 0;
        }
    }

    function renderEvents(events) {
        eventListContainer.innerHTML = '';
        if (events.length === 0) {
            eventListContainer.innerHTML = '<p style="opacity: 0.6;">Keine Termine für dieses Team erstellt.</p>';
            return;
        }
        
        events.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
        
        events.forEach(event => {
            // NEU: Status-Klasse und -Text
            const isCanceled = event.status === 'CANCELED';
            const statusClass = isCanceled ? 'event-type-Abgesagt' : `event-type-${event.event_type.replace(' ', '-')}`;
            const statusLabel = isCanceled ? 'ABGESAGT' : event.event_type;
            const statusColor = isCanceled ? '#f44336' : (event.event_type === 'Training' ? '#00bcd4' : '#38E838');

            const item = document.createElement('div');
            item.className = `event-item ${statusClass}`;
            item.style.borderLeftColor = statusColor; // Für die Farbe des abgesagten Events

            const startTime = formatDateTime(event.start_time);
            const endTime = event.end_time ? ` - ${formatDateTime(event.end_time)}` : '';
            const location = event.location ? `<br>Ort: ${event.location}` : '';
            
            let deadlineHtml = '';
            if (event.response_deadline_hours) {
                 deadlineHtml = `<br><span style="color:#ffcc00; font-size:0.9em;">Frist: ${event.response_deadline_hours}h vorher</span>`;
            }

            let isRecurringEvent = event.end_time && (new Date(event.end_time).getDate() !== new Date(event.start_time).getDate() || new Date(event.end_time).getMonth() !== new Date(event.start_time).getMonth());
            
            const isRecurringDisplay = isRecurringEvent ? ' (Regeltermin)' : '';
            const recurringClass = isRecurringEvent ? 'recurring' : '';

            // Buttons anpassen
            let editButton = isCanceled 
                ? `<button class="btn btn-secondary btn-inline" disabled title="Abgesagte Termine können nicht bearbeitet werden.">Bearbeiten</button>` 
                : `<button class="btn btn-secondary btn-inline" onclick="openEditModal(${event.id})">Bearbeiten</button>`;
                
            let cancelButton = isCanceled
                ? `<button class="btn btn-primary btn-inline" disabled title="Bereits abgesagt.">Abgesagt</button>`
                : `<button class="btn btn-danger btn-inline" onclick="openCancelModal(${event.id}, '${event.title.replace(/'/g, "\\'")}')">Absagen</button>`;


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
            eventListContainer.appendChild(item);
        });
    }


    // ==================================================
    // --- T E R M I N - E R S T E L L U N G ---
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
             // Wenn das Feld leer ist, wird der Wert null gesendet, das Backend lädt dann den Standard.
             deadlineHours = null;
        }
        
        // Regeltermin-Validierung
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
            response_deadline_hours: deadlineHours, // Sendet null oder die Zahl
            
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
    
    // ==================================================
    // --- T E R M I N - B E A R B E I T E N ---
    // ==================================================
    
    function closeEditModal() {
        editEventModal.style.display = 'none';
        editMessageDiv.textContent = '';
    }
    window.closeEditModal = closeEditModal;

    async function openEditModal(eventId) {
        editMessageDiv.textContent = 'Lade Event-Daten...';
        editEventModal.style.display = 'block';

        try {
            // Lade die Event-Liste (muss die aktuelle Liste neu abrufen, falls sie veraltet ist)
            const listResponse = await fetch(`/calendar/list/${selectedTeamId}`);
            if (listResponse.status === 401) { window.logout(); return; }
            if (!listResponse.ok) throw new Error('Terminliste konnte nicht geladen werden.');
            
            const events = await listResponse.json();
            const event = events.find(e => e.id === eventId);
            
            if (!event) throw new Error('Termin nicht gefunden.');
            
            // Prüfung: Kann nur bearbeitet werden, wenn nicht abgesagt
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
            
            // end_time kann null sein
            editEventEndTime.value = event.end_time ? formatForInput(event.end_time) : '';
            
            editEventLocation.value = event.location || '';
            editEventDescription.value = event.description || '';
            
            // Status und Deadline
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


    // ==================================================
    // --- T E R M I N - A B S A G E N ---
    // ==================================================

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
            
            window.showToast('✅ Termin wurde abgesagt und Spieler informiert.', "success");
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
        eventListContainer = document.getElementById('event-list-container');
        attendanceModal = document.getElementById('attendance-modal');
        attendanceModalTitle = document.getElementById('attendance-modal-title');
        attendanceModalStats = document.getElementById('attendance-modal-stats');
        attendanceList = document.getElementById('attendance-list');
        defaultStatusSelect = document.getElementById('default-status-select');
        responseDeadlineInput = document.getElementById('response-deadline-input');
        
        // NEU: DOM-Zuweisung (Absage)
        cancelEventModal = document.getElementById('cancel-event-modal');
        cancelEventModalTitle = document.getElementById('cancel-modal-title');
        cancelReasonInput = document.getElementById('cancel-reason-input');
        confirmCancelButton = document.getElementById('confirm-cancel-button');
        cancelMessageDiv = document.getElementById('cancel-message');

        // NEU: DOM-Zuweisung (Regeltermine)
        isRecurringCheckbox = document.getElementById('is-recurring-checkbox');
        recurringOptionsDiv = document.getElementById('recurring-options');
        repeatFrequencySelect = document.getElementById('repeat-frequency-select');
        repeatUntilInput = document.getElementById('repeat-until');
        repeatIntervalInput = document.getElementById('repeat-interval-input'); 
        
        // NEU: DOM-Zuweisung (Bearbeiten)
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
        
        // NEU: Absage Event Listener
        if(confirmCancelButton) {
            confirmCancelButton.addEventListener('click', handleCancelEvent);
        }
        
        // NEU: Event Listener für Regeltermine Umschalter
        if(isRecurringCheckbox) {
             isRecurringCheckbox.addEventListener('change', function() {
                 if (recurringOptionsDiv) {
                     recurringOptionsDiv.style.display = this.checked ? 'block' : 'none';
                 }
             });
        }
        
        // NEU: Event Listener für dynamisches Vorfüllen der Deadline
        if(eventType) {
            eventType.addEventListener('change', function() {
                responseDeadlineInput.value = getDefaultDeadline(this.value);
            });
        }
        
        // NEU: Event Listener für Bearbeiten
        if(editEventForm) {
             editEventForm.addEventListener('submit', handleEditEvent);
        }
        
        // Event Listener für Modal-Klicks (Schließen)
        window.addEventListener('click', function(event) {
            if (event.target == attendanceModal) {
                 // closeAttendanceModal ist global im HTML definiert
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