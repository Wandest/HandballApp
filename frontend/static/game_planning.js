// DATEI: frontend/static/game_planning.js
// +++ FIX: Korrigiert die Datums-Filterlogik für den Dashboard-Modus +++

(function() {
    
    // Globale Variablen
    var selectedTeamId = localStorage.getItem('selected_team_id');
    var selectedTeamName = localStorage.getItem('selected_team_name');

    // DOM-Elemente
    var gameplanTeamName, addGameButton, gameMessageDiv, gameListContainer, tabBtnSaison, tabBtnTestspiel, tabBtnTurnier, activeGameCategoryInput, tournamentGameFields, tournamentSelect, newTournamentGroup;
    var videoModal, videoUrlInputModal, videoModalGameId, videoModalMessage;

    // --- Ladefunktionen (werden global verfügbar gemacht) ---
    
    function switchGameCategory(category) {
        if (!activeGameCategoryInput) return; // Nicht auf Dashboard-Seite
        activeGameCategoryInput.value = category;
        [tabBtnSaison, tabBtnTestspiel, tabBtnTurnier].forEach(btn => btn.classList.remove('active'));
        if (category === 'Saison') tabBtnSaison.classList.add('active');
        if (category === 'Testspiel') tabBtnTestspiel.classList.add('active');
        if (category === 'Turnier') tabBtnTurnier.classList.add('active');
        
        if (category === 'Turnier') {
            tournamentGameFields.style.display = 'block';
            if (tournamentSelect.value === 'NEW') {
                newTournamentGroup.style.display = 'block';
            } else {
                newTournamentGroup.style.display = 'none';
            }
        } else {
            tournamentGameFields.style.display = 'none';
            newTournamentGroup.style.display = 'none';
        }
    }
    window.switchGameCategory = switchGameCategory;

    function deleteGame(gameId) {
        if (!window.checkVerification()) return; 
        if (!confirm("Sind Sie sicher, dass Sie dieses Spiel löschen möchten?")) return;
        
        fetch(`/games/delete/${gameId}`, { method: 'DELETE' })
            .then(response => response.json().then(data => ({ status: response.status, body: data })))
            .then(({ status, body }) => {
                if (status === 200) {
                    window.showToast("Spiel erfolgreich gelöscht.", "success");
                    loadGames(selectedTeamId); 
                } else {
                    window.showToast(`Fehler beim Löschen: ${body.detail || 'Unbekannt.'}`, "error");
                }
            })
            .catch(error => window.showToast('Serverfehler beim Löschen des Spiels.', "error"));
    }
    window.deleteGame = deleteGame;

    function startProtocol(gameId) {
        if (!window.checkVerification()) return; 
        window.location.href = `/protocol/${gameId}`;
    }
    window.startProtocol = startProtocol;

    // --- Spielplan laden (MIT FILTER-LOGIK) ---
    async function loadGames(teamId, mode = 'all') { // 'all' (Standard) oder 'dashboard'
        if (!gameListContainer) {
            // Verhindert Fehler, wenn auf Seiten geladen, die die Liste nicht haben
            return;
        }
        
        gameListContainer.innerHTML = `<p style="opacity: 0.6;">Lade Spielplan...</p>`;
        
        if (!teamId) return;

        try {
            const response = await fetch(`/games/list/${teamId}`, { method: 'GET' });
            if (response.status === 401 || response.status === 403) { window.logout(); return; }
            let games = await response.json(); 

            // +++ KORRIGIERTE FILTERLOGIK FÜR DASHBOARD +++
            if (mode === 'dashboard') {
                const now = new Date();
                
                // 1. ZUERST das Zieldatum (in 14 Tagen) berechnen
                const twoWeeksFromNow = new Date(now.getTime() + (14 * 24 * 60 * 60 * 1000));
                
                // 2. DANN 'now' auf den Beginn des heutigen Tages setzen (00:00:00)
                now.setHours(0, 0, 0, 0); 

                games = games.filter(game => {
                    const gameDate = new Date(game.date);
                    
                    // Zeige Spiele, die HEUTE oder SPÄTER stattfinden (>= now)
                    // UND VOR dem 14-Tage-Limit liegen (<= twoWeeksFromNow)
                    return gameDate >= now && gameDate <= twoWeeksFromNow;
                });
            }
            // +++ ENDE KORREKTUR +++


            gameListContainer.innerHTML = '';

            if (games.length === 0) {
                if (mode === 'dashboard') {
                    gameListContainer.innerHTML = `<p style="opacity: 0.6;">Keine Spiele in den nächsten 14 Tagen geplant.</p>`;
                } else {
                    gameListContainer.innerHTML = `<p style="opacity: 0.6;">Keine Spiele angelegt.</p>`;
                }
                return;
            }
            
            const groupedGames = { 'Saison': [], 'Testspiel': [], 'Turnier': {} };
            const archiveGroups = {}; 
            games.forEach(game => {
                if (game.game_category === 'Saison') groupedGames.Saison.push(game);
                else if (game.game_category === 'Testspiel') groupedGames.Testspiel.push(game);
                else if (game.game_category === 'Turnier') {
                    const tourName = game.tournament_name || 'Unbenanntes Turnier';
                    if (!groupedGames.Turnier[tourName]) groupedGames.Turnier[tourName] = [];
                    groupedGames.Turnier[tourName].push(game);
                } else {
                    if (mode === 'all') { 
                        const archiveName = game.game_category;
                        if (!archiveGroups[archiveName]) archiveGroups[archiveName] = [];
                        archiveGroups[archiveName].push(game);
                    }
                }
            });
            
            const renderGameList = (gameList) => {
                let html = '';
                // Sortiere nach Datum (aufsteigend)
                gameList.sort((a, b) => new Date(a.date) - new Date(b.date));
                
                gameList.forEach(game => {
                    const dateObj = new Date(game.date);
                    // Zeige Datum UND Uhrzeit an, wenn vorhanden
                    const formattedDate = dateObj.toLocaleString('de-DE', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                    }).replace(' Uhr', '');
                    
                    const videoIcon = game.video_url ? ' 🎬' : '';
                    const videoUrlJs = game.video_url ? `'${game.video_url.replace(/'/g, "\\'")}'` : "''";

                    html += `
                        <div class="game-list-item">
                            <div class="game-info">
                                <span>📅 ${formattedDate} <strong>vs. ${game.opponent}</strong>${videoIcon}</span>
                                <span>Kategorie: ${game.game_category === 'Turnier' ? game.tournament_name : game.game_category}</span>
                            </div>
                            <div class="game-actions">
                                <button class="btn btn-secondary btn-small" 
                                        style="margin: 0 5px 0 0; padding: 4px 8px; font-size: 0.9em;"
                                        onclick="openVideoModal(${game.id}, ${videoUrlJs})">
                                    Video/URL
                                </button>
                                <button class="btn btn-info btn-inline" onclick="startProtocol(${game.id})">Protokoll</button>
                                <button class="btn btn-danger btn-inline-delete" onclick="deleteGame(${game.id})">Löschen</button>
                            </div>
                        </div>
                    `;
                });
                return html;
            };
            
            let finalHtml = '';
            if (groupedGames.Saison.length > 0) {
                finalHtml += '<h3 class="game-list-header">Saison (Liga)</h3>';
                finalHtml += renderGameList(groupedGames.Saison);
            }
            if (groupedGames.Testspiel.length > 0) {
                finalHtml += '<h3 class="game-list-header">Testspiele</h3>';
                finalHtml += renderGameList(groupedGames.Testspiel);
            }
            if (Object.keys(groupedGames.Turnier).length > 0) {
                finalHtml += '<h3 class="game-list-header">Turniere</h3>';
                for (const tourName in groupedGames.Turnier) {
                    finalHtml += `<h4 style="margin: 10px 0 5px 5px; color: #ddd;">${tourName}</h4>`;
                    finalHtml += renderGameList(groupedGames.Turnier[tourName]);
                }
            }
            if (mode === 'all' && Object.keys(archiveGroups).length > 0) {
                finalHtml += '<h3 class="game-list-header" style="color: #9e9e9e;">Archiv</h3>';
                for (const archiveName in archiveGroups) {
                    finalHtml += `<h4 style="margin: 10px 0 5px 5px; color: #ccc;">${archiveName}</h4>`;
                    finalHtml += renderGameList(archiveGroups[archiveName]);
                }
            }
            gameListContainer.innerHTML = finalHtml;
        } catch (error) {
            console.error("Fehler loadGames:", error);
            gameListContainer.innerHTML = `<p class="error">Fehler beim Laden des Spielplans.</p>`;
        }
    }
    window.loadGames = loadGames;
    
    // --- Turniere laden ---
    async function loadTournaments(teamId) {
        if (!tournamentSelect) return; // Nicht auf Dashboard-Seite
        tournamentSelect.innerHTML = '<option value="" disabled selected>Lade Turniere...</option>';
        if (!teamId) return;

        try {
            const response = await fetch(`/games/tournaments/${teamId}`, { method: 'GET' });
            if (response.status === 401 || response.status === 403) { window.logout(); return; }
            if (!response.ok) throw new Error('Turniere konnten nicht geladen werden.');
            const tournaments = await response.json();
            tournamentSelect.innerHTML = '';
            
            if (tournaments.length > 0) {
                tournaments.forEach(name => {
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = name;
                    tournamentSelect.appendChild(option);
                });
            }
            const newOption = document.createElement('option');
            newOption.value = 'NEW';
            newOption.textContent = '[ Neues Turnier anlegen ]';
            tournamentSelect.appendChild(newOption);
            
            if (tournamentSelect.options.length > 0 && tournamentSelect.value === "") {
                 tournamentSelect.selectedIndex = 0;
            } else if (tournamentSelect.options.length === 1) {
                tournamentSelect.value = 'NEW';
            }
            tournamentSelect.dispatchEvent(new Event('change'));

        } catch (error) {
            console.error('Fehler beim Laden der Turniere:', error);
            tournamentSelect.innerHTML = '<option value="" disabled selected>Fehler</Möglichkeit>';
            const newOption = document.createElement('option');
            newOption.value = 'NEW';
            newOption.textContent = '[ Neues Turnier anlegen ]';
            tournamentSelect.appendChild(newOption);
            tournamentSelect.value = 'NEW';
            tournamentSelect.dispatchEvent(new Event('change'));
        }
    }
    window.loadTournaments = loadTournaments;


    // ==================================================
    // --- V I D E O   M O D A L ---
    // ==================================================

    function openVideoModal(gameId, currentUrl) {
        if (!videoModal) return;
        videoModalGameId.value = gameId;
        videoUrlInputModal.value = (currentUrl && currentUrl !== 'null') ? currentUrl : ''; 
        videoModalMessage.textContent = '';
        videoModalMessage.className = 'message';
        document.getElementById('video-modal-title').textContent = `Video-URL für Spiel #${gameId}`;
        videoModal.style.display = 'block';
    }
    window.openVideoModal = openVideoModal;

    async function saveVideoUrl() {
        if (!window.checkVerification()) return;

        const gameId = videoModalGameId.value;
        const newUrl = videoUrlInputModal.value.trim();
        videoModalMessage.textContent = 'Speichere...';
        videoModalMessage.className = 'message';

        try {
            const response = await fetch(`/games/update-video/${gameId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ video_url: newUrl || null })
            });
            
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Fehler beim Speichern der URL.');
            }
            
            videoModalMessage.textContent = '✅ Erfolgreich gespeichert.';
            videoModalMessage.className = 'message success';
            
            loadGames(selectedTeamId, 'all'); // Im Zweifel immer alle laden

            if (typeof window.closeVideoModal === 'function') {
                setTimeout(window.closeVideoModal, 1000); 
            }

        } catch (error) {
            videoModalMessage.textContent = `❌ ${error.message}`;
            videoModalMessage.className = 'message error';
            console.error("Fehler Video-URL:", error);
        }
    }
    window.saveVideoUrl = saveVideoUrl;


    // ==================================================
    // --- I N I T I A L I S I E R U N G ---
    // ==================================================

    function initGamePlanning() {
        // Zuweisung der DOM-Elemente
        gameplanTeamName = document.getElementById('gameplan-team-name');
        addGameButton = document.getElementById('add-game-button');
        gameMessageDiv = document.getElementById('game-message');
        gameListContainer = document.getElementById('game-list-container');
        tabBtnSaison = document.getElementById('tab-btn-saison');
        tabBtnTestspiel = document.getElementById('tab-btn-testspiel');
        tabBtnTurnier = document.getElementById('tab-btn-turnier');
        activeGameCategoryInput = document.getElementById('active-game-category');
        tournamentGameFields = document.getElementById('tournament-game-fields');
        tournamentSelect = document.getElementById('tournament-select');
        newTournamentGroup = document.getElementById('new-tournament-group');
        videoModal = document.getElementById('video-url-modal');
        videoUrlInputModal = document.getElementById('video-url-input-modal');
        videoModalGameId = document.getElementById('video-modal-game-id');
        videoModalMessage = document.getElementById('video-modal-message');

        // Prüfen, ob wir uns auf der game-planning Seite befinden
        if (!addGameButton) {
            // Wir sind auf dem Dashboard, das nur 'loadGames' braucht.
            return;
        }

        console.log("initGamePlanning() wird aufgerufen.");
        
        // --- Event Listener ---
        document.getElementById('add-game-form').addEventListener('submit', async function(event) {
            event.preventDefault();
            if (!window.checkVerification()) return;
            
            if (!selectedTeamId) {
                gameMessageDiv.textContent = '❌ Bitte zuerst eine Mannschaft auswählen (Team Management).';
                gameMessageDiv.className = 'message error';
                return;
            }
            const opponent = document.getElementById('game-opponent').value;
            const dateInput = document.getElementById('game-date');
            
            let date = dateInput.value;
            if (date && date.length === 10) { 
                 date = date + 'T12:00'; // Standard-Uhrzeit
            }
            
            const videoUrl = document.getElementById('game-video-url').value.trim();
            
            const category = activeGameCategoryInput.value;
            let tournamentName = null;
            if (category === "Turnier") {
                const selectedTournament = tournamentSelect.value;
                if (selectedTournament === "NEW") {
                    tournamentName = document.getElementById('new-tournament-name').value;
                    if (!tournamentName) {
                        gameMessageDiv.textContent = '❌ Bitte einen Namen für das neue Turnier eingeben.';
                        gameMessageDiv.className = 'message error';
                        return;
                    }
                } else if (!selectedTournament) {
                     gameMessageDiv.textContent = '❌ Bitte ein Turnier auswählen oder ein neues anlegen.';
                     gameMessageDiv.className = 'message error';
                     return;
                } else {
                    tournamentName = selectedTournament;
                }
            }
            gameMessageDiv.textContent = `Erstelle Spiel gegen ${opponent}...`;
            gameMessageDiv.className = 'message';
            
            const payload = {
                opponent: opponent,
                date: date, 
                team_id: parseInt(selectedTeamId),
                game_category: category,
                tournament_name: tournamentName,
                video_url: videoUrl || null 
            };
            
            try {
                const response = await fetch('/games/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const data = await response.json();
                if (response.ok) {
                    window.showToast(`✅ Spiel gegen "${opponent}" erfolgreich angelegt.`, "success");
                    gameMessageDiv.textContent = `✅ Spiel gegen "${opponent}" erfolgreich angelegt.`;
                    gameMessageDiv.className = 'message success';
                    document.getElementById('add-game-form').reset();
                    switchGameCategory('Testspiel');
                    loadGames(selectedTeamId, 'all'); 
                    if (category === "Turnier") {
                        loadTournaments(selectedTeamId);
                    }
                } else if (response.status === 401 || response.status === 403) {
                    window.logout();
                } else {
                    gameMessageDiv.textContent = `❌ Fehler: ${data.detail || 'Unbekannter Fehler'}`;
                    gameMessageDiv.className = 'message error';
                }
            } catch (error) {
                gameMessageDiv.textContent = '❌ Serverfehler beim Erstellen des Spiels.';
                gameMessageDiv.className = 'message error';
            }
        });
        
        tournamentSelect.addEventListener('change', function() {
            if (this.value === 'NEW') {
                newTournamentGroup.style.display = 'block';
            } else {
                newTournamentGroup.style.display = 'none';
            }
        });
        // --- ENDE Event Listener ---

        const storedId = localStorage.getItem('selected_team_id');
        const storedName = localStorage.getItem('selected_team_name');
        
        if (storedId && storedName) {
            selectedTeamId = storedId;
            selectedTeamName = storedName;

            gameplanTeamName.textContent = selectedTeamName;
            addGameButton.disabled = false;
            [tabBtnSaison, tabBtnTestspiel, tabBtnTurnier].forEach(btn => btn.disabled = false);
            loadGames(selectedTeamId, 'all'); // Explizit 'all'
            loadTournaments(selectedTeamId);
            switchGameCategory('Testspiel');
        } else {
            gameplanTeamName.textContent = "(Team wählen)";
            addGameButton.disabled = true;
            [tabBtnSaison, tabBtnTestspiel, tabBtnTurnier].forEach(btn => btn.disabled = true);
            gameListContainer.innerHTML = '<p style="opacity: 0.6;">Wählen Sie eine Mannschaft aus.</p>';
        }
    }

    document.addEventListener('DOMContentLoaded', initGamePlanning);

})();