from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, case, distinct
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import re

# WICHTIG: game_participations_table importiert
from backend.database import SessionLocal, Trainer, Team, Player, Game, Action, CustomAction, game_participations_table
from backend.auth import get_current_trainer 

router = APIRouter()

# -----------------------------
# Pydantic Modelle für Aktionen
# -----------------------------
class ActionCreate(BaseModel):
    action_type: str 
    time_in_game: Optional[str] = "N/A" 
    game_id: int 
    player_id: Optional[int] = None 
    is_seven_meter: Optional[bool] = False

class ActionResponse(BaseModel):
    id: int
    action_type: str
    time_in_game: str
    player_name: Optional[str] = None
    player_number: Optional[int] = None
    game_id: int
    player_id: Optional[int]

    class Config:
        from_attributes = True

# ANGEPASST (PHASE 6.3)
class PlayerStats(BaseModel):
    player_id: int
    player_name: str
    player_number: Optional[int]
    position: Optional[str]
    games_played: int # NEU: Für Tore/Spiel
    goals: int
    misses: int
    tech_errors: int
    seven_meter_goals: int
    seven_meter_misses: int
    seven_meter_caused: int
    seven_meter_saves: int
    seven_meter_received: int 
    saves: int
    opponent_goals: int
    custom_counts: Dict[str, int] = {}

class OpponentStats(BaseModel):
    opponent_goals: int
    opponent_misses: int
    opponent_tech_errors: int

# Datenbanksession
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# -----------------------------
# Endpunkte
# -----------------------------

