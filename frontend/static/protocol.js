// DATEI: frontend/static/protocol.js (FINAL KORRIGIERT: Behebt ReferenceErrors und implementiert fehlende Funktionen)

// --- Globale Variablen ---
var GAME_ID, TEAM_ID; 
var PRELOADED_VIDEO_URL = null; 

var fullTeamRoster = []; 
var participatingPlayers = []; 
var customActions = [];
var selectedPlayerId = null; 
var activeGoalieId = null; 
var pendingActionType = null;
var pendingIsSevenMeter = false;
var protocolCurrentHalf = 'H1'; 
var currentFilterHalf = 'ALL'; 
var activeLogRow = null; 
var playersOnCourt = new Set(); 

// YouTube Player Instance
var youtubePlayer = null;

// DOM Elemente (werden in initProtocol gesetzt)
var ACTION_LOG_CONTAINER, PLAYER_BUTTONS_CONTAINER, SCORE_BOARD, SELECTED_PLAYER_INFO, STATS_TABLE_CONTAINER_FIELD, STATS_TABLE_CONTAINER_GOALIE, STATS_TABLE_CONTAINER_CUSTOM, STATS_TABLE_CONTAINER_OPPONENT, CUSTOM_ACTION_BUTTONS_CONTAINER, ROSTER_CHECKLIST_CONTAINER, ROSTER_MESSAGE, SAVE_ROSTER_BTN;
var SHOT_MODAL_FULL, SHOT_MODAL_TITLE_FULL, SHOT_MODAL_HALF, SHOT_MODAL_TITLE_HALF;
var subButtonsContainer, videoUrlInput; 


// ==================================================
// --- H I L F S F U N K T I O N E N ---
// ==================================================

// --- Generische Message-Funktion ---
function showMessage(element, message, type = 'info') {
    if (!element) return;
    element.textContent = message;
    element.className = `message ${type}`;
}

// --- Navigation ---
function leaveProtocol() { 
    window.location.href = "/dashboard"; 
}
window.leaveProtocol = leaveProtocol;

// --- Daten-Aktualisierung (Global) ---
function updateAllStats() {
    // Ruft alle Ladefunktionen auf, die vom Filter-Status abhängen
    setFilterHalf(currentFilterHalf, document.getElementById('log-tab').classList.contains('active'));
    // Score ist unabhängig vom Filter
    updateScoreDisplay(); 
}
window.updateAllStats = updateAllStats;

// --- Tab-Steuerung ---
function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-nav .tab-button').forEach(button => {
        button.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
    document.querySelector(`.tab-nav .tab-button[onclick="showTab('${tabName}')"]`).classList.add('active');
    
    setFilterHalf(currentFilterHalf, tabName === 'log');
    
    if (tabName === 'log') { 
        if (!youtubePlayer && (videoUrlInput.value || PRELOADED_VIDEO_URL)) {
            loadVideo(); 
        }
    }
}
window.showTab = showTab; 

// --- Spieler-Auswahl ---
function selectPlayer(playerId, playerName, isGoalie) {
    selectedPlayerId = playerId;
    SELECTED_PLAYER_INFO.textContent = playerName;
    document.querySelectorAll('.player-list button').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    const buttonId = playerId === 'opponent' ? 'player-btn-opponent' : `player-btn-${playerId}`;
    const buttonElement = document.getElementById(buttonId);
    if (buttonElement) {
         buttonElement.classList.add('selected');
    }

    if (isGoalie) {
        document.querySelectorAll('.player-list button.active-goalie').forEach(btn => {
            btn.classList.remove('active-goalie');
        });
        if (buttonElement) {
            buttonElement.classList.add('active-goalie');
        }
        activeGoalieId = playerId;
    } else if (activeGoalieId === playerId) {
         if (buttonElement) {
            buttonElement.classList.remove('active-goalie');
         }
         activeGoalieId = null;
    }
    
    // updatePlayerButtonsState(); // (Funktion fehlt noch für Phase 10.5)
}
window.selectPlayer = selectPlayer;

