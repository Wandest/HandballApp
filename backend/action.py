from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import re

from backend.database import SessionLocal, Trainer, Team, Player, Game, Action, CustomAction
from backend.auth import get_current_trainer 

router = APIRouter()

# -----------------------------
# Pydantic Modelle für Aktionen (Unverändert)
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

# Statistik-Modell (Unverändert)
class PlayerStats(BaseModel):
    player_id: int
    player_name: str
    player_number: Optional[int]
    goals: int
    misses: int
    tech_errors: int
    seven_meter_goals: int
    seven_meter_misses: int
    custom_counts: Dict[str, int]

# Datenbanksession
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# -----------------------------
# Standard-Aktionen erstellen (FINAL KORRIGIERT: Keine 7m-Aktionen hier mehr!)
# -----------------------------
def create_default_actions(trainer_id: int, db: Session):
    """
    Diese Funktion stellt nur sicher, dass die CUSTOM ACTION Tabelle existiert.
    Die 7m-Aktionen werden jetzt NICHT über die Datenbank erstellt, da sie hartcodiert sind.
    """
    
    # Optional: Timeout, falls der Trainer es nicht löschen können soll
    default_actions_to_create = [
        {"name": "Timeout", "key": "TIMEOUT", "is_goalkeeper_action": False},
    ]

    for action_data in default_actions_to_create:
        existing = db.query(CustomAction).filter(
            CustomAction.trainer_id == trainer_id,
            CustomAction.key == action_data['key']
        ).first()

        if not existing:
            new_action = CustomAction(
                trainer_id=trainer_id,
                name=action_data['name'],
                key=action_data['key'],
                is_goalkeeper_action=action_data['is_goalkeeper_action']
            )
            db.add(new_action)
    
    db.commit()


# -----------------------------
# Endpunkte (Unverändert)
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
    
    if action_data.player_id:
        player = db.query(Player).filter(Player.id == action_data.player_id).first()
        if not player or player.team_id != game.team_id:
            raise HTTPException(status_code=400, detail="Ungültige Spieler-ID oder Spieler gehört nicht zu diesem Team.")

    action_key = action_data.action_type
    if action_data.is_seven_meter:
        if action_data.action_type == 'Goal':
            action_key = 'Goal_7m'
        elif action_data.action_type == 'Miss':
            action_key = 'Miss_7m'
            
    # HINWEIS: SEVEN_METER_SAVE und SEVEN_METER_CAUSED müssen direkt als Action Type übergeben werden.
    # Da dies bereits im Frontend-Code geschieht, wird das Backend es korrekt speichern.


    new_action = Action(
        action_type=action_key,
        time_in_game=action_data.time_in_game,
        game_id=action_data.game_id,
        player_id=action_data.player_id
    )
    db.add(new_action)
    db.commit()
    db.refresh(new_action)

    return new_action

# ALLE AKTIONEN EINES SPIELS LADEN (Unverändert)
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

# LIVE STATISTIKEN FÜR EIN SPIEL ABFRAGEN (Unverändert)
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
        
    custom_actions = db.query(CustomAction).filter(CustomAction.trainer_id == current_trainer.id).all()
    
    stats_query = db.query(
        Player.id,
        Player.name,
        Player.number,
        func.count(case((Action.action_type == 'Goal', 1), else_=None)).label('goals'),
        func.count(case((Action.action_type == 'Miss', 1), else_=None)).label('misses'),
        func.count(case((Action.action_type == 'TechError', 1), else_=None)).label('tech_errors'),
        func.count(case((Action.action_type == 'Goal_7m', 1), else_=None)).label('seven_meter_goals'),
        func.count(case((Action.action_type == 'Miss_7m', 1), else_=None)).label('seven_meter_misses'),
    ).select_from(Player).outerjoin(Action, (Action.player_id == Player.id) & (Action.game_id == game_id))\
    .filter(Player.team_id == team.id)\
    .group_by(Player.id, Player.name, Player.number)\
    .order_by(Player.number.asc())

    stats_results = stats_query.all()
    
    all_actions_for_game = db.query(Action).filter(Action.game_id == game_id, Action.player_id.isnot(None)).all()
    
    final_stats = []
    
    for player_id, name, number, goals, misses, tech_errors, sm_goals, sm_misses in stats_results:
        custom_counts = {}
        for ca in custom_actions:
            count = sum(1 for action in all_actions_for_game if action.player_id == player_id and action.action_type == ca.key)
            if count > 0:
                custom_counts[ca.key] = count
                
        final_stats.append(PlayerStats(
            player_id=player_id,
            player_name=name,
            player_number=number,
            goals=goals,
            misses=misses,
            tech_errors=tech_errors,
            seven_meter_goals=sm_goals,
            seven_meter_misses=sm_misses,
            custom_counts=custom_counts
        ))

    return final_stats