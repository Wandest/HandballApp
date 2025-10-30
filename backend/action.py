from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import re

from backend.database import SessionLocal, Trainer, Team, Player, Game, Action
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
    is_seven_meter: Optional[bool] = False # Für 7m-Tore/Fehlwürfe

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

# Statistik-Modell
class PlayerStats(BaseModel):
    player_id: int
    player_name: str
    player_number: Optional[int]
    position: Optional[str] 
    # Feste Aktionen
    goals: int
    misses: int
    tech_errors: int
    seven_meter_goals: int
    seven_meter_misses: int
    seven_meter_caused: int
    seven_meter_saves: int
    saves: int
    opponent_goals: int
    # Dynamische Aktionen
    custom_counts: Dict[str, int] # Hier kommen die Custom Actions rein

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
    
    if action_data.player_id:
        player = db.query(Player).filter(Player.id == action_data.player_id).first()
        if not player or player.team_id != game.team_id:
            raise HTTPException(status_code=400, detail="Ungültige Spieler-ID oder Spieler gehört nicht zu diesem Team.")

    action_key = action_data.action_type
    
    # Spezielle 7m-Logik
    if action_data.is_seven_meter:
        if action_data.action_type == 'Goal':
            action_key = 'Goal_7m'
        elif action_data.action_type == 'Miss':
            action_key = 'Miss_7m'

    new_action = Action(
        action_type=action_key, # Speichert "Goal_7m" oder "Gute Abwehr"
        time_in_game=action_data.time_in_game,
        game_id=action_data.game_id,
        player_id=action_data.player_id
    )
    db.add(new_action)
    db.commit()
    db.refresh(new_action)
    
    # Fülle Antwort aus
    player_name_resp = player.name if action_data.player_id and player else None
    player_number_resp = player.number if action_data.player_id and player else None

    return ActionResponse(
        id=new_action.id,
        action_type=new_action.action_type,
        time_in_game=new_action.time_in_game,
        game_id=new_action.game_id,
        player_id=new_action.player_id,
        player_name=player_name_resp,
        player_number=player_number_resp
    )

# ALLE AKTIONEN EINES SPIELS LADEN
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

# LIVE STATISTIKEN FÜR EIN SPIEL ABFRAGEN (Platzhalter für Custom Actions)
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
        
    
    # HINWEIS: Diese Abfrage zählt NOCH KEINE Custom Actions.
    # Sie zählt nur die festen Typen.
    
    stats_query = db.query(
        Player.id,
        Player.name,
        Player.number,
        Player.position, 
        func.count(case((Action.action_type == 'Goal', 1), else_=None)).label('goals'),
        func.count(case((Action.action_type == 'Miss', 1), else_=None)).label('misses'),
        func.count(case((Action.action_type == 'TechError', 1), else_=None)).label('tech_errors'),
        func.count(case((Action.action_type == 'Goal_7m', 1), else_=None)).label('seven_meter_goals'),
        func.count(case((Action.action_type == 'Miss_7m', 1), else_=None)).label('seven_meter_misses'),
        func.count(case((Action.action_type == 'SEVEN_METER_CAUSED', 1), else_=None)).label('seven_meter_caused'),
        func.count(case((Action.action_type == 'SEVEN_METER_SAVE', 1), else_=None)).label('seven_meter_saves'),
        func.count(case((Action.action_type == 'Save', 1), else_=None)).label('saves'),
        func.count(case((Action.action_type == 'OppGoal', 1), else_=None)).label('opponent_goals')
    ).select_from(Player).outerjoin(Action, (Action.player_id == Player.id) & (Action.game_id == game_id))\
    .filter(Player.team_id == team.id)\
    .group_by(Player.id, Player.name, Player.number, Player.position)\
    .order_by(Player.number.asc())

    stats_results = stats_query.all()
    
    final_stats = []
    
    for row in stats_results:
        final_stats.append(PlayerStats(
            player_id=row.id,
            player_name=row.name,
            player_number=row.number,
            position=row.position,
            goals=row.goals,
            misses=row.misses,
            tech_errors=row.tech_errors,
            seven_meter_goals=row.seven_meter_goals,
            seven_meter_misses=row.seven_meter_misses,
            seven_meter_caused=row.seven_meter_caused,
            seven_meter_saves=row.seven_meter_saves,
            saves=row.saves,
            opponent_goals=row.opponent_goals,
            custom_counts={} # TODO: Muss noch implementiert werden
        ))

    return final_stats

# ENDPUNKT ZUM LÖSCHEN EINER AKTION
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