// --- Halbzeit-Steuerung (Header) ---
function setHalf(half) {
    protocolCurrentHalf = half;
    document.getElementById('half-btn-H1').classList.remove('active');
    document.getElementById('half-btn-H2').classList.remove('active');
    document.getElementById(`half-btn-${half}`).classList.add('active');
    window.showToast(`Protokoll für ${half} aktiv.`, "success");
}
window.setHalf = setHalf;

// --- Filter-Steuerung (Statistik & Log) ---
function setFilterHalf(half, isLogTab = false) {
    currentFilterHalf = half;
    
    // Buttons im Stats-Tab aktualisieren
    document.getElementById('filter-btn-ALL').classList.remove('active');
    document.getElementById('filter-btn-H1').classList.remove('active');
    document.getElementById('filter-btn-H2').classList.remove('active');
    document.getElementById(`filter-btn-${half}`).classList.add('active');
    
    // Buttons im Log-Tab aktualisieren
    document.getElementById('log-filter-btn-ALL').classList.remove('active');
    document.getElementById('log-filter-btn-H1').classList.remove('active');
    document.getElementById('log-filter-btn-H2').classList.remove('active');
    document.getElementById(`log-filter-btn-${half}`).classList.add('active');

    // Lade die Stats/Logs für den ausgewählten Filter
    if (isLogTab) {
        loadActionLog();
    } else {
        loadStats();
        loadOpponentStats();
    }
}
window.setFilterHalf = setFilterHalf;


// ==================================================
// --- MODAL- & AKTIONSLOGIK ---
// ==================================================

// --- Modal-Steuerung (Öffnen/Schließen) ---
function showShotModal(actionType, isSevenMeter) {
     if (!selectedPlayerId) {
        window.showToast("Bitte zuerst einen Spieler auswählen.", "error");
        return;
    }
    
    const buttonId = selectedPlayerId === 'opponent' ? 'player-btn-opponent' : `player-btn-${selectedPlayerId}`;
    const buttonElement = document.getElementById(buttonId);
    const playerName = buttonElement ? buttonElement.textContent : 'Unbekannt';

    pendingActionType = actionType;
    pendingIsSevenMeter = isSevenMeter;

    // KORREKTUR (Ihre Anforderung): Gegner-Aktionen (OppGoal, OppMiss) nutzen jetzt auch das Halbfeld
    const useHalfField = (
        actionType === 'Goal' || actionType === 'Miss' || 
        actionType === 'Goal_7m' || actionType === 'Miss_7m' ||
        actionType === 'OppGoal' || actionType === 'OppMiss' 
    );

    if (useHalfField) {
        SHOT_MODAL_TITLE_HALF.textContent = `Aktion eintragen: ${actionType} - ${playerName}`;
        SHOT_MODAL_HALF.style.display = 'block';
    } else {
        SHOT_MODAL_TITLE_FULL.textContent = `Aktion eintragen: ${actionType} - ${playerName}`;
        SHOT_MODAL_FULL.style.display = 'block';
    }
}
window.showShotModal = showShotModal;

function closeShotModal() {
    SHOT_MODAL_FULL.style.display = 'none';
    SHOT_MODAL_HALF.style.display = 'none';
    pendingActionType = null;
    pendingIsSevenMeter = false;
}
window.closeShotModal = closeShotModal;


// --- AKTIONEN LOGGEN (Backend-Kommunikation) ---

