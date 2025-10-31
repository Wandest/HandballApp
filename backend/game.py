#
# DATEI: backend/game.py
#
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import distinct
from pydantic import BaseModel
from typing import List, Optional

# PlayerResponse wird importiert, um es im Roster-Endpunkt zu verwenden
from backend.player import PlayerResponse
from backend.database import SessionLocal, Trainer, Team, Game, Player
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

class ArchiveSeasonRequest(BaseModel):
    archive_name: str 

# --- NEUES MODELL (PHASE 6) ---
class RosterUpdateRequest(BaseModel):
    # Erwartet eine Liste von Spieler-IDs, die teilnehmen
    player_ids: List[int]

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

# SPIEL HINZUFÜGEN (Unverändert)
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

# SPIEL LÖSCHEN (Unverändert)
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


# SPIEL-LISTE EINES TEAMS LADEN (Unverändert)
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

# LISTE ALLER TURNIERNAMEN FÜR EIN TEAM (Unverändert)
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
    tournaments_query = db.query(distinct(Game.tournament_name)).filter(
        Game.team_id == team_id,
        Game.tournament_name.isnot(None) 
    ).all()
    tournaments = [row[0] for row in tournaments_query if row[0]]
    return tournaments


# SAISON ARCHIVIEREN (Unverändert)
@router.post("/archive/season/{team_id}")
def archive_season(
    team_id: int,
    archive_data: ArchiveSeasonRequest,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(
        Team.id == team_id,
        Team.trainer_id == current_trainer.id
    ).first()
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für dieses Team.")
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


# --- NEUE ENDPUNKTE (PHASE 6) ---

# HELPER-FUNKTION: Prüft, ob der Trainer Zugriff auf das Spiel hat
def check_game_auth(game_id: int, trainer_id: int, db: Session) -> Game:
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
    
    team = db.query(Team).filter(
        Team.id == game.team_id,
        Team.trainer_id == trainer_id
    ).first()
    
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für dieses Spiel.")
    
    return game

# 1. SPIEL-ROSTER (TEILNEHMER) ABFRAGEN
@router.get("/roster/{game_id}", response_model=List[PlayerResponse])
def get_game_roster(
    game_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    game = check_game_auth(game_id, current_trainer.id, db)
    
    # participating_players ist die Liste der Spieler-Objekte in der m2m-Beziehung
    return game.participating_players


# 2. SPIEL-ROSTER (TEILNEHMER) AKTUALISIEREN
@router.post("/roster/{game_id}", response_model=List[PlayerResponse])
def update_game_roster(
    game_id: int,
    roster_data: RosterUpdateRequest,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    game = check_game_auth(game_id, current_trainer.id, db)
    
    # 1. Finde die Spieler-Objekte, die teilnehmen sollen
    players_to_participate = db.query(Player).filter(
        Player.id.in_(roster_data.player_ids),
        Player.team_id == game.team_id # Sicherheitscheck: Nur Spieler des eigenen Teams
    ).all()
    
    # 2. Aktualisiere die Beziehungs-Liste
    game.participating_players = players_to_participate
    
    db.commit()
    db.refresh(game)
    
    return game.participating_players