# DATEI: backend/player_portal.py
# +++ NEU: API für Spieler-Kalenderansicht +++
# +++ FIX: Pydantic 'BaseModel' importiert +++

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
# +++ KORREKTUR: BaseModel importieren +++
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import re
from sqlalchemy import func, case, and_, distinct, or_
from datetime import datetime

from backend.database import (
    SessionLocal, Player, Game, Action, CustomAction, 
    game_participations_table, TeamEvent, Attendance, AttendanceStatus
)
from backend.auth import get_current_player_only # Wichtig: Spieler-Dependency
from backend.action import PlayerStats, ActionPlaylistResponse # Wiederverwenden der Pydantic-Modelle
from backend.time_tracking import calculate_all_player_times, format_seconds # Spielzeit-Logik

router = APIRouter(
    prefix="/portal",
    tags=["Player Portal"],
    dependencies=[Depends(get_current_player_only)] # Alle Routen hier sind für Spieler geschützt
)

# Datenbanksession
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ==================================================
# Pydantic Modelle (NEU FÜR SPIELER-KALENDER)
# ==================================================

class PlayerEventResponse(BaseModel):
    id: int
    title: str
    event_type: str
    start_time: datetime
    end_time: Optional[datetime] = None
    location: Optional[str] = None
    description: Optional[str] = None
    
    # Eigener Status des Spielers
    my_status: AttendanceStatus
    my_reason: Optional[str] = None
    
    class Config:
        from_attributes = True

class PlayerAttendanceUpdate(BaseModel):
    status: AttendanceStatus
    reason: Optional[str] = None

# ==================================================
# Endpunkt: Meine Statistiken
# ==================================================

@router.get("/my-stats", response_model=List[PlayerStats])
def get_my_season_stats(
    current_player: Player = Depends(get_current_player_only),
    db: Session = Depends(get_db)
):
    """
    Liefert die aggregierten Saison-Statistiken (ähnlich wie get_season_stats aus action.py)
    jedoch NUR für den aktuell eingeloggten Spieler.
    """
    
    team_id = current_player.team_id
    player_id = current_player.id
    
    saison_games = db.query(Game).filter(
        Game.team_id == team_id,
        Game.game_category == 'Saison'
    ).all()
    saison_game_ids = [g.id for g in saison_games]
    
    if not saison_game_ids:
        return []

    custom_actions = db.query(CustomAction).filter(CustomAction.team_id == team_id).all()
    custom_action_names = [ca.name for ca in custom_actions]

    action_subquery = db.query(Action).filter(Action.game_id.in_(saison_game_ids)).subquery()

    # Case Statements (kopiert aus action.py, angepasst für einen Spieler)
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
            (and_(action_subquery.c.action_type == 'OppGoal', action_subquery.c.active_goalie_id == player_id), 1),
            else_=None
        )).label('opponent_goals_received'),
    ]
    
    safe_custom_labels = {}
    for name in custom_action_names:
        safe_label = f"custom_{re.sub(r'[^A-Za-z09_]', '_', name)}"
        safe_custom_labels[name] = safe_label
        case_statements.append(
            func.count(case((action_subquery.c.action_type == name, 1), else_=None)).label(safe_label)
        )

    # +++ KORREKTUR (FIX FÜR 500 ERROR) +++
    # Die Subquery MUSS die player_id enthalten, damit der JOIN funktioniert.
    games_played_subquery = (
        db.query(
            game_participations_table.c.player_id, # <-- DIESE ZEILE FEHLTE
            func.count(distinct(game_participations_table.c.game_id)).label("games_played"),
        )
        .join(Game, Game.id == game_participations_table.c.game_id)
        .filter(Game.game_category == 'Saison', Game.team_id == team_id, game_participations_table.c.player_id == player_id)
        .group_by(game_participations_table.c.player_id) # <-- DIESE ZEILE FEHLTE
        .subquery()
    )
    # +++ ENDE KORREKTUR +++
    
    # Haupt-Query
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
        .outerjoin(games_played_subquery, games_played_subquery.c.player_id == Player.id) # Der Join funktioniert jetzt
        .filter(Player.id == player_id) # NUR DIESER SPIELER
        .group_by(Player.id, Player.name, Player.number, Player.position, games_played_subquery.c.games_played)
    )
    
    stats_results = stats_query.first() # .first() statt .all()
    
    if not stats_results:
        # Spieler hat keine Aktionen, aber wir geben leere Stats zurück
        return [PlayerStats(
            player_id=current_player.id,
            player_name=current_player.name,
            player_number=current_player.number,
            position=current_player.position,
            custom_counts={} # Wichtig, damit das Frontend keinen Fehler wirft
        )]
    
    # --- Spielzeit-Berechnung (effizient für einen Spieler) ---
    total_time_on_court_seconds = 0
    
    for game in saison_games:
        # Ruft die Spielzeit-Logik für diesen Spieler in diesem Spiel ab
        player_times = calculate_all_player_times(db, game.id, [player_id], 'ALL')
        total_time_on_court_seconds += player_times.get(player_id, 0)
    
    time_on_court_display = format_seconds(total_time_on_court_seconds)
    
    row_data = stats_results._asdict()
    custom_counts_dict = {name: row_data.get(safe_label, 0) for name, safe_label in safe_custom_labels.items()}
    
    my_stats = PlayerStats(
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
        time_on_court_display=time_on_court_display
    )
        
    return [my_stats] # Muss als Liste zurückgegeben werden, da PlayerStats im Frontend als Array erwartet wird