async function logActionToBackend(actionType, playerId, x = null, y = null, isSevenMeter = false, activeGoalie = null) {
    if (!GAME_ID) return;
    
    const payload = {
        action_type: actionType,
        time_in_game: protocolCurrentHalf, 
        game_id: GAME_ID,
        player_id: (playerId === 'opponent' ? null : playerId),
        is_seven_meter: isSevenMeter,
        x_coordinate: x,
        y_coordinate: y,
        active_goalie_id: activeGoalie,
        server_timestamp: new Date().toISOString() // Für Phase 10.5
    };
    
    try {
        const response = await fetch('/actions/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (response.status === 401) { window.logout(); return; }
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Aktion konnte nicht gespeichert werden.");
        }
        
        const data = await response.json();
        window.showToast(`Aktion: ${actionType} gespeichert.`, "success");
        updateAllStats();
        
    } catch (error) {
        window.showToast(`Fehler: ${error.message}`, "error");
        console.error("Log Action Error:", error);
    }
}
window.logActionToBackend = logActionToBackend; // Global machen für Koordinaten-Klicks

// --- Klick-Handler für Spielfeld-Modale ---
function getCoordinates(event, pitchType) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x_pixel = event.clientX - rect.left;
    const y_pixel = event.clientY - rect.top;
    
    const x_percentage = (x_pixel / rect.width) * 100;
    const y_percentage = (y_pixel / rect.height) * 100;
    
    return { x: x_percentage, y: y_percentage };
}

function logShotWithCoordinatesHalf(event) {
    const coords = getCoordinates(event, 'half');
    logActionToBackend(pendingActionType, selectedPlayerId, coords.x, coords.y, pendingIsSevenMeter, activeGoalieId);
    closeShotModal();
}
window.logShotWithCoordinatesHalf = logShotWithCoordinatesHalf;

function logShotWithCoordinatesFull(event) {
    const coords = getCoordinates(event, 'full');
    logActionToBackend(pendingActionType, selectedPlayerId, coords.x, coords.y, pendingIsSevenMeter, activeGoalieId);
    closeShotModal();
}
window.logShotWithCoordinatesFull = logShotWithCoordinatesFull;

// --- Klick-Handler für Aktionen (ohne Modal) ---
function handleAction(actionType) {
    if (!selectedPlayerId || selectedPlayerId === 'opponent') {
        window.showToast("Bitte zuerst einen EIGENEN Spieler auswählen.", "error");
        return;
    }
    logActionToBackend(actionType, selectedPlayerId, null, null, false, null);
}
window.handleAction = handleAction;

function handleOpponentAction(actionType) {
    logActionToBackend(actionType, 'opponent', null, null, false, activeGoalieId);
}
window.handleOpponentAction = handleOpponentAction;

function handleGoalieAction(actionType) {
     if (!activeGoalieId) {
        window.showToast("Bitte einen Spieler als aktiven Torwart auswählen.", "error");
        return;
    }
    logActionToBackend(actionType, activeGoalieId, null, null, false, activeGoalieId);
}
window.handleGoalieAction = handleGoalieAction;


// ==================================================
// --- STATISTIK LADEN & ANZEIGEN ---
// ==================================================

// --- Gegner-Stats (Tabelle) ---
async function loadOpponentStats() {
    STATS_TABLE_CONTAINER_OPPONENT.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Gegner-Statistik...</p>';
    try {
        const response = await fetch(`/actions/stats/opponent/${GAME_ID}?half=${currentFilterHalf}`);
        if (response.status === 401) { window.logout(); return; }
        if (!response.ok) throw new Error("Gegner-Stats nicht gefunden.");
        
        const stats = await response.json();
        
        let tableHtml = `<table class="opponent-stats-table"><tbody>
            <tr><td>🟡 Gegner Tore (Gesamt)</td><td>${stats.opponent_goals}</td></tr>
            <tr><td>💨 Gegner Fehlwürfe</td><td>${stats.opponent_misses}</td></tr>
            <tr><td>🚫 Gegner Tech. Fehler</td><td>${stats.opponent_tech_errors}</td></tr>
        </tbody></table>`;
        STATS_TABLE_CONTAINER_OPPONENT.innerHTML = tableHtml;
        
    } catch (error) {
        STATS_TABLE_CONTAINER_OPPONENT.innerHTML = `<p class="error">${error.message}</p>`;
        console.error("Opponent Stats Error:", error);
    }
}

