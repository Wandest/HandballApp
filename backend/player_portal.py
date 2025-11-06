# DATEI: backend/player_portal.py (Finaler Absagegrund Fix und Statistik/Clips Routen)
# +++ NEU: Implementierung von /portal/stats und /portal/clips +++

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import List, Dict, Any, Optional
import re
from sqlalchemy import func, case, and_, distinct, or_
from datetime import datetime, timedelta 

from backend.database import (
    SessionLocal, Player, Game, Action, CustomAction, 
    game_participations_table, TeamEvent, Attendance, AttendanceStatus
)
from backend.auth import get_current_player_only
from backend.action import PlayerStats, ActionPlaylistResponse
from backend.time_tracking import (
    calculate_all_player_times, 
    format_seconds,
    # HIER FEHLTEN DIE IMPORTE:
    get_clock_intervals, 
    get_player_intervals 
)

router = APIRouter(
    prefix="/portal",
    tags=["Player Portal"],
    dependencies=[Depends(get_current_player_only)]
)

# Datenbanksession
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ==================================================
# Pydantic Modelle 
# ==================================================

class PlayerEventResponse(BaseModel):
    id: int
    title: str
    event_type: str
    start_time: datetime
    end_time: Optional[datetime] = None
    location: Optional[str] = None
    description: Optional[str] = None
    
    my_status: str # Sende Status als String
    my_reason: Optional[str] = None
    
    response_deadline_hours: Optional[int] = None
    
    class Config:
        from_attributes = True

class PlayerAttendanceUpdate(BaseModel):
    # Status muss der ENUM NAME sein (z.B. 'ATTENDING', 'DECLINED')
    status: str 
    reason: Optional[str] = None

# ==================================================
# NEUE ENDPUNKTE: Spieler-Statistiken (Phase 10)
# ==================================================