# ==================================================
# Endpunkt: Meine Video-Clips
# ==================================================

@router.get("/my-clips", response_model=List[ActionPlaylistResponse])
def get_my_season_clips(
    current_player: Player = Depends(get_current_player_only),
    db: Session = Depends(get_db)
):
    """
    Liefert alle Aktionen (für Video-Clips) aus Saisonspielen,
    die NUR den eingeloggten Spieler betreffen.
    """
    team_id = current_player.team_id
    player_id = current_player.id

    saison_games = db.query(Game).filter(
        Game.team_id == team_id,
        Game.game_category == 'Saison',
        Game.video_url.isnot(None) 
    ).all()
    game_ids = [g.id for g in saison_games]
    game_map = {g.id: g for g in saison_games}
    
    if not game_ids:
        return []

    actions_query = db.query(Action).filter(
        Action.game_id.in_(game_ids),
        Action.video_timestamp.isnot(None),
        or_(
            Action.player_id == player_id,
            Action.active_goalie_id == player_id # Auch Paraden etc.
        )
    ).order_by(Action.server_timestamp.asc()).all()
    
    response_list = []
    for action in actions_query:
        game = game_map.get(action.game_id)
        if not game: continue
        
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
# (NEU) Endpunkte: Spieler-Kalender
# ==================================================

@router.get("/calendar/list", response_model=List[PlayerEventResponse])
def get_my_team_events(
    current_player: Player = Depends(get_current_player_only),
    db: Session = Depends(get_db)
):
    """
    Listet alle Termine für das Team des Spielers auf und fügt den 
    persönlichen Anwesenheitsstatus des Spielers hinzu.
    """
    
    # Finde alle Events für das Team des Spielers
    events = db.query(TeamEvent).filter(
        TeamEvent.team_id == current_player.team_id
    ).order_by(TeamEvent.start_time.asc()).all()
    
    if not events:
        return []
        
    # Finde alle Anwesenheits-Einträge DIESES Spielers
    my_attendances_query = db.query(Attendance).filter(
        Attendance.player_id == current_player.id,
        Attendance.event_id.in_([e.id for e in events])
    ).all()
    
    # Konvertiere in ein Dictionary für schnellen Zugriff
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
            event_type=event.event_type.value, # Wichtig: .value für Enum
            start_time=event.start_time,
            end_time=event.end_time,
            location=event.location,
            description=event.description,
            my_status=my_status,
            my_reason=my_reason
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
    Ermöglicht dem Spieler, seinen Status (Zusage/Absage/Vielleicht)
    für einen Termin zu aktualisieren.
    """
    
    # Finde den Anwesenheits-Eintrag
    attendance = db.query(Attendance).filter(
        Attendance.event_id == event_id,
        Attendance.player_id == current_player.id
    ).first()
    
    if not attendance:
        raise HTTPException(status_code=404, detail="Termin oder Anwesenheits-Eintrag nicht gefunden.")
        
    # Aktualisiere Status und Grund
    attendance.status = update_data.status
    attendance.reason = update_data.reason
    attendance.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(attendance)
    
    # Lade die Event-Details, um das volle PlayerEventResponse-Objekt zurückzugeben
    event = db.query(TeamEvent).filter(TeamEvent.id == event_id).first()
    
    return PlayerEventResponse(
        id=event.id,
        title=event.title,
        event_type=event.event_type.value,
        start_time=event.start_time,
        end_time=event.end_time,
        location=event.location,
        description=event.description,
        my_status=attendance.status,
        my_reason=attendance.reason
    )