from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import distinct # NEU: Import für distinct
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
    game_category: str 
    tournament_name: Optional[str] = None 

class GameResponse(BaseModel):
    id: int
    opponent: str
    date: str
    team_id: int
    game_category: str
    tournament_name: Optional[str] = None

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
    
    valid_categories = ["Saison", "Testspiel", "Turnier"]
    if game_data.game_category not in valid_categories:
        raise HTTPException(status_code=400, detail="Ungültige Spielkategorie.")
        
    if game_data.game_category == "Turnier" and not game_data.tournament_name:
        raise HTTPException(status_code=400, detail="Für Turnierspiele muss ein Turniername angegeben werden.")

    # Bereinige den Turniernamen, falls es kein Turnierspiel ist
    tournament_name_to_save = game_data.tournament_name if game_data.game_category == "Turnier" else None

    new_game = Game(
        opponent=game_data.opponent,
        date=game_data.date,
        team_id=game_data.team_id,
        game_category=game_data.game_category,
        tournament_name=tournament_name_to_save
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
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")

    team = db.query(Team).filter(
        Team.id == game.team_id,
        Team.trainer_id == current_trainer.id
    ).first()

    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung, dieses Spiel zu löschen.")

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

# --- NEUER ENDPUNKT ---
# LISTE ALLER TURNIERNAMEN FÜR EIN TEAM
@router.get("/tournaments/{team_id}", response_model=List[str])
def list_tournaments(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(
        Team.id == team_id,
        Team.trainer_id == current_trainer.id
    ).first()

    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für dieses Team.")

    # Finde alle einzigartigen (distinct) Turniernamen für dieses Team
    tournaments_query = db.query(distinct(Game.tournament_name)).filter(
        Game.team_id == team_id,
        Game.tournament_name.isnot(None) # Ignoriere leere Einträge
    ).all()
    
    # Extrahiere die Namen aus dem Query-Ergebnis
    tournaments = [row[0] for row in tournaments_query if row[0]]
    
    return tournaments