@router.get("/stats", response_model=Dict[str, str])
def get_my_season_stats(
    current_player: Player = Depends(get_current_player_only),
    db: Session = Depends(get_db)
):
    """
    Berechnet und liefert die Saison-Statistik NUR für den aktuellen Spieler,
    getrennt nach Feldspieler- und Torwart-Sektion.
    """
    player_id = current_player.id
    team_id = current_player.team_id
    
    # --- 1. Datenbasis laden (entspricht Logik aus action.py::get_season_stats, aber gefiltert) ---
    saison_games = db.query(Game).filter(
        Game.team_id == team_id,
        Game.game_category == 'Saison'
    ).all()
    saison_game_ids = [g.id for g in saison_games]

    if not saison_game_ids:
         return {"field_stats": "", "goalie_stats": "", "custom_stats": ""}

    player_ids = [player_id] # Nur der aktuelle Spieler
    custom_actions = db.query(CustomAction).filter(CustomAction.team_id == team_id).all()
    custom_action_names = [ca.name for ca in custom_actions]

    action_subquery = db.query(Action).filter(Action.game_id.in_(saison_game_ids)).subquery()

    # Case Statements für die Aktionen
    case_statements = [
        func.count(case((action_subquery.c.action_type == 'Goal', 1), else_=None)).label('goals'),
        func.count(case((action_subquery.c.action_type == 'Miss', 1), else_=None)).label('misses'),
        func.count(case((action_subquery.c.action_type == 'TechError', 1), else_=None)).label('tech_errors'),
        func.count(case((action_subquery.c.action_type == 'Fehlpass', 1), else_=None)).label('fehlpaesse'),
        func.count(case((action_subquery.c.action_type == 'Goal_7m', 1), else_=None)).label('seven_meter_goals'),
        func.count(case((action_subquery.c.action_type == 'Miss_7m', 1), else_=None)).label('seven_meter_misses'),
        func.count(case((action_subquery.c.action_type == 'SEVEN_METER_CAUSED', 1), else_=None)).label('seven_meter_caused'),
        func.count(case((action_subquery.c.action_type == 'Save', 1), else_=None)).label('saves'),
        func.count(case((action_subquery.c.action_type == 'SEVEN_METER_SAVE', 1), else_=None)).label('seven_meter_saves'),
        func.count(case((action_subquery.c.action_type == 'SEVEN_METER_RECEIVED', 1), else_=None)).label('seven_meter_received'),
        func.count(case(
            (and_(action_subquery.c.action_type == 'OppGoal', action_subquery.c.active_goalie_id == Player.id), 1),
            else_=None
        )).label('opponent_goals_received'),
    ]
    
    # Custom Action Statements
    safe_custom_labels = {}
    for name in custom_action_names:
        safe_label = f"custom_{re.sub(r'[^A-Za-z09_]', '_', name)}"
        safe_custom_labels[name] = safe_label
        case_statements.append(
            func.count(case((action_subquery.c.action_type == name, 1), else_=None)).label(safe_label)
        )

    # Spiele teilgenommen (Game Participation)
    games_played_subquery = (
        db.query(
            game_participations_table.c.player_id,
            func.count(distinct(game_participations_table.c.game_id)).label("games_played"),
        )
        .join(Game, Game.id == game_participations_table.c.game_id)
        .filter(Game.game_category == 'Saison', Game.team_id == team_id, game_participations_table.c.player_id == player_id)
        .group_by(game_participations_table.c.player_id)
        .subquery()
    )
    
    stats_query = (
        db.query(
            Player.id, Player.name, Player.number, Player.position,
            func.coalesce(games_played_subquery.c.games_played, 0).label("games_played"),
            *case_statements
        )
        .select_from(Player)
        .outerjoin(action_subquery, 
            or_(
                (action_subquery.c.player_id == Player.id), 
                (action_subquery.c.active_goalie_id == Player.id)
            )
        )
        .outerjoin(games_played_subquery, games_played_subquery.c.player_id == Player.id)
        .filter(Player.id == player_id) # NUR der aktuelle Spieler
        .group_by(Player.id, Player.name, Player.number, Player.position, games_played_subquery.c.games_played)
    )
    
    stats_result = stats_query.first()
    
    if not stats_result:
        return {"field_stats": "", "goalie_stats": "", "custom_stats": ""}

    # --- 2. Zeitberechnung (komplex, daher manuell aggregiert) ---
    # Die Funktionen müssen importiert werden, da sie nicht intern in dieser Datei sind
    all_clock_intervals_map = {game.id: get_clock_intervals(db, game.id) for game in saison_games} 
    all_player_intervals_map = {game.id: get_player_intervals(db, game.id) for game in saison_games} 
    
    total_time_on_court_seconds = 0
    for game in saison_games:
        # Wir müssen die calculate_all_player_times-Funktion für jedes Spiel aufrufen, um die
        # Zeit zu berechnen.
        player_time_for_game = calculate_all_player_times(db, game.id, [player_id], 'ALL').get(player_id, 0)
        total_time_on_court_seconds += player_time_for_game

    # --- 3. Pydantic Modell erstellen und HTML rendern ---
    row_data = stats_result._asdict()
    custom_counts_dict = {name: row_data.get(safe_label, 0) for name, safe_label in safe_custom_labels.items()}
    
    player_stats_data = PlayerStats(
        player_id=player_id, 
        player_name=row_data.get('name'),
        player_number=row_data.get('number'), 
        position=row_data.get('position'),
        games_played=row_data.get('games_played', 0), 
        goals=row_data.get('goals', 0),
        misses=row_data.get('misses', 0),
        tech_errors=row_data.get('tech_errors', 0),
        fehlpaesse=row_data.get('fehlpaesse', 0), 
        seven_meter_goals=row_data.get('seven_meter_goals', 0),
        seven_meter_misses=row_data.get('seven_meter_misses', 0),
        seven_meter_caused=row_data.get('seven_meter_caused', 0),
        seven_meter_saves=row_data.get('seven_meter_saves', 0),
        seven_meter_received=row_data.get('seven_meter_received', 0),
        saves=row_data.get('saves', 0),
        opponent_goals_received=row_data.get('opponent_goals_received', 0),
        custom_counts=custom_counts_dict,
        time_on_court_seconds=total_time_on_court_seconds, 
        time_on_court_display=format_seconds(total_time_on_court_seconds)
    )

    is_goalie = player_stats_data.position == 'Torwart'

    # --- 4. HTML-Generierung (nur die benötigte Sektion) ---
    field_html = ""
    goalie_html = ""
    
    # A. Feldspieler-Tabelle
    if not is_goalie and player_stats_data.games_played > 0:
        total_goals = player_stats_data.goals + player_stats_data.seven_meter_goals
        total_shots = total_goals + player_stats_data.misses + player_stats_data.seven_meter_misses
        # WICHTIG: Die JavaScript-Funktion .toFixed(0) ist in Python nicht verfügbar. Wir nutzen Python-String-Formatierung.
        shot_quote = f"{round((total_goals / total_shots) * 100)}%" if total_shots > 0 else '—'
        seven_meter_attempts = player_stats_data.seven_meter_goals + player_stats_data.seven_meter_misses
        tore_pro_spiel = f"{total_goals / player_stats_data.games_played:.1f}" if player_stats_data.games_played > 0 else '0.0'
        
        field_html = f"""
            <table class="stats-table">
                <thead><tr>
                    <th>Spiele</th>
                    <th>Zeit (M:S)</th>
                    <th>Tore ges.</th>
                    <th>Fehlwürfe</th>
                    <th>Quote</th>
                    <th>Tore/Spiel</th>
                    <th>7m G/A</th>
                    <th>Tech. Fehler</th>
                    <th>Fehlpässe</th>
                    <th>7m Ver.</th>
                </tr></thead>
                <tbody>
                    <tr>
                        <td>{player_stats_data.games_played}</td>
                        <td>{player_stats_data.time_on_court_display}</td>
                        <td>{total_goals}</td>
                        <td>{player_stats_data.misses + player_stats_data.seven_meter_misses}</td>
                        <td>{shot_quote}</td>
                        <td>{tore_pro_spiel}</td>
                        <td>{player_stats_data.seven_meter_goals}/{seven_meter_attempts}</td>
                        <td>{player_stats_data.tech_errors}</td>
                        <td>{player_stats_data.fehlpaesse}</td>
                        <td>{player_stats_data.seven_meter_caused}</td>
                    </tr>
                </tbody>
            </table>
        """
        
    # B. Torwart-Tabelle
    if is_goalie and player_stats_data.games_played > 0:
        total_shots_on_goal = player_stats_data.saves + player_stats_data.opponent_goals_received
        save_quote = f"{round((player_stats_data.saves / total_shots_on_goal) * 100)}%" if total_shots_on_goal > 0 else '—'
        seven_meter_total = player_stats_data.seven_meter_saves + player_stats_data.seven_meter_received
        seven_meter_quote = f"{round((player_stats_data.seven_meter_saves / seven_meter_total) * 100)}%" if seven_meter_total > 0 else '—'
        
        goalie_html = f"""
            <table class="stats-table">
                <thead><tr>
                    <th>Spiele</th>
                    <th>Zeit (M:S)</th>
                    <th>Paraden ges.</th>
                    <th>Gegentore</th>
                    <th>Paraden Quote</th>
                    <th>7m P/G</th>
                </tr></thead>
                <tbody>
                    <tr>
                        <td>{player_stats_data.games_played}</td>
                        <td>{player_stats_data.time_on_court_display}</td>
                        <td>{player_stats_data.saves}</td>
                        <td>{player_stats_data.opponent_goals_received}</td>
                        <td>{save_quote}</td>
                        <td>{player_stats_data.seven_meter_saves} / {seven_meter_total} ({seven_meter_quote})</td>
                    </tr>
                </tbody>
            </table>
        """
    
    # C. Custom-Aktionen-Tabelle
    custom_html = ""
    if player_stats_data.custom_counts and len(player_stats_data.custom_counts) > 0:
        # Nur Aktionen anzeigen, die > 0 sind
        filtered_custom_counts = {k: v for k, v in player_stats_data.custom_counts.items() if v > 0}
        if filtered_custom_counts:
            custom_html = '<table class="stats-table"><thead><tr><th>Aktion</th><th>Anzahl</th></tr></thead><tbody>'
            for action_name, count in filtered_custom_counts.items():
                custom_html += f'<tr><td>{action_name}</td><td>{count}</td></tr>'
            custom_html += '</tbody></table>'


    return {
        "field_stats": field_html,
        "goalie_stats": goalie_html,
        "custom_stats": custom_html,
    }