// --- Spieler-Stats (Tabellen) ---
async function loadStats() {
    STATS_TABLE_CONTAINER_FIELD.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Spieler-Statistik...</p>';
    STATS_TABLE_CONTAINER_GOALIE.innerHTML = '';
    STATS_TABLE_CONTAINER_CUSTOM.innerHTML = '';
    try {
        const response = await fetch(`/actions/stats/game/${GAME_ID}?half=${currentFilterHalf}`);
        if (response.status === 401) { window.logout(); return; }
        if (!response.ok) throw new Error("Spieler-Stats nicht gefunden.");
        
        const stats = await response.json();
        renderStatsTables(stats);
        
    } catch (error) {
        STATS_TABLE_CONTAINER_FIELD.innerHTML = `<p class="error">${error.message}</p>`;
        console.error("Player Stats Error:", error);
    }
}

// --- Scoreboard ---
async function updateScoreDisplay() {
    try {
        const [myStatsRes, oppStatsRes] = await Promise.all([
             fetch(`/actions/stats/game/${GAME_ID}?half=ALL`),
             fetch(`/actions/stats/opponent/${GAME_ID}?half=ALL`)
        ]);
        if (!myStatsRes.ok || !oppStatsRes.ok) throw new Error("Score-Daten nicht gefunden.");
        
        const myStats = await myStatsRes.json();
        const oppStats = await oppStatsRes.json();
        
        const myScore = myStats.reduce((acc, player) => acc + player.goals + player.seven_meter_goals, 0);
        const oppScore = oppStats.opponent_goals;
        
        SCORE_BOARD.textContent = `${myScore} - ${oppScore}`;
        
    } catch (error) {
        SCORE_BOARD.textContent = `N/A`;
        console.error("Score Update Error:", error);
    }
}

