# DATEI: backend/game.py
# (KORRIGIERT: Behebt NameError für PlayerResponse durch korrekten Import)

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional, Any # WICHTIG: List hinzugefügt

from backend.database import SessionLocal, Trainer, Team, Game, Player 
from backend.auth import get_current_trainer, check_team_auth_and_get_role
from backend.database import UserRole 
from backend.player import PlayerResponse # WICHTIG: PlayerResponse hier importiert

router = APIRouter()

# -----------------------------\
# Pydantic Modelle
# -----------------------------\

class GameCreate(BaseModel):
    opponent: str
    date: str
    team_id: int
    game_category: str 
    tournament_name: Optional[str] = None 
    video_url: Optional[str] = None 

class GameResponse(BaseModel):
    id: int
    opponent: str
    date: str
    team_id: int
    game_category: str
    tournament_name: Optional[str] = None
    video_url: Optional[str] = None

    class Config:
        from_attributes = True

class GameVideoUpdate(BaseModel):
    video_url: Optional[str] = None

class ArchiveSeasonRequest(BaseModel):
    archive_name: str 

class RosterUpdateRequest(BaseModel):
    player_ids: List[int]

# Datenbanksession
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Endpunkte ---

# SPIEL HINZUFÜGEN
@router.post("/add", response_model=GameResponse)
def create_game(
    game_data: GameCreate,
    current_trainer: Trainer = Depends(get_current_trainer), 
    db: Session = Depends(get_db)
):
    # Berechtigung prüfen: Jeder Trainer im Team darf Spiele hinzufügen
    check_team_auth_and_get_role(db, current_trainer.id, game_data.team_id)

    valid_categories = ["Saison", "Testspiel", "Turnier"]
    if game_data.game_category not in valid_categories:
        raise HTTPException(status_code=400, detail="Ungültige Spielkategorie.")
    
    tournament_name_to_save = game_data.tournament_name if game_data.game_category == "Turnier" else None
    
    new_game = Game(
        opponent=game_data.opponent,
        date=game_data.date,
        team_id=game_data.team_id,
        game_category=game_data.game_category,
        tournament_name=tournament_name_to_save,
        video_url=game_data.video_url 
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
        
    # Berechtigungsprüfung: Nur MAIN_COACH oder TEAM_ADMIN darf Spiele löschen
    check_team_auth_and_get_role(
        db, 
        current_trainer.id, 
        game.team_id, 
        required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
    )

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
    # Berechtigung prüfen: Jeder Trainer im Team darf die Liste sehen
    check_team_auth_and_get_role(db, current_trainer.id, team_id)
    
    games = db.query(Game).filter(
        Game.team_id == team_id
    ).order_by(Game.date.desc()).all()
    return games

# ENDPUNKT zum Speichern der Video-URL
@router.put("/update-video/{game_id}", response_model=GameResponse)
def update_game_video_url(
    game_id: int,
    video_data: GameVideoUpdate,
    db: Session = Depends(get_db),
    current_trainer: Trainer = Depends(get_current_trainer)
):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
    
    # Berechtigung prüfen: Jeder Trainer im Team darf Video-URLs bearbeiten
    check_team_auth_and_get_role(db, current_trainer.id, game.team_id)
        
    try:
        game.video_url = video_data.video_url
        db.commit()
        db.refresh(game)
        return game
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Fehler beim Speichern: {e}")

# LISTE ALLER TURNIERNAMEN FÜR EIN TEAM
@router.get("/tournaments/{team_id}", response_model=List[str])
def list_tournaments(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # Berechtigung prüfen
    check_team_auth_and_get_role(db, current_trainer.id, team_id)

    tournaments_query = db.query(distinct(Game.tournament_name)).filter(
        Game.team_id == team_id,
        Game.tournament_name.isnot(None) 
    ).all()
    tournaments = [row[0] for row in tournaments_query if row[0]]
    return tournaments


# SAISON ARCHIVIEREN
@router.post("/archive/season/{team_id}")
def archive_season(
    team_id: int,
    archive_data: ArchiveSeasonRequest,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # Berechtigungsprüfung: Nur MAIN_COACH oder TEAM_ADMIN darf archivieren
    check_team_auth_and_get_role(
        db, 
        current_trainer.id, 
        team_id, 
        required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
    )

    archive_name = archive_data.archive_name.strip()
    if not archive_name:
        raise HTTPException(status_code=400, detail="Archivname darf nicht leer sein.")
    reserved_names = ["Saison", "Testspiel", "Turnier"]
    if archive_name in reserved_names:
        raise HTTPException(status_code=400, detail=f"'{archive_name}' ist ein reservierter Kategoriename.")
        
    games_to_archive_query = db.query(Game).filter(
        Game.team_id == team_id,
        Game.game_category == 'Saison'
    )
    count = games_to_archive_query.count()
    if count == 0:
        return {"message": "Keine Saisonspiele zum Archivieren gefunden.", "archived_count": 0}
        
    games_to_archive_query.update({
        "game_category": archive_name
    })
    db.commit()
    return {"message": f"Saison erfolgreich archiviert. {count} Spiele wurden in '{archive_name}' verschoben.", "archived_count": count}


# 1. SPIEL-ROSTER (TEILNEHMER) ABFRAGEN
@router.get("/roster/{game_id}", response_model=List[PlayerResponse])
def get_game_roster(
    game_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")

    # Berechtigung prüfen: Jeder Trainer im Team darf den Roster sehen
    check_team_auth_and_get_role(db, current_trainer.id, game.team_id)
    
    return game.participating_players


# 2. SPIEL-ROSTER (TEILNEHMER) AKTUALISIEREN
@router.post("/roster/{game_id}", response_model=List[PlayerResponse])
def update_game_roster(
    game_id: int,
    roster_data: RosterUpdateRequest,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")

    # Berechtigung prüfen: Jeder Trainer im Team darf Roster bearbeiten
    check_team_auth_and_get_role(db, current_trainer.id, game.team_id)
    
    players_to_participate = db.query(Player).filter(
        Player.id.in_(roster_data.player_ids),
        Player.team_id == game.team_id # Sicherheitscheck
    ).all()
    
    game.participating_players = players_to_participate
    
    db.commit()
    db.refresh(game)
    
    return game.participating_players