@router.get("/clips", response_model=List[ActionPlaylistResponse])
def get_my_season_clips(
    current_player: Player = Depends(get_current_player_only),
    db: Session = Depends(get_db)
):
    """
    Listet alle Aktionen mit Video-Timestamp für den aktuellen Spieler in Saisonspielen auf.
    """
    team_id = current_player.team_id
    player_id = current_player.id

    saison_game_ids = [g.id for g in db.query(Game).filter(
        Game.team_id == team_id,
        Game.game_category == 'Saison',
        Game.video_url.isnot(None)
    ).all()]
    
    if not saison_game_ids:
        return []

    # Suche nach allen Aktionen, die der Spieler als Feldspieler ODER als Torwart
    # (falls es eine Torwart-Aktion ist) durchgeführt hat.
    # WICHTIG: Die Aktionen 'OppGoal' und 'OppMiss' haben KEINE player_id
    actions_query = db.query(Action).join(Game).filter(
        Action.game_id.in_(saison_game_ids),
        Action.video_timestamp.isnot(None),
        or_(
            Action.player_id == player_id,
            Action.active_goalie_id == player_id
        )
    ).order_by(Action.server_timestamp.asc())
    
    actions = actions_query.all()
    
    response_list = []
    
    # Da wir den Spieler bereits kennen, brauchen wir nur die Spieldaten
    game_map = {g.id: g for g in db.query(Game).filter(Game.id.in_(saison_game_ids)).all()}
    
    for action in actions:
        game = game_map.get(action.game_id)
        if not game: continue
        
        # Sicherstellen, dass nur Aktionen, die dem Spieler zugeschrieben werden, geladen werden
        if action.player_id != player_id and action.active_goalie_id != player_id:
             continue
        
        response_list.append(ActionPlaylistResponse(
            id=action.id, 
            action_type=action.action_type,
            time_in_game=action.time_in_game, 
            game_id=action.game_id,
            player_name=current_player.name, 
            player_number=current_player.number,
            video_timestamp=action.video_timestamp,
            game_opponent=game.opponent,
            game_video_url=game.video_url
        ))
        
    return response_list