// --- STATISTIK-TABELLEN RENDERN (HELFER) ---
function renderStatsTables(stats) {
    let fieldHeaders = ['Spieler', '#', 'Tore', 'FW', 'Quote', '7m G/A', 'TF', 'FP', '7m V.', 'Zeit'];
    let goalieHeaders = ['Spieler', '#', 'Paraden', 'GGT', 'Quote', '7m P/G', 'Zeit'];
    
    let fieldTableHtml = '<table class="stats-table"><thead><tr>' + fieldHeaders.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
    let goalieTableHtml = '<table class="stats-table"><thead><tr>' + goalieHeaders.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
    
    let fieldPlayersFound = false, goaliesFound = false;
    
    const customActionNames = (stats.length > 0 && stats[0].custom_counts) ? Object.keys(stats[0].custom_counts) : [];
    let customTableHtml = '<table class="stats-table"><thead><tr><th>Spieler</th><th>#</th>';
    customActionNames.forEach(name => { customTableHtml += `<th>${name}</th>`; });
    customTableHtml += '</tr></thead><tbody>';
    
    // Total-Zähler
    let total = { goals: 0, misses: 0, seven_meter_goals: 0, seven_meter_misses: 0, tech_errors: 0, fehlpaesse: 0, seven_meter_caused: 0, saves: 0, opponent_goals_received: 0, seven_meter_saves: 0, seven_meter_received: 0 };
    let totalTimeOnCourt = 0;

    stats.forEach(player => {
        // Summen
        Object.keys(total).forEach(key => { total[key] += (player[key] || 0); });
        totalTimeOnCourt += (player.time_on_court_seconds || 0);

        const timeDisplay = player.time_on_court_display || '00:00';
        
        if (player.position === 'Torwart') {
            goaliesFound = true;
            const totalShotsOnGoal = player.saves + player.opponent_goals_received;
            const quote = totalShotsOnGoal > 0 ? ((player.saves / totalShotsOnGoal) * 100).toFixed(0) + '%' : '—';
            const sevenMeterTotal = player.seven_meter_saves + player.seven_meter_received;
            
            goalieTableHtml += `<tr>
                <td>${player.player_name}</td>
                <td>${player.player_number || ''}</td>
                <td>${player.saves}</td>
                <td>${player.opponent_goals_received}</td>
                <td>${quote}</td>
                <td>${player.seven_meter_saves} / ${sevenMeterTotal}</td>
                <td>${timeDisplay}</td>
            </tr>`;
        } else {
            fieldPlayersFound = true;
            const totalShots = player.goals + player.misses;
            const quote = totalShots > 0 ? ((player.goals / totalShots) * 100).toFixed(0) + '%' : '—';
            const sevenMeterAttempts = player.seven_meter_goals + player.seven_meter_misses;
            
            fieldTableHtml += `<tr>
                <td>${player.player_name}</td>
                <td>${player.player_number || ''}</td>
                <td>${player.goals}</td>
                <td>${player.misses}</td>
                <td>${quote}</td>
                <td>${player.seven_meter_goals}/${sevenMeterAttempts}</td>
                <td>${player.tech_errors}</td>
                <td>${player.fehlpaesse}</td>
                <td>${player.seven_meter_caused}</td>
                <td>${timeDisplay}</td>
            </tr>`;
        }
        
        // Custom Actions (für alle Spieler)
        customTableHtml += `<tr><td>${player.player_name}</td><td>${player.player_number || ''}</td>`;
        customActionNames.forEach(name => {
            customTableHtml += `<td>${player.custom_counts[name] || 0}</td>`;
        });
        customTableHtml += `</tr>`;
    });
    
    // Total-Zeile für Feldspieler
    const totalShots = total.goals + total.misses;
    const totalQuote = totalShots > 0 ? ((total.goals / totalShots) * 100).toFixed(0) + '%' : '—';
    const totalSevenMeterAttempts = total.seven_meter_goals + total.seven_meter_misses;
    const totalTimeDisplay = window.formatSeconds ? window.formatSeconds(totalTimeOnCourt) : 'N/A';
    
    fieldTableHtml += `</tbody><tfoot><tr>
        <td>TOTAL</td><td></td>
        <td>${total.goals}</td>
        <td>${total.misses}</td>
        <td>${totalQuote}</td>
        <td>${total.seven_meter_goals}/${totalSevenMeterAttempts}</td>
        <td>${total.tech_errors}</td>
        <td>${total.fehlpaesse}</td>
        <td>${total.seven_meter_caused}</td>
        <td>${totalTimeDisplay}</td>
    </tr></tfoot></table>`;
    
    goalieTableHtml += '</tbody></table>';
    customTableHtml += '</tbody></table>';
    
    STATS_TABLE_CONTAINER_FIELD.innerHTML = fieldPlayersFound ? fieldTableHtml : '<p style="opacity: 0.6; text-align: center;">Keine Feldspieler im Roster.</p>';
    STATS_TABLE_CONTAINER_GOALIE.innerHTML = goaliesFound ? goalieTableHtml : '<p style="opacity: 0.6; text-align: center;">Keine Torhüter im Roster.</p>';
    STATS_TABLE_CONTAINER_CUSTOM.innerHTML = customActionNames.length > 0 ? customTableHtml : '<p style="opacity: 0.6; text-align: center;">Keine Team-Aktionen definiert.</p>';
}


// ==================================================
// --- LOG & VIDEO (Implementierung fehlt noch) ---
// ==================================================

async function loadActionLog() {
    ACTION_LOG_CONTAINER.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Aktions-Log...</p>';
    try {
        const response = await fetch(`/actions/list/${GAME_ID}?half=${currentFilterHalf}`);
        if (response.status === 401) { window.logout(); return; }
        if (!response.ok) throw new Error("Aktions-Log nicht gefunden.");
        
        const actions = await response.json();
        renderActionLog(actions);

    } catch (error) {
        ACTION_LOG_CONTAINER.innerHTML = `<p class="error">${error.message}</p>`;
        console.error("Action Log Error:", error);
    }
}

