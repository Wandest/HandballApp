from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

from backend.database import SessionLocal, Trainer, Team, Game
from backend.auth import get_current_trainer 

router = APIRouter()

# -----------------------------
# Pydantic Modelle für Spiele
# -----------------------------
class GameCreate(BaseModel):
    opponent: str
    date: str
    team_id: int 

class GameResponse(BaseModel):
    id: int
    opponent: str
    date: str
    team_id: int

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

# SPIEL HINZUFÜGEN
@router.post("/add", response_model=GameResponse)
def create_game(
    game_data: GameCreate,
    current_trainer: Trainer = Depends(get_current_trainer), 
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(
        Team.id == game_data.team_id,
        Team.trainer_id == current_trainer.id
    ).first()

    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden oder gehört nicht zu diesem Trainer.")
    
    new_game = Game(
        opponent=game_data.opponent,
        date=game_data.date,
        team_id=game_data.team_id
    )
    db.add(new_game)
    db.commit()
    db.refresh(new_game)

    return new_game

# SPIEL LÖSCHEN
@router.delete("/delete/{game_id}")
def delete_game(
    game_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # 1. Spiel finden
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")

    # 2. Prüfen, ob der Trainer das Team des Spiels besitzt
    team = db.query(Team).filter(
        Team.id == game.team_id,
        Team.trainer_id == current_trainer.id
    ).first()

    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung, dieses Spiel zu löschen.")

    # 3. Löschen (Dank "cascade" werden zugehörige "Action"-Einträge mitgelöscht)
    db.delete(game)
    db.commit()

    return {"message": "Spiel erfolgreich gelöscht."}


# SPIEL-LISTE EINES TEAMS LADEN
@router.get("/list/{team_id}", response_model=List[GameResponse])
def list_games(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(
        Team.id == team_id,
        Team.trainer_id == current_trainer.id
    ).first()

    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden oder gehört nicht zu diesem Trainer.")

    games = db.query(Game).filter(
        Game.team_id == team_id
    ).order_by(Game.date.desc()).all()
    
    return games
