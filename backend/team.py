from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List

# Explizite Imports
from backend.database import SessionLocal, Trainer, Team
from backend.auth import get_current_trainer 

router = APIRouter()

# -----------------------------
# NEU: Liste der verfügbaren Ligen (Detailliert nach Geschlecht und Alter)
# -----------------------------
AVAILABLE_LEAGUES = [
    # MÄNNER & FRAUEN (Aktive)
    "Männer - 1. Bundesliga",
    "Männer - 2. Bundesliga",
    "Männer - 3. Liga Nord",
    "Männer - Regionalliga West",
    "Männer - Oberliga",
    "Männer - Verbandsliga",
    "Männer - Landesliga",
    "Männer - Bezirksliga",
    "Männer - Kreisliga",
    
    "Frauen - 1. Bundesliga",
    "Frauen - 2. Bundesliga",
    "Frauen - 3. Liga Nord",
    "Frauen - Regionalliga West",
    "Frauen - Oberliga",
    "Frauen - Verbandsliga",
    "Frauen - Landesliga",
    "Frauen - Bezirksliga",
    "Frauen - Kreisliga",

    # JUGEND MÄNNLICH
    "A-Jugend männlich - 1. Bundesliga",
    "A-Jugend männlich - 2. Bundesliga",
    "A-Jugend männlich - Regionalliga",
    "A-Jugend männlich - Oberliga",
    "A-Jugend männlich - Kreisliga",
    
    "B-Jugend männlich - Bundesliga",
    "B-Jugend männlich - Regionalliga",
    "B-Jugend männlich - Oberliga",
    "B-Jugend männlich - Kreisliga",

    "C-Jugend männlich - Regionalliga",
    "C-Jugend männlich - Oberliga",
    "C-Jugend männlich - Kreisliga",
    
    # JUGEND WEIBLICH
    "A-Jugend weiblich - 1. Bundesliga",
    "A-Jugend weiblich - 2. Bundesliga",
    "A-Jugend weiblich - Regionalliga",
    "A-Jugend weiblich - Oberliga",
    "A-Jugend weiblich - Kreisliga",
    
    "B-Jugend weiblich - Bundesliga",
    "B-Jugend weiblich - Regionalliga",
    "B-Jugend weiblich - Oberliga",
    "B-Jugend weiblich - Kreisliga",

    "C-Jugend weiblich - Regionalliga",
    "C-Jugend weiblich - Oberliga",
    "C-Jugend weiblich - Kreisliga",
]

# -----------------------------
# Pydantic Modelle für Teams
# -----------------------------
class TeamCreate(BaseModel):
    name: str
    league: str

class TeamResponse(BaseModel):
    id: int
    name: str
    league: str
    trainer_id: int

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

# ENDPUNKT ZUM LADEN DER LIGEN (Ungeschützt)
@router.get("/leagues", response_model=List[str])
def get_available_leagues():
    return AVAILABLE_LEAGUES


# TEAM HINZUFÜGEN (Geschützt)
@router.post("/add", response_model=TeamResponse)
def create_team(
    team: TeamCreate,
    current_trainer: Trainer = Depends(get_current_trainer), 
    db: Session = Depends(get_db)
):
    # Prüfen, ob die gewählte Liga existiert
    if team.league not in AVAILABLE_LEAGUES:
        raise HTTPException(status_code=400, detail="Ungültige Spielklasse.")

    # Prüfen, ob der Trainer bereits ein Team mit diesem Namen hat
    existing_team = db.query(Team).filter(
        Team.trainer_id == current_trainer.id,
        Team.name == team.name
    ).first()

    if existing_team:
        raise HTTPException(status_code=400, detail="Sie haben bereits eine Mannschaft mit diesem Namen.")

    new_team = Team(
        name=team.name,
        league=team.league,
        trainer_id=current_trainer.id
    )
    db.add(new_team)
    db.commit()
    db.refresh(new_team)

    return new_team

# TEAM-LISTE LADEN (Geschützt)
@router.get("/list", response_model=List[TeamResponse])
def list_teams(
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    teams = db.query(Team).filter(
        Team.trainer_id == current_trainer.id
    ).all()
    
    return teams