function renderActionLog(actions) {
    if (actions.length === 0) {
        ACTION_LOG_CONTAINER.innerHTML = '<p style="opacity: 0.6; text-align: center;">Keine Aktionen in dieser Hälfte.</p>';
        return;
    }
    
    let logHtml = '<table class="log-table"><thead><tr><th>Hälfte</th><th>Zeitstempel</th><th>Spieler</th><th>Aktion</th></tr></thead><tbody>';
    
    actions.forEach(action => {
        const timeClass = action.video_timestamp ? 'log-time-cell' : 'log-time-cell no-time';
        const timeDisplay = action.video_timestamp || '00:00';
        const playerName = action.player_name || (action.action_type.startsWith('Opp') ? 'Gegner' : 'Team');
        
        logHtml += `<tr id="log-row-${action.id}" onclick="handleLogClick(${action.id}, '${action.video_timestamp}')">
            <td>${action.time_in_game}</td>
            <td class="${timeClass}" id="log-time-${action.id}">${timeDisplay}</td>
            <td>${playerName}</td>
            <td>${action.action_type}</td>
        </tr>`;
    });
    
    logHtml += '</tbody></table>';
    ACTION_LOG_CONTAINER.innerHTML = logHtml;
}

function loadVideo() {
    // Implementierung (YouTube API)
}
window.loadVideo = loadVideo;

// --- (Platzhalter für Video-Funktionen) ---
function handleLogClick(actionId, timestamp) {
    window.showToast(`Klick auf Log-Zeile ${actionId} (Zeit: ${timestamp || 'N/A'})`, 'info');
    // Implementierung für Video-Schnitt
}
window.handleLogClick = handleLogClick;


// ==================================================
// --- ROSTER (KADER) ---
// ==================================================

async function loadCustomActions() {
    CUSTOM_ACTION_BUTTONS_CONTAINER.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Aktionen...</p>';
    try {
        const response = await fetch(`/custom-actions/list?team_id=${TEAM_ID}`);
        if (response.status === 401) { window.logout(); return; }
        if (!response.ok) throw new Error("Aktionen konnten nicht geladen werden.");
        customActions = await response.json();
        CUSTOM_ACTION_BUTTONS_CONTAINER.innerHTML = '';
        if (customActions.length === 0) {
             CUSTOM_ACTION_BUTTONS_CONTAINER.innerHTML = '<p style="opacity: 0.6; text-align: center; font-size:0.9em;">Keine eigenen Aktionen.</p>';
             return;
        }
        customActions.forEach(action => {
            const btn = document.createElement('button');
            const categoryClass = action.category.replace(/\s+/g, "-");
            btn.className = `btn btn-custom btn-custom-${categoryClass}`;
            btn.textContent = action.name;
            btn.onclick = () => showShotModal(action.name, false); 
            CUSTOM_ACTION_BUTTONS_CONTAINER.appendChild(btn);
        });
    } catch (error) {
        CUSTOM_ACTION_BUTTONS_CONTAINER.innerHTML = '<p class="error">Aktionen fehlgeschlagen.</p>';
        console.error("Custom Action Fehler:", error);
    }
}

async function loadFullTeamRoster() {
    PLAYER_BUTTONS_CONTAINER.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Kader...</p>';
    ROSTER_CHECKLIST_CONTAINER.innerHTML = '<p style="opacity: 0.6; text-align: center; grid-column: span 2;">Lade Team-Kader...</p>';
    try {
        const teamResponse = await fetch(`/players/list/${TEAM_ID}`);
        if (teamResponse.status === 401) { window.logout(); return; }
        fullTeamRoster = await teamResponse.json();
        
        const rosterResponse = await fetch(`/games/roster/${GAME_ID}`);
        if (rosterResponse.status === 401) { window.logout(); return; }
        participatingPlayers = await rosterResponse.json();
        
        renderPlayerButtons();
        renderRosterChecklist();
        
    } catch (error) {
        PLAYER_BUTTONS_CONTAINER.innerHTML = '<p class="error">Kader fehlgeschlagen.</p>';
        ROSTER_CHECKLIST_CONTAINER.innerHTML = '<p class="error">Kader fehlgeschlagen.</p>';
        console.error("Roster Fehler:", error);
    }
}

