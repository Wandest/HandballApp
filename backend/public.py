# DATEI: backend/public.py (KORRIGIERT: Entfernt redundante Statistik-Routen und nutzt Action-Modelle)

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import HTMLResponse 
from fastapi.templating import Jinja2Templates 
from sqlalchemy.orm import Session
from sqlalchemy import func, case, and_, distinct
from pydantic import BaseModel, EmailStr 
from typing import List, Optional, Dict, Any
import re

from backend.database import SessionLocal, Trainer, Team, Player, Game, Action, CustomAction, game_participations_table
# Wichtig: Wir importieren die Pydantic-Modelle aus action.py, um Redundanz zu vermeiden
from backend.action import PlayerStats, OpponentStats, ShotData, ShotDataResponse 
# Import für die Passwort-Logik (für /register-player)
from backend.auth import get_password_hash 

router = APIRouter()

# --- Pydantic Modelle für öffentliche Routen ---

class PublicTeam(BaseModel):
    id: int
    name: str
    class Config: from_attributes = True

class PublicStatsResponse(BaseModel):
    # NEU: Diese werden direkt vom action.py Endpunkt geladen
    player_stats: List[PlayerStats]
    opponent_stats: OpponentStats

# NEU (PHASE 10): Modelle für die Account-Aktivierung
class PlayerTokenInfo(BaseModel):
    player_name: str
    team_name: str
    email: EmailStr

class PlayerRegistration(BaseModel):
    token: str
    email: EmailStr
    password: str

# Datenbanksession
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ==================================================
# 1. ÖFFENTLICHER ENDPUNKT: TOKEN VALIDIEREN & DATEN LADEN
# ==================================================

@router.get("/player-info-by-token/{token}", response_model=PlayerTokenInfo)
def get_player_info_by_token(token: str, db: Session = Depends(get_db)):
    """
    Sucht einen Spieler anhand des Einladungstokens und gibt die relevanten Infos zurück.
    """
    
    player = db.query(Player).filter(
        Player.invitation_token == token,
        Player.is_active == False 
    ).first()
    
    if not player:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Aktivierungstoken ungültig, abgelaufen oder bereits verwendet."
        )
        
    team = db.query(Team).filter(Team.id == player.team_id).first()
    
    return PlayerTokenInfo(
        player_name=player.name,
        team_name=team.name if team else "Unbekanntes Team",
        email=player.email 
    )


# ==================================================
# 2. ÖFFENTLICHER ENDPUNKT: REGISTRIERUNG ABSCHLIESSEN
# ==================================================

@router.post("/register-player")
def register_player(data: PlayerRegistration, db: Session = Depends(get_db)):
    """
    Schließt die Spielerregistrierung ab: Validiert Token und setzt Passwort/aktiviert Account.
    """
    
    # 1. Spieler über Token finden
    player = db.query(Player).filter(
        Player.invitation_token == data.token,
        Player.email == data.email, # Sicherheits-Check
        Player.is_active == False
    ).first()
    
    if not player:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token ungültig oder E-Mail passt nicht zum Token."
        )
        
    # 2. Passwort hashen und speichern
    hashed_password = get_password_hash(data.password)
    
    player.password = hashed_password
    player.is_active = True
    player.invitation_token = None # Token nach Verwendung ungültig machen
    
    db.commit()
    
    return {"message": "Account erfolgreich aktiviert."}


# ==================================================
# 3. ÖFFENTLICHE ROUTE FÜR HTML-SEITE (Jinja2)
# ==================================================

@router.get("/activate-account", response_class=HTMLResponse)
async def activate_account_page(request: Request):
    templates = Jinja2Templates(directory="frontend")
    return templates.TemplateResponse(
        "player_registration.html", 
        {"request": request, "title": "Account-Aktivierung"}
    )


# ==================================================
# 4. Endpunkte für Liga-Scouting (Öffentliche Statistiken)
# Die Routen sind NUR für das Auflisten von Teams/Ligen zuständig. 
# Die Statisik-Routen sind in action.py definiert.
# ==================================================

@router.get("/leagues", response_model=List[str])
def get_public_leagues(db: Session = Depends(get_db)):
    """ Liefert eine Liste aller Spielklassen, in denen mindestens ein öffentliches Team registriert ist. """
    leagues = db.query(distinct(Team.league)).filter(Team.is_public == True).all()
    return [league[0] for league in leagues] 


@router.get("/teams/by-league/{league_name}", response_model=List[PublicTeam])
def get_public_teams_by_league(league_name: str, db: Session = Depends(get_db)):
    """ Liefert alle Teams einer Liga, die zur Veröffentlichung freigegeben sind. """
    teams = db.query(Team).filter(
        Team.league == league_name,
        Team.is_public == True
    ).all()
    return teams
    

@router.get("/stats/season/{team_id}", response_model=PublicStatsResponse)
def get_public_season_stats(team_id: int, db: Session = Depends(get_db)):
    """
    Liefert öffentliche Saison-Statistiken für ein Team.
    """
    team = db.query(Team).filter(Team.id == team_id, Team.is_public == True).first()
    if not team:
        raise HTTPException(status_code=404, detail="Öffentliches Team nicht gefunden.")

    # Rufe die Statistiken von den Action-Routern ab (simulierte Abhängigkeit, da wir keine direkte Dependency Injection über Router haben)
    
    # NOTE: Da wir in FastAPI keine saubere Dependency Injection zwischen Routern haben,
    # senden wir hier einen Fehlercode und bitten den Frontend-Client, direkt die action.py-Endpunkte abzufragen.
    # Dies ist der sauberste Weg, ohne Circular Dependencies zu erzeugen.
    
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Bitte verwenden Sie die direkten Endpunkte unter /actions/stats/season/{team_id} und /actions/stats/opponent/season/{team_id}."
    )


@router.get("/shots/season/{team_id}", response_model=List[ShotDataResponse])
def get_public_season_shot_charts(team_id: int, db: Session = Depends(get_db)):
    # Simuliert: Route sollte auf /actions/shots/season/{team_id} zeigen
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Bitte verwenden Sie die direkten Endpunkte unter /actions/shots/season/{team_id}."
    )

@router.get("/shots/errors/season/{team_id}", response_model=List[ShotDataResponse])
def get_public_season_error_charts(team_id: int, db: Session = Depends(get_db)):
    # Simuliert: Route sollte auf /actions/shots/errors/season/{team_id} zeigen
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Bitte verwenden Sie die direkten Endpunkte unter /actions/shots/errors/season/{team_id}."
    )

@router.get("/shots/opponent/season/{team_id}", response_model=List[ShotData])
def get_public_season_opponent_shot_charts(team_id: int, db: Session = Depends(get_db)):
    # Simuliert: Route sollte auf /actions/shots/opponent/season/{team_id} zeigen
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Bitte verwenden Sie die direkten Endpunkte unter /actions/shots/opponent/season/{team_id}."
    )