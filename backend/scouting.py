# DATEI: backend/scouting.py (NEU FÜR PHASE 9)

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from backend.database import SessionLocal, Trainer, Team, Game, ScoutingReport
from backend.auth import get_current_trainer

router = APIRouter()

# --- Pydantic Modelle ---

class ScoutingReportBase(BaseModel):
    title: str
    content: Optional[str] = None
    opponent_name: str
    game_id: Optional[int] = None

class ScoutingReportCreate(ScoutingReportBase):
    team_id: int

class ScoutingReportResponse(ScoutingReportBase):
    id: int
    team_id: int
    trainer_id: int
    created_at: datetime
    updated_at: datetime
    game_date: Optional[str] = None # Um das Spieldatum im Frontend anzuzeigen

    class Config:
        from_attributes = True

# --- Datenbank-Helfer ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Helper-Funktion zur Berechtigungsprüfung ---
def check_team_auth(team_id: int, trainer_id: int, db: Session) -> Team:
    team = db.query(Team).filter(
        Team.id == team_id,
        Team.trainer_id == trainer_id
    ).first()
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für dieses Team.")
    return team

# --- API-Endpunkte ---

@router.post("/add", response_model=ScoutingReportResponse)
def create_scouting_report(
    report_data: ScoutingReportCreate,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    """ Erstellt einen neuen Scouting-Bericht für ein Team. """
    team = check_team_auth(report_data.team_id, current_trainer.id, db)
    
    game_date = None
    if report_data.game_id:
        game = db.query(Game).filter(Game.id == report_data.game_id, Game.team_id == team.id).first()
        if not game:
            raise HTTPException(status_code=404, detail="Zugehöriges Spiel nicht gefunden.")
        game_date = game.date

    new_report = ScoutingReport(
        title=report_data.title,
        content=report_data.content,
        opponent_name=report_data.opponent_name,
        game_id=report_data.game_id,
        team_id=team.id,
        trainer_id=current_trainer.id
    )
    
    db.add(new_report)
    db.commit()
    db.refresh(new_report)
    
    # Füge das Spieldatum zur Antwort hinzu
    response_data = ScoutingReportResponse.from_orm(new_report)
    response_data.game_date = game_date
    return response_data

@router.get("/list/{team_id}", response_model=List[ScoutingReportResponse])
def get_scouting_reports(
    team_id: int,
    opponent_name: Optional[str] = Query(None), # Optionaler Filter nach Gegnername
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    """ Listet alle Scouting-Berichte für ein Team auf, optional gefiltert nach Gegner. """
    check_team_auth(team_id, current_trainer.id, db)
    
    query = db.query(ScoutingReport).filter(ScoutingReport.team_id == team_id)
    
    if opponent_name:
        query = query.filter(ScoutingReport.opponent_name == opponent_name)
        
    reports = query.order_by(ScoutingReport.created_at.desc()).all()
    
    # Spieldaten für die Antwort anreichern
    response_list = []
    for report in reports:
        response_data = ScoutingReportResponse.from_orm(report)
        if report.game_id:
            game = db.query(Game.date).filter(Game.id == report.game_id).first()
            if game:
                response_data.game_date = game.date
        response_list.append(response_data)
        
    return response_list

@router.put("/update/{report_id}", response_model=ScoutingReportResponse)
def update_scouting_report(
    report_id: int,
    report_data: ScoutingReportBase, # Trainer kann nicht team_id oder trainer_id ändern
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    """ Aktualisiert einen bestehenden Scouting-Bericht. """
    report = db.query(ScoutingReport).filter(ScoutingReport.id == report_id).first()
    
    if not report:
        raise HTTPException(status_code=404, detail="Bericht nicht gefunden.")
    if report.trainer_id != current_trainer.id:
        raise HTTPException(status_code=403, detail="Keine Berechtigung, diesen Bericht zu bearbeiten.")
    
    # Prüfen, ob das (neue) Spiel zum Team gehört
    game_date = None
    if report_data.game_id:
        game = db.query(Game).filter(Game.id == report_data.game_id, Game.team_id == report.team_id).first()
        if not game:
            raise HTTPException(status_code=404, detail="Zugehöriges Spiel nicht gefunden.")
        game_date = game.date

    # Daten aktualisieren
    report.title = report_data.title
    report.content = report_data.content
    report.opponent_name = report_data.opponent_name
    report.game_id = report_data.game_id
    
    db.commit()
    db.refresh(report)
    
    response_data = ScoutingReportResponse.from_orm(report)
    response_data.game_date = game_date
    return response_data

@router.delete("/delete/{report_id}")
def delete_scouting_report(
    report_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    """ Löscht einen Scouting-Bericht. """
    report = db.query(ScoutingReport).filter(ScoutingReport.id == report_id).first()
    
    if not report:
        raise HTTPException(status_code=404, detail="Bericht nicht gefunden.")
    if report.trainer_id != current_trainer.id:
        # Alternativ: Team-Trainer dürfen alle Berichte des Teams löschen
        # check_team_auth(report.team_id, current_trainer.id, db)
        raise HTTPException(status_code=403, detail="Keine Berechtigung, diesen Bericht zu löschen.")
        
    db.delete(report)
    db.commit()
    
    return {"message": "Scouting-Bericht erfolgreich gelöscht."}