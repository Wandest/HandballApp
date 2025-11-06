# DATEI: backend/absence.py
# +++ NEU: Aktualisiert beim Erstellen einer Abwesenheit automatisch alle betroffenen Kalender-Events +++

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, date

from backend.database import (
    SessionLocal, Player, 
    PlayerAbsence, AbsenceReason,
    TeamEvent, Attendance, AttendanceStatus # NEU: Importiere Event-Modelle
)
from backend.auth import get_current_player_only

router = APIRouter(
    prefix="/absence",
    tags=["Player Absence"],
    dependencies=[Depends(get_current_player_only)]
)

# Datenbanksession
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ==================================================
# Pydantic Modelle
# ==================================================

class AbsenceCreate(BaseModel):
    start_date: date
    end_date: Optional[date] = None
    reason: AbsenceReason
    notes: Optional[str] = None

class AbsenceResponse(BaseModel):
    id: int
    player_id: int
    start_date: datetime
    end_date: Optional[datetime] = None
    reason: AbsenceReason
    notes: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

# ==================================================
# Endpunkte (Nur für Spieler)
# ==================================================

@router.post("/add", response_model=AbsenceResponse)
def create_absence(
    absence_data: AbsenceCreate,
    current_player: Player = Depends(get_current_player_only),
    db: Session = Depends(get_db)
):
    """
    Spieler trägt eine neue Abwesenheit ein.
    """
    
    # Konvertiere date zu datetime für die DB
    start_datetime = datetime.combine(absence_data.start_date, datetime.min.time())
    end_datetime = None
    if absence_data.end_date:
        # Setze das Ende auf das Ende des Tages
        end_datetime = datetime.combine(absence_data.end_date, datetime.max.time())

    if end_datetime and end_datetime < start_datetime:
        raise HTTPException(status_code=400, detail="Das Enddatum muss nach dem Startdatum liegen.")

    new_absence = PlayerAbsence(
        player_id=current_player.id,
        start_date=start_datetime,
        end_date=end_datetime,
        reason=absence_data.reason,
        notes=absence_data.notes
    )
    
    db.add(new_absence)
    db.flush() # flush() um die new_absence.id zu bekommen (falls benötigt)
    
    # --- NEUE SYNCHRONISIERUNGS-LOGIK ---
    # Finde alle Events, die in den Abwesenheitszeitraum fallen
    
    events_query = db.query(TeamEvent).filter(
        TeamEvent.team_id == current_player.team_id,
        TeamEvent.start_time >= start_datetime
    )
    
    if end_datetime:
        events_query = events_query.filter(TeamEvent.start_time <= end_datetime)
        
    relevant_events = events_query.all()
    relevant_event_ids = [event.id for event in relevant_events]

    if relevant_event_ids:
        # Setze alle Anwesenheiten für diese Events auf ABGESAGT
        db.query(Attendance).filter(
            Attendance.player_id == current_player.id,
            Attendance.event_id.in_(relevant_event_ids)
        ).update({
            "status": AttendanceStatus.DECLINED,
            "reason": new_absence.reason.value, # z.B. "Urlaub"
            "updated_at": datetime.utcnow()
        }, synchronize_session=False)
    
    # --- ENDE SYNCHRONISIERUNGS-LOGIK ---

    db.commit()
    db.refresh(new_absence)
    
    return new_absence


@router.get("/list", response_model=List[AbsenceResponse])
def get_my_absences(
    current_player: Player = Depends(get_current_player_only),
    db: Session = Depends(get_db)
):
    """
    Listet alle zukünftigen und aktuellen Abwesenheiten eines Spielers auf.
    """
    today = datetime.combine(date.today(), datetime.min.time())
    
    absences = db.query(PlayerAbsence).filter(
        PlayerAbsence.player_id == current_player.id,
        # Zeige alle, die HEUTE enden oder später
        (PlayerAbsence.end_date >= today) | (PlayerAbsence.end_date == None) 
    ).order_by(PlayerAbsence.start_date.asc()).all()
    
    return absences


@router.delete("/delete/{absence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_absence(
    absence_id: int,
    current_player: Player = Depends(get_current_player_only),
    db: Session = Depends(get_db)
):
    """
    Ermöglicht einem Spieler, eine von ihm erstellte Abwesenheit zu löschen.
    HINWEIS: Setzt den Status von Terminen NICHT automatisch zurück.
    """
    absence = db.query(PlayerAbsence).filter(
        PlayerAbsence.id == absence_id,
        PlayerAbsence.player_id == current_player.id
    ).first()
    
    if not absence:
        raise HTTPException(status_code=404, detail="Abwesenheit nicht gefunden oder keine Berechtigung.")
        
    db.delete(absence)
    db.commit()
    
    return None