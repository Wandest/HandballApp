// DATEI: frontend/static/protocol.js
// +++ NEU: handleSevenMeterAction hinzugefügt (Phase 12 UX-Verbesserung) +++

// --- Globale Variablen ---
var GAME_ID, TEAM_ID; 
var PRELOADED_VIDEO_URL = null; 

var fullTeamRoster = []; 
var participatingPlayers = []; 
var customActions = [];
var gameActionLog = []; // Speichert alle Aktionen für die Wiederverwendung durch Tabs

var selectedPlayerId = null; 
var activeGoalieId = null; 
var pendingActionType = null;
var pendingIsSevenMeter = false;
var protocolCurrentHalf = 'H1'; 
var currentFilterHalf = 'ALL'; 
var activeLogRow = null; 
var playersOnCourt = new Set(); 

var isGameClockRunning = false; 
var gameHasStarted = false; 

var youtubePlayer = null;

// DOM Elemente
var ACTION_LOG_CONTAINER, PLAYER_BUTTONS_CONTAINER, SCORE_BOARD, SELECTED_PLAYER_INFO, STATS_TABLE_CONTAINER_FIELD, STATS_TABLE_CONTAINER_GOALIE, STATS_TABLE_CONTAINER_CUSTOM, STATS_TABLE_CONTAINER_OPPONENT, CUSTOM_ACTION_BUTTONS_CONTAINER, ROSTER_CHECKLIST_CONTAINER, ROSTER_MESSAGE, SAVE_ROSTER_BTN;
var SHOT_MODAL_FULL, SHOT_MODAL_TITLE_FULL, SHOT_MODAL_HALF, SHOT_MODAL_TITLE_HALF;
var videoUrlInput; 
var onCourtPlayerButtonsContainer, onCourtCount;
var TIMELINE_CONTAINER, TIMELINE_TAB; 
var btnGameStart, btnGamePause, btnGameResume;


// ==================================================
// --- H I L F S F U N K T I O N E N ---
// ==================================================

function formatSeconds(seconds) {
    if (seconds < 0 || isNaN(seconds)) return 'N/A';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function showMessage(element, message, type = 'info') {
    if (!element) return;
    element.textContent = message;
    element.className = `message ${type}`;
}
function leaveProtocol() { 
    window.location.href = "/dashboard"; 
}
window.leaveProtocol = leaveProtocol;

function updateAllStats() {
    // Ruft die Ladefunktion für den *aktuell aktiven Tab* auf
    const activeTabButton = document.querySelector('.tab-nav .tab-button.active');
    const activeTabName = activeTabButton ? activeTabButton.getAttribute('onclick').match(/'(.*?)'/)[1] : 'stats';
    
    setFilterHalf(currentFilterHalf, activeTabName);
    updateScoreDisplay(); 
}
window.updateAllStats = updateAllStats;

function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-nav .tab-button').forEach(button => {
        button.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
    document.querySelector(`.tab-nav .tab-button[onclick="showTab('${tabName}')"]`).classList.add('active');
    
    // Setzt den Filter für den NEUEN Tab (lädt ggf. Daten)
    setFilterHalf(currentFilterHalf, tabName);
    
    if (tabName === 'log') { 
        if (!youtubePlayer && (videoUrlInput.value || PRELOADED_VIDEO_URL)) {
            loadVideo(); 
        }
    }
}
window.showTab = showTab; 

function selectPlayer(playerId, playerName) {
    selectedPlayerId = playerId;
    SELECTED_PLAYER_INFO.textContent = playerName; 
    
    document.querySelectorAll('#on-court-player-buttons-container button').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    const buttonElement = document.getElementById(`on-court-btn-${playerId}`);
    if (buttonElement) {
         buttonElement.classList.add('selected');
    }
}
window.selectPlayer = selectPlayer;

function setHalf(half) {
    protocolCurrentHalf = half;
    document.getElementById('half-btn-H1').classList.remove('active');
    document.getElementById('half-btn-H2').classList.remove('active');
    document.getElementById(`half-btn-${half}`).classList.add('active');
    window.showToast(`Protokoll für ${half} aktiv.`, "success");
    
    if (half === 'H2' && isGameClockRunning) {
        handleGameClock('GAME_PAUSE', true); // 'true' für stilles Pausieren
    }
}
window.setHalf = setHalf;

