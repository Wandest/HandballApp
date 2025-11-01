# DATEI: backend/team.py
# (KEINE ÄNDERUNGEN NÖTIG)

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List

from backend.database import SessionLocal, Trainer, Team
from backend.auth import get_current_trainer 

router = APIRouter()

# -----------------------------
# Liste der verfügbaren Ligen (Exportierbare Funktion)
# -----------------------------
def get_league_list(): 
    return [
        "Männer - 1. Bundesliga", "Männer - 2. Bundesliga", "Männer - 3. Liga Nord",
        "Männer - Regionalliga West", "Männer - Oberliga", "Männer - Verbandsliga",
        "Männer - Landesliga", "Männer - Bezirksliga", "Männer - Kreisliga",
        "Frauen - 1. Bundesliga", "Frauen - 2. Bundesliga", "Frauen - 3. Liga Nord",
        "Frauen - Regionalliga West", "Frauen - Oberliga", "Frauen - Verbandsliga",
        "Frauen - Landesliga", "Frauen - Bezirksliga", "Frauen - Kreisliga",
        "A-Jugend männlich - 1. Bundesliga", "A-Jugend männlich - 2. Bundesliga",
        "A-Jugend männlich - Regionalliga", "A-Jugend männlich - Oberliga",
        "A-Jugend männlich - Kreisliga",
        "B-Jugend männlich - Bundesliga", "B-Jugend männlich - Regionalliga",
        "B-Jugend männlich - Oberliga", "B-Jugend männlich - Kreisliga",
        "C-Jugend männlich - Regionalliga", "C-Jugend männlich - Oberliga",
        "C-Jugend männlich - Kreisliga",
        "A-Jugend weiblich - 1. Bundesliga", "A-Jugend weiblich - 2. Bundesliga",
        "A-Jugend weiblich - Regionalliga", "A-Jugend weiblich - Oberliga",
        "A-Jugend weiblich - Kreisliga",
        "B-Jugend weiblich - Bundesliga", "B-Jugend weiblich - Regionalliga",
        "B-Jugend weiblich - Oberliga", "B-Jugend weiblich - Kreisliga",
        "C-Jugend weiblich - Regionalliga", "C-Jugend weiblich - Oberliga",
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
    is_public: bool # (PHASE 6)

    class Config:
        from_attributes = True

class TeamPublicToggleResponse(BaseModel):
    team_id: int
    is_public: bool
    message: str

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

@router.get("/leagues", response_model=List[str])
def get_available_leagues():
    return get_league_list()


@router.post("/add", response_model=TeamResponse)
def create_team(
    team: TeamCreate,
    current_trainer: Trainer = Depends(get_current_trainer), 
    db: Session = Depends(get_db)
):
    if team.league not in get_league_list():
        raise HTTPException(status_code=400, detail="Ungültige Spielklasse.")

    existing_team = db.query(Team).filter(
        Team.trainer_id == current_trainer.id,
        Team.name == team.name
    ).first()

    if existing_team:
        raise HTTPException(status_code=400, detail="Sie haben bereits eine Mannschaft mit diesem Namen.")

    new_team = Team(
        name=team.name,
        league=team.league,
        trainer_id=current_trainer.id,
        is_public=False 
    )
    db.add(new_team)
    db.commit()
    db.refresh(new_team)

    return new_team

@router.get("/list", response_model=List[TeamResponse])
def list_teams(
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    teams = db.query(Team).filter(
        Team.trainer_id == current_trainer.id
    ).all()
    
    return teams

@router.post("/toggle-public/{team_id}", response_model=TeamPublicToggleResponse)
def toggle_team_public(
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
    
    team.is_public = not team.is_public
    db.commit()
    db.refresh(team)
    
    message = "sichtbar" if team.is_public else "privat"
    
    return TeamPublicToggleResponse(
        team_id=team.id,
        is_public=team.is_public,
        message=f"Team '{team.name}' ist jetzt öffentlich {message}."
    )