function renderPlayerButtons() {
    PLAYER_BUTTONS_CONTAINER.innerHTML = '';
    if (!participatingPlayers || participatingPlayers.length === 0) {
         PLAYER_BUTTONS_CONTAINER.innerHTML = '<p class="error">Kein Roster gesetzt. Bitte unter "Kader / Roster" hinzufügen.</p>';
         return;
    }

    participatingPlayers.sort((a, b) => (a.number || 999) - (b.number || 999));
    
    participatingPlayers.forEach(player => {
        const isGoalie = player.position === 'Torwart';
        const btn = document.createElement('button');
        btn.id = `player-btn-${player.id}`;
        btn.className = isGoalie ? 'goalkeeper' : '';
        const numberDisplay = player.number ? `#${player.number} ` : '';
        btn.textContent = `${numberDisplay}${player.name}`;
        btn.onclick = () => selectPlayer(player.id, btn.textContent, isGoalie);
        PLAYER_BUTTONS_CONTAINER.appendChild(btn);
    });
    
    const opponentBtn = document.createElement('button');
    opponentBtn.id = 'player-btn-opponent';
    opponentBtn.className = 'opponent';
    opponentBtn.textContent = 'Gegner Team';
    opponentBtn.onclick = () => selectPlayer('opponent', 'Gegner Team', false);
    PLAYER_BUTTONS_CONTAINER.appendChild(opponentBtn);
    
    if (subButtonsContainer) {
        subButtonsContainer.innerHTML = ''; 
    }
}

function renderRosterChecklist() {
    ROSTER_CHECKLIST_CONTAINER.innerHTML = '';
    fullTeamRoster.sort((a, b) => (a.number || 999) - (b.number || 999));
    
    const participatingIds = new Set(participatingPlayers.map(p => p.id));

    fullTeamRoster.forEach(player => {
        const isChecked = participatingIds.has(player.id);
        const playerItem = document.createElement('div');
        playerItem.className = 'roster-player-item';
        playerItem.innerHTML = `
            <input type="checkbox" id="roster-player-${player.id}" value="${player.id}" ${isChecked ? 'checked' : ''}>
            <label for="roster-player-${player.id}">#${player.number || '?'} ${player.name} (${player.position || 'Feld'})</label>
        `;
        ROSTER_CHECKLIST_CONTAINER.appendChild(playerItem);
    });
}