function setFilterHalf(half, activeTabName = 'stats') {
    currentFilterHalf = half;
    
    // Alle Filter-Button-Gruppen synchronisieren
    const filterGroups = ['filter-btn', 'log-filter-btn', 'timeline-filter-btn'];
    filterGroups.forEach(prefix => {
        ['ALL', 'H1', 'H2'].forEach(h => {
            const btn = document.getElementById(`${prefix}-${h}`);
            if (btn) {
                btn.classList.remove('active');
                if (h === half) {
                    btn.classList.add('active');
                }
            }
        });
    });

    // Lade die Daten für den aktiven Tab
    if (activeTabName === 'stats') {
        loadStats();
        loadOpponentStats();
    } else if (activeTabName === 'log' || activeTabName === 'timeline') {
        // Log und Timeline benötigen beide das ActionLog
        loadActionLog();
    }
}
window.setFilterHalf = setFilterHalf;


// ==================================================
// --- SPIELUHR (Phase 10.5 Stoppuhr) ---
// ==================================================

function handleGameClock(actionType, silent = false) {
    
    let originalActionType = actionType;
    if (actionType === 'GAME_RESUME') {
        actionType = 'GAME_START'; 
    }
    
    if (actionType === 'GAME_START') {
        if (isGameClockRunning) return; 
        isGameClockRunning = true;
        gameHasStarted = true; 
        logActionToBackend(actionType, null); 
        if (!silent) window.showToast("Spieluhr gestartet!", "success");
        
    } else if (actionType === 'GAME_PAUSE') {
        if (!isGameClockRunning) return; 
        isGameClockRunning = false;
        logActionToBackend(actionType, null);
        if (!silent) window.showToast("Spieluhr angehalten (Timeout/Pause).", "info");
    }
    
    updateGameClockUI();
}
window.handleGameClock = handleGameClock;

function updateGameClockUI() {
    if (!gameHasStarted) {
        btnGameStart.style.display = 'block';
        btnGamePause.style.display = 'none';
        btnGameResume.style.display = 'none';
    } else if (isGameClockRunning) {
        btnGameStart.style.display = 'none';
        btnGamePause.style.display = 'block';
        btnGameResume.style.display = 'none';
    } else {
        btnGameStart.style.display = 'none';
        btnGamePause.style.display = 'none';
        btnGameResume.style.display = 'block';
    }
}


// ==================================================
// --- EIN/AUSWECHSELN (Phase 10.5 Workflow) ---
// ==================================================

function toggleSubstitution(playerId, playerName, isGoalie) {
    if (playersOnCourt.has(playerId)) {
        // --- AUSWECHSELN ---
        playersOnCourt.delete(playerId);
        logActionToBackend('SubOut', playerId);
        window.showToast(`${playerName} ausgewechselt.`, "info");
        
        if (activeGoalieId === playerId) {
            activeGoalieId = null;
        }
        if (selectedPlayerId === playerId) {
            selectedPlayerId = null;
            SELECTED_PLAYER_INFO.textContent = "Keiner";
        }

    } else {
        // --- EINWECHSELN ---
        if (playersOnCourt.size >= 7) {
            window.showToast("Maximal 7 Spieler auf dem Feld.", "error");
            return;
        }
        playersOnCourt.add(playerId);
        logActionToBackend('SubIn', playerId);
        window.showToast(`${playerName} eingewechselt.`, "success");
        
        if (isGoalie) {
            participatingPlayers.forEach(p => {
                if (p.position === 'Torwart' && p.id !== playerId && playersOnCourt.has(p.id)) {
                    playersOnCourt.delete(p.id);
                    logActionToBackend('SubOut', p.id);
                    window.showToast(`${p.name} (TW) automatisch ausgewechselt.`, "info");
                }
            });
            activeGoalieId = playerId;
        }
    }
    
    renderPlayerButtons(); 
    renderOnCourtButtons();
}
window.toggleSubstitution = toggleSubstitution;

