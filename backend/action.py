# DATEI: backend/action.py
# (Version, die 'fehlpaesse' UND '/stats/errors/season' enthält)
# KORRIGIERT: Enthält jetzt Halbzeit-Filter und Gegner-Wurfbild-Endpunkt

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case, distinct, and_
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import re

from backend.database import SessionLocal, Trainer, Team, Player, Game, Action, CustomAction, game_participations_table
from backend.auth import get_current_trainer 

router = APIRouter()

# --- Pydantic Modelle ---
class ActionCreate(BaseModel):
    action_type: str 
    time_in_game: Optional[str] = "N/A" # H1, H2, N/A
    game_id: int 
    player_id: Optional[int] = None 
    is_seven_meter: Optional[bool] = False
    x_coordinate: Optional[float] = None
    y_coordinate: Optional[float] = None
    active_goalie_id: Optional[int] = None
    video_timestamp: Optional[str] = None # NEU (PHASE 8)

class ActionResponse(BaseModel):
    id: int
    action_type: str
    time_in_game: str
    player_name: Optional[str] = None
    player_number: Optional[int] = None
    game_id: int
    player_id: Optional[int]
    x_coordinate: Optional[float] = None
    y_coordinate: Optional[float] = None
    video_timestamp: Optional[str] = None # NEU (PHASE 8)
    class Config: from_attributes = True

class PlayerStats(BaseModel):
# ... (Rest des Modells unverändert) ...
    player_id: int
    player_name: str
    player_number: Optional[int]
    position: Optional[str]
    games_played: int 
    goals: int
    misses: int
    tech_errors: int
    fehlpaesse: int  # <-- Wichtig
    seven_meter_goals: int
    seven_meter_misses: int
    seven_meter_caused: int
    seven_meter_saves: int
    seven_meter_received: int 
    saves: int
    opponent_goals_received: int 
    custom_counts: Dict[str, int] = {}
    class Config: from_attributes = True

class OpponentStats(BaseModel):
# ... (Rest des Modells unverändert) ...
    opponent_goals: int
    opponent_misses: int
    opponent_tech_errors: int
    class Config: from_attributes = True

class ShotData(BaseModel):
# ... (Rest des Modells unverändert) ...
    action_type: str
    x_coordinate: float
    y_coordinate: float
    class Config: from_attributes = True

class ShotDataResponse(BaseModel):
# ... (Rest des Modells unverändert) ...
    player_id: int
    player_name: str
    player_number: Optional[int]
    shots: List[ShotData]
    class Config: from_attributes = True

def get_db():
# ... (Funktion unverändert) ...
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- NEU: Helper-Funktion für Halbzeit-Filter ---
def apply_half_filter(query, half: str):
# ... (Funktion unverändert) ...
    """ Wendet einen Filter für H1, H2 oder ALL auf eine Query an. """
    if half == 'H1':
        return query.filter(Action.time_in_game == 'H1')
    elif half == 'H2':
        return query.filter(Action.time_in_game == 'H2')
    # Bei 'ALL' oder None wird kein Filter angewendet
    return query

# --- Endpunkte ---

@router.post("/add", response_model=ActionResponse)
def log_action(
    action_data: ActionCreate,
    current_trainer: Trainer = Depends(get_current_trainer), 
    db: Session = Depends(get_db)
):
    game = db.query(Game).filter(Game.id == action_data.game_id).first()
    if not game: raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
    team = db.query(Team).filter(Team.id == game.team_id, Team.trainer_id == current_trainer.id).first()
    if not team: raise HTTPException(status_code=403, detail="Keine Berechtigung für dieses Spiel.")
    
    player_name_for_action, player_number_for_action = None, None
    if action_data.player_id:
        player = db.query(Player).filter(Player.id == action_data.player_id).first()
        if not player or player.team_id != game.team_id:
            raise HTTPException(status_code=400, detail="Ungültige Spieler-ID.")
        player_name_for_action, player_number_for_action = player.name, player.number

    new_action = Action(
        action_type=action_data.action_type,
        time_in_game=action_data.time_in_game, # Speichert jetzt H1/H2
        game_id=action_data.game_id,
        player_id=action_data.player_id,
        x_coordinate=action_data.x_coordinate,
        y_coordinate=action_data.y_coordinate,
        active_goalie_id=action_data.active_goalie_id,
        video_timestamp=action_data.video_timestamp # NEU (PHASE 8)
    )
    db.add(new_action); db.commit(); db.refresh(new_action)
    
    return ActionResponse(
        id=new_action.id, action_type=new_action.action_type,
        time_in_game=new_action.time_in_game, game_id=new_action.game_id,
        player_id=new_action.player_id, player_name=player_name_for_action,
        player_number=player_number_for_action, x_coordinate=new_action.x_coordinate,
        y_coordinate=new_action.y_coordinate,
        video_timestamp=new_action.video_timestamp # NEU (PHASE 8)
    )

