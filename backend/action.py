# DATEI: backend/action.py
# +++ ENTSCHLACKT: Saisonstatistik-Logik in stats_service.py ausgelagert. +++

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case, and_, distinct, DateTime, cast, or_
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import re
from datetime import datetime, timedelta

# KORRIGIERT: Expliziter Import aller benötigten Modelle
from backend.database import SessionLocal, Trainer, Player, Game, Team, Action, CustomAction, UserRole, game_participations_table
from backend.auth import get_current_trainer, check_team_auth_and_get_role

# NEU: Import des Statistik-Service
from backend.stats_service import get_season_stats_for_team

# Importe, die lokal benötigt werden (Time Tracking wird nur für Einzelspiel-Statistiken benötigt)
from backend.time_tracking import calculate_all_player_times, format_seconds

router = APIRouter()

# ==================================================
# Pydantic Modelle (ACHTUNG: PlayerStats muss hier bleiben!)
# ==================================================
class ActionCreate(BaseModel):
    action_type: str 
    time_in_game: Optional[str] = "N/A"
    game_id: int 
    player_id: Optional[int] = None 
    is_seven_meter: Optional[bool] = False
    x_coordinate: Optional[float] = None
    y_coordinate: Optional[float] = None
    active_goalie_id: Optional[int] = None
    video_timestamp: Optional[str] = None 
    server_timestamp: Optional[datetime] = None 

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
    video_timestamp: Optional[str] = None 
    server_timestamp: Optional[datetime] = None 
    class Config: from_attributes = True

class ActionTimestampUpdate(BaseModel):
    video_timestamp: str

# DIESE KLASSE MUSS HIER BLEIBEN, solange wir database.py nicht anfassen können.
class PlayerStats(BaseModel):
    player_id: int
    player_name: str
    player_number: Optional[int] = None
    position: Optional[str] = None
    games_played: int = 0
    goals: int = 0
    misses: int = 0
    tech_errors: int = 0
    fehlpaesse: int = 0
    seven_meter_goals: int = 0
    seven_meter_misses: int = 0
    seven_meter_caused: int = 0
    seven_meter_saves: int = 0
    seven_meter_received: int = 0
    saves: int = 0
    opponent_goals_received: int = 0
    custom_counts: Dict[str, int] = {}
    time_on_court_seconds: int = 0 
    time_on_court_display: str = "00:00" 
    class Config: from_attributes = True

class OpponentStats(BaseModel):
    opponent_goals: int
    opponent_misses: int
    opponent_tech_errors: int = 0
    class Config: from_attributes = True

class ShotData(BaseModel):
    action_type: str
    player_name: Optional[str] = None
    player_number: Optional[int] = None
    x_coordinate: Optional[float] = None
    y_coordinate: Optional[float] = None
    game_id: Optional[int] = None 
    class Config: from_attributes = True

class ShotDataResponse(BaseModel):
    player_id: int
    player_name: str
    player_number: Optional[int] = None
    shots: List[ShotData]
    class Config: from_attributes = True

class ActionPlaylistResponse(BaseModel):
    id: int # Action ID
    action_type: str
    time_in_game: str
    player_name: Optional[str] = None
    player_number: Optional[int] = None
    video_timestamp: Optional[str] = None
    game_id: int
    game_opponent: str
    game_video_url: Optional[str] = None
    class Config: from_attributes = True
# ==================================================


# Datenbanksession
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def apply_half_filter(query, half: str):
    """ Wendet einen Filter für H1, H2 oder ALL auf eine Query an. """
    if half == 'H1':
        return query.filter(Action.time_in_game == 'H1')
    elif half == 'H2':
        return query.filter(Action.time_in_game == 'H2')
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
    check_team_auth_and_get_role(db, current_trainer.id, game.team_id)
    player_name_for_action, player_number_for_action = None, None
    if action_data.player_id:
        player = db.query(Player).filter(Player.id == action_data.player_id).first()
        if not player or player.team_id != game.team_id:
            raise HTTPException(status_code=400, detail="Ungültige Spieler-ID.")
        player_name_for_action, player_number_for_action = player.name, player.number
    server_time = action_data.server_timestamp if action_data.server_timestamp else datetime.utcnow()
    new_action = Action(
        action_type=action_data.action_type,
        time_in_game=action_data.time_in_game, 
        game_id=action_data.game_id,
        player_id=action_data.player_id,
        x_coordinate=action_data.x_coordinate,
        y_coordinate=action_data.y_coordinate,
        active_goalie_id=action_data.active_goalie_id,
        video_timestamp=action_data.video_timestamp,
        server_timestamp=server_time
    )
    db.add(new_action); db.commit(); db.refresh(new_action)
    return ActionResponse(
        id=new_action.id, action_type=new_action.action_type,
        time_in_game=new_action.time_in_game, game_id=new_action.game_id,
        player_id=new_action.player_id, player_name=player_name_for_action,
        player_number=player_number_for_action, x_coordinate=new_action.x_coordinate,
        y_coordinate=new_action.y_coordinate,
        video_timestamp=new_action.video_timestamp,
        server_timestamp=new_action.server_timestamp
    )