function renderOnCourtButtons() {
    onCourtPlayerButtonsContainer.innerHTML = '';
    onCourtCount.textContent = playersOnCourt.size;
    
    if (playersOnCourt.size === 0) {
        onCourtPlayerButtonsContainer.innerHTML = '<p style="opacity: 0.6; text-align: center; font-size: 0.9em; padding: 20px 0;">Bitte Spieler (unten) einwechseln.</p>';
        return;
    }
    
    let isSelectedPlayerStillOnCourt = false;

    const players = participatingPlayers.filter(p => playersOnCourt.has(p.id));
    players.sort((a, b) => (a.number || 999) - (b.number || 999));

    players.forEach(player => {
        const btn = document.createElement('button');
        btn.id = `on-court-btn-${player.id}`;
        btn.className = 'btn btn-on-court';
        const numberDisplay = player.number ? `#${player.number} ` : '';
        btn.textContent = `${numberDisplay}${player.name}`;
        
        btn.onclick = () => selectPlayer(player.id, btn.textContent);
        
        if (player.id === selectedPlayerId) {
            btn.classList.add('selected');
            isSelectedPlayerStillOnCourt = true;
        }
        
        onCourtPlayerButtonsContainer.appendChild(btn);
    });
    
    if (!isSelectedPlayerStillOnCourt) {
        selectedPlayerId = null;
        SELECTED_PLAYER_INFO.textContent = "Keiner";
    }
}


// ==================================================
// --- MODAL- & AKTIONSLOGIK ---
// ==================================================

function showShotModal(actionType, isSevenMeter) {
    let playerId = selectedPlayerId;
    let playerName = SELECTED_PLAYER_INFO.textContent;

    if (actionType.startsWith('Opp')) {
        playerId = 'opponent';
        playerName = 'Gegner';
    }

     if (!playerId) {
        window.showToast("Bitte zuerst einen Spieler (links oben) auswählen.", "error");
        return;
    }
    
    if (!isGameClockRunning && !(actionType.startsWith('Opp'))) {
        window.showToast("Spieluhr läuft nicht. Aktion wird geloggt, aber Zeitmessung ist evtl. inkorrekt.", "error");
    }
    
    pendingActionType = actionType;
    pendingIsSevenMeter = isSevenMeter;
    selectedPlayerId = playerId; 

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
        server_timestamp: new Date().toISOString() 
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
        const silentActions = ['SubIn', 'SubOut', 'GAME_START', 'GAME_PAUSE']; 
        if (!silentActions.includes(actionType)) {
             window.showToast(`Aktion: ${actionType} gespeichert.`, "success");
        }
        updateAllStats();
        
    } catch (error) {
        window.showToast(`Fehler: ${error.message}`, "error");
        console.error("Log Action Error:", error);
    }
}
window.logActionToBackend = logActionToBackend; 

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

function handleAction(actionType) {
    if (!selectedPlayerId || selectedPlayerId === 'opponent') {
        window.showToast("Bitte zuerst einen Spieler (links oben) auswählen.", "error");
        return;
    }
    if (!isGameClockRunning) {
        window.showToast("Spieluhr läuft nicht. Aktion wird geloggt, aber Zeitmessung ist evtl. inkorrekt.", "error");
    }
    logActionToBackend(actionType, selectedPlayerId, null, null, false, null);
}
window.handleAction = handleAction;

// +++ NEUE FUNKTION (ersetzt showShotModal für 7m) +++
function handleSevenMeterAction(actionType) {
    if (!selectedPlayerId || selectedPlayerId === 'opponent') {
        window.showToast("Bitte zuerst einen Spieler (links oben) auswählen.", "error");
        return;
    }
    if (!isGameClockRunning) {
        window.showToast("Spieluhr läuft nicht. Aktion wird geloggt, aber Zeitmessung ist evtl. inkorrekt.", "error");
    }
    
    // Loggt die Aktion direkt, ohne Wurfbild, aber mit activeGoalieId
    logActionToBackend(actionType, selectedPlayerId, null, null, true, activeGoalieId);
}
window.handleSevenMeterAction = handleSevenMeterAction;

function handleOpponentAction(actionType) {
    if (!isGameClockRunning) {
        window.showToast("Spieluhr läuft nicht. Aktion wird geloggt, aber Zeitmessung ist evtl. inkorrekt.", "error");
    }
    if (actionType === 'OppGoal' || actionType === 'OppMiss') {
        showShotModal(actionType, false);
    } else {
        logActionToBackend(actionType, 'opponent', null, null, false, activeGoalieId);
    }
}
window.handleOpponentAction = handleOpponentAction;