async function handleSaveRoster() {
    if (!window.checkVerification()) return;
    
    const selectedIds = Array.from(ROSTER_CHECKLIST_CONTAINER.querySelectorAll('input[type="checkbox"]:checked'))
                           .map(input => parseInt(input.value));
                           
    if (selectedIds.length === 0) {
         showMessage(ROSTER_MESSAGE, "❌ Bitte mindestens einen Spieler auswählen.", "error");
         return;
    }
    
    showMessage(ROSTER_MESSAGE, "Speichere Roster...", "info");
    SAVE_ROSTER_BTN.disabled = true;

    try {
        const response = await fetch(`/games/roster/${GAME_ID}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_ids: selectedIds })
        });

        if (response.ok) {
            participatingPlayers = await response.json();
            showMessage(ROSTER_MESSAGE, "✅ Roster erfolgreich gespeichert.", "success");
            renderPlayerButtons(); 
        } else {
             const data = await response.json();
             throw new Error(data.detail || "Roster konnte nicht gespeichert werden.");
        }
    } catch (error) {
        showMessage(ROSTER_MESSAGE, `❌ Fehler: ${error.message}`, "error");
        console.error("Save Roster Error:", error);
    } finally {
        SAVE_ROSTER_BTN.disabled = false;
    }
}

// ==================================================
// --- I N I T I A L I S I E R U N G ---
// ==================================================

function parseJinjaData() {
    const body = document.body;
    const gameId = parseInt(body.dataset.gameId) || null;
    const teamId = parseInt(body.dataset.teamId) || null;
    const videoUrl = body.dataset.videoUrl || null;
    
    return { gameId, teamId, videoUrl };
}

function initProtocol() {
    // 1. Jinja2-Variablen sicher zuweisen
    const matchData = parseJinjaData();
    
    GAME_ID = matchData.gameId;
    TEAM_ID = matchData.teamId;
    PRELOADED_VIDEO_URL = matchData.videoUrl;

    if (!GAME_ID || !TEAM_ID) {
        console.error("KRITISCHER FEHLER: Game-ID oder Team-ID konnte nicht aus dem DOM gelesen werden.");
        window.showToast("Kritischer Fehler: IDs fehlen. Protokoll nicht startbar.", "error");
        return;
    }

    // 2. DOM-Elemente initialisieren
    ACTION_LOG_CONTAINER = document.getElementById('action-log-container');
    PLAYER_BUTTONS_CONTAINER = document.getElementById('player-buttons-container');
    SCORE_BOARD = document.getElementById('score-board');
    SELECTED_PLAYER_INFO = document.getElementById('selected-player-info');
    STATS_TABLE_CONTAINER_FIELD = document.getElementById('stats-table-container-field');
    STATS_TABLE_CONTAINER_GOALIE = document.getElementById('stats-table-container-goalie');
    STATS_TABLE_CONTAINER_CUSTOM = document.getElementById('stats-table-container-custom');
    STATS_TABLE_CONTAINER_OPPONENT = document.getElementById('stats-table-container-opponent');
    CUSTOM_ACTION_BUTTONS_CONTAINER = document.getElementById('custom-action-buttons');
    ROSTER_CHECKLIST_CONTAINER = document.getElementById('roster-checklist-container');
    ROSTER_MESSAGE = document.getElementById('roster-message');
    SAVE_ROSTER_BTN = document.getElementById('save-roster-btn');
    SHOT_MODAL_FULL = document.getElementById('shot-modal-full');
    SHOT_MODAL_TITLE_FULL = document.getElementById('shot-modal-title-full');
    SHOT_MODAL_HALF = document.getElementById('shot-modal-half');
    SHOT_MODAL_TITLE_HALF = document.getElementById('shot-modal-title-half');
    subButtonsContainer = document.getElementById('substitution-buttons');
    videoUrlInput = document.getElementById('video-url-input');
    
    // 3. Initialen Zustand setzen
    setHalf('H1');
    setFilterHalf('ALL'); // Stellt sicher, dass Stats geladen werden
    
    // 4. Roster und Custom Actions laden
    Promise.all([
        loadFullTeamRoster(),
        loadCustomActions()
    ]).then(() => {
        updateAllStats();
        window.showToast("Protokoll-Daten erfolgreich geladen. Wähle Spieler.", "success");
    }).catch(err => {
         console.error("Laden der Initialdaten fehlgeschlagen:", err);
         window.showToast(`Laden der Protokoll-Daten fehlgeschlagen: ${err.message}`, "error");
    });
    
    // 5. Video-URL setzen
    if (videoUrlInput && PRELOADED_VIDEO_URL) {
        videoUrlInput.value = PRELOADED_VIDEO_URL;
    }
    
    // 6. Event Listener
    if (SAVE_ROSTER_BTN) {
        SAVE_ROSTER_BTN.addEventListener('click', handleSaveRoster);
    }
    
    // 7. KORREKTUR: Event Listener für Modal-Klick (hierher verschoben)
    window.addEventListener('click', function(event) {
        // SHOT_MODAL_FULL und SHOT_MODAL_HALF sind jetzt hier definiert
        if ((event.target == SHOT_MODAL_FULL || event.target == SHOT_MODAL_HALF) && typeof closeShotModal === 'function') {
            closeShotModal();
        }
    });
}

document.addEventListener('DOMContentLoaded', initProtocol);