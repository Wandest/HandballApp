// DATEI: frontend/static/league_scouting.js (KORRIGIERT: IIFE Kapselung gegen SyntaxError)

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


    // Event Listener für Charts (Nutzt die globalen Funktionen aus season_analysis.js)
    document.addEventListener('DOMContentLoaded', () => {
        publicShotChartPlayerSelect.addEventListener('change', (e) => {
            if(typeof window.renderShotChart === 'function') {
                window.renderShotChart(e.target.value, publicShotChartOverlay, publicSeasonShotData);
            }
        });
        publicErrorChartPlayerSelect.addEventListener('change', (e) => {
            if(typeof window.renderErrorChart === 'function') {
                window.renderErrorChart(e.target.value, publicErrorChartOverlay, publicSeasonErrorData);
            }
        });
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
        publicLeagueSelect.innerHTML = '<option value="" disabled selected>Lade Ligen...</option>';
        try {
            const response = await fetch('/public/leagues');
            if (!response.ok) throw new Error("Ligen-API-Fehler");
            const leagues = await response.json();
            publicLeagueSelect.innerHTML = '<option value="" disabled selected>Öffentliche Liga auswählen</option>';
            if (leagues.length === 0) {
                 publicLeagueSelect.innerHTML = '<option value="" disabled selected>Keine öffentlichen Ligen gefunden.</option>';
                 publicTeamsList.innerHTML = '<p style="opacity: 0.6;">Keine Teams in öffentlichen Ligen.</p>';
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
            publicTeamsList.innerHTML = `<p class="error">Fehler beim Laden der Ligen.</p>`;
            console.error('Public Leagues Error:', error);
        }
    }

    function loadPublicTeams(leagueName) {
        if (!leagueName) return;
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
        
        publicStatsField.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Statistik...</p>';
        publicShotChartOverlay.innerHTML = '<p style="opacity: 0.6; text-align: center; padding-top: 22%; color: black;">Lade Wurfbild...</p>';
        publicStatsGoalie.innerHTML = '';
        publicStatsCustom.innerHTML = '';
        publicStatsOpponent.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Statistik...</p>';
        publicErrorChartOverlay.innerHTML = '<p style="opacity: 0.6; text-align: center; padding-top: 22%; color: black;">Lade Fehlerbild...</p>';
        publicOpponentShotChartOverlay.innerHTML = '<p style="opacity: 0.6; text-align: center; padding-top: 22%; color: black;">Lade Gegner-Wurfbild...</p>';
        
        loadScoutingReports(myActiveTeamId, teamName);

        try {
            const [
                statsResponse,
                publicShotDataResponse,
                publicErrorDataResponse,
                publicOpponentShotDataResponse
            ] = await Promise.all([
                fetch(`/public/stats/season/${teamId}`),
                fetch(`/public/shots/season/${teamId}`),
                fetch(`/public/shots/errors/season/${teamId}`), 
                fetch(`/public/shots/opponent/season/${teamId}`)
            ]);

            // 1. STATISTIK (Nutzt globale Funktionen)
            if (statsResponse.ok) {
                const stats = await statsResponse.json();
                if(typeof window.displaySeasonPlayerStats === 'function') {
                     window.displaySeasonPlayerStats(stats.player_stats, 'public-stats-table-');
                     window.displaySeasonOpponentStats(stats.opponent_stats, publicStatsOpponent);
                }
            } else { throw new Error('Öffentliche Statistik konnte nicht geladen werden.'); }
            
            // 2. EIGENES WURFBILD
            if (publicShotDataResponse.ok) {
                publicSeasonShotData = await publicShotDataResponse.json();
                if(typeof window.renderShotChart === 'function') {
                    window.renderShotChart('all', publicShotChartOverlay, publicSeasonShotData); 
                }
                publicShotChartPlayerSelect.innerHTML = '<option value="all" selected>Alle Spieler</option>';
                publicSeasonShotData.forEach(playerData => {
                    const option = document.createElement('option');
                    option.value = playerData.player_id;
                    option.textContent = `#${playerData.player_number || '?'} ${playerData.player_name}`;
                    publicShotChartPlayerSelect.appendChild(option);
                });
            } else { publicShotChartOverlay.innerHTML = '<p class="error" style="text-align: center; padding-top: 22%; color: black;">Fehler beim Laden.</p>'; }
            
            // 3. EIGENES FEHLERBILD
            if (publicErrorDataResponse.ok) {
                publicSeasonErrorData = await publicErrorDataResponse.json();
                 if(typeof window.renderErrorChart === 'function') {
                    window.renderErrorChart('all', publicErrorChartOverlay, publicSeasonErrorData); 
                 }
                publicErrorChartPlayerSelect.innerHTML = '<option value="all" selected>Alle Spieler</option>';
                publicSeasonErrorData.forEach(playerData => {
                    const option = document.createElement('option');
                    option.value = playerData.player_id;
                    option.textContent = `#${playerData.player_number || '?'} ${playerData.player_name}`;
                    publicErrorChartPlayerSelect.appendChild(option);
                });
            } else { publicErrorChartOverlay.innerHTML = '<p class="error" style="text-align: center; padding-top: 22%; color: black;">Fehler beim Laden.</p>'; }
            
            // 4. GEGNER WURFBILD
            if (publicOpponentShotDataResponse.ok) {
                const publicOpponentData = await publicOpponentShotDataResponse.json();
                if(typeof window.renderOpponentShotChart === 'function') {
                    window.renderOpponentShotChart(publicOpponentShotChartOverlay, publicOpponentData);
                }
            } else { publicOpponentShotChartOverlay.innerHTML = '<p class="error" style="text-align: center; padding-top: 22%; color: black;">Fehler beim Laden.</p>'; }
            
        } catch (error) {
            publicStatsField.innerHTML = `<p class="error">FEHLER: Statistik konnte nicht geladen werden.</p>`;
            console.error('Public Stats Error:', error);
        }
    }
    window.showPublicTeamStats = showPublicTeamStats;


    // ==================================================
    // --- Q U A L I T A T I V E S   S C O U T I N G ---
    // ==================================================

    async function loadMyTeamGames() {
        // ... (Logik bleibt unverändert) ...
    }

    function populateGameSelect(games) {
        // ... (Logik bleibt unverändert) ...
    }

    async function loadScoutingReports(myTeamId, opponentName) {
        // ... (Logik bleibt unverändert) ...
    }
    window.loadScoutingReports = loadScoutingReports;

    function openReportEditor(reportId) {
        // ... (Logik bleibt unverändert) ...
    }
    window.openReportEditor = openReportEditor;

    function closeReportEditor() {
        reportEditorModal.style.display = 'none';
    }

    async function saveReport() {
        // ... (Logik bleibt unverändert) ...
    }
    window.saveReport = saveReport;

    async function deleteReport(reportId) {
        // ... (Logik bleibt unverändert) ...
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
        
        // ... (Event Listener für Modale, die in HTML definiert wurden)
    }

    document.addEventListener('DOMContentLoaded', initLeagueScouting);
    
})(); // ENDE IIFE