function handleGoalieAction(actionType) {
     if (!activeGoalieId) {
        window.showToast("Bitte einen Torwart (links unten) einwechseln, um ihn als aktiv zu setzen.", "error");
        return;
    }
    if (!isGameClockRunning) {
        window.showToast("Spieluhr läuft nicht. Aktion wird geloggt, aber Zeitmessung ist evtl. inkorrekt.", "error");
    }
    
    const goalie = participatingPlayers.find(p => p.id === activeGoalieId);
    const goalieName = goalie ? (goalie.number ? `#${goalie.number} ` : '') + goalie.name : 'Torwart';
    
    selectPlayer(activeGoalieId, goalieName);
    
    logActionToBackend(actionType, activeGoalieId, null, null, false, activeGoalieId);
}
window.handleGoalieAction = handleGoalieAction;


// ==================================================
// --- STATISTIK LADEN & ANZEIGEN (unverändert) ---
// ==================================================

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
    
    let total = { goals: 0, misses: 0, seven_meter_goals: 0, seven_meter_misses: 0, tech_errors: 0, fehlpaesse: 0, seven_meter_caused: 0, time_on_court_seconds: 0 };
    let totalGoalie = { saves: 0, opponent_goals_received: 0, seven_meter_saves: 0, seven_meter_received: 0, time_on_court_seconds: 0 };


    const rosterPlayers = participatingPlayers.map(p => {
        const playerStats = stats.find(s => s.player_id === p.id);
        if (playerStats) {
            return playerStats;
        }
        return {
            player_id: p.id,
            player_name: p.name,
            player_number: p.number,
            position: p.position,
            games_played: 0, goals: 0, misses: 0, tech_errors: 0, fehlpaesse: 0,
            seven_meter_goals: 0, seven_meter_misses: 0, seven_meter_caused: 0,
            seven_meter_saves: 0, seven_meter_received: 0, saves: 0,
            opponent_goals_received: 0, custom_counts: {},
            time_on_court_seconds: 0, time_on_court_display: '00:00'
        };
    });

    rosterPlayers.forEach(player => {
        const timeDisplay = formatSeconds(player.time_on_court_seconds || 0);
        
        if (player.position === 'Torwart') {
            goaliesFound = true;
            totalGoalie.saves += player.saves || 0;
            totalGoalie.opponent_goals_received += player.opponent_goals_received || 0;
            totalGoalie.seven_meter_saves += player.seven_meter_saves || 0;
            totalGoalie.seven_meter_received += player.seven_meter_received || 0;
            totalGoalie.time_on_court_seconds += player.time_on_court_seconds || 0;

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
            total.goals += player.goals || 0;
            total.misses += player.misses || 0;
            total.seven_meter_goals += player.seven_meter_goals || 0;
            total.seven_meter_misses += player.seven_meter_misses || 0;
            total.tech_errors += player.tech_errors || 0;
            total.fehlpaesse += player.fehlpaesse || 0;
            total.seven_meter_caused += player.seven_meter_caused || 0;
            total.time_on_court_seconds += player.time_on_court_seconds || 0;

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
        
        customTableHtml += `<tr><td>${player.player_name}</td><td>${player.player_number || ''}</td>`;
        customActionNames.forEach(name => {
            customTableHtml += `<td>${player.custom_counts[name] || 0}</td>`;
        });
        customTableHtml += `</tr>`;
    });
    
    // --- TOTAL FÜR FELDSPIELER ---
    const totalShots = total.goals + total.misses;
    const totalQuote = totalShots > 0 ? ((total.goals / totalShots) * 100).toFixed(0) + '%' : '—';
    const totalSevenMeterAttempts = total.seven_meter_goals + total.seven_meter_misses;
    const totalTimeDisplay = formatSeconds(total.time_on_court_seconds);
    
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
    
    // --- TOTAL FÜR TORWART ---
    const totalGoalieShots = totalGoalie.saves + totalGoalie.opponent_goals_received;
    const totalGoalieQuote = totalGoalieShots > 0 ? ((totalGoalie.saves / totalGoalieShots) * 100).toFixed(0) + '%' : '—';
    const totalGoalie7m = totalGoalie.seven_meter_saves + totalGoalie.seven_meter_received;
    const totalGoalieTimeDisplay = formatSeconds(totalGoalie.time_on_court_seconds);

    goalieTableHtml += `</tbody><tfoot><tr>
        <td>TOTAL</td><td></td>
        <td>${totalGoalie.saves}</td>
        <td>${totalGoalie.opponent_goals_received}</td>
        <td>${totalGoalieQuote}</td>
        <td>${totalGoalie.seven_meter_saves} / ${totalGoalie7m}</td>
        <td>${totalGoalieTimeDisplay}</td>
    </tr></tfoot></table>`;
    
    customTableHtml += '</tbody></table>';
    
    STATS_TABLE_CONTAINER_FIELD.innerHTML = fieldPlayersFound ? fieldTableHtml : '<p style="opacity: 0.6; text-align: center;">Keine Feldspieler im Roster oder auf dem Feld.</p>';
    STATS_TABLE_CONTAINER_GOALIE.innerHTML = goaliesFound ? goalieTableHtml : '<p style="opacity: 0.6; text-align: center;">Keine Torhüter im Roster oder auf dem Feld.</p>';
    STATS_TABLE_CONTAINER_CUSTOM.innerHTML = customActionNames.length > 0 ? customTableHtml : '<p style="opacity: 0.6; text-align: center;">Keine Team-Aktionen definiert.</p>';
}