@router.get("/list/{game_id}", response_model=List[ActionResponse])
def list_actions(
    game_id: int,
    half: Optional[str] = Query('ALL', enum=['H1', 'H2', 'ALL']), # NEU: Filter
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game: raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
    team = db.query(Team).filter(Team.id == game.team_id, Team.trainer_id == current_trainer.id).first()
    if not team: raise HTTPException(status_code=403, detail="Keine Berechtigung.")

    actions_query = db.query(Action).filter(Action.game_id == game_id)
    actions_query = apply_half_filter(actions_query, half) # NEU
    actions_data = actions_query.order_by(Action.id.desc()).all()
    
    response_list = []
    team_players = {p.id: p for p in db.query(Player).filter(Player.team_id == game.team_id).all()}
    
    for action in actions_data:
        player_name, player_number = None, None
        if action.player_id and action.player_id in team_players:
            player = team_players[action.player_id]
            player_name, player_number = player.name, player.number
        response_list.append(ActionResponse(
            id=action.id, action_type=action.action_type,
            time_in_game=action.time_in_game, game_id=action.game_id,
            player_id=action.player_id, player_name=player_name,
            player_number=player_number, x_coordinate=action.x_coordinate,
            y_coordinate=action.y_coordinate,
            video_timestamp=action.video_timestamp # NEU (PHASE 8)
        ))
    return response_list

@router.get("/stats/{game_id}", response_model=List[PlayerStats])
def get_game_stats(
# ... (Rest der Datei unverändert) ...
    game_id: int,
    half: Optional[str] = Query('ALL', enum=['H1', 'H2', 'ALL']), # NEU: Filter
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game: raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
    team = db.query(Team).filter(Team.id == game.team_id, Team.trainer_id == current_trainer.id).first()
    if not team: raise HTTPException(status_code=403, detail="Keine Berechtigung.")
        
    participating_player_ids = [pid[0] for pid in db.query(game_participations_table.c.player_id).filter(
        game_participations_table.c.game_id == game_id
    ).all()]

    if not participating_player_ids:
        all_players = db.query(Player).filter(Player.team_id == team.id).order_by(Player.number.asc()).all()
        return [PlayerStats(
            player_id=p.id, player_name=p.name, player_number=p.number, position=p.position,
            games_played=0, goals=0, misses=0, tech_errors=0, fehlpaesse=0,
            seven_meter_goals=0, seven_meter_misses=0, seven_meter_caused=0, 
            seven_meter_saves=0, seven_meter_received=0, saves=0, 
            opponent_goals_received=0, custom_counts={}
        ) for p in all_players]

    custom_actions = db.query(CustomAction).filter(CustomAction.team_id == team.id).all()
    custom_action_names = [ca.name for ca in custom_actions]
    
    # NEU: Action-Subquery mit Halbzeit-Filter
    action_subquery = db.query(Action).filter(Action.game_id == game_id)
    action_subquery = apply_half_filter(action_subquery, half)
    action_subquery = action_subquery.subquery()
    
    case_statements = [
        func.count(case((action_subquery.c.action_type == 'Goal', 1), else_=None)).label('goals'),
        func.count(case((action_subquery.c.action_type == 'Miss', 1), else_=None)).label('misses'),
        func.count(case((action_subquery.c.action_type.in_(['TechError', 'Fehlpass']), 1), else_=None)).label('tech_errors'),
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
        )).label('opponent_goals_received')
    ]
    
    safe_custom_labels = {}
    for name in custom_action_names:
        safe_label = f"custom_{re.sub(r'[^A-Za-z0-9_]', '_', name)}"
        safe_custom_labels[name] = safe_label
        case_statements.append(
            func.count(case((action_subquery.c.action_type == name, 1), else_=None)).label(safe_label)
        )
        
    stats_query = (
        db.query(Player.id, Player.name, Player.number, Player.position, *case_statements)
        .select_from(Player)
        .outerjoin(action_subquery, # NEU: Join mit Subquery
            and_(
                (action_subquery.c.player_id == Player.id) | (action_subquery.c.active_goalie_id == Player.id)
                # game_id und half filter sind schon in der Subquery
            )
        )
        .filter(Player.team_id == team.id, Player.id.in_(participating_player_ids)) 
        .group_by(Player.id, Player.name, Player.number, Player.position)
        .order_by(Player.number.asc())
    )
    
    stats_results = stats_query.all()
    final_stats = []
    for row in stats_results:
        row_data = row._asdict()
        custom_counts_dict = {name: row_data.get(safe_label, 0) for name, safe_label in safe_custom_labels.items()}
        
        # NEU: Setze games_played=1 nur, wenn der Filter 'ALL' ist (sonst ist es irreführend)
        games_played = 1 if half == 'ALL' else 0 
        
        final_stats.append(PlayerStats(
            player_id=row_data.get('id'), player_name=row_data.get('name'),
            player_number=row_data.get('number'), position=row_data.get('position'),
            games_played=games_played, # NEU
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
            custom_counts=custom_counts_dict
        ))
    return final_stats

