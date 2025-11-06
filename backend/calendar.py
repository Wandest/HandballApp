# DATEI: backend/calendar.py
# +++ AKTUALISIERT: Fügt 'default_status' beim Erstellen hinzu +++
# +++ FIX: Behebt 500 Internal Server Error bei /list, indem EventResponse manuell erstellt wird +++

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

# Importiere alle notwendigen Modelle
from backend.database import (
    SessionLocal, Trainer, Team, Player, 
    TeamEvent, Attendance, EventType, AttendanceStatus, UserRole
)
from backend.auth import get_current_trainer, check_team_auth_and_get_role

router = APIRouter(
    prefix="/calendar",
    tags=["Calendar (Trainer)"],
    dependencies=[Depends(get_current_trainer)] # Alle Routen hier sind für Trainer
)

# Datenbanksession
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ==================================================
# Pydantic Modelle für Kalender
# ==================================================

class EventCreate(BaseModel):
    team_id: int
    title: str
    event_type: EventType
    start_time: datetime
    end_time: Optional[datetime] = None
    location: Optional[str] = None
    description: Optional[str] = None
    # +++ NEUES FELD (PHASE 10/12) +++
    default_status: AttendanceStatus 

class EventResponse(BaseModel):
    id: int
    team_id: int
    title: str
    event_type: str # +++ KORRIGIERT: Muss String sein, da wir .value übergeben
    start_time: datetime
    end_time: Optional[datetime] = None
    location: Optional[str] = None
    description: Optional[str] = None
    created_by_trainer_id: int
    default_status: AttendanceStatus # +++ NEUES FELD

    class Config:
        from_attributes = True # Erlaubt das Lesen von ORM-Objekten

class AttendancePlayerResponse(BaseModel):
    player_id: int
    player_name: str
    player_number: Optional[int]
    status: AttendanceStatus
    reason: Optional[str] = None
    updated_at: datetime
    
    class Config:
        from_attributes = True

# ==================================================
# Endpunkte (Nur für Trainer)
# ==================================================

@router.post("/add", response_model=EventResponse)
def create_team_event(
    event_data: EventCreate,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    """
    Erstellt einen neuen Termin für ein Team.
    WICHTIG: Erstellt automatisch Anwesenheits-Einträge für alle Spieler im Team,
    basierend auf dem gewählten 'default_status'.
    """
    # Berechtigung prüfen: Jeder Trainer im Team darf Termine erstellen
    check_team_auth_and_get_role(db, current_trainer.id, event_data.team_id)
    
    new_event = TeamEvent(
        team_id=event_data.team_id,
        created_by_trainer_id=current_trainer.id,
        title=event_data.title,
        event_type=event_data.event_type,
        start_time=event_data.start_time,
        end_time=event_data.end_time,
        location=event_data.location,
        description=event_data.description,
        default_status=event_data.default_status # +++ NEUES FELD
    )
    
    db.add(new_event)
    db.flush() # Wichtig, um die new_event.id zu bekommen

    # Finde alle Spieler des Teams
    team_players = db.query(Player).filter(Player.team_id == event_data.team_id).all()
    
    # Erstelle automatisch Anwesenheits-Einträge für jeden Spieler
    for player in team_players:
        new_attendance = Attendance(
            event_id=new_event.id,
            player_id=player.id,
            status=event_data.default_status # +++ NUTZT DEN STANDARD-STATUS
        )
        db.add(new_attendance)
        
    db.commit()
    db.refresh(new_event)
    
    # +++ KORRIGIERT: Gebe EventResponse manuell zurück, um Enum-Problem zu lösen
    return EventResponse(
        id=new_event.id,
        team_id=new_event.team_id,
        title=new_event.title,
        event_type=new_event.event_type.value, # Wichtig: .value
        start_time=new_event.start_time,
        end_time=new_event.end_time,
        location=new_event.location,
        description=new_event.description,
        created_by_trainer_id=new_event.created_by_trainer_id,
        default_status=new_event.default_status
    )

@router.get("/list/{team_id}", response_model=List[EventResponse])
def get_team_events(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    """
    Listet alle Kalender-Termine für ein Team auf (Trainer-Sicht).
    """
    check_team_auth_and_get_role(db, current_trainer.id, team_id)
    
    events_query = db.query(TeamEvent).filter(
        TeamEvent.team_id == team_id
    ).order_by(TeamEvent.start_time.asc()).all()
    
    # +++ KORREKTUR (FIX FÜR 500 ERROR):
    # Wir müssen die Liste manuell erstellen, um das Enum (event_type)
    # korrekt als String (.value) zu serialisieren.
    response_list = []
    for event in events_query:
        response_list.append(EventResponse(
            id=event.id,
            team_id=event.team_id,
            title=event.title,
            event_type=event.event_type.value, # Wichtig: .value
            start_time=event.start_time,
            end_time=event.end_time,
            location=event.location,
            description=event.description,
            created_by_trainer_id=event.created_by_trainer_id,
            default_status=event.default_status
        ))
        
    return response_list

@router.get("/attendance/{event_id}", response_model=List[AttendancePlayerResponse])
def get_event_attendance(
    event_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    """
    Ruft die Anwesenheitsliste (Status aller Spieler) für einen bestimmten Termin ab.
    """
    event = db.query(TeamEvent).filter(TeamEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden.")
        
    # Prüfen, ob der Trainer Zugriff auf das Team dieses Events hat
    check_team_auth_and_get_role(db, current_trainer.id, event.team_id)
    
    attendances = db.query(
        Player.id,
        Player.name,
        Player.number,
        Attendance.status,
        Attendance.reason,
        Attendance.updated_at
    ).join(
        Attendance, Player.id == Attendance.player_id
    ).filter(
        Attendance.event_id == event_id
    ).order_by(Player.number.asc()).all()
    
    response_list = []
    for row in attendances:
        response_list.append(AttendancePlayerResponse(
            player_id=row[0],
            player_name=row[1],
            player_number=row[2],
            status=row[3],
            reason=row[4],
            updated_at=row[5]
        ))
        
    return response_list

@router.delete("/delete/{event_id}")
def delete_team_event(
    event_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    """
    Löscht einen Termin (und alle zugehörigen Anwesenheits-Einträge).
    """
    event = db.query(TeamEvent).filter(TeamEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden.")
        
    # Nur Admins/Haupttrainer dürfen Termine löschen
    check_team_auth_and_get_role(
        db, 
        current_trainer.id, 
        event.team_id, 
        required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
    )
    
    db.delete(event)
    db.commit()
    
    return {"message": "Termin erfolgreich gelöscht."}