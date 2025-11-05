// DATEI: frontend/static/team_management.js (FINALE KORREKTUR: Kapselung in IIFE)

/**
 * Logik für Team, Spieler, Custom Actions und Staff Management.
 * Der gesamte Code ist in eine IIFE (Immediately Invoked Function Expression)
 * gekapselt, um 'Identifier already declared' Fehler zu vermeiden.
 */
(function() {

    // Globale Variablen (Dürfen existieren, da sie im gesamten Skript benötigt werden)
    var selectedTeamId = localStorage.getItem('selected_team_id');
    var selectedTeamName = localStorage.getItem('selected_team_name');

    // FIX: Alle diese Variablen sind jetzt im LOKALEN SCOPE dieser Funktion (IIFE)
    var currentStaff = []; 
    var currentLoggedInTrainerId = null; 
    var currentLoggedInTrainerRole = null; 
    var targetCoachId = null; 

    // DOM-Variablen-Stubs (KEINE Deklaration mit let/const/var nötig, da Zuweisung in init erfolgt)
    var teamListDiv, teamMessageDiv, playerMessageDiv, playerListContainer, kaderTeamName, customActionTeamName, kaderTeamNameForm, customActionTeamNameForm, addPlayerButton, addCustomActionButton, customActionMessageDiv, customActionListContainer, selectedTeamInfoDiv;
    var invitePlayerModal, inviteModalTitle, invitePlayerIdInput, invitePlayerEmailInput, invitePlayerMessage;
    var staffTeamName, staffListContainer, addCoachButton, coachMessageDiv, addCoachForm, roleChangeModal, roleModalCoachName, roleSwapSection, roleUpdateSection, swapTargetName, updateTargetName, newRoleSelectSwap, newRoleSelectUpdate, roleModalMessage;

    const ROLE_LABELS = {
        'MAIN_COACH': 'Haupttrainer 👑',
        'TEAM_ADMIN': 'Team-Admin 🛠️',
        'ASSISTANT_COACH': 'Co-Trainer 👨‍🏫'
    };


    // ==================================================
    // --- T E A M   M A N A G E M E N T ---
    // ==================================================

    // --- Team-Auswahl/Wechsel ---
    function selectTeam(teamId, teamName) {
        selectedTeamId = teamId;
        selectedTeamName = teamName;
        document.querySelectorAll('.team-list-item').forEach(item => {
            item.classList.remove('selected');
        });
        const selectedElement = document.getElementById(`team-${teamId}`);
        if(selectedElement) {
            selectedElement.classList.add('selected');
        }
        
        if (selectedTeamInfoDiv) {
            selectedTeamInfoDiv.textContent = `Ausgewählt: ${teamName}`;
        }
        // Update aller Formulare und Listen
        kaderTeamName.textContent = teamName;
        customActionTeamName.textContent = teamName;
        kaderTeamNameForm.textContent = teamName;
        customActionTeamNameForm.textContent = teamName;
        staffTeamName.textContent = teamName;
        
        addPlayerButton.disabled = false;
        addCustomActionButton.disabled = false;
        loadPlayers(teamId);
        loadCustomActions(teamId);
        loadStaff(teamId); 

        // Speichern für alle Seiten
        localStorage.setItem('selected_team_id', teamId);
        localStorage.setItem('selected_team_name', teamName);
    }
    // Wird im Dashboard benötigt
    window.selectTeam = selectTeam; 

    // --- Teams laden und Toggle ---
    async function loadTeams() {
        try {
            // Ladeindikator sichtbar machen
            teamListDiv.innerHTML = '<p style="opacity: 0.6;">Lade Mannschaften...</p>';
            
            const response = await fetch('/teams/list', {
                method: 'GET'
            });
            if (response.status === 401 || response.status === 403) { window.logout(); return; }
            if (!response.ok) throw new Error('Netzwerkfehler beim Laden der Teams.');
            const teams = await response.json();
            teamListDiv.innerHTML = '';
            
            // UI Reset (wenn kein Team gespeichert ist)
            if (!localStorage.getItem('selected_team_id')) {
                if(selectedTeamInfoDiv) selectedTeamInfoDiv.textContent = "";
                kaderTeamName.textContent = "(Team wählen)";
                staffTeamName.textContent = "(Team wählen)";
                addPlayerButton.disabled = true;
                playerListContainer.innerHTML = '<p style="opacity: 0.6;">Wählen Sie eine Mannschaft aus.</p>';
                loadStaff(null);
            }

            if (teams.length === 0) {
                teamListDiv.innerHTML = '<p style="opacity: 0.6;">Noch keine Mannschaften vorhanden.</p>';
                return;
            }
            
            let foundSelected = false;
            teams.forEach(team => {
                const teamItem = document.createElement('div');
                teamItem.className = 'team-list-item';
                teamItem.id = `team-${team.id}`;
                
                const teamInfoLine = document.createElement('div');
                teamInfoLine.className = 'team-info-line';
                teamInfoLine.innerHTML = `<span><strong>${team.name}</strong> (${team.league})</span>`;

                const publicControl = document.createElement('div');
                publicControl.className = 'team-public-control';
                publicControl.innerHTML = `
                    <input type="checkbox" id="public-checkbox-${team.id}" ${team.is_public ? 'checked' : ''}>
                    <label for="public-checkbox-${team.id}">Öffentlich sichtbar (Liga-Scouting)</label>
                    <div id="team-public-message-${team.id}" class="message" style="margin-top: 5px;"></div>
                `;
                publicControl.querySelector(`#public-checkbox-${team.id}`).addEventListener('change', function() {
                    toggleTeamPublic(team.id, team.name, this.checked);
                });

                teamItem.appendChild(teamInfoLine);
                teamItem.appendChild(publicControl); 
                
                teamItem.addEventListener('click', (e) => {
                    if (e.target.tagName.toLowerCase() === 'input' || e.target.tagName.toLowerCase() === 'label' || e.target.closest('.team-public-control')) {
                        return;
                    }
                    selectTeam(team.id, team.name);
                });
                teamListDiv.appendChild(teamItem);

                if (selectedTeamId && team.id === parseInt(selectedTeamId)) {
                    selectTeam(team.id, team.name); 
                    foundSelected = true;
                }
            });
            
            if (!foundSelected && teams.length > 0) {
                 selectTeam(teams[0].id, teams[0].name);
            }

        } catch (error) {
            console.error('Fehler beim Laden der Teams:', error);
            teamListDiv.innerHTML = `<p class="error">FEHLER beim Laden der Teams.</p>`;
        }
    }
    // Wird im Dashboard benötigt
    window.loadTeams = loadTeams;

    async function toggleTeamPublic(teamId, teamName, isPublic) {
        if (!window.checkVerification()) {
            const checkbox = document.getElementById(`public-checkbox-${teamId}`);
            if (checkbox) { checkbox.checked = !isPublic; }
            return; 
        }

        const messageElement = document.getElementById(`team-public-message-${teamId}`);
        messageElement.textContent = 'Aktualisiere...';
        messageElement.className = 'message';
        try {
            const response = await fetch(`/teams/toggle-public/${teamId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ is_public: isPublic }),
            });
            const data = await response.json();
            if (response.ok) {
                messageElement.textContent = `✅ Team '${teamName}' ist jetzt ${isPublic ? 'öffentlich sichtbar.' : 'privat.'}`;
                messageElement.className = 'message success';
            } else {
                const checkbox = document.getElementById(`public-checkbox-${teamId}`);
                if (checkbox) checkbox.checked = !isPublic; 
                messageElement.textContent = `❌ Fehler: ${data.detail || 'Fehler beim Ändern der Sichtbarkeit.'}`;
                messageElement.className = 'message error';
            }
        } catch (error) {
            const checkbox = document.getElementById(`public-checkbox-${teamId}`);
            if (checkbox) checkbox.checked = !isPublic; 
            messageElement.textContent = '❌ Serverfehler bei der Aktualisierung.';
            messageElement.className = 'message error';
            console.error('Toggle Public Fehler:', error);
        }
    }

    // --- Formular: Team erstellen ---
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('add-team-form').addEventListener('submit', async function(event) {
            event.preventDefault();
            if (!window.checkVerification()) { return; }

            const name = document.getElementById('team-name').value;
            const league = document.getElementById('team-league').value;
            teamMessageDiv.textContent = 'Erstelle Mannschaft...';
            teamMessageDiv.className = 'message';
            try {
                const response = await fetch('/teams/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, league }),
                });
                const data = await response.json();
                if (response.ok) {
                    window.showToast(`✅ Mannschaft "${name}" erfolgreich erstellt.`, "success");
                    teamMessageDiv.textContent = `✅ Mannschaft "${name}" erfolgreich erstellt.`;
                    teamMessageDiv.className = 'message success';
                    document.getElementById('add-team-form').reset();
                    loadTeams(); 
                } else if (response.status === 401 || response.status === 403) {
                    window.logout();
                } else {
                    teamMessageDiv.textContent = `❌ Fehler: ${data.detail || 'Unbekannter Fehler'}`;
                    teamMessageDiv.className = 'message error';
                }
            } catch (error) {
                teamMessageDiv.textContent = '❌ Serverfehler beim Erstellen der Mannschaft.';
                teamMessageDiv.className = 'message error';
            }
        });
    });


    // ==================================================
    // --- P L A Y E R   M A N A G E M E N T ---
    // ==================================================

    // --- Spieler laden und Status anzeigen ---
    async function loadPlayers(teamId) {
        if (!teamId) {
             playerListContainer.innerHTML = '<p style="opacity: 0.6;">Wählen Sie eine Mannschaft aus.</p>';
             return;
        }
        playerListContainer.innerHTML = `<p style="opacity: 0.6;">Lade Kader...</p>`;
        try {
            const response = await fetch(`/players/list/${teamId}`, {
                method: 'GET'
            });
            if (response.status === 401 || response.status === 403) { window.logout(); return; }
            const players = await response.json();
            playerListContainer.innerHTML = '';
            
            if (players.length === 0) {
                playerListContainer.innerHTML = `<p style="opacity: 0.6;">Keine Spieler im Kader.</p>`;
                return;
            }
            
            // Header für die Spielerliste
            const header = document.createElement('div');
            header.className = 'player-list-item';
            header.style.background = 'none';
            header.style.borderBottom = '1px solid rgba(255, 255, 255, 0.2)';
            header.innerHTML = `
                <strong class="player-info">Spieler</strong>
                <strong class="player-actions" style="text-align: right;">Account-Status / Aktionen</strong>
            `;
            playerListContainer.appendChild(header);

            players.forEach(player => {
                const playerItem = document.createElement('div');
                playerItem.className = 'player-list-item';
                
                const numberDisplay = player.number !== null ? `#${player.number}` : '';
                const positionDisplay = player.position ? ` (${player.position})` : '';
                
                let accountStatusHtml = '';
                if (player.is_active) {
                    accountStatusHtml = '<span class="account-status active">✅ Aktiv</span>';
                } else if (player.email) {
                    accountStatusHtml = '<span class="account-status pending">⚠️ Eingeladen</span>';
                } else {
                    // Fall 3: Noch kein Account -> Einlade-Button
                    accountStatusHtml = `<button class="btn btn-info" onclick="openInviteModal(${player.id}, '${player.name.replace(/'/g, "\\'")}')">👤 Account einladen</button>`;
                }

                playerItem.innerHTML = `
                    <div class="player-info">
                        <span>${numberDisplay} <strong>${player.name}</strong>${positionDisplay}</span>
                    </div>
                    <div class="player-actions">
                        ${accountStatusHtml}
                        <button class="btn btn-danger btn-inline-delete" onclick="deletePlayer(${player.id})">Löschen</button>
                    </div>
                `;
                playerListContainer.appendChild(playerItem);
            });
        } catch (error) {
            playerListContainer.innerHTML = `<p class="error">Fehler beim Laden des Kaders.</p>`;
        }
    }
    window.loadPlayers = loadPlayers; 

    // --- Formular: Spieler erstellen ---
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('add-player-form').addEventListener('submit', async function(event) {
            event.preventDefault();
            if (!window.checkVerification()) { return; }

            if (!selectedTeamId) {
                playerMessageDiv.textContent = '❌ Bitte zuerst Team auswählen.';
                playerMessageDiv.className = 'message error';
                return;
            }
            const name = document.getElementById('player-name').value;
            const number = document.getElementById('player-number').value ? parseInt(document.getElementById('player-number').value) : null;
            const position = document.getElementById('player-position').value;
            playerMessageDiv.textContent = `Füge Spieler zu ${selectedTeamName} hinzu...`;
            playerMessageDiv.className = 'message';
            const payload = {
                name: name, number: number,
                position: position || null, team_id: selectedTeamId 
            };
            try {
                const response = await fetch('/players/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify(payload),
                });
                const data = await response.json();
                if (response.ok) {
                    window.showToast(`✅ Spieler "${name}" erfolgreich hinzugefügt.`, "success");
                    playerMessageDiv.textContent = `✅ Spieler "${name}" erfolgreich hinzugefügt.`;
                    playerMessageDiv.className = 'message success';
                    document.getElementById('add-player-form').reset();
                    loadPlayers(selectedTeamId); 
                } else {
                    playerMessageDiv.textContent = `❌ Fehler: ${data.detail || 'Unbekannter Fehler'}`;
                    playerMessageDiv.className = 'message error';
                }
            } catch (error) {
                playerMessageDiv.textContent = '❌ Serverfehler beim Erstellen des Spielers.';
                playerMessageDiv.className = 'message error';
            }
        });
    });

    // --- Spieler löschen ---
    async function deletePlayer(playerId) {
        if (!window.checkVerification()) { return; }
        if (!confirm("Sind Sie sicher, dass Sie diesen Spieler löschen möchten?")) return;
        
        playerMessageDiv.textContent = 'Lösche Spieler...';
        playerMessageDiv.className = 'message';
        try {
            const response = await fetch(`/players/delete/${playerId}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                window.showToast("✅ Spieler erfolgreich gelöscht.", "success");
                playerMessageDiv.textContent = `✅ Spieler erfolgreich gelöscht.`;
                playerMessageDiv.className = 'message success';
                loadPlayers(selectedTeamId);
            } else {
                const data = await response.json();
                playerMessageDiv.textContent = `❌ Fehler beim Löschen: ${data.detail || 'Unbekannt.'}`;
                playerMessageDiv.className = 'message error';
            }
        } catch (error) {
            playerMessageDiv.textContent = '❌ Serverfehler beim Löschen des Spielers.';
            playerMessageDiv.className = 'message error';
        }
    }
    window.deletePlayer = deletePlayer;

    // --- Modal: Spieler Einladung ---
    function openInviteModal(playerId, playerName) {
        inviteModalTitle.textContent = `Account für ${playerName} einladen`;
        invitePlayerIdInput.value = playerId;
        invitePlayerEmailInput.value = '';
        invitePlayerMessage.textContent = '';
        invitePlayerMessage.className = 'message';
        invitePlayerModal.style.display = 'block';
    }
    window.openInviteModal = openInviteModal;

    async function sendInvitation() {
        if (!window.checkVerification()) return;
        
        const playerId = invitePlayerIdInput.value;
        const email = invitePlayerEmailInput.value;
        
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            invitePlayerMessage.textContent = '❌ Bitte eine gültige E-Mail-Adresse eingeben.';
            invitePlayerMessage.className = 'message error';
            return;
        }
        
        invitePlayerMessage.textContent = 'Sende Einladung...';
        invitePlayerMessage.className = 'message';
        
        try {
            const response = await fetch(`/players/invite/${playerId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email })
            });
            
            const data = await response.json();
            
            if (response.status === 401) { window.logout(); return; }
            
            if (!response.ok) {
                throw new Error(data.detail || "Unbekannter Fehler beim Einladen.");
            }
            
            window.showToast('✅ Einladung erfolgreich gesendet.', "success");
            invitePlayerMessage.textContent = '✅ Einladung erfolgreich gesendet.';
            invitePlayerMessage.className = 'message success';
            
            loadPlayers(selectedTeamId); 
            
            // NOTE: closeInviteModal wird in team_management.html definiert
            if (typeof closeInviteModal === 'function') {
                setTimeout(closeInviteModal, 1500);
            }

        } catch (error) {
            invitePlayerMessage.textContent = `❌ ${error.message}`;
            invitePlayerMessage.className = 'message error';
            console.error("Fehler beim Senden der Einladung:", error);
        }
    }
    window.sendInvitation = sendInvitation;


    // ==================================================
    // --- C U S T O M   A C T I O N S ---
    // ==================================================

    // --- Aktionen laden ---
    async function loadCustomActions(teamId) {
        if (!teamId) { 
            customActionListContainer.innerHTML = '<p style="opacity: 0.6;">Wählen Sie ein Team.</p>';
            return;
        }
        customActionListContainer.innerHTML = `<p style="opacity: 0.6;">Lade Aktionen...</p>`;
        try {
            const response = await fetch(`/custom-actions/list?team_id=${teamId}`);
            if (response.status === 401 || response.status === 403) { window.logout(); return; }
            const actions = await response.json();
            customActionListContainer.innerHTML = '';
            if (actions.length === 0) {
                customActionListContainer.innerHTML = `<p style="opacity: 0.6;">Keine eigenen Aktionen erstellt.</p>`;
                return;
            }
            actions.forEach(action => {
                const actionItem = document.createElement('div');
                actionItem.className = 'custom-action-list-item';
                const categoryDisplay = action.category ? ` (${action.category})` : '';
                actionItem.innerHTML = `
                    <span><strong>${action.name}</strong>${categoryDisplay}</span>
                    <button class="btn btn-danger btn-inline-delete" onclick="deleteCustomAction(${action.id})">Löschen</button>
                `;
                customActionListContainer.appendChild(actionItem);
            });
        } catch (error) {
            customActionListContainer.innerHTML = `<p class="error">Fehler beim Laden der Aktionen.</p>`;
        }
    }
    window.loadCustomActions = loadCustomActions;

    // --- Formular: Aktion erstellen ---
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('add-custom-action-form').addEventListener('submit', async function(event) {
            event.preventDefault();
            if (!window.checkVerification()) { return; }

            if (!selectedTeamId) {
                customActionMessageDiv.textContent = '❌ Bitte zuerst Team auswählen.';
                customActionMessageDiv.className = 'message error';
                return;
            }
            const name = document.getElementById('custom-action-name').value;
            const category = document.getElementById('custom-action-category').value;
            customActionMessageDiv.textContent = `Erstelle Aktion "${name}"...`;
            customActionMessageDiv.className = 'message';
            const payload = {
                name: name,
                category: category,
                team_id: selectedTeamId
            };
            try {
                const response = await fetch('/custom-actions/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const data = await response.json();
                if (response.ok) {
                    window.showToast(`✅ Aktion "${name}" erfolgreich erstellt.`, "success");
                    customActionMessageDiv.textContent = `✅ Aktion "${name}" erfolgreich erstellt.`;
                    customActionMessageDiv.className = 'message success';
                    document.getElementById('add-custom-action-form').reset();
                    loadCustomActions(selectedTeamId);
                } else {
                    customActionMessageDiv.textContent = `❌ Fehler: ${data.detail || 'Unbekannter Fehler'}`;
                    customActionMessageDiv.className = 'message error';
                }
            } catch (error) {
                customActionMessageDiv.textContent = '❌ Serverfehler beim Erstellen der Aktion.';
                customActionMessageDiv.className = 'message error';
            }
        });
    });

    // --- Aktion löschen ---
    async function deleteCustomAction(actionId) {
        if (!window.checkVerification()) { return; }
        if (!confirm("Sind Sie sicher, dass Sie diese Aktionsvorlage löschen möchten?")) return;
        
        try {
            const response = await fetch(`/custom-actions/delete/${actionId}?team_id=${selectedTeamId}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                window.showToast("✅ Aktion erfolgreich gelöscht.", "success");
                customActionMessageDiv.textContent = `✅ Aktion erfolgreich gelöscht.`;
                customActionMessageDiv.className = 'message success';
                loadCustomActions(selectedTeamId);
            } else {
                const data = await response.json();
                customActionMessageDiv.textContent = `❌ Fehler beim Löschen: ${data.detail || 'Unbekannt.'}`;
                customActionMessageDiv.className = 'message error';
            }
        } catch (error) {
            customActionMessageDiv.textContent = '❌ Serverfehler beim Löschen der Aktion.';
            customActionMessageDiv.className = 'message error';
        }
    }
    window.deleteCustomAction = deleteCustomAction;


    // ==================================================
    // --- S T A F F   M A N A G E M E N T (PHASE 10.2) ---
    // ==================================================

    // --- Staff-Liste laden ---
    async function loadStaff(teamId) {
        if (!teamId) {
             staffTeamName.textContent = "(Team wählen)";
             staffListContainer.innerHTML = '<p style="opacity: 0.6;">Wählen Sie eine Mannschaft aus.</p>';
             addCoachButton.disabled = true;
             return;
        }
        
        staffTeamName.textContent = selectedTeamName;
        addCoachButton.disabled = false;
        staffListContainer.innerHTML = '<p style="opacity: 0.6;">Lade Staff...</p>';
        coachMessageDiv.textContent = '';
        
        try {
            const response = await fetch(`/teams/staff/${teamId}`, { method: 'GET' });
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) {
                 const data = await response.json();
                 if (response.status === 403) {
                     staffListContainer.innerHTML = '<p class="error">Keine Berechtigung zum Anzeigen des Staffs.</p>';
                     return;
                 }
                 throw new Error(data.detail || 'Staff konnte nicht geladen werden.');
            }
            
            const staff = await response.json();
            currentStaff = staff; 
            
            // Finde den eingeloggten Trainer (Wir wissen seinen Benutzernamen aus Jinja2)
            const trainerIdentifierElement = document.querySelector('.sidebar p:last-child');
            const trainerIdentifier = trainerIdentifierElement ? trainerIdentifierElement.textContent.split(': ')[1] : null; 
            const loggedInTrainer = staff.find(c => c.username === trainerIdentifier || c.email === trainerIdentifier);
            currentLoggedInTrainerId = loggedInTrainer ? loggedInTrainer.id : null;
            currentLoggedInTrainerRole = loggedInTrainer ? loggedInTrainer.role : null;
            
            renderStaffList(staff);
            
        } catch (error) {
            console.error('Fehler beim Laden des Staffs:', error);
            staffListContainer.innerHTML = `<p class="error">FEHLER beim Laden des Staffs.</p>`;
        }
    }
    window.loadStaff = loadStaff;

    // --- Staff-Liste rendern ---
    function renderStaffList(staff) {
        staffListContainer.innerHTML = '';
        staff.sort((a, b) => a.role.localeCompare(b.role));
        
        if (staff.length === 0) {
            staffListContainer.innerHTML = '<p style="opacity: 0.6;">Keine Trainer im Team.</p>';
            return;
        }
        
        staff.forEach(coach => {
            const isMe = coach.id === currentLoggedInTrainerId;
            const isCriticalRole = coach.role === 'MAIN_COACH' || coach.role === 'TEAM_ADMIN';
            const canManage = currentLoggedInTrainerRole === 'MAIN_COACH' || currentLoggedInTrainerRole === 'TEAM_ADMIN';
            
            const item = document.createElement('div');
            item.className = 'staff-list-item'; 
            
            let roleButtonDisabled = !canManage;
            let roleButtonTitle = canManage ? '' : 'Keine Berechtigung.';
            if (isMe && isCriticalRole) {
                roleButtonDisabled = true;
                roleButtonTitle = 'Rolle als Haupttrainer/Admin muss über den Tausch-Endpunkt geändert werden.';
            }
            
            let deleteButtonDisabled = !canManage || isMe;
            let deleteButtonTitle = canManage ? '' : 'Keine Berechtigung.';
            if (isMe) {
                deleteButtonTitle = 'Sie können sich nicht selbst entfernen.';
            }
            
            item.innerHTML = `
                <div class="staff-info">
                    <strong>${coach.username}</strong> ${isMe ? '(Du)' : ''}<br>
                    <span class="staff-role" style="color: #00bcd4;">${ROLE_LABELS[coach.role] || coach.role}</span>
                </div>
                <div class="staff-actions">
                    <button class="btn btn-info btn-inline" onclick="openRoleModal(${coach.id}, '${coach.username.replace(/'/g, "\\'")}', '${coach.role}')" 
                        ${roleButtonDisabled ? `disabled title="${roleButtonTitle}"` : ''}>Rolle</button>
                    <button class="btn btn-danger btn-inline-delete" onclick="removeCoach(${coach.id}, '${coach.username.replace(/'/g, "\\'")}')" 
                        ${deleteButtonDisabled ? `disabled title="${deleteButtonTitle}"` : ''}>Löschen</button>
                </div>
            `;
            
            staffListContainer.appendChild(item);
        });
    }

    // --- Trainer hinzufügen ---
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('add-coach-form').addEventListener('submit', async function(event) {
            event.preventDefault();
            if (!window.checkVerification() || !selectedTeamId) return;

            const email = document.getElementById('coach-email').value;
            coachMessageDiv.textContent = 'Füge Trainer hinzu...';
            coachMessageDiv.className = 'message';

            try {
                const response = await fetch(`/teams/staff/add/${selectedTeamId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email }),
                });
                const data = await response.json();
                if (response.ok) {
                    window.showToast(`✅ Trainer "${data.username}" hinzugefügt.`, "success");
                    coachMessageDiv.textContent = `✅ Trainer "${data.username}" (Co-Trainer) hinzugefügt.`;
                    coachMessageDiv.className = 'message success';
                    document.getElementById('coach-email').value = '';
                    loadStaff(selectedTeamId);
                } else if (response.status === 401 || response.status === 403) {
                    window.logout();
                } else {
                    coachMessageDiv.textContent = `❌ Fehler: ${data.detail || 'Unbekannter Fehler'}`;
                    coachMessageDiv.className = 'message error';
                }
            } catch (error) {
                coachMessageDiv.textContent = '❌ Serverfehler beim Hinzufügen des Trainers.';
                coachMessageDiv.className = 'message error';
            }
        });
    });

    // --- Trainer entfernen ---
    async function removeCoach(coachId, username) {
        if (!window.checkVerification() || !selectedTeamId) return;
        
        if (!confirm(`Sind Sie sicher, dass Sie den Trainer "${username}" aus dem Team entfernen möchten?`)) {
            return;
        }
        
        try {
            const response = await fetch(`/teams/staff/remove/${selectedTeamId}/${coachId}`, {
                method: 'DELETE'
            });
            
            if (response.status === 401 || response.status === 403) { window.logout(); return; }
            
            if (response.status === 204 || response.ok) { 
                window.showToast(`✅ Trainer "${username}" entfernt.`, "success");
                loadStaff(selectedTeamId);
            } else {
                const data = await response.json();
                window.showToast(`❌ Fehler beim Entfernen: ${data.detail || 'Unbekannt.'}`, "error");
            }
        } catch (error) {
            window.showToast('❌ Serverfehler beim Entfernen des Trainers.', "error");
        }
    }
    window.removeCoach = removeCoach;

    // --- Modal: Rolle ändern/tauschen ---
    function openRoleModal(coachId, username, currentRole) {
        if (!window.checkVerification() || !selectedTeamId) return;

        targetCoachId = coachId;
        roleModalCoachName.textContent = username;
        roleModalMessage.textContent = '';
        roleModalMessage.className = 'message';
        
        const isTargetMainCoach = currentRole === 'MAIN_COACH';
        const isMeTheMainCoach = currentLoggedInTrainerRole === 'MAIN_COACH';
        
        if (isMeTheMainCoach) {
            roleSwapSection.style.display = 'block';
            roleUpdateSection.style.display = 'none';
            swapTargetName.textContent = username;
            newRoleSelectSwap.value = currentRole; 
        } else if (isTargetMainCoach) {
            window.showToast("Sie können die Rolle des Haupttrainers nur als Haupttrainer selbst tauschen.", "error");
            return;
        } else {
            roleSwapSection.style.display = 'none';
            roleUpdateSection.style.display = 'block';
            updateTargetName.textContent = username;
            newRoleSelectUpdate.value = currentRole; 
        }
        
        roleChangeModal.style.display = 'block';
    }
    window.openRoleModal = openRoleModal;

    // --- Rolle aktualisieren (Update) ---
    async function confirmRoleUpdate() {
        if (!window.checkVerification() || !selectedTeamId || !targetCoachId) return;
        const newRole = newRoleSelectUpdate.value;
        
        roleModalMessage.textContent = 'Aktualisiere Rolle...';
        roleModalMessage.className = 'message';
        
        try {
            const response = await fetch(`/teams/staff/role/${selectedTeamId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ coach_id: targetCoachId, new_role: newRole }),
            });
            const data = await response.json();
            if (response.ok) {
                window.showToast(`✅ Rolle auf ${ROLE_LABELS[newRole]} aktualisiert.`, "success");
                roleModalMessage.textContent = '✅ Rolle erfolgreich aktualisiert.';
                roleModalMessage.className = 'message success';
                loadStaff(selectedTeamId);
                // NOTE: closeRoleModal wird in team_management.html definiert
                if (typeof closeRoleModal === 'function') {
                    setTimeout(closeRoleModal, 1500);
                }
            } else {
                roleModalMessage.textContent = `❌ Fehler: ${data.detail || 'Unbekannter Fehler'}`;
                roleModalMessage.className = 'message error';
            }
        } catch (error) {
            roleModalMessage.textContent = '❌ Serverfehler beim Aktualisieren der Rolle.';
            roleModalMessage.className = 'message error';
        }
    }
    window.confirmRoleUpdate = confirmRoleUpdate;

    // --- Haupttrainer-Rolle tauschen (Swap) ---
    async function confirmRoleSwap() {
        if (!window.checkVerification() || !selectedTeamId || !targetCoachId) return;
        const newRole = newRoleSelectSwap.value;
        
        roleModalMessage.textContent = 'Führe Tausch aus...';
        roleModalMessage.className = 'message';
        
        if (newRole !== 'MAIN_COACH' && currentLoggedInTrainerRole === 'MAIN_COACH') {
            try {
                 await confirmRoleUpdate();
            } catch (e) {
                 roleModalMessage.textContent = '❌ Fehler beim Rollen-Update (Nicht-Tausch).';
                 roleModalMessage.className = 'message error';
            }
            return;
        }
        
        if (newRole === 'MAIN_COACH') {
            if (!confirm(`Sicher? Ihre Rolle wird auf Co-Trainer herabgestuft und ${roleModalCoachName.textContent} wird Haupttrainer!`)) {
                roleModalMessage.textContent = 'Abgebrochen.';
                roleModalMessage.className = 'message error';
                return;
            }

            try {
                const response = await fetch(`/teams/staff/swap_main_coach/${selectedTeamId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ new_main_coach_id: targetCoachId }),
                });
                const data = await response.json();
                if (response.ok) {
                    window.showToast(`✅ Haupttrainer-Rolle erfolgreich getauscht.`, "success");
                    roleModalMessage.textContent = `✅ ${data.message}`;
                    roleModalMessage.className = 'message success';
                    
                    currentLoggedInTrainerRole = 'ASSISTANT_COACH';
                    loadStaff(selectedTeamId);
                    if (typeof closeRoleModal === 'function') {
                        setTimeout(closeRoleModal, 1500);
                    }
                } else {
                    roleModalMessage.textContent = `❌ Fehler: ${data.detail || 'Unbekannter Fehler'}`;
                    roleModalMessage.className = 'message error';
                }
            } catch (error) {
                roleModalMessage.textContent = '❌ Serverfehler beim Rollen-Tausch.';
                roleModalMessage.className = 'message error';
            }
        }
    }
    window.confirmRoleSwap = confirmRoleSwap;


    // --- Initialisierung ---
    function initTeamManagement() {
        // 💡 FIX: Zuweisung der DOM-Elemente ohne 'let/const'
        teamListDiv = document.getElementById('team-list');
        teamMessageDiv = document.getElementById('team-message');
        playerMessageDiv = document.getElementById('player-message');
        playerListContainer = document.getElementById('player-list-container');
        kaderTeamName = document.getElementById('kader-team-name');
        customActionTeamName = document.getElementById('custom-action-team-name');
        kaderTeamNameForm = document.getElementById('kader-team-name-form');
        customActionTeamNameForm = document.getElementById('custom-action-team-name-form');
        addPlayerButton = document.getElementById('add-player-button');
        addCustomActionButton = document.getElementById('add-custom-action-button');
        customActionMessageDiv = document.getElementById('custom-action-message');
        customActionListContainer = document.getElementById('custom-action-list-container');
        selectedTeamInfoDiv = document.getElementById('selected-team-info');
        invitePlayerModal = document.getElementById('invite-player-modal');
        inviteModalTitle = document.getElementById('invite-modal-title');
        invitePlayerIdInput = document.getElementById('invite-player-id');
        invitePlayerEmailInput = document.getElementById('invite-player-email');
        invitePlayerMessage = document.getElementById('invite-player-message');
        staffTeamName = document.getElementById('staff-team-name');
        staffListContainer = document.getElementById('staff-list-container');
        addCoachButton = document.getElementById('add-coach-button');
        coachMessageDiv = document.getElementById('coach-message');
        addCoachForm = document.getElementById('add-coach-form');
        roleChangeModal = document.getElementById('role-change-modal');
        roleModalCoachName = document.getElementById('role-modal-coach-name');
        roleSwapSection = document.getElementById('role-swap-section');
        roleUpdateSection = document.getElementById('role-update-section');
        swapTargetName = document.getElementById('swap-target-name');
        updateTargetName = document.getElementById('update-target-name');
        newRoleSelectSwap = document.getElementById('new-role-select-swap');
        newRoleSelectUpdate = document.getElementById('new-role-select-update');
        roleModalMessage = document.getElementById('role-modal-message');

        console.log("initTeamManagement() wird aufgerufen. Lade Teams...");
        loadTeams();
    }

    document.addEventListener('DOMContentLoaded', initTeamManagement);
})();