@router.get("/list/{game_id}", response_model=List[ActionResponse])
def list_actions(
    game_id: int,
    half: Optional[str] = Query('ALL', enum=['H1', 'H2', 'ALL']), 
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game: raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
    check_team_auth_and_get_role(db, current_trainer.id, game.team_id)
    actions_query = db.query(Action).filter(Action.game_id == game_id)
    actions_query = apply_half_filter(actions_query, half) 
    actions_data = actions_query.order_by(Action.server_timestamp.asc()).all()
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
            video_timestamp=action.video_timestamp,
            server_timestamp=action.server_timestamp
        ))
    return response_list

@router.get("/stats/game/{game_id}", response_model=List[PlayerStats])
def get_game_stats(
    game_id: int,
    half: Optional[str] = Query('ALL', enum=['H1', 'H2', 'ALL']),
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
    
    check_team_auth_and_get_role(db, current_trainer.id, game.team_id)

    team_players = game.participating_players
    if not team_players:
         team_players = db.query(Player).filter(Player.team_id == game.team_id).all()

    player_ids = [p.id for p in team_players]
    if not player_ids:
        return []
        
    custom_actions = db.query(CustomAction).filter(CustomAction.team_id == game.team_id).all()
    custom_action_names = [ca.name for ca in custom_actions]

    base_query = db.query(Action).filter(Action.game_id == game_id)
    base_query = apply_half_filter(base_query, half) 
    
    action_subquery = base_query.subquery()

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
        )).label('opponent_goals_received')
    ]
    
    safe_custom_labels = {}
    for name in custom_action_names:
        safe_label = f"custom_{re.sub(r'[^A-Za-z09_]', '_', name)}"
        safe_custom_labels[name] = safe_label
        case_statements.append(
            func.count(case((action_subquery.c.action_type == name, 1), else_=None)).label(safe_label)
        )

    stats_query = (
        db.query(Player.id, Player.name, Player.number, Player.position, *case_statements)
        .select_from(Player)
        .outerjoin(action_subquery, 
            or_(
                (action_subquery.c.player_id == Player.id), 
                (action_subquery.c.active_goalie_id == Player.id)
            )
        )
        .filter(Player.id.in_(player_ids)) 
        .group_by(Player.id, Player.name, Player.number, Player.position)
        .order_by(Player.number.asc())
    )
    
    stats_results = stats_query.all()
    final_stats = []
    
    # *** Ruft die ausgelagerte, neue Zeit-Logik auf ***
    player_times_seconds = calculate_all_player_times(db, game_id, player_ids, half)
    # *** ENDE KORREKTUR ***
    
    for row in stats_results:
        row_data = row._asdict()
        player_id = row_data.get('id')
        
        time_on_court_seconds = player_times_seconds.get(player_id, 0)
        time_on_court_display = format_seconds(time_on_court_seconds)

        custom_counts_dict = {name: row_data.get(safe_label, 0) for name, safe_label in safe_custom_labels.items()}
        
        final_stats.append(PlayerStats(
            player_id=player_id, 
            player_name=row_data.get('name'),
            player_number=row_data.get('number'), 
            position=row_data.get('position'),
            games_played=1, # Es ist nur dieses eine Spiel
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
            time_on_court_seconds=time_on_court_seconds, 
            time_on_court_display=time_on_court_display
        ))
        
    return final_stats


