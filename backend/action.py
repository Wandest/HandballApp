from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

from backend.database import SessionLocal, Trainer, Team, Player, Game, Action
from backend.auth import get_current_trainer 

router = APIRouter()

# -----------------------------
# Pydantic Modelle für Aktionen
# -----------------------------
class ActionCreate(BaseModel):
    action_type: str # Z.B. 'Goal', '2Min', 'Timeout'
    time_in_game: str # Aktuelle Spielzeit, z.B. "12:45"
    game_id: int 
    player_id: Optional[int] = None # Optional, da Timeouts oder Team-Fouls keinen Spieler betreffen

class ActionResponse(BaseModel):
    id: int
    action_type: str
    time_in_game: str
    game_id: int
    player_id: Optional[int]

    class Config:
        from_attributes = True

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

# AKTION HINZUFÜGEN (Der Kern des Protokolls)
@router.post("/add", response_model=ActionResponse)
def log_action(
    action_data: ActionCreate,
    current_trainer: Trainer = Depends(get_current_trainer), 
    db: Session = Depends(get_db)
):
    # 1. Spiel-Validierung: Prüfen, ob das Spiel existiert und zum Trainer gehört
    game = db.query(Game).filter(Game.id == action_data.game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")

    team = db.query(Team).filter(
        Team.id == game.team_id,
        Team.trainer_id == current_trainer.id
    ).first()

    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung, Aktionen für dieses Spiel zu protokollieren.")
    
    # 2. Spieler-Validierung (falls vorhanden)
    if action_data.player_id:
        player = db.query(Player).filter(Player.id == action_data.player_id).first()
        if not player or player.team_id != game.team_id:
            raise HTTPException(status_code=400, detail="Ungültige Spieler-ID oder Spieler gehört nicht zu diesem Team.")

    # 3. Aktion erstellen
    new_action = Action(
        action_type=action_data.action_type,
        time_in_game=action_data.time_in_game,
        game_id=action_data.game_id,
        player_id=action_data.player_id
    )
    db.add(new_action)
    db.commit()
    db.refresh(new_action)

    return new_action

# ALLE AKTIONEN EINES SPIELS LADEN
@router.get("/list/{game_id}", response_model=List[ActionResponse])
def list_actions(
    game_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # Zugriffsprüfung
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")

    team = db.query(Team).filter(
        Team.id == game.team_id,
        Team.trainer_id == current_trainer.id
    ).first()

    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung, Aktionen für dieses Spiel einzusehen.")

    actions = db.query(Action).filter(
        Action.game_id == game_id
    ).order_by(Action.time_in_game.desc()).all()
    
    return actions