# ==================================================
# Endpunkte: Spieler-Kalender (unverändert)
# ==================================================

@router.get("/calendar/list", response_model=List[PlayerEventResponse])
def get_my_team_events(
    current_player: Player = Depends(get_current_player_only),
    db: Session = Depends(get_db)
):
    """
    Listet alle Termine für das Team des Spielers auf.
    """
    
    events = db.query(TeamEvent).filter(
        TeamEvent.team_id == current_player.team_id
    ).order_by(TeamEvent.start_time.asc()).all()
    
    if not events:
        return []
        
    my_attendances_query = db.query(Attendance).filter(
        Attendance.player_id == current_player.id
    ).all()
    
    my_attendances_map = {att.event_id: att for att in my_attendances_query}
    
    response_list = []
    for event in events:
        my_status = AttendanceStatus.NOT_RESPONDED
        my_reason = None
        
        if event.id in my_attendances_map:
            my_status = my_attendances_map[event.id].status
            my_reason = my_attendances_map[event.id].reason
        
        response_list.append(PlayerEventResponse(
            id=event.id,
            title=event.title,
            event_type=event.event_type.value,
            start_time=event.start_time,
            end_time=event.end_time,
            location=event.location,
            description=event.description,
            my_status=my_status.name, # Sende Status als ENUM NAME
            my_reason=my_reason,
            response_deadline_hours=event.response_deadline_hours
        ))
        
    return response_list


@router.post("/calendar/respond/{event_id}", response_model=PlayerEventResponse)
def respond_to_event(
    event_id: int,
    update_data: PlayerAttendanceUpdate,
    current_player: Player = Depends(get_current_player_only),
    db: Session = Depends(get_db)
):
    """
    Ermöglicht dem Spieler, seinen Status zu aktualisieren.
    FIX: Korrigiert die Zuweisung des 'reason' Feldes.
    """
    
    event = db.query(TeamEvent).filter(TeamEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden.")

    # 1. Frist prüfen (Logik von vorher beibehalten)
    if event.response_deadline_hours is not None and event.response_deadline_hours > 0:
        deadline = event.start_time - timedelta(hours=event.response_deadline_hours)
        if datetime.utcnow() > deadline:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, 
                detail=f"Die Antwortfrist ({event.response_deadline_hours}h vorher) ist leider abgelaufen."
            )

    # 2. Status in ENUM konvertieren (Der Status kommt als String, z.B. 'DECLINED')
    try:
        new_status = AttendanceStatus[update_data.status]
    except KeyError:
        raise HTTPException(status_code=400, detail="Ungültiger Status übermittelt.")

    # Finde den Anwesenheits-Eintrag
    attendance = db.query(Attendance).filter(
        Attendance.event_id == event_id,
        Attendance.player_id == current_player.id
    ).first()
    
    if not attendance:
        # Sollte nicht passieren, da der Trainer den Eintrag beim Erstellen erzeugt
        raise HTTPException(status_code=404, detail="Anwesenheits-Eintrag nicht gefunden.")
        
    # 3. Aktualisiere Status und Grund
    attendance.status = new_status
    
    if new_status in [AttendanceStatus.DECLINED, AttendanceStatus.TENTATIVE]:
        # Der Grund muss mitgesendet werden, wenn der Status Absage/Vielleicht ist
        if not update_data.reason:
             raise HTTPException(status_code=400, detail="Ein Grund ist für Absage/Vielleicht erforderlich.")
        attendance.reason = update_data.reason
    else:
        # Wenn der Status Zusage oder Keine Antwort ist, muss der Grund NULL sein.
        attendance.reason = None
        
    attendance.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(attendance)
    
    # 4. Response erstellen
    return PlayerEventResponse(
        id=event.id,
        title=event.title,
        event_type=event.event_type.value,
        start_time=event.start_time,
        end_time=event.end_time,
        location=event.location,
        description=event.description,
        my_status=attendance.status.name, # Sende den ENUM NAME zurück
        my_reason=attendance.reason,
        response_deadline_hours=event.response_deadline_hours
    )