@router.get("/stats/opponent/{game_id}", response_model=OpponentStats)
def get_opponent_game_stats(
    game_id: int,
    half: Optional[str] = Query('ALL', enum=['H1', 'H2', 'ALL']),
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
    check_team_auth_and_get_role(db, current_trainer.id, game.team_id)
    base_query = db.query(
        func.coalesce(func.sum(case((Action.action_type == 'OppGoal', 1), else_=0)), 0).label('opponent_goals'),
        func.coalesce(func.sum(case((Action.action_type == 'OppMiss', 1), else_=0)), 0).label('opponent_misses'),
        func.coalesce(func.sum(case((Action.action_type == 'OppTechError', 1), else_=0)), 0).label('opponent_tech_errors')
    ).filter(Action.game_id == game_id)
    stats_query = apply_half_filter(base_query, half).first()
    if not stats_query:
         return OpponentStats(opponent_goals=0, opponent_misses=0, opponent_tech_errors=0)
    return OpponentStats(
        opponent_goals=stats_query.opponent_goals,
        opponent_misses=stats_query.opponent_misses,
        opponent_tech_errors=stats_query.opponent_tech_errors
    )


# ==================================================
# SAISON ROUTEN
# ==================================================

@router.get("/list/season/{team_id}", response_model=List[ActionPlaylistResponse])
def list_season_actions(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    check_team_auth_and_get_role(db, current_trainer.id, team_id)
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
        Action.video_timestamp.isnot(None)
    ).order_by(Action.server_timestamp.asc()).all()
    team_players = {p.id: p for p in db.query(Player).filter(Player.team_id == team_id).all()}
    response_list = []
    for action in actions_query:
        game = game_map.get(action.game_id)
        if not game: continue
        player_name, player_number = None, None
        if action.player_id and action.player_id in team_players:
            player = team_players[action.player_id]
            player_name, player_number = player.name, player.number
        response_list.append(ActionPlaylistResponse(
            id=action.id, action_type=action.action_type,
            time_in_game=action.time_in_game, game_id=action.game_id,
            player_name=player_name, player_number=player_number,
            video_timestamp=action.video_timestamp,
            game_opponent=game.opponent,
            game_video_url=game.video_url
        ))
    return response_list


@router.get("/shots/season/{team_id}", response_model=List[ShotDataResponse])
def get_season_shot_charts(team_id: int, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team: raise HTTPException(status_code=404, detail="Team nicht gefunden.")
    saison_games_ids = [g.id for g in db.query(Game).filter(
        Game.team_id == team_id, Game.game_category == 'Saison'
    ).all()]
    if not saison_games_ids: return [] 
    player_map = {p.id: p for p in db.query(Player).filter(Player.team_id == team_id).all()}
    shots_query = db.query(
        Action.action_type,
        Action.player_id,
        Action.x_coordinate,
        Action.y_coordinate
    ).filter(
        Action.game_id.in_(saison_games_ids),
        Action.action_type.in_(['Goal', 'Miss', 'Goal_7m', 'Miss_7m']),
        Action.x_coordinate.isnot(None),
        Action.y_coordinate.isnot(None)
    ).all()
    player_shots: Dict[int, List[ShotData]] = {}
    for shot in shots_query:
        if shot.player_id not in player_map: continue
        if shot.player_id not in player_shots:
            player_shots[shot.player_id] = []
        player_shots[shot.player_id].append(ShotData(
            action_type=shot.action_type,
            x_coordinate=shot.x_coordinate,
            y_coordinate=shot.y_coordinate
        ))
    return [ShotDataResponse(
        player_id=pid,
        player_name=player_map[pid].name,
        player_number=player_map[pid].number,
        shots=shots
    ) for pid, shots in player_shots.items()]

@router.get("/shots/errors/season/{team_id}", response_model=List[ShotDataResponse])
def get_season_error_charts(team_id: int, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team: raise HTTPException(status_code=404, detail="Team nicht gefunden.")
    saison_games_ids = [g.id for g in db.query(Game).filter(
        Game.team_id == team_id, Game.game_category == 'Saison'
    ).all()]
    if not saison_games_ids: return [] 
    player_map = {p.id: p for p in db.query(Player).filter(Player.team_id == team_id).all()}
    error_action_types = ['TechError', 'Fehlpass']
    error_query = db.query(
        Action.action_type,
        Action.player_id,
        Action.x_coordinate,
        Action.y_coordinate
    ).filter(
        Action.game_id.in_(saison_games_ids),
        Action.action_type.in_(error_action_types),
        Action.x_coordinate.isnot(None),
        Action.y_coordinate.isnot(None)
    ).all()
    player_errors: Dict[int, List[ShotData]] = {}
    for error in error_query:
        if error.player_id not in player_map: continue
        if error.player_id not in player_errors:
            player_errors[error.player_id] = []
        player_errors[error.player_id].append(ShotData(
            action_type=error.action_type,
            x_coordinate=error.x_coordinate,
            y_coordinate=error.y_coordinate
        ))
    return [ShotDataResponse(
        player_id=pid,
        player_name=player_map[pid].name,
        player_number=player_map[pid].number,
        shots=errors
    ) for pid, shots in player_errors.items()]


@router.get("/shots/opponent/season/{team_id}", response_model=List[ShotData])
def get_season_opponent_shot_charts(team_id: int, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team: raise HTTPException(status_code=404, detail="Team nicht gefunden.")
    saison_games_ids = [g.id for g in db.query(Game).filter(
        Game.team_id == team_id, Game.game_category == 'Saison'
    ).all()]
    if not saison_games_ids: return [] 
    shot_action_types = ['OppGoal', 'OppMiss']
    shots_query = db.query(
        Action.action_type,
        Action.x_coordinate,
        Action.y_coordinate,
        Action.game_id
    ).filter(
        Action.game_id.in_(saison_games_ids),
        Action.action_type.in_(shot_action_types),
        Action.x_coordinate.isnot(None),
        Action.y_coordinate.isnot(None)
    ).all()
    return [ShotData(
        action_type=shot.action_type,
        player_name=None,
        x_coordinate=shot.x_coordinate,
        y_coordinate=shot.y_coordinate,
        game_id=shot.game_id
    ) for shot in shots_query]
    

# WICHTIG: Diese Route wird nun den Statistik-Service verwenden.
@router.get("/stats/season/{team_id}", response_model=List[PlayerStats])
def get_season_stats(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    check_team_auth_and_get_role(db, current_trainer.id, team_id)

    # RUFT JETZT DEN SERVICE AUF
    # Da get_season_stats_for_team List[Any] zurückgibt, muss es von FastAPI in List[PlayerStats] umgewandelt werden.
    return get_season_stats_for_team(db, team_id)


@router.get("/stats/opponent/season/{team_id}", response_model=OpponentStats)
def get_season_opponent_stats(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    check_team_auth_and_get_role(db, current_trainer.id, team_id)
    saison_game_ids = [g.id for g in db.query(Game).filter(
        Game.team_id == team_id,
        Game.game_category == 'Saison'
    ).all()]
    if not saison_game_ids:
        return OpponentStats(opponent_goals=0, opponent_misses=0, opponent_tech_errors=0)
    stats_query = db.query(
        func.coalesce(func.sum(case((Action.action_type == 'OppGoal', 1), else_=0)), 0).label('opponent_goals'),
        func.coalesce(func.sum(case((Action.action_type == 'OppMiss', 1), else_=0)), 0).label('opponent_misses'),
        func.coalesce(func.sum(case((Action.action_type == 'OppTechError', 1), else_=0)), 0).label('opponent_tech_errors')
    ).filter(Action.game_id.in_(saison_game_ids)).first()
    return OpponentStats(
        opponent_goals=stats_query.opponent_goals,
        opponent_misses=stats_query.opponent_misses,
        opponent_tech_errors=stats_query.opponent_tech_errors
    )


@router.delete("/delete/{action_id}")
def delete_action(
    action_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    action = db.query(Action).filter(Action.id == action_id).first()
    if not action: raise HTTPException(status_code=404, detail="Aktion nicht gefunden.")
    game = db.query(Game).filter(Game.id == action.game_id).first()
    if not game: raise HTTPException(status_code=404, detail="Zugehöriges Spiel nicht gefunden.")
    check_team_auth_and_get_role(
        db, 
        current_trainer.id, 
        game.team_id, 
        required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
    )
    db.delete(action); db.commit()
    return {"message": "Aktion erfolgreich gelöscht."}

@router.put("/update-timestamp/{action_id}", response_model=ActionResponse)
def update_action_timestamp(
    action_id: int,
    timestamp_data: ActionTimestampUpdate,
    current_trainer: Trainer = Depends(get_current_trainer), 
    db: Session = Depends(get_db)
):
    action = db.query(Action).filter(Action.id == action_id).first()
    if not action:
        raise HTTPException(status_code=404, detail="Aktion nicht gefunden.")
    game = db.query(Game).filter(Game.id == action.game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Zugehöriges Spiel nicht gefunden.")
    check_team_auth_and_get_role(db, current_trainer.id, game.team_id)
    try:
        action.video_timestamp = timestamp_data.video_timestamp
        db.commit()
        db.refresh(action)
        player_name, player_number = None, None
        if action.player_id:
            player = db.query(Player).filter(Player.id == action.player_id).first()
            if player:
                player_name, player_number = player.name, player.number
        return ActionResponse(
            id=action.id, action_type=action.action_type,
            time_in_game=action.time_in_game, game_id=action.game_id,
            player_id=action.player_id, player_name=player_name,
            player_number=player_number, x_coordinate=action.x_coordinate,
            y_coordinate=action.y_coordinate,
            video_timestamp=action.video_timestamp,
            server_timestamp=action.server_timestamp
        )
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Fehler beim Speichern: {e}")