// ==================================================
// --- LOG & VIDEO (unverändert) ---
// ==================================================

function renderSubstitutionTimeline(actions) {
    if (!TIMELINE_CONTAINER) return;
    TIMELINE_CONTAINER.innerHTML = ''; 

    // Finde die Start- und Endzeit der Uhr in diesem Filter
    const clockActions = actions.filter(a => a.action_type === 'GAME_START' || a.action_type === 'GAME_PAUSE');
    if (clockActions.length === 0) {
        TIMELINE_CONTAINER.innerHTML = '<p style="opacity: 0.6;">Spieluhr in dieser Hälfte nicht gestartet.</p>';
        return;
    }
    
    const gameStartTime = new Date(clockActions[0].server_timestamp).getTime();
    let gameEndTime = new Date(clockActions[clockActions.length - 1].server_timestamp).getTime();
    
    if (clockActions[clockActions.length - 1].action_type === 'GAME_START') {
        gameEndTime = new Date().getTime();
    }
    
    const totalDisplayDuration = gameEndTime - gameStartTime;
    if (totalDisplayDuration <= 0) {
        TIMELINE_CONTAINER.innerHTML = '<p style="opacity: 0.6;">Spiel-Dauer ist null oder negativ.</p>';
        return;
    }

    const playerIntervals = new Map(); 
    const onCourtMap = new Map(); 

    actions.forEach(action => {
        const actionTime = new Date(action.server_timestamp).getTime();
        const playerId = action.player_id;

        if (action.action_type === 'SubIn' && playerId) {
            onCourtMap.set(playerId, actionTime); 
        } else if (action.action_type === 'SubOut' && playerId) {
            if (onCourtMap.has(playerId)) {
                const inTime = onCourtMap.get(playerId);
                const interval = { start: inTime, end: actionTime };
                if (!playerIntervals.has(playerId)) playerIntervals.set(playerId, []);
                playerIntervals.get(playerId).push(interval);
                onCourtMap.delete(playerId); 
            }
        }
    });

    onCourtMap.forEach((inTime, playerId) => {
        const interval = { start: inTime, end: gameEndTime }; 
        if (!playerIntervals.has(playerId)) playerIntervals.set(playerId, []);
        playerIntervals.get(playerId).push(interval);
    });

    participatingPlayers.forEach(player => {
        if (!playerIntervals.has(player.id)) return; 

        const intervals = playerIntervals.get(player.id);
        const isGoalie = player.position === 'Torwart';
        const number = player.number ? `#${player.number} ` : '';

        let rowHtml = `
            <div class="timeline-row">
                <div class="timeline-label" title="${number}${player.name}">${number}${player.name}</div>
                <div class="timeline-bar-container">
        `;
        
        intervals.forEach(interval => {
            const leftPercent = Math.max(0, ((interval.start - gameStartTime) / totalDisplayDuration) * 100);
            const widthPercent = Math.max(0.5, ((interval.end - interval.start) / totalDisplayDuration) * 100); 
            const barClass = isGoalie ? 'timeline-bar goalkeeper' : 'timeline-bar';
            
            rowHtml += `<div class="${barClass}" style="left: ${leftPercent}%; width: ${widthPercent}%;"></div>`;
        });

        rowHtml += `</div></div>`;
        TIMELINE_CONTAINER.innerHTML += rowHtml;
    });

    if (TIMELINE_CONTAINER.innerHTML === '') {
         TIMELINE_CONTAINER.innerHTML = '<p style="opacity: 0.6;">Keine SubIn/SubOut-Aktionen in diesem Log-Filter gefunden.</p>';
    }
}


