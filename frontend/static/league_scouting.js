// DATEI: frontend/static/league_scouting.js
// +++ ENTSCHLACKT: Nutzt jetzt globale Render-Funktionen aus trainer_stats.js +++

(function() {
    // Globale Variablen
    var myActiveTeamId = localStorage.getItem('selected_team_id');
    var publicSeasonShotData = [];
    var publicSeasonErrorData = [];
    var currentScoutingOpponentName = null; 
    var myTeamGames = []; 
    var myScoutingReports = []; 

    // DOM-Elemente
    var publicLeagueSelect, publicTeamsList, scoutingModal, scoutingTeamName, publicStatsField, publicStatsGoalie, publicStatsCustom, publicStatsOpponent;
    var publicShotChartPlayerSelect, publicShotChartOverlay, publicErrorChartPlayerSelect, publicErrorChartOverlay, publicOpponentShotChartOverlay;
    var scoutingReportsList, scoutingModalOpponentName, scoutingModalMyTeamId;
    var reportEditorModal, reportEditorTitle, reportTitleInput, reportOpponentInput, reportGameSelect, reportContentInput, reportEditorReportId, reportEditorMessage;


    // Event Listener für Charts (Nutzt die globalen Funktionen aus trainer_stats.js)
    document.addEventListener('DOMContentLoaded', () => {
        // --- Zuweisung der DOM-Elemente (Muss im DOMContentLoaded-Handler erfolgen) ---
        publicShotChartPlayerSelect = document.getElementById('public-shot-chart-player-select');
        publicShotChartOverlay = document.getElementById('public-shot-chart-overlay');
        publicErrorChartPlayerSelect = document.getElementById('public-error-chart-player-select');
        publicErrorChartOverlay = document.getElementById('public-error-chart-overlay');
        publicOpponentShotChartOverlay = document.getElementById('public-opponent-shot-chart-overlay');
        
        // ... (Zuweisung der anderen Elemente) ...
        publicLeagueSelect = document.getElementById('public-league-select');
        publicTeamsList = document.getElementById('public-teams-list');
        scoutingModal = document.getElementById('scouting-modal');
        scoutingTeamName = document.getElementById('scouting-team-name');
        publicStatsField = document.getElementById('public-stats-table-field-season');
        publicStatsGoalie = document.getElementById('public-stats-table-goalie-season');
        publicStatsCustom = document.getElementById('public-stats-table-custom-season');
        publicStatsOpponent = document.getElementById('public-stats-table-opponent-season');
        scoutingReportsList = document.getElementById('scouting-reports-list');
        scoutingModalOpponentName = document.getElementById('scouting-modal-opponent-name');
        scoutingModalMyTeamId = document.getElementById('scouting-modal-my-team-id');
        reportEditorModal = document.getElementById('report-editor-modal');
        reportEditorTitle = document.getElementById('report-editor-title');
        reportTitleInput = document.getElementById('report-title');
        reportOpponentInput = document.getElementById('report-opponent');
        reportGameSelect = document.getElementById('report-game-select');
        reportContentInput = document.getElementById('report-content');
        reportEditorReportId = document.getElementById('report-editor-report-id');
        reportEditorMessage = document.getElementById('report-editor-message');
        
        // Event Listener müssen jetzt die globalen Funktionen aufrufen
        if (publicShotChartPlayerSelect) {
            publicShotChartPlayerSelect.addEventListener('change', (e) => {
                if(typeof window.renderShotChart === 'function') {
                    window.renderShotChart(e.target.value, publicShotChartOverlay, publicSeasonShotData);
                }
            });
        }
        if (publicErrorChartPlayerSelect) {
            publicErrorChartPlayerSelect.addEventListener('change', (e) => {
                if(typeof window.renderErrorChart === 'function') {
                    window.renderErrorChart(e.target.value, publicErrorChartOverlay, publicSeasonErrorData);
                }
            });
        }
    });


    // ==================================================
    // --- Ö F F E N T L I C H E S   S C O U T I N G ---
    // ==================================================

    function closeModal() {
        scoutingModal.style.display = 'none';
        publicStatsField.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Statistik...</p>';
        publicStatsGoalie.innerHTML = '';
        publicStatsCustom.innerHTML = '';
        publicStatsOpponent.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Statistik...</p>';
        publicShotChartOverlay.innerHTML = '';
        publicErrorChartOverlay.innerHTML = '';
        publicOpponentShotChartOverlay.innerHTML = '';
        publicShotChartPlayerSelect.innerHTML = '<option value="all" selected>Alle Spieler</option>';
        publicErrorChartPlayerSelect.innerHTML = '<option value="all" selected>Alle Spieler</option>';
    }
    window.closeModal = closeModal;

    async function loadPublicLeagues() {
        if (!publicLeagueSelect) return;
        publicLeagueSelect.innerHTML = '<option value="" disabled selected>Lade Ligen...</option>';
        try {
            const response = await fetch('/public/leagues');
            if (!response.ok) throw new Error("Ligen-API-Fehler");
            const leagues = await response.json();
            publicLeagueSelect.innerHTML = '<option value="" disabled selected>Öffentliche Liga auswählen</option>';
            if (leagues.length === 0) {
                 publicLeagueSelect.innerHTML = '<option value="" disabled selected>Keine öffentlichen Ligen gefunden.</option>';
                 if (publicTeamsList) publicTeamsList.innerHTML = '<p style="opacity: 0.6;">Keine Teams in öffentlichen Ligen.</p>';
                 return;
            }
            leagues.forEach(league => {
                const option = document.createElement('option');
                option.value = league;
                option.textContent = league;
                publicLeagueSelect.appendChild(option);
            });
        } catch (error) {
            publicLeagueSelect.innerHTML = '<option value="" disabled selected>Fehler beim Laden.</option>';
            if (publicTeamsList) publicTeamsList.innerHTML = `<p class="error">Fehler beim Laden der Ligen.</p>`;
            console.error('Public Leagues Error:', error);
        }
    }

    function loadPublicTeams(leagueName) {
        if (!leagueName || !publicTeamsList) return;
        publicTeamsList.innerHTML = '<p style="opacity: 0.6;">Lade Teams...</p>';
        fetch(`/public/teams/by-league/${encodeURIComponent(leagueName)}`)
            .then(response => {
                if (!response.ok) throw new Error("Teams-API-Fehler");
                return response.json();
            })
            .then(teams => {
                const otherTeams = teams.filter(team => team.id != myActiveTeamId);
                
                publicTeamsList.innerHTML = '';
                
                if (otherTeams.length === 0) {
                     publicTeamsList.innerHTML = '<p style="opacity: 0.6;">Keine *anderen* öffentlichen Teams in dieser Liga gefunden.</p>';
                     return;
                }
                
                otherTeams.forEach(team => {
                    const teamItem = document.createElement('div');
                    teamItem.className = 'league-team-item';
                    teamItem.innerHTML = `<strong>${team.name}</strong>`;
                    teamItem.onclick = () => showPublicTeamStats(team.id, team.name);
                    publicTeamsList.appendChild(teamItem);
                });
            })
            .catch(error => {
                publicTeamsList.innerHTML = `<p class="error">Fehler beim Laden der Teams.</p>`;
                console.error('Public Teams Error:', error);
            });
    }
    window.loadPublicTeams = loadPublicTeams;

    async function showPublicTeamStats(teamId, teamName) {
        if (!myActiveTeamId) {
            window.showToast("Bitte zuerst ein eigenes Team im Dashboard auswählen.", "error");
            return;
        }
        
        scoutingTeamName.textContent = teamName;
        scoutingModal.style.display = 'block';
        
        currentScoutingOpponentName = teamName;
        scoutingModalOpponentName.value = teamName;
        scoutingModalMyTeamId.value = myActiveTeamId;
        
        // Reset UI
        publicStatsField.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Statistik...</p>';
        publicShotChartOverlay.innerHTML = '<p style="opacity: 0.6; text-align: center; padding-top: 45%; color: black;">Lade Wurfbild...</p>';
        publicStatsGoalie.innerHTML = '';
        publicStatsCustom.innerHTML = '';
        publicStatsOpponent.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Statistik...</p>';
        publicErrorChartOverlay.innerHTML = '<p style="opacity: 0.6; text-align: center; padding-top: 22%; color: black;">Lade Fehlerbild...</p>';
        publicOpponentShotChartOverlay.innerHTML = '<p style="opacity: 0.6; text-align: center; padding-top: 45%; color: black;">Lade Gegner-Wurfbild...</p>';
        
        loadScoutingReports(myActiveTeamId, teamName);
        
        const loadPromises = [
            fetch(`/actions/stats/season/${teamId}`), // Liefert PlayerStats
            fetch(`/actions/stats/opponent/season/${teamId}`), // Liefert OpponentStats
            fetch(`/actions/shots/season/${teamId}`), // Liefert ShotData (Own Team Shots)
            fetch(`/actions/shots/errors/season/${teamId}`), // Liefert ErrorData
            fetch(`/actions/shots/opponent/season/${teamId}`) // Liefert Opponent ShotData
        ];

        try {
            const [
                statsRes, oppStatsRes, shotDataRes, errorDataRes, oppShotDataRes
            ] = await Promise.all(loadPromises);

            // 1. STATISTIK (Nutzt globale Funktionen)
            if (statsRes.ok && oppStatsRes.ok) {
                const playerStats = await statsRes.json();
                const opponentStats = await oppStatsRes.json();
                
                if(typeof window.displaySeasonPlayerStats === 'function') {
                     window.displaySeasonPlayerStats(playerStats, 'public-stats-table-');
                }
                if(typeof window.displaySeasonOpponentStats === 'function') {
                     window.displaySeasonOpponentStats(opponentStats, publicStatsOpponent);
                }
            } else { throw new Error('Öffentliche Statistik konnte nicht geladen werden.'); }
            
            // 2. EIGENES WURFBILD
            if (shotDataRes.ok) {
                publicSeasonShotData = await shotDataRes.json();
                if(typeof window.renderShotChart === 'function') {
                    window.renderShotChart('all', publicShotChartOverlay, publicSeasonShotData); 
                }
                // Dropdown füllen
                publicShotChartPlayerSelect.innerHTML = '<option value="all" selected>Alle Spieler</option>';
                publicSeasonShotData.forEach(playerData => {
                    const option = document.createElement('option');
                    option.value = playerData.player_id;
                    option.textContent = `#${playerData.player_number || '?'} ${playerData.player_name}`;
                    publicShotChartPlayerSelect.appendChild(option);
                });
            } else { publicShotChartOverlay.innerHTML = '<p class="error" style="text-align: center; padding-top: 45%; color: black;">Fehler beim Laden der Wurfdaten.</p>'; }
            
            // 3. EIGENES FEHLERBILD
            if (errorDataRes.ok) {
                publicSeasonErrorData = await errorDataRes.json();
                 if(typeof window.renderErrorChart === 'function') {
                    window.renderErrorChart('all', publicErrorChartOverlay, publicSeasonErrorData); 
                 }
                // Dropdown füllen
                publicErrorChartPlayerSelect.innerHTML = '<option value="all" selected>Alle Spieler</option>';
                publicSeasonErrorData.forEach(playerData => {
                    const option = document.createElement('option');
                    option.value = playerData.player_id;
                    option.textContent = `#${playerData.player_number || '?'} ${playerData.player_name}`;
                    publicErrorChartPlayerSelect.appendChild(option);
                });
            } else { publicErrorChartOverlay.innerHTML = '<p class="error" style="text-align: center; padding-top: 22%; color: black;">Fehler beim Laden der Fehlerdaten.</p>'; }
            
            // 4. GEGNER WURFBILD
            if (oppShotDataRes.ok) {
                const publicOpponentData = await oppShotDataRes.json();
                if(typeof window.renderOpponentShotChart === 'function') {
                    window.renderOpponentShotChart(publicOpponentShotChartOverlay, publicOpponentData);
                }
            } else { publicOpponentShotChartOverlay.innerHTML = '<p class="error" style="text-align: center; padding-top: 45%; color: black;">Fehler beim Laden der Gegner-Wurfdaten.</p>'; }
            
        } catch (error) {
            if (publicStatsField) publicStatsField.innerHTML = `<p class="error">FEHLER: ${error.message}</p>`;
            console.error('Public Stats Error:', error);
        }
    }
    window.showPublicTeamStats = showPublicTeamStats;


    // ==================================================
    // --- Q U A L I T A T I V E S   S C O U T I N G ---
    // ==================================================

    async function loadMyTeamGames() {
        if (!myActiveTeamId) return;
        try {
            const response = await fetch(`/games/list/${myActiveTeamId}`);
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) throw new Error("Spiele konnten nicht geladen werden.");
            myTeamGames = await response.json();
            populateGameSelect(myTeamGames);
        } catch (error) {
            console.error("Fehler beim Laden der Team-Spiele:", error);
        }
    }

    function populateGameSelect(games) {
        if (!reportGameSelect) return;
        
        reportGameSelect.innerHTML = '<option value="">Kein spezifisches Spiel</option>';
        // Nur die letzten 20 Spiele anzeigen
        const recentGames = games.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20); 

        recentGames.forEach(game => {
            const option = document.createElement('option');
            const dateDisplay = game.date.split('T')[0];
            option.value = game.id;
            option.textContent = `vs. ${game.opponent} (${dateDisplay})`;
            reportGameSelect.appendChild(option);
        });
    }

    async function loadScoutingReports(myTeamId, opponentName) {
        if (!scoutingReportsList) return;
        
        scoutingReportsList.innerHTML = '<p style="opacity: 0.6;">Lade Berichte...</p>';
        try {
            const response = await fetch(`/scouting/list/${myTeamId}?opponent_name=${encodeURIComponent(opponentName)}`);
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) throw new Error("Berichte konnten nicht geladen werden.");
            
            myScoutingReports = await response.json();
            scoutingReportsList.innerHTML = '';
            
            if (myScoutingReports.length === 0) {
                 scoutingReportsList.innerHTML = '<p style="opacity: 0.6; font-size: 0.9em;">Keine eigenen Scouting-Berichte für diesen Gegner.</p>';
                 return;
            }
            
            myScoutingReports.forEach(report => {
                const item = document.createElement('div');
                item.className = 'report-item';
                const gameInfo = report.game_date ? `<br>Spiel: ${report.game_date}` : '';
                
                item.innerHTML = `
                    <div class="report-item-info">
                        <strong>${report.title}</strong>
                        <span>Erstellt am: ${new Date(report.created_at).toLocaleDateString()}${gameInfo}</span>
                    </div>
                    <div class="report-item-actions">
                        <button class="btn btn-secondary" onclick="openReportEditor(${report.id})">Edit</button>
                        <button class="btn btn-danger" onclick="deleteReport(${report.id})">Löschen</button>
                    </div>
                `;
                scoutingReportsList.appendChild(item);
            });

        } catch (error) {
            scoutingReportsList.innerHTML = `<p class="error">Fehler beim Laden der Berichte.</p>`;
            console.error('Scouting Reports Error:', error);
        }
    }
    window.loadScoutingReports = loadScoutingReports;

    function openReportEditor(reportId) {
        if (!reportEditorModal) return;
        
        reportEditorForm.reset();
        reportEditorReportId.value = reportId || '';
        reportEditorMessage.textContent = '';
        reportOpponentInput.value = currentScoutingOpponentName || 'Unbekannt'; 
        
        if (reportId) {
            const report = myScoutingReports.find(r => r.id === reportId);
            if (report) {
                reportEditorTitle.textContent = 'Bericht bearbeiten';
                reportTitleInput.value = report.title;
                reportContentInput.value = report.content || '';
                reportGameSelect.value = report.game_id || '';
            }
        } else {
            reportEditorTitle.textContent = `Neuer Bericht für ${currentScoutingOpponentName}`;
        }
        
        reportEditorModal.style.display = 'block';
    }
    window.openReportEditor = openReportEditor;

    function closeReportEditor() {
        if (reportEditorModal) reportEditorModal.style.display = 'none';
    }
    window.closeReportEditor = closeReportEditor;

    async function saveReport() {
        if (!window.checkVerification() || !myActiveTeamId) return;

        const isUpdate = !!reportEditorReportId.value;
        const url = isUpdate ? `/scouting/update/${reportEditorReportId.value}` : '/scouting/add';
        const method = isUpdate ? 'PUT' : 'POST';
        
        const gameId = reportGameSelect.value ? parseInt(reportGameSelect.value) : null;

        const payload = {
            title: reportTitleInput.value,
            content: reportContentInput.value,
            opponent_name: reportOpponentInput.value,
            game_id: gameId,
            team_id: parseInt(myActiveTeamId) // Nur für die Create-Route relevant
        };

        reportEditorMessage.textContent = 'Speichere...';
        reportEditorMessage.className = 'message';
        
        try {
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const data = await response.json();
            if (response.status === 401) { window.logout(); return; }
            if (!response.ok) throw new Error(data.detail || 'Fehler beim Speichern des Berichts.');

            window.showToast(`✅ Bericht erfolgreich ${isUpdate ? 'aktualisiert' : 'erstellt'}.`, "success");
            closeReportEditor();
            loadScoutingReports(myActiveTeamId, currentScoutingOpponentName); // Liste neu laden

        } catch (error) {
            reportEditorMessage.textContent = `❌ Fehler: ${error.message}`;
            reportEditorMessage.className = 'message error';
            console.error('Save Report Error:', error);
        }
    }
    window.saveReport = saveReport;

    async function deleteReport(reportId) {
        if (!window.checkVerification()) return;
        
        if (!confirm("Sind Sie sicher, dass Sie diesen Bericht löschen möchten?")) return;
        
        try {
            const response = await fetch(`/scouting/delete/${reportId}`, {
                method: 'DELETE'
            });
            
            if (response.status === 401) { window.logout(); return; }
            
            if (response.ok || response.status === 204) {
                window.showToast("✅ Bericht gelöscht.", "success");
                loadScoutingReports(myActiveTeamId, currentScoutingOpponentName);
            } else {
                const data = await response.json();
                window.showToast(`❌ Fehler beim Löschen: ${data.detail || 'Unbekannt.'}`, "error");
            }
        } catch (error) {
            window.showToast('❌ Serverfehler beim Löschen.', "error");
        }
    }
    window.deleteReport = deleteReport;

    // --- Initialisierung ---
    function initLeagueScouting() {
        // Zuweisung aller DOM-Elemente
        publicLeagueSelect = document.getElementById('public-league-select');
        publicTeamsList = document.getElementById('public-teams-list');
        scoutingModal = document.getElementById('scouting-modal');
        scoutingTeamName = document.getElementById('scouting-team-name');
        publicStatsField = document.getElementById('public-stats-table-field-season');
        publicStatsGoalie = document.getElementById('public-stats-table-goalie-season');
        publicStatsCustom = document.getElementById('public-stats-table-custom-season');
        publicStatsOpponent = document.getElementById('public-stats-table-opponent-season');
        publicShotChartPlayerSelect = document.getElementById('public-shot-chart-player-select');
        publicShotChartOverlay = document.getElementById('public-shot-chart-overlay');
        publicErrorChartPlayerSelect = document.getElementById('public-error-chart-player-select');
        publicErrorChartOverlay = document.getElementById('public-error-chart-overlay');
        publicOpponentShotChartOverlay = document.getElementById('public-opponent-shot-chart-overlay');
        scoutingReportsList = document.getElementById('scouting-reports-list');
        scoutingModalOpponentName = document.getElementById('scouting-modal-opponent-name');
        scoutingModalMyTeamId = document.getElementById('scouting-modal-my-team-id');
        reportEditorModal = document.getElementById('report-editor-modal');
        reportEditorTitle = document.getElementById('report-editor-title');
        reportTitleInput = document.getElementById('report-title');
        reportOpponentInput = document.getElementById('report-opponent');
        reportGameSelect = document.getElementById('report-game-select');
        reportContentInput = document.getElementById('report-content');
        reportEditorReportId = document.getElementById('report-editor-report-id');
        reportEditorMessage = document.getElementById('report-editor-message');
        
        console.log("initLeagueScouting() wird aufgerufen.");
        myActiveTeamId = localStorage.getItem('selected_team_id');
        loadPublicLeagues();
        loadMyTeamGames(); // Lädt Spiele für den GameSelect im Bericht-Editor
        
        // Event Listener: Wird in DOMContentLoaded oben hinzugefügt

    }

    document.addEventListener('DOMContentLoaded', initLeagueScouting);
    
})(); // ENDE IIFE