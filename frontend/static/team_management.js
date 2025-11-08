// DATEI: frontend/static/team_management.js (FINALE KORREKTUR: Staff & Injury Management)

/**
 * Logik für Team, Spieler, Custom Actions und Staff Management UND Verletzungen.
 * Der gesamte Code ist in eine IIFE (Immediately Invoked Function Expression)
 * gekapselt, um 'Identifier already declared' Fehler zu vermeiden.
 */
(function() {

    // Globale Variablen (Dürfen existieren, da sie im gesamten Skript benötigt werden)
    var selectedTeamId = localStorage.getItem('selected_team_id');
    var selectedTeamName = localStorage.getItem('selected_team_name');

    // LOKALE Variablen für Staff Management
    var currentStaff = []; 
    var currentLoggedInTrainerId = null; 
    var currentLoggedInTrainerRole = null; 
    var targetCoachId = null; 
    var targetCoachUsername = null;

    // DOM-Variablen-Stubs 
    var teamListDiv, teamMessageDiv, playerMessageDiv, playerListContainer, kaderTeamName, customActionTeamName, kaderTeamNameForm, customActionTeamNameForm, addPlayerButton, addCustomActionButton, customActionMessageDiv, customActionListContainer, selectedTeamInfoDiv;
    var invitePlayerModal, inviteModalTitle, invitePlayerIdInput, invitePlayerEmailInput, invitePlayerMessage;
    var staffTeamName, staffListContainer, addCoachButton, coachMessageDiv, addCoachForm, roleChangeModal, roleModalCoachName, roleSwapSection, roleUpdateSection, swapTargetName, updateTargetName, newRoleSelectSwap, newRoleSelectUpdate, roleModalMessage;
    
    // NEUE DOM-ELEMENTE für Deadlines
    var settingsTeamName, settingsLoadingIndicator, settingsFormContent, saveSettingsBtn, settingsMessage, updateSettingsForm;
    var settingGame, settingTournament, settingTestspiel, settingTraining, settingOther;
    
    // NEUE DOM-ELEMENTE für Verletzungen (Phase 11)
    var injuryModal, injuryPlayerName, injuryForm, injuryPlayerIdInput, injuryDescriptionInput, injuryLocationInput, injuryStatusSelect, injuryStartDateInput, injuryEndDateInput, injuryNotesInput, injuryMessageDiv, injuryHistoryList;


    const ROLE_LABELS = {
        'MAIN_COACH': 'Haupttrainer 👑',
        'TEAM_ADMIN': 'Team-Admin 🛠️',
        'ASSISTANT_COACH': 'Co-Trainer 👨‍🏫'
    };
    
    const INJURY_STATUS_LABELS = {
        'ACUTE': '🔴 Akut (Ausfall)',
        'REHAB': '🟡 Reha / Aufbau',
        'CHRONIC': '🟠 Chronisch',
        'CLEARED': '🟢 Ausgeheilt (Fit)'
    };
    
    // --- Hilfsfunktion zum Zuweisen der Input-Elemente (muss hier sein) ---
    function assignDynamicElements() {
        // Settings Elemente
        settingsTeamName = document.getElementById('settings-team-name');
        settingsLoadingIndicator = document.getElementById('settings-loading-indicator');
        settingsFormContent = document.getElementById('settings-form-content');
        saveSettingsBtn = document.getElementById('save-settings-btn');
        settingsMessage = document.getElementById('settings-message');
        updateSettingsForm = document.getElementById('update-settings-form');
        
        settingGame = document.getElementById('setting-game');
        settingTournament = document.getElementById('setting-tournament');
        settingTestspiel = document.getElementById('setting-testspiel');
        settingTraining = document.getElementById('setting-training');
        settingOther = document.getElementById('setting-other');
        
        // Staff Elemente
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
        
        // Injury Elemente
        injuryModal = document.getElementById('injury-modal');
        injuryPlayerName = document.getElementById('injury-player-name');
        injuryForm = document.getElementById('injury-form');
        injuryPlayerIdInput = document.getElementById('injury-player-id');
        injuryDescriptionInput = document.getElementById('injury-description');
        injuryLocationInput = document.getElementById('injury-location');
        injuryStatusSelect = document.getElementById('injury-status');
        injuryStartDateInput = document.getElementById('injury-start-date');
        injuryEndDateInput = document.getElementById('injury-end-date');
        injuryNotesInput = document.getElementById('injury-notes');
        injuryMessageDiv = document.getElementById('injury-message');
        injuryHistoryList = document.getElementById('injury-history-list');
    }


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
        kaderTeamName.textContent = teamName;
        customActionTeamName.textContent = teamName;
        kaderTeamNameForm.textContent = teamName;
        customActionTeamNameForm.textContent = teamName;
        staffTeamName.textContent = teamName;
        settingsTeamName.textContent = teamName;
        
        addPlayerButton.disabled = false;
        addCustomActionButton.disabled = false;
        
        loadPlayers(teamId);
        loadCustomActions(teamId);
        loadStaff(teamId); 
        loadDeadlines(teamId); 

        // Speichern für alle Seiten
        localStorage.setItem('selected_team_id', teamId);
        localStorage.setItem('selected_team_name', teamName);
    }
    window.selectTeam = selectTeam; 

    // --- Teams laden und Toggle ---
    async function loadTeams() {
        try {
            teamListDiv.innerHTML = '<p style="opacity: 0.6;">Lade Mannschaften...</p>';
            
            const response = await fetch('/teams/list', {
                method: 'GET'
            });
            if (response.status === 401 || response.status === 403) { window.logout(); return; }
            if (!response.ok) throw new Error('Netzwerkfehler beim Laden der Teams.');
            const teams = await response.json();
            teamListDiv.innerHTML = '';
            
            // UI Reset
            if (!localStorage.getItem('selected_team_id')) {
                if(selectedTeamInfoDiv) selectedTeamInfoDiv.textContent = "";
                kaderTeamName.textContent = "(Team wählen)";
                staffTeamName.textContent = "(Team wählen)";
                settingsTeamName.textContent = "(Team wählen)";
                addPlayerButton.disabled = true;
                playerListContainer.innerHTML = '<p style="opacity: 0.6;">Wählen Sie eine Mannschaft aus.</p>';
                loadStaff(null);
                loadDeadlines(null);
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
    window.loadTeams = loadTeams;

    // --- Public Toggle Logik ---
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
    // --- D E A D L I N E S   S E T T I N G S ---
    // ==================================================

    async function loadDeadlines(teamId) {
        if (!settingsFormContent || !settingsLoadingIndicator) return;
        
        settingsLoadingIndicator.style.display = 'block';
        settingsFormContent.style.display = 'none';
        saveSettingsBtn.style.display = 'none';
        saveSettingsBtn.disabled = true;
        settingsMessage.textContent = '';
        
        if (!teamId) {
             settingsLoadingIndicator.textContent = 'Bitte Team auswählen.';
             return;
        }
        
        settingsLoadingIndicator.textContent = 'Lade Standard-Fristen...';

        try {
            const response = await fetch(`/teams/settings/${teamId}`);
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) throw new Error('Fristen konnten nicht geladen werden.');
            
            const settings = await response.json();
            
            settingGame.value = settings.game_deadline_hours || 0;
            settingTournament.value = settings.tournament_deadline_hours || 0;
            settingTestspiel.value = settings.testspiel_deadline_hours || 0;
            settingTraining.value = settings.training_deadline_hours || 0;
            settingOther.value = settings.other_deadline_hours || 0;
            
            settingsLoadingIndicator.style.display = 'none';
            settingsFormContent.style.display = 'grid';
            saveSettingsBtn.style.display = 'block';
            saveSettingsBtn.disabled = false;

        } catch (error) {
            settingsLoadingIndicator.textContent = `❌ Fehler: ${error.message}`;
            settingsLoadingIndicator.className = 'message error';
        }
    }
    window.loadDeadlines = loadDeadlines;

    async function handleSaveDeadlines(event) {
        event.preventDefault();
        if (!window.checkVerification() || !selectedTeamId) return;

        settingsMessage.textContent = 'Speichere Fristen...';
        settingsMessage.className = 'message';
        saveSettingsBtn.disabled = true;
        
        const payload = {
            game_deadline_hours: parseInt(settingGame.value) || 0,
            tournament_deadline_hours: parseInt(settingTournament.value) || 0,
            testspiel_deadline_hours: parseInt(settingTestspiel.value) || 0,
            training_deadline_hours: parseInt(settingTraining.value) || 0,
            other_deadline_hours: parseInt(settingOther.value) || 0
        };

        try {
            const response = await fetch(`/teams/settings/${selectedTeamId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            
            const data = await response.json();
            if (response.ok) {
                window.showToast("✅ Fristen erfolgreich gespeichert.", "success");
                settingsMessage.textContent = '✅ Standard-Fristen erfolgreich gespeichert.';
                settingsMessage.className = 'message success';
            } else {
                 settingsMessage.textContent = `❌ Fehler: ${data.detail || 'Unbekannter Fehler'}`;
                 settingsMessage.className = 'message error';
            }
        } catch (error) {
            settingsMessage.textContent = '❌ Serverfehler beim Speichern der Fristen.';
            settingsMessage.className = 'message error';
        } finally {
            saveSettingsBtn.disabled = false;
        }
    }
    document.addEventListener('DOMContentLoaded', () => {
        if (updateSettingsForm) {
            updateSettingsForm.addEventListener('submit', handleSaveDeadlines);
        }
    });

    // ==================================================
    // --- P L A Y E R / C U S T O M - A C T I O N S ---
    // ==================================================

    // --- Spieler laden (loadPlayers) ---
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
            if (response.status === 401) { window.logout(); return; }
            const players = await response.json();
            playerListContainer.innerHTML = '';
            
            if (players.length === 0) {
                playerListContainer.innerHTML = `<p style="opacity: 0.6;">Keine Spieler im Kader.</p>`;
                return;
            }
            
            const header = document.createElement('div');
            header.className = 'player-list-item';
            header.style.background = 'none';
            header.style.borderBottom = '1px solid rgba(255, 255, 255, 0.2)';
            header.innerHTML = `
                <strong class="player-info">Spieler</strong>
                <strong class="player-actions" style="text-align: right;">Aktionen</strong>
            `;
            playerListContainer.appendChild(header);

            players.forEach(player => {
                const playerItem = document.createElement('div');
                playerItem.className = 'player-list-item';
                
                const numberDisplay = player.number !== null ? `#${player.number}` : '';
                const positionDisplay = player.position ? ` (${player.position})` : '';
                const playerNameEscaped = player.name.replace(/'/g, "\\'");
                
                let accountStatusHtml = '';
                if (player.is_active) {
                    accountStatusHtml = '<span class="account-status active">✅ Aktiv</span>';
                } else if (player.email) {
                    accountStatusHtml = '<span class="account-status pending">⚠️ Eingeladen</span>';
                } else {
                    accountStatusHtml = `<button class="btn btn-info btn-inline" onclick="openInviteModal(${player.id}, '${playerNameEscaped}')">👤 Einladen</button>`;
                }
                
                // NEU: Verletzungs-Button
                const injuryButton = `<button class="btn btn-danger btn-inline" style="background-color: #f44336;" onclick="openInjuryModal(${player.id}, '${playerNameEscaped}')" title="Verletzungs-Akte öffnen">🚑</button>`;

                playerItem.innerHTML = `
                    <div class="player-info">
                        <span>${numberDisplay} <strong>${player.name}</strong>${positionDisplay}</span>
                    </div>
                    <div class="player-actions">
                        ${injuryButton}
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

    // --- Spieler erstellen (Formular) ---
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
            if (!response.ok) throw new Error(data.detail || "Unbekannter Fehler beim Einladen.");
            
            window.showToast('✅ Einladung erfolgreich gesendet.', "success");
            invitePlayerMessage.textContent = '✅ Einladung erfolgreich gesendet.';
            invitePlayerMessage.className = 'message success';
            loadPlayers(selectedTeamId); 
            if (typeof window.closeInviteModal === 'function') setTimeout(window.closeInviteModal, 1500);

        } catch (error) {
            invitePlayerMessage.textContent = `❌ ${error.message}`;
            invitePlayerMessage.className = 'message error';
        }
    }
    window.sendInvitation = sendInvitation;
    
    // --- Custom Actions ---
    async function loadCustomActions(teamId) {
        if (!teamId) { 
            customActionListContainer.innerHTML = '<p style="opacity: 0.6;">Wählen Sie ein Team.</p>';
            return;
        }
        customActionListContainer.innerHTML = `<p style="opacity: 0.6;">Lade Aktionen...</p>`;
        try {
            const response = await fetch(`/custom-actions/list?team_id=${teamId}`);
            if (response.status === 401) { window.logout(); return; }
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
    // --- S T A F F   M A N A G E M E N T ---
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
            
            // Finde den eingeloggten Trainer
            const loggedInUsername = localStorage.getItem('logged_in_username');
            const loggedInTrainer = staff.find(c => c.username === loggedInUsername);
            
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
                roleButtonDisabled = false; 
                roleButtonTitle = 'Rolle tauschen / bearbeiten'; 
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
        if (!checkVerification() || !selectedTeamId) return;

        targetCoachId = coachId;
        targetCoachUsername = username;
        roleModalCoachName.textContent = username;
        roleModalMessage.textContent = '';
        roleModalMessage.className = 'message';
        
        const isTargetMainCoach = currentRole === 'MAIN_COACH';
        const isMeTheMainCoach = currentLoggedInTrainerRole === 'MAIN_COACH';
        const isMe = coachId === currentLoggedInTrainerId;
        
        // Optionen für das Dropdown im Update-Feld setzen (ohne MAIN_COACH)
        newRoleSelectUpdate.innerHTML = `
            <option value="TEAM_ADMIN">Team-Admin (TEAM_ADMIN)</option>
            <option value="ASSISTANT_COACH">Co-Trainer (ASSISTANT_COACH)</option>
        `;

        if (isMe && isMeTheMainCoach) {
            // FALL 1: Ich bin Haupttrainer und klicke auf MICH SELBST
            roleSwapSection.style.display = 'block';
            roleUpdateSection.style.display = 'none';
            swapTargetName.textContent = username;
            
            // Ich kann mich nur auf ASSISTANT_COACH herabstufen (via Swap-Endpunkt)
            newRoleSelectSwap.innerHTML = `
                <option value="MAIN_COACH" selected>Haupttrainer (MAIN_COACH)</option>
                <option value="ASSISTANT_COACH">Co-Trainer (ASSISTANT_COACH)</option>
            `;

        } else if (isMeTheMainCoach) {
            // FALL 2: Ich bin Haupttrainer und klicke auf EINEN ANDEREN Trainer
            roleSwapSection.style.display = 'block';
            roleUpdateSection.style.display = 'none';
            swapTargetName.textContent = username;
            
            // Der Haupttrainer kann jeden anderen zum Haupttrainer machen.
            newRoleSelectSwap.innerHTML = `
                <option value="MAIN_COACH">Haupttrainer (MAIN_COACH)</option>
                <option value="TEAM_ADMIN">Team-Admin (TEAM_ADMIN)</option>
                <option value="ASSISTANT_COACH">Co-Trainer (ASSISTANT_COACH)</option>
            `;
            newRoleSelectSwap.value = currentRole;

        } else {
            // FALL 3: Ich bin Admin/Co-Trainer und klicke auf irgendjemanden
            // Als Admin/Co-Trainer kann ich keine kritischen Rollen ändern/tauschen
            if (currentRole === 'MAIN_COACH' || currentRole === 'TEAM_ADMIN') {
                 if (!isMe) {
                     window.showToast("Als Co-Trainer/Admin können Sie die Rolle des Haupttrainers/Admins nicht ändern.", "error");
                     return;
                 }
            }
            // Zeige nur das Update-Feld für unkritische Rollen
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
        if (!checkVerification() || !selectedTeamId || !targetCoachId) return;
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
        if (!checkVerification() || !selectedTeamId || !targetCoachId) return;
        const newRole = newRoleSelectSwap.value;
        
        roleModalMessage.textContent = 'Führe Aktion aus...';
        roleModalMessage.className = 'message';
        
        if (targetCoachId === currentLoggedInTrainerId && newRole === 'ASSISTANT_COACH') {
            // FALL 1: Der Haupttrainer stuft sich selbst herab
             if (!confirm(`Sicher? Sie werden auf Co-Trainer herabgestuft! Wählen Sie den neuen Haupttrainer über den Rollen-Button des ZIEL-Trainers.`)) {
                roleModalMessage.textContent = 'Abgebrochen.';
                roleModalMessage.className = 'message error';
                return;
            }
            
            // Nutze den Update-Endpunkt, um den eigenen Status zu ändern
            try {
                 const response = await fetch(`/teams/staff/role/${selectedTeamId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ coach_id: targetCoachId, new_role: newRole }),
                });
                
                if (response.ok) {
                    window.showToast(`✅ Ihre Rolle wurde auf Co-Trainer herabgestuft.`, "success");
                    loadStaff(selectedTeamId);
                    if (typeof closeRoleModal === 'function') {
                        setTimeout(closeRoleModal, 1500);
                    }
                } else {
                     const data = await response.json();
                     throw new Error(data.detail || 'Fehler beim Herabstufen der eigenen Rolle.');
                }
            } catch (error) {
                 roleModalMessage.textContent = `❌ Fehler: ${error.message}`;
                 roleModalMessage.className = 'message error';
            }
            return;
        }

        if (newRole === 'MAIN_COACH') {
            // FALL 2: Haupttrainer tauscht die Rolle auf einen anderen Trainer
            if (!confirm(`Sicher? Ihre Rolle wird auf Co-Trainer herabgestuft und ${targetCoachUsername} wird Haupttrainer!`)) {
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
                    
                    // Aktualisiere den globalen Status, da der eingeloggte Trainer herabgestuft wurde
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
        } else {
            // FALL 3: Haupttrainer ändert die Rolle eines anderen auf Admin/Co-Trainer
            await confirmRoleUpdate();
        }
    }
    window.confirmRoleSwap = confirmRoleSwap;

    
    // ==================================================
    // --- V E R L E T Z U N G S - M A N A G E M E N T (NEU) ---
    // ==================================================

    async function loadInjuries(playerId) {
        injuryHistoryList.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Akte...</p>';
        try {
            const response = await fetch(`/athletic/injuries/list/${playerId}`);
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) throw new Error("Verletzungen konnten nicht geladen werden.");
            
            const injuries = await response.json();
            renderInjuryList(injuries);
        } catch (error) {
            injuryHistoryList.innerHTML = `<p class="error">Fehler: ${error.message}</p>`;
        }
    }

    function renderInjuryList(injuries) {
        injuryHistoryList.innerHTML = '';
        if (injuries.length === 0) {
            injuryHistoryList.innerHTML = '<p style="opacity: 0.6; text-align: center;">Keine Einträge vorhanden.</p>';
            return;
        }

        injuries.forEach(injury => {
            const item = document.createElement('div');
            item.className = `injury-item status-${injury.status}`;
            
            const startDate = new Date(injury.start_date).toLocaleDateString('de-DE');
            const endDate = injury.end_date ? new Date(injury.end_date).toLocaleDateString('de-DE') : 'laufend';
            const statusLabel = INJURY_STATUS_LABELS[injury.status] || injury.status;
            
            let updateButton = '';
            if (injury.status !== 'CLEARED') {
                updateButton = `<button class="btn btn-success btn-small" onclick="updateInjuryStatus(${injury.id}, 'CLEARED')">✅ Als ausgeheilt markieren</button>`;
            }

            item.innerHTML = `
                <div class="injury-header">
                    <span>${injury.description} (${injury.location || 'k.A.'})</span>
                    <span>${statusLabel}</span>
                </div>
                <div class="injury-dates">
                    Von: ${startDate} | Bis: ${endDate}
                </div>
                <p style="font-size: 0.9em; margin: 5px 0; font-style: italic; opacity: 0.8;">${injury.notes || ''}</p>
                <div class="injury-actions">
                    ${updateButton}
                </div>
            `;
            injuryHistoryList.appendChild(item);
        });
    }

    async function updateInjuryStatus(injuryId, newStatus) {
        if (!window.checkVerification()) return;
        try {
            const payload = { status: newStatus };
            // Wenn auf CLEARED gesetzt wird, setzen wir auch das Enddatum auf heute
            if (newStatus === 'CLEARED') {
                payload.end_date = new Date().toISOString().split('T')[0];
            }

            const response = await fetch(`/athletic/injuries/update/${injuryId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) throw new Error("Status konnte nicht aktualisiert werden.");

            window.showToast("Status aktualisiert.", "success");
            const playerId = document.getElementById('injury-player-id').value;
            loadInjuries(playerId); 

        } catch (error) {
            window.showToast(`❌ Fehler: ${error.message}`, "error");
        }
    }
    window.updateInjuryStatus = updateInjuryStatus;

    async function handleSaveInjury(event) {
        event.preventDefault();
        if (!window.checkVerification()) return;
        
        injuryMessageDiv.textContent = 'Speichere...';
        injuryMessageDiv.className = 'message';
        
        const payload = {
            player_id: parseInt(injuryPlayerIdInput.value),
            description: injuryDescriptionInput.value,
            location: injuryLocationInput.value || null,
            status: injuryStatusSelect.value,
            start_date: injuryStartDateInput.value,
            end_date: injuryEndDateInput.value || null,
            notes: injuryNotesInput.value || null
        };

        try {
            const response = await fetch('/athletic/injuries/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || "Fehler beim Speichern.");
            }

            injuryMessageDiv.textContent = '✅ Verletzung gespeichert.';
            injuryMessageDiv.className = 'message success';
            window.showToast("Verletzung eingetragen.", "success");
            
            // Formular teilweise zurücksetzen (Spieler-ID behalten)
            injuryDescriptionInput.value = '';
            injuryLocationInput.value = '';
            injuryStatusSelect.value = 'ACUTE';
            injuryStartDateInput.value = '';
            injuryEndDateInput.value = '';
            injuryNotesInput.value = '';

            loadInjuries(payload.player_id);

        } catch (error) {
            injuryMessageDiv.textContent = `❌ ${error.message}`;
            injuryMessageDiv.className = 'message error';
        }
    }

    function openInjuryModal(playerId, playerName) {
        injuryPlayerName.textContent = playerName;
        injuryPlayerIdInput.value = playerId;
        injuryMessageDiv.textContent = '';
        injuryForm.reset();
        loadInjuries(playerId);
        injuryModal.style.display = 'block';
    }
    window.openInjuryModal = openInjuryModal;


    // --- Initialisierung ---
    function initTeamManagement() {
        // Zuweisung der DOM-Elemente
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
        
        assignDynamicElements(); 

        console.log("initTeamManagement() wird aufgerufen. Lade Teams...");
        loadTeams();
        
        // Event Listeners
        if (injuryForm) {
            injuryForm.addEventListener('submit', handleSaveInjury);
        }
    }

    document.addEventListener('DOMContentLoaded', initTeamManagement);
})();