async function loadActionLog() {
    ACTION_LOG_CONTAINER.innerHTML = '<p style="opacity: 0.6; text-align: center;">Lade Aktions-Log...</p>';
    TIMELINE_CONTAINER.innerHTML = '<p style="opacity: 0.6;">Lade Timeline-Daten...</p>'; 
    try {
        const response = await fetch(`/actions/list/${GAME_ID}?half=${currentFilterHalf}`);
        if (response.status === 401) { window.logout(); return; }
        if (!response.ok) throw new Error("Aktions-Log nicht gefunden.");
        
        gameActionLog = await response.json(); 
        
        renderSubstitutionTimeline(gameActionLog); 
        renderActionLog(gameActionLog); 

    } catch (error) {
        ACTION_LOG_CONTAINER.innerHTML = `<p class="error">${error.message}</p>`;
        TIMELINE_CONTAINER.innerHTML = `<p class="error">Timeline-Fehler: ${error.message}</p>`;
        console.error("Action Log Error:", error);
    }
}

function renderActionLog(actions) {
    playersOnCourt.clear();
    activeGoalieId = null;
    isGameClockRunning = false; 
    gameHasStarted = false; 
    
    if (actions.length === 0) {
        ACTION_LOG_CONTAINER.innerHTML = '<p style="opacity: 0.6; text-align: center;">Keine Aktionen in dieser Hälfte.</p>';
        updateGameClockUI(); 
        renderPlayerButtons(); 
        renderOnCourtButtons();
        return;
    }
    
    let logHtml = '<table class="log-table"><thead><tr><th>Hälfte</th><th>Zeitstempel</th><th>Spieler</th><th>Aktion</th></tr></thead><tbody>';
    
    actions.forEach(action => {
        const timeClass = action.video_timestamp ? 'log-time-cell' : 'log-time-cell no-time';
        const timeDisplay = action.video_timestamp || '00:00';
        const playerName = action.player_name || (action.action_type.startsWith('Opp') ? 'Gegner' : 'Team');
        
        let rowClass = '';
        if (action.action_type === 'GAME_START' || action.action_type === 'GAME_PAUSE') {
            rowClass = 'style="background-color: rgba(255, 204, 0, 0.1); color: #ffcc00;"';
        }

        logHtml += `<tr id="log-row-${action.id}" onclick="handleLogClick(${action.id}, '${action.video_timestamp}')" ${rowClass}>
            <td>${action.time_in_game}</td>
            <td class="${timeClass}" id="log-time-${action.id}">${timeDisplay}</td>
            <td>${playerName}</td>
            <td>${action.action_type}</td>
        </tr>`;
        
        if (action.action_type === 'GAME_START') { 
            isGameClockRunning = true;
            gameHasStarted = true;
        } else if (action.action_type === 'GAME_PAUSE') {
            isGameClockRunning = false;
        }
        
        if (action.action_type === 'SubIn' && action.player_id) {
            playersOnCourt.add(action.player_id);
            const player = fullTeamRoster.find(p => p.id === action.player_id);
            if (player && player.position === 'Torwart') {
                activeGoalieId = player.id;
            }
        } else if (action.action_type === 'SubOut' && action.player_id) {
            playersOnCourt.delete(action.player_id);
            if (activeGoalieId === action.player_id) {
                activeGoalieId = null;
            }
        }
    });
    
    logHtml += '</tbody></table>';
    ACTION_LOG_CONTAINER.innerHTML = logHtml;
    
    updateGameClockUI(); 
    renderPlayerButtons(); 
    renderOnCourtButtons(); 
}

function loadVideo() {
    // Implementierung (YouTube API)
}
window.loadVideo = loadVideo;

