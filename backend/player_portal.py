# DATEI: backend/player_portal.py (Finaler Absagegrund Fix und Statistik/Clips Implementierung)
# +++ ENTSCHLACKT: Statistik-Logik in stats_service.py ausgelagert. +++

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import List, Dict, Any, Optional
import re
from sqlalchemy import func, case, and_, distinct, or_
from datetime import datetime, timedelta 

from backend.database import (
    SessionLocal, Player, Game, Action, CustomAction, 
    game_participations_table, TeamEvent, Attendance, AttendanceStatus, EventType
)
from backend.auth import get_current_player_only
from backend.action import PlayerStats, ActionPlaylistResponse
from backend.time_tracking import format_seconds
# NEU: Import des Statistik-Service
from backend.stats_service import get_season_stats_for_team


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
# Pydantic Modelle (Unverändert)
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
    status: str 
    reason: Optional[str] = None


# ==================================================
# Endpunkte: Spieler-Statistiken und Clips (NEU)
# ==================================================

# NEU: Liefert die aggregierten Saison-Statistiken des Spielers
@router.get("/stats", response_model=Dict[str, str])
def get_my_season_stats(
    current_player: Player = Depends(get_current_player_only),
    db: Session = Depends(get_db)
):
    team_id = current_player.team_id
    player_id = current_player.id
    
    # RUFT JETZT DEN SERVICE AUF
    all_team_stats = get_season_stats_for_team(db, team_id)
    my_stats = next((s for s in all_team_stats if s.player_id == player_id), None)

    if not my_stats:
        return {"field_stats": "", "goalie_stats": "", "custom_stats": ""}

    # 1. Erstelle die HTML-Strings (Basierend auf der Position)
    
    def create_field_html(stats: PlayerStats):
        if stats.position == 'Torwart': return ""
        if stats.games_played == 0: return ""
        
        total_shots = stats.goals + stats.misses + stats.seven_meter_goals + stats.seven_meter_misses
        quote = f"{((stats.goals + stats.seven_meter_goals) / total_shots * 100):.0f}%" if total_shots > 0 else '—'
        total_goals = stats.goals + stats.seven_meter_goals
        
        return f"""
            <table class="stats-table">
                <thead><tr><th>Wert</th><th>Total</th><th>Quote</th></tr></thead>
                <tbody>
                    <tr><td>Spiele</td><td>{stats.games_played}</td><td>-</td></tr>
                    <tr><td>Spielzeit</td><td>{stats.time_on_court_display}</td><td>-</td></tr>
                    <tr><td>Tore gesamt</td><td>{total_goals}</td><td>{quote}</td></tr>
                    <tr><td>Fehlwürfe</td><td>{stats.misses + stats.seven_meter_misses}</td><td>-</td></tr>
                    <tr><td>Tech. Fehler</td><td>{stats.tech_errors}</td><td>-</td></tr>
                    <tr><td>Fehlpässe</td><td>{stats.fehlpaesse}</td><td>-</td></tr>
                </tbody>
            </table>
        """
        
    def create_goalie_html(stats: PlayerStats):
        if stats.position != 'Torwart': return ""
        if stats.games_played == 0: return ""
        
        total_saves = stats.saves + stats.seven_meter_saves
        total_goals_received = stats.opponent_goals_received + stats.seven_meter_received
        total_shots_on_goal = total_saves + total_goals_received
        save_quote = f"{(total_saves / total_shots_on_goal * 100):.0f}%" if total_shots_on_goal > 0 else '—'
        
        seven_meter_total = stats.seven_meter_saves + stats.seven_meter_received
        seven_meter_quote = f"{(stats.seven_meter_saves / seven_meter_total * 100):.0f}%" if seven_meter_total > 0 else '—'
        
        return f"""
            <table class="stats-table">
                <thead><tr><th>Wert</th><th>Total</th><th>Quote</th></tr></thead>
                <tbody>
                    <tr><td>Spiele</td><td>{stats.games_played}</td><td>-</td></tr>
                    <tr><td>Spielzeit</td><td>{stats.time_on_court_display}</td><td>-</td></tr>
                    <tr><td>Paraden gesamt</td><td>{total_saves}</td><td>{save_quote}</td></tr>
                    <tr><td>Gegentore</td><td>{total_goals_received}</td><td>-</td></tr>
                    <tr><td>7m gehalten</td><td>{stats.seven_meter_saves} / {seven_meter_total}</td><td>{seven_meter_quote}</td></tr>
                </tbody>
            </table>
        """
        
    def create_custom_html(stats: PlayerStats):
        # Zeige Custom Stats für jeden (Feld und TW)
        if not stats.custom_counts or all(v == 0 for v in stats.custom_counts.values()): return ""
        
        html = '<table class="stats-table"><thead><tr><th>Aktion</th><th>Anzahl</th></tr></thead><tbody>'
        for action_name, count in stats.custom_counts.items():
            if count > 0:
                 html += f'<tr><td>{action_name}</td><td>{count}</td></tr>'
        html += '</tbody></table>'
        return html

    return {
        "field_stats": create_field_html(my_stats),
        "goalie_stats": create_goalie_html(my_stats),
        "custom_stats": create_custom_html(my_stats)
    }

# NEU: Liefert alle Clips des Spielers
@router.get("/clips", response_model=List[ActionPlaylistResponse])
def get_my_season_clips(
    current_player: Player = Depends(get_current_player_only),
    db: Session = Depends(get_db)
):
    team_id = current_player.team_id
    player_id = current_player.id

    saison_games = db.query(Game).filter(
        Game.team_id == team_id,
        Game.game_category == 'Saison',
        Game.video_url.isnot(None)
    ).all()
    saison_game_ids = [g.id for g in saison_games]
    
    if not saison_game_ids:
        return []

    # Suche nach Aktionen des Spielers (Feldspieler ODER Torwart-Aktion)
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
    
    game_map = {g.id: g for g in saison_games}
    
    for action in actions:
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
# Endpunkte: Spieler-Kalender (Unverändert)
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
    """
    
    event = db.query(TeamEvent).filter(TeamEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden.")

    # 1. Frist prüfen
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
        # Dies sollte nicht passieren, da die Attendance bei Event-Erstellung angelegt wird
        raise HTTPException(status_code=404, detail="Anwesenheits-Eintrag nicht gefunden.")
        
    # 3. Aktualisiere Status und Grund
    attendance.status = new_status
    
    if new_status in [AttendanceStatus.DECLINED, AttendanceStatus.TENTATIVE]:
        if not update_data.reason:
             raise HTTPException(status_code=400, detail="Ein Grund ist für Absage/Vielleicht erforderlich.")
        attendance.reason = update_data.reason
    else:
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