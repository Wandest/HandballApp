#
# DATEI: backend/player.py
#
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

from backend.database import SessionLocal, Trainer, Team, Player
from backend.auth import get_current_trainer 

router = APIRouter()

# -----------------------------
# Pydantic Modelle für Spieler
# -----------------------------

POSITIONS = ["Torwart", "Rückraum Mitte", "Rückraum Links", "Rückraum Rechts", "Linksaußen", "Rechtsaußen", "Kreisläufer", "Universal"]

class PlayerCreate(BaseModel):
    name: str
    number: Optional[int] = None
    position: Optional[str] = None
    team_id: int 

# --- HIER SIND DIE ÄNDERUNGEN ---
class PlayerResponse(BaseModel):
    id: int
    name: str
    number: Optional[int]
    position: Optional[str]
    team_id: int
    
    # NEU: Ein Flag, das wir im Frontend setzen können
    # (z.B. um anzuzeigen, ob der Spieler im Roster ist)
    is_participating: Optional[bool] = False 

    class Config:
        from_attributes = True
# --- ENDE ÄNDERUNGEN ---

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

@router.get("/positions", response_model=List[str])
def get_available_positions():
    return POSITIONS

# SPIELER HINZUFÜGEN
@router.post("/add", response_model=PlayerResponse)
def create_player(
    player_data: PlayerCreate,
    current_trainer: Trainer = Depends(get_current_trainer), 
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(
        Team.id == player_data.team_id,
        Team.trainer_id == current_trainer.id
    ).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden oder gehört nicht zu diesem Trainer.")
    if player_data.position and player_data.position not in POSITIONS:
        raise HTTPException(status_code=400, detail="Ungültige Position.")
    if player_data.number is not None:
        existing_player_with_number = db.query(Player).filter(
            Player.team_id == player_data.team_id,
            Player.number == player_data.number
        ).first()
        if existing_player_with_number:
            raise HTTPException(status_code=400, detail=f"Spielernummer {player_data.number} ist in diesem Team bereits vergeben.")

    new_player = Player(
        name=player_data.name,
        number=player_data.number,
        position=player_data.position,
        team_id=player_data.team_id
    )
    db.add(new_player)
    db.commit()
    db.refresh(new_player)
    return new_player

# SPIELER LÖSCHEN
@router.delete("/delete/{player_id}")
def delete_player(
    player_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    player = db.query(Player).filter(Player.id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden.")
    team = db.query(Team).filter(
        Team.id == player.team_id,
        Team.trainer_id == current_trainer.id
    ).first()
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung, diesen Spieler zu löschen.")
    db.delete(player)
    db.commit()
    return {"message": "Spieler erfolgreich gelöscht."}


# SPIELER-LISTE EINES TEAMS LADEN
@router.get("/list/{team_id}", response_model=List[PlayerResponse])
def list_players(
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

    players = db.query(Player).filter(
        Player.team_id == team_id
    ).order_by(Player.number.asc(), Player.name.asc()).all()
    
    return players