function handleLogClick(actionId, timestamp) {
    window.showToast(`Klick auf Log-Zeile ${actionId} (Zeit: ${timestamp || 'N/A'})`, 'info');
    // Implementierung für Video-Schnitt
}
window.handleLogClick = handleLogClick;


// ==================================================
// --- ROSTER (KADER) (unverändert) ---
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
            btn.className = `btn action-button btn-custom btn-custom-${categoryClass}`;
            btn.textContent = action.name;
            btn.onclick = () => showShotModal(action.name, false); 
            CUSTOM_ACTION_BUTTONS_CONTAINER.appendChild(btn);
        });
    } catch (error) {
        CUSTOM_ACTION_BUTTONS_CONTAINER.innerHTML = `<p class="error">Aktionen fehlgeschlagen: ${error.message}</p>`;
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
        PLAYER_BUTTONS_CONTAINER.innerHTML = `<p class="error">Kader fehlgeschlagen: ${error.message}</p>`;
        ROSTER_CHECKLIST_CONTAINER.innerHTML = `<p class="error">Kader fehlgeschlagen: ${error.message}</p>`;
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
        btn.className = 'btn-kader'; 
        
        if (isGoalie) {
            btn.classList.add('goalkeeper');
        }
        if (playersOnCourt.has(player.id)) {
            btn.classList.add('on-court');
        }
        if (activeGoalieId === player.id) {
             btn.classList.add('active-goalie');
        }

        const numberDisplay = player.number ? `#${player.number} ` : '';
        btn.textContent = `${numberDisplay}${player.name}`;
        
        btn.onclick = () => toggleSubstitution(player.id, btn.textContent, isGoalie);
        
        PLAYER_BUTTONS_CONTAINER.appendChild(btn);
    });
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
    
    const newRosterIds = new Set(selectedIds);
    const playersToRemoveFromCourt = [];
    playersOnCourt.forEach(playerId => {
        if (!newRosterIds.has(playerId)) {
            playersToRemoveFromCourt.push(playerId);
        }
    });
    
    playersToRemoveFromCourt.forEach(playerId => {
        if (isGameClockRunning) {
            logActionToBackend('SubOut', playerId);
        }
        playersOnCourt.delete(playerId);
    });
    if (playersToRemoveFromCourt.length > 0) {
        window.showToast("Spieler, die vom Roster entfernt wurden, wurden automatisch ausgewechselt.", "info");
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
            renderOnCourtButtons(); 
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
    // 1. Jinja2-Variablen
    const matchData = parseJinjaData();
    GAME_ID = matchData.gameId;
    TEAM_ID = matchData.teamId;
    PRELOADED_VIDEO_URL = matchData.videoUrl;

    if (!GAME_ID || !TEAM_ID) {
        console.error("KRITISCHER FEHLER: Game-ID oder Team-ID konnte nicht aus dem DOM gelesen werden.");
        window.showToast("Kritischer Fehler: IDs fehlen. Protokoll nicht startbar.", "error");
        return;
    }

    // 2. DOM-Elemente
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
    videoUrlInput = document.getElementById('video-url-input');
    
    onCourtPlayerButtonsContainer = document.getElementById('on-court-player-buttons-container');
    onCourtCount = document.getElementById('on-court-count');
    TIMELINE_CONTAINER = document.getElementById('timeline-container');
    TIMELINE_TAB = document.getElementById('timeline-tab'); 
    
    btnGameStart = document.getElementById('btn-game-start');
    btnGamePause = document.getElementById('btn-game-pause');
    btnGameResume = document.getElementById('btn-game-resume');
    
    // 3. Initialen Zustand setzen
    setHalf('H1');
    setFilterHalf('ALL', 'stats'); // Startet auf dem Stats-Tab
    
    // 4. Roster und Custom Actions laden
    Promise.all([
        loadFullTeamRoster(),
        loadCustomActions()
    ]).then(() => {
        loadActionLog();
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
    
    // 7. Event Listener für Modal-Klick
    window.addEventListener('click', function(event) {
        if ((event.target == SHOT_MODAL_FULL || event.target == SHOT_MODAL_HALF) && typeof closeShotModal === 'function') {
            closeShotModal();
        }
    });
}

document.addEventListener('DOMContentLoaded', initProtocol);