# AKTION HINZUFÜGEN
@router.post("/add", response_model=ActionResponse)
def log_action(
    action_data: ActionCreate,
    current_trainer: Trainer = Depends(get_current_trainer), 
    db: Session = Depends(get_db)
):
    game = db.query(Game).filter(Game.id == action_data.game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
    team = db.query(Team).filter(
        Team.id == game.team_id,
        Team.trainer_id == current_trainer.id
    ).first()
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung, Aktionen für dieses Spiel zu protokollieren.")
    
    player_name_for_action = None
    player_number_for_action = None
    
    if action_data.player_id:
        player = db.query(Player).filter(Player.id == action_data.player_id).first()
        if not player or player.team_id != game.team_id:
            raise HTTPException(status_code=400, detail="Ungültige Spieler-ID oder Spieler gehört nicht zu diesem Team.")
        player_name_for_action = player.name
        player_number_for_action = player.number

    action_key = action_data.action_type
    if action_data.is_seven_meter:
        if action_data.action_type == 'Goal':
            action_key = 'Goal_7m'
        elif action_data.action_type == 'Miss':
            action_key = 'Miss_7m'

    new_action = Action(
        action_type=action_key,
        time_in_game=action_data.time_in_game,
        game_id=action_data.game_id,
        player_id=action_data.player_id
    )
    db.add(new_action)
    db.commit()
    db.refresh(new_action)
    
    response_data = ActionResponse(
        id=new_action.id,
        action_type=new_action.action_type,
        time_in_game=new_action.time_in_game,
        game_id=new_action.game_id,
        player_id=new_action.player_id,
        player_name=player_name_for_action,
        player_number=player_number_for_action
    )

    return response_data

# ALLE AKTIONEN EINES SPIELS LADEN (BUGFIX ANGEWENDET)
@router.get("/list/{game_id}", response_model=List[ActionResponse])
def list_actions(
    game_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
    team = db.query(Team).filter(
        Team.id == game.team_id,
        Team.trainer_id == current_trainer.id
    ).first()
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung, Aktionen für dieses Spiel einzusehen.")

    actions_data = db.query(Action).filter(Action.game_id == game_id).order_by(Action.id.desc()).all()
    
    response_list = []
    
    team_players = {p.id: p for p in db.query(Player).filter(Player.team_id == game.team_id).all()}
    
    for action in actions_data:
        player_name = None
        player_number = None
        
        if action.player_id and action.player_id in team_players:
            player = team_players[action.player_id]
            player_name = player.name
            player_number = player.number
        
        response_list.append(ActionResponse(
            id=action.id,
            action_type=action.action_type,
            time_in_game=action.time_in_game, 
            game_id=action.game_id,
            player_id=action.player_id,
            player_name=player_name,
            player_number=player_number
        ))
        
    return response_list

# LIVE STATISTIKEN FÜR SPIELER ABFRAGEN (BUGFIX ANGEWENDET)
@router.get("/stats/{game_id}", response_model=List[PlayerStats])
def get_game_stats(
    game_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
    team = db.query(Team).filter(
        Team.id == game.team_id,
        Team.trainer_id == current_trainer.id
    ).first()
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für dieses Spiel.")
        
    participating_player_ids = db.query(game_participations_table.c.player_id).filter(
        game_participations_table.c.game_id == game_id
    ).all()
    participating_player_ids = [pid[0] for pid in participating_player_ids]

    if not participating_player_ids:
        return [] 

    custom_actions = db.query(CustomAction).filter(CustomAction.team_id == team.id).all()
    custom_action_names = [ca.name for ca in custom_actions]
    case_statements = [
        func.count(case((Action.action_type == 'Goal', 1), else_=None)).label('goals'),
        func.count(case((Action.action_type == 'Miss', 1), else_=None)).label('misses'),
        func.count(case((Action.action_type == 'TechError', 1), else_=None)).label('tech_errors'),
        func.count(case((Action.action_type == 'Goal_7m', 1), else_=None)).label('seven_meter_goals'),
        func.count(case((Action.action_type == 'Miss_7m', 1), else_=None)).label('seven_meter_misses'),
        func.count(case((Action.action_type == 'SEVEN_METER_CAUSED', 1), else_=None)).label('seven_meter_caused'),
        func.count(case((Action.action_type == 'SEVEN_METER_SAVE', 1), else_=None)).label('seven_meter_saves'),
        func.count(case((Action.action_type == 'SEVEN_METER_RECEIVED', 1), else_=None)).label('seven_meter_received'),
        func.count(case((Action.action_type == 'Save', 1), else_=None)).label('saves'),
        func.count(case((Action.action_type == 'OppGoal', 1), else_=None)).label('opponent_goals')
    ]
    for name in custom_action_names:
        safe_label = f"custom_{name}" 
        case_statements.append(
            func.count(case((Action.action_type == name, 1), else_=None)).label(safe_label)
        )
    stats_query = (
        db.query(
            Player.id,
            Player.name,
            Player.number,
            Player.position,
            *case_statements
        )
        .select_from(Player)
        .outerjoin(Action, (Action.player_id == Player.id) & (Action.game_id == game_id))
        .filter(Player.team_id == team.id)
        .filter(Player.id.in_(participating_player_ids))
        .group_by(Player.id, Player.name, Player.number, Player.position)
        .order_by(Player.number.asc())
    )
    
    stats_results = stats_query.all()
    final_stats = []
    
    for row in stats_results:
        row_data = row._asdict()
        custom_counts_dict = {}
        for name in custom_action_names:
            safe_label = f"custom_{name}"
            custom_counts_dict[name] = row_data.get(safe_label, 0)

        final_stats.append(PlayerStats(
            player_id=row_data.get('id'),
            player_name=row_data.get('name'),
            player_number=row_data.get('number'),
            position=row_data.get('position'),
            games_played=1, # Für Live-Statistik ist das immer 1
            goals=row_data.get('goals', 0),
            misses=row_data.get('misses', 0),
            tech_errors=row_data.get('tech_errors', 0),
            seven_meter_goals=row_data.get('seven_meter_goals', 0),
            seven_meter_misses=row_data.get('seven_meter_misses', 0),
            seven_meter_caused=row_data.get('seven_meter_caused', 0),
            seven_meter_saves=row_data.get('seven_meter_saves', 0),
            seven_meter_received=row_data.get('seven_meter_received', 0),
            saves=row_data.get('saves', 0),
            opponent_goals=row_data.get('opponent_goals', 0),
            custom_counts=custom_counts_dict
        ))
    return final_stats

# LIVE GEGNER-STATISTIK
@router.get("/stats/opponent/{game_id}", response_model=OpponentStats)
def get_opponent_stats(
    game_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
    team = db.query(Team).filter(
        Team.id == game.team_id,
        Team.trainer_id == current_trainer.id
    ).first()
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für dieses Spiel.")
    stats_query = db.query(
        func.count(case((Action.action_type == 'OppGoal', 1), else_=None)).label('opponent_goals'),
        func.count(case((Action.action_type == 'OppMiss', 1), else_=None)).label('opponent_misses'),
        func.count(case((Action.action_type == 'OppTechError', 1), else_=None)).label('opponent_tech_errors')
    ).filter(
        Action.game_id == game_id,
        Action.player_id.is_(None) 
    )
    stats_result = stats_query.first()
    if not stats_result:
        return OpponentStats(opponent_goals=0, opponent_misses=0, opponent_tech_errors=0)
    return OpponentStats(
        opponent_goals=stats_result.opponent_goals,
        opponent_misses=stats_result.opponent_misses,
        opponent_tech_errors=stats_result.opponent_tech_errors
    )

# SAISON-STATISTIK (SPIELER) (ANGEPASST FÜR PHASE 6.3)
@router.get("/stats/season/{team_id}", response_model=List[PlayerStats])
def get_season_stats(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id, Team.trainer_id == current_trainer.id).first()
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für dieses Team.")
        
    # 1. Finde alle "Saison"-Spiele des Teams
    saison_games_query = db.query(Game.id).filter(
        Game.team_id == team_id,
        Game.game_category == 'Saison'
    )
    saison_games_ids = [g[0] for g in saison_games_query.all()]
    
    if not saison_games_ids:
        players = db.query(Player).filter(Player.team_id == team_id).all()
        empty_stats = []
        for p in players:
            empty_stats.append(PlayerStats(
                player_id=p.id, player_name=p.name, player_number=p.number, position=p.position,
                games_played=0, goals=0, misses=0, tech_errors=0, seven_meter_goals=0,
                seven_meter_misses=0, seven_meter_caused=0, seven_meter_saves=0,
                seven_meter_received=0, saves=0, opponent_goals=0, custom_counts={}
            ))
        return empty_stats

    # 2. Zähle, an wie vielen dieser Saisonspiele jeder Spieler teilgenommen hat
    games_played_count = db.query(
        game_participations_table.c.player_id,
        func.count(game_participations_table.c.game_id).label('games_played')
    ).filter(
        game_participations_table.c.game_id.in_(saison_games_ids)
    ).group_by(
        game_participations_table.c.player_id
    ).subquery()

    # 3. Zähle Aktionen
    custom_actions = db.query(CustomAction).filter(CustomAction.team_id == team.id).all()
    custom_action_names = [ca.name for ca in custom_actions]
    case_statements = [
        func.count(case((Action.action_type == 'Goal', 1), else_=None)).label('goals'),
        func.count(case((Action.action_type == 'Miss', 1), else_=None)).label('misses'),
        func.count(case((Action.action_type == 'TechError', 1), else_=None)).label('tech_errors'),
        func.count(case((Action.action_type == 'Goal_7m', 1), else_=None)).label('seven_meter_goals'),
        func.count(case((Action.action_type == 'Miss_7m', 1), else_=None)).label('seven_meter_misses'),
        func.count(case((Action.action_type == 'SEVEN_METER_CAUSED', 1), else_=None)).label('seven_meter_caused'),
        func.count(case((Action.action_type == 'SEVEN_METER_SAVE', 1), else_=None)).label('seven_meter_saves'),
        func.count(case((Action.action_type == 'SEVEN_METER_RECEIVED', 1), else_=None)).label('seven_meter_received'),
        func.count(case((Action.action_type == 'Save', 1), else_=None)).label('saves'),
        func.count(case((Action.action_type == 'OppGoal', 1), else_=None)).label('opponent_goals')
    ]
    for name in custom_action_names:
        safe_label = f"custom_{name}" 
        case_statements.append(
            func.count(case((Action.action_type == name, 1), else_=None)).label(safe_label)
        )
    
    # 4. Kombinierte Abfrage (BUGFIX: Backslash entfernt)
    stats_query = db.query(
        Player.id,
        Player.name,
        Player.number,
        Player.position,
        func.coalesce(games_played_count.c.games_played, 0).label('games_played'),
        *case_statements 
    ).select_from(Player)\
    .outerjoin(games_played_count, Player.id == games_played_count.c.player_id)\
    .outerjoin(Action, 
        (Action.player_id == Player.id) & 
        (Action.game_id.in_(saison_games_ids))
    )\
    .filter(Player.team_id == team.id)\
    .group_by(
        Player.id, 
        Player.name, 
        Player.number, 
        Player.position, 
        games_played_count.c.games_played
    )\
    .order_by(Player.number.asc())
    
    stats_results = stats_query.all()
    final_stats = []
    
    for row in stats_results:
        row_data = row._asdict()
        custom_counts_dict = {}
        for name in custom_action_names:
            safe_label = f"custom_{name}"
            custom_counts_dict[name] = row_data.get(safe_label, 0)
        final_stats.append(PlayerStats(
            player_id=row_data.get('id'),
            player_name=row_data.get('name'),
            player_number=row_data.get('number'),
            position=row_data.get('position'),
            games_played=row_data.get('games_played', 0), # NEU
            goals=row_data.get('goals', 0),
            misses=row_data.get('misses', 0),
            tech_errors=row_data.get('tech_errors', 0),
            seven_meter_goals=row_data.get('seven_meter_goals', 0),
            seven_meter_misses=row_data.get('seven_meter_misses', 0),
            seven_meter_caused=row_data.get('seven_meter_caused', 0),
            seven_meter_saves=row_data.get('seven_meter_saves', 0),
            seven_meter_received=row_data.get('seven_meter_received', 0),
            saves=row_data.get('saves', 0),
            opponent_goals=row_data.get('opponent_goals', 0),
            custom_counts=custom_counts_dict
        ))
    return final_stats

# SAISON-STATISTIK (GEGNER)
@router.get("/stats/season/opponent/{team_id}", response_model=OpponentStats)
def get_season_opponent_stats(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(Team.id == team_id, Team.trainer_id == current_trainer.id).first()
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für dieses Team.")
        
    saison_games_subquery = db.query(Game.id).filter(
        Game.team_id == team_id,
        Game.game_category == 'Saison'
    ).subquery()

    stats_query = db.query(
        func.count(case((Action.action_type == 'OppGoal', 1), else_=None)).label('opponent_goals'),
        func.count(case((Action.action_type == 'OppMiss', 1), else_=None)).label('opponent_misses'),
        func.count(case((Action.action_type == 'OppTechError', 1), else_=None)).label('opponent_tech_errors')
    ).filter(
        Action.game_id.in_(saison_games_subquery), 
        Action.player_id.is_(None) 
    )
    
    stats_result = stats_query.first()

    if not stats_result:
        return OpponentStats(opponent_goals=0, opponent_misses=0, opponent_tech_errors=0)

    return OpponentStats(
        opponent_goals=stats_result.opponent_goals,
        opponent_misses=stats_result.opponent_misses,
        opponent_tech_errors=stats_result.opponent_tech_errors
    )


# AKTION LÖSCHEN
@router.delete("/delete/{action_id}")
def delete_action(
    action_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    action = db.query(Action).filter(Action.id == action_id).first()
    if not action:
        raise HTTPException(status_code=404, detail="Aktion nicht gefunden.")
    game = db.query(Game).filter(Game.id == action.game_id).first()
    team = db.query(Team).filter(
        Team.id == game.team_id,
        Team.trainer_id == current_trainer.id
    ).first()
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung, diese Aktion zu löschen.")
    db.delete(action)
    db.commit()
    return {"message": "Aktion erfolgreich gelöscht."}

