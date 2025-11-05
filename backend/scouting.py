# DATEI: backend/scouting.py
# (KORRIGIERT: Autorisierung nutzt check_team_auth_and_get_role)

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime

from backend.database import SessionLocal, Trainer, Team, Game, ScoutingReport
from backend.auth import get_current_trainer, check_team_auth_and_get_role
from backend.database import UserRole # Für Löschberechtigung

router = APIRouter()

# ... (Pydantic Modelle unverändert) ...

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

# --- API-Endpunkte ---

@router.post("/add", response_model=ScoutingReportResponse)
def create_scouting_report(
    report_data: ScoutingReportCreate,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # Berechtigung prüfen: Jeder Trainer im Team darf Berichte erstellen
    check_team_auth_and_get_role(db, current_trainer.id, report_data.team_id)
    
    new_report = ScoutingReport(
        title=report_data.title,
        content=report_data.content,
        opponent_name=report_data.opponent_name,
        game_id=report_data.game_id,
        team_id=report_data.team_id,
        trainer_id=current_trainer.id
    )
    
    db.add(new_report)
    db.commit()
    db.refresh(new_report)
    
    # Spieldaten zur Antwort hinzufügen
    response_data = ScoutingReportResponse.from_orm(new_report)
    if new_report.game_id:
        game = db.query(Game.date).filter(Game.id == new_report.game_id).first()
        if game:
            response_data.game_date = game.date
    return response_data

@router.get("/list/{team_id}", response_model=List[ScoutingReportResponse])
def get_scouting_reports(
    team_id: int,
    opponent_name: Optional[str] = Query(None), # Optionaler Filter nach Gegnername
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # Berechtigung prüfen
    check_team_auth_and_get_role(db, current_trainer.id, team_id)
    
    query = db.query(ScoutingReport).filter(ScoutingReport.team_id == team_id)
    
    if opponent_name:
        query = query.filter(ScoutingReport.opponent_name == opponent_name)
        
    # ... (Rest der Logik unverändert) ...
    reports = query.order_by(ScoutingReport.created_at.desc()).all()
    
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
    report = db.query(ScoutingReport).filter(ScoutingReport.id == report_id).first()
    
    if not report:
        raise HTTPException(status_code=404, detail="Bericht nicht gefunden.")
    
    # Berechtigungsprüfung: Nur der Ersteller darf bearbeiten (Standard)
    if report.trainer_id != current_trainer.id:
        raise HTTPException(status_code=403, detail="Keine Berechtigung, diesen Bericht zu bearbeiten.")
    
    # ... (Rest der Logik unverändert) ...
    game_date = None
    if report_data.game_id:
        # Prüfen, ob das Spiel zum Team gehört
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
    report = db.query(ScoutingReport).filter(ScoutingReport.id == report_id).first()
    
    if not report:
        raise HTTPException(status_code=404, detail="Bericht nicht gefunden.")
        
    # Berechtigungsprüfung: Nur der Ersteller ODER ein MAIN_COACH/TEAM_ADMIN darf löschen
    role = check_team_auth_and_get_role(db, current_trainer.id, report.team_id)
    
    if report.trainer_id != current_trainer.id and role not in [UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]:
        raise HTTPException(status_code=403, detail="Keine Berechtigung, diesen Bericht zu löschen.")
        
    db.delete(report)
    db.commit()
    
    return {"message": "Scouting-Bericht erfolgreich gelöscht."}