@router.get("/stats/opponent/{game_id}", response_model=OpponentStats)
def get_opponent_stats(
# ... (Rest der Datei unverändert) ...
    game_id: int,
    half: Optional[str] = Query('ALL', enum=['H1', 'H2', 'ALL']), # NEU: Filter
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game: raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
    team = db.query(Team).filter(Team.id == game.team_id, Team.trainer_id == current_trainer.id).first()
    if not team: raise HTTPException(status_code=403, detail="Keine Berechtigung.")

    stats_query = db.query(
        func.count(case((Action.action_type == 'OppGoal', 1), else_=None)).label('opponent_goals'),
        func.count(case((and_(Action.action_type == 'OppMiss', Action.player_id.is_(None)), 1), else_=None)).label('opponent_misses'),
        func.count(case((and_(Action.action_type == 'OppTechError', Action.player_id.is_(None)), 1), else_=None)).label('opponent_tech_errors')
    ).filter(Action.game_id == game_id)
    
    stats_query = apply_half_filter(stats_query, half) # NEU
    
    stats_result = stats_query.first()
    if not stats_result: return OpponentStats(opponent_goals=0, opponent_misses=0, opponent_tech_errors=0)
    return OpponentStats(
        opponent_goals=stats_result.opponent_goals,
        opponent_misses=stats_result.opponent_misses,
        opponent_tech_errors=stats_result.opponent_tech_errors
    )

@router.get("/stats/season/{team_id}", response_model=List[PlayerStats])
def get_season_stats(
# ... (Rest der Datei unverändert) ...
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id, Team.trainer_id == current_trainer.id).first()
    if not team: raise HTTPException(status_code=403, detail="Keine Berechtigung.")
        
    saison_games_ids = [g[0] for g in db.query(Game.id).filter(
        Game.team_id == team_id, Game.game_category == 'Saison'
    ).all()]
    
    if not saison_games_ids:
        players = db.query(Player).filter(Player.team_id == team_id).all()
        return [PlayerStats(
            player_id=p.id, player_name=p.name, player_number=p.number, position=p.position,
            games_played=0, goals=0, misses=0, tech_errors=0, fehlpaesse=0,
            seven_meter_goals=0, seven_meter_misses=0, seven_meter_caused=0, 
            seven_meter_saves=0, seven_meter_received=0, saves=0, 
            opponent_goals_received=0, custom_counts={}
        ) for p in players]

    games_played_count = db.query(
        game_participations_table.c.player_id,
        func.count(game_participations_table.c.game_id).label('games_played')
    ).filter(
        game_participations_table.c.game_id.in_(saison_games_ids)
    ).group_by(game_participations_table.c.player_id).subquery()

    custom_actions = db.query(CustomAction).filter(CustomAction.team_id == team.id).all()
    custom_action_names = [ca.name for ca in custom_actions]
    
    case_statements = [
        func.count(case((Action.action_type == 'Goal', 1), else_=None)).label('goals'),
        func.count(case((Action.action_type == 'Miss', 1), else_=None)).label('misses'),
        func.count(case((Action.action_type.in_(['TechError', 'Fehlpass']), 1), else_=None)).label('tech_errors'),
        func.count(case((Action.action_type == 'Fehlpass', 1), else_=None)).label('fehlpaesse'),
        func.count(case((Action.action_type == 'Goal_7m', 1), else_=None)).label('seven_meter_goals'),
        func.count(case((Action.action_type == 'Miss_7m', 1), else_=None)).label('seven_meter_misses'),
        func.count(case((Action.action_type == 'SEVEN_METER_CAUSED', 1), else_=None)).label('seven_meter_caused'),
        func.count(case((Action.action_type == 'Save', 1), else_=None)).label('saves'),
        func.count(case((Action.action_type == 'SEVEN_METER_SAVE', 1), else_=None)).label('seven_meter_saves'),
        func.count(case((Action.action_type == 'SEVEN_METER_RECEIVED', 1), else_=None)).label('seven_meter_received'),
        func.count(case(
            (and_(Action.action_type == 'OppGoal', Action.active_goalie_id == Player.id), 1),
            else_=None
        )).label('opponent_goals_received')
    ]
    
    safe_custom_labels = {}
    for name in custom_action_names:
        safe_label = f"custom_{re.sub(r'[^A-Za-z0-9_]', '_', name)}"
        safe_custom_labels[name] = safe_label
        case_statements.append(
            func.count(case((Action.action_type == name, 1), else_=None)).label(safe_label)
        )
    
    stats_query = db.query(
        Player.id, Player.name, Player.number, Player.position,
        func.coalesce(games_played_count.c.games_played, 0).label('games_played'),
        *case_statements 
    ).select_from(Player)\
    .outerjoin(games_played_count, Player.id == games_played_count.c.player_id)\
    .outerjoin(Action, 
        and_(
            (Action.player_id == Player.id) | (Action.active_goalie_id == Player.id),
            Action.game_id.in_(saison_games_ids)
        )
    )\
    .filter(Player.team_id == team.id)\
    .group_by(Player.id, Player.name, Player.number, Player.position, games_played_count.c.games_played)\
    .order_by(Player.number.asc())
    
    stats_results = stats_query.all()
    final_stats = []
    for row in stats_results:
        row_data = row._asdict()
        custom_counts_dict = {name: row_data.get(safe_label, 0) for name, safe_label in safe_custom_labels.items()}
        final_stats.append(PlayerStats(
            player_id=row_data.get('id'), player_name=row_data.get('name'),
            player_number=row_data.get('number'), position=row_data.get('position'),
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
            custom_counts=custom_counts_dict
        ))
    return final_stats

@router.get("/stats/season/opponent/{team_id}", response_model=OpponentStats)
def get_season_opponent_stats(
# ... (Rest der Datei unverändert) ...
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id, Team.trainer_id == current_trainer.id).first()
    if not team: raise HTTPException(status_code=403, detail="Keine Berechtigung.")
        
    saison_games_subquery = db.query(Game.id).filter(
        Game.team_id == team_id, Game.game_category == 'Saison'
    ).subquery()

    stats_query = db.query(
        func.count(case((Action.action_type == 'OppGoal', 1), else_=None)).label('opponent_goals'),
        func.count(case((and_(Action.action_type == 'OppMiss', Action.player_id.is_(None)), 1), else_=None)).label('opponent_misses'),
        func.count(case((and_(Action.action_type == 'OppTechError', Action.player_id.is_(None)), 1), else_=None)).label('opponent_tech_errors')
    ).filter(Action.game_id.in_(saison_games_subquery))
    stats_result = stats_query.first()
    if not stats_result: return OpponentStats(opponent_goals=0, opponent_misses=0, opponent_tech_errors=0)
    return OpponentStats(
        opponent_goals=stats_result.opponent_goals,
        opponent_misses=stats_result.opponent_misses,
        opponent_tech_errors=stats_result.opponent_tech_errors
    )

@router.delete("/delete/{action_id}")
def delete_action(
# ... (Rest der Datei unverändert) ...
    action_id: int,
    # 'half' wird hier nicht benötigt, da wir einfach die Aktion löschen,
    # unabhängig vom aktuellen Filter
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    action = db.query(Action).filter(Action.id == action_id).first()
    if not action: raise HTTPException(status_code=404, detail="Aktion nicht gefunden.")
    game = db.query(Game).filter(Game.id == action.game_id).first()
    team = db.query(Team).filter(Team.id == game.team_id, Team.trainer_id == current_trainer.id).first()
    if not team: raise HTTPException(status_code=403, detail="Keine Berechtigung.")
    db.delete(action); db.commit()
    return {"message": "Aktion erfolgreich gelöscht."}


@router.get("/shots/season/{team_id}", response_model=List[ShotDataResponse])
def get_season_shot_charts(
# ... (Rest der Datei unverändert) ...
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id, Team.trainer_id == current_trainer.id).first()
    if not team: raise HTTPException(status_code=403, detail="Keine Berechtigung.")
    saison_games_ids = [g[0] for g in db.query(Game.id).filter(
        Game.team_id == team_id, Game.game_category == 'Saison'
    ).all()]
    if not saison_games_ids: return [] 
    shot_action_types = ['Goal', 'Miss', 'Goal_7m', 'Miss_7m'] # 7m hinzugefügt
    shots_query = db.query(
        Action.player_id, Action.action_type,
        Action.x_coordinate, Action.y_coordinate,
        Player.name, Player.number
    ).join(Player, Player.id == Action.player_id)\
    .filter(
        Action.game_id.in_(saison_games_ids),
        Action.action_type.in_(shot_action_types),
        Action.x_coordinate.isnot(None),
        Action.y_coordinate.isnot(None)
    ).all()
    player_shots: Dict[int, Dict[str, Any]] = {}
    for shot in shots_query:
        if shot.player_id not in player_shots:
            player_shots[shot.player_id] = {
                "player_id": shot.player_id,
                "player_name": shot.name or "Unbekannt",
                "player_number": shot.number, "shots": []
            }
        player_shots[shot.player_id]["shots"].append(ShotData(
            action_type=shot.action_type,
            x_coordinate=shot.x_coordinate,
            y_coordinate=shot.y_coordinate
        ))
    return list(player_shots.values())

# ==================================================
# KORREKTUR: '/stats/errors/season' (Behebt 404-Fehler)
# ==================================================
@router.get("/stats/errors/season/{team_id}", response_model=List[ShotDataResponse])
def get_season_error_charts(
# ... (Rest der Datei unverändert) ...
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id, Team.trainer_id == current_trainer.id).first()
    if not team: raise HTTPException(status_code=403, detail="Keine Berechtigung.")
    saison_games_ids = [g[0] for g in db.query(Game.id).filter(
        Game.team_id == team_id, Game.game_category == 'Saison'
    ).all()]
    if not saison_games_ids: return [] 
    error_action_types = ['TechError', 'Fehlpass']
    errors_query = db.query(
        Action.player_id, Action.action_type,
        Action.x_coordinate, Action.y_coordinate,
        Player.name, Player.number
    ).join(Player, Player.id == Action.player_id)\
    .filter(
        Action.game_id.in_(saison_games_ids),
        Action.action_type.in_(error_action_types),
        Action.x_coordinate.isnot(None),
        Action.y_coordinate.isnot(None)
    ).all()
    player_errors: Dict[int, Dict[str, Any]] = {}
    for error in errors_query:
        if error.player_id not in player_errors:
            player_errors[error.player_id] = {
                "player_id": error.player_id,
                "player_name": error.name or "Unbekannt",
                "player_number": error.number, "shots": []
            }
        player_errors[error.player_id]["shots"].append(ShotData(
            action_type=error.action_type,
            x_coordinate=error.x_coordinate,
            y_coordinate=error.y_coordinate
        ))
    return list(player_errors.values())

# ==================================================
# NEU: Endpunkt für Gegner-Wurfbilder (Phase 9)
# ==================================================
@router.get("/shots/opponent/season/{team_id}", response_model=List[ShotData])
def get_season_opponent_shot_charts(
# ... (Rest der Datei unverändert) ...
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id, Team.trainer_id == current_trainer.id).first()
    if not team: raise HTTPException(status_code=403, detail="Keine Berechtigung.")
        
    saison_games_ids = [g[0] for g in db.query(Game.id).filter(
        Game.team_id == team_id, Game.game_category == 'Saison'
    ).all()]
    
    if not saison_games_ids: return [] 

    shot_action_types = ['OppGoal', 'OppMiss']
    
    shots_query = db.query(
        Action.action_type,
        Action.x_coordinate,
        Action.y_coordinate
    ).filter(
        Action.game_id.in_(saison_games_ids),
        Action.action_type.in_(shot_action_types),
        Action.x_coordinate.isnot(None),
        Action.y_coordinate.isnot(None)
    ).all()

    response_list = []
    for shot in shots_query:
        response_list.append(ShotData(
            action_type=shot.action_type,
            x_coordinate=shot.x_coordinate,
            y_coordinate=shot.y_coordinate
        ))
    
    return response_list

