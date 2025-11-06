# DATEI: backend/calendar.py
# +++ NEU: Prüft beim Erstellen von Terminen, ob Spieler bereits abwesend gemeldet sind +++

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta 
from sqlalchemy import select

# Importiere alle notwendigen Modelle
from backend.database import (
    SessionLocal, Trainer, Player, Team, 
    TeamEvent, Attendance, EventType, AttendanceStatus, UserRole,
    TeamSettings, 
    EventStatus,
    PlayerAbsence # NEU: PlayerAbsence importieren
)
from backend.auth import get_current_trainer, check_team_auth_and_get_role

router = APIRouter(
    prefix="/calendar",
    tags=["Calendar (Trainer)"],
    dependencies=[Depends(get_current_trainer)] 
)

# Datenbanksession
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ==================================================
# Pydantic Modelle für Kalender (unverändert)
# ... (Klassen EventCreate, EventUpdate, EventCancel, EventResponse, AttendancePlayerResponse) ...
class EventCreate(BaseModel):
    team_id: int
    title: str
    event_type: EventType
    start_time: datetime
    end_time: Optional[datetime] = None
    location: Optional[str] = None
    description: Optional[str] = None
    default_status: str 
    response_deadline_hours: Optional[int] = None
    is_recurring: bool = False
    repeat_until: Optional[datetime] = None
    repeat_frequency: Optional[str] = None 
    repeat_interval: int = 1 

class EventUpdate(BaseModel):
    title: Optional[str] = None
    event_type: Optional[EventType] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    location: Optional[str] = None
    description: Optional[str] = None
    default_status: Optional[str] = None 
    response_deadline_hours: Optional[int] = None
    status: Optional[EventStatus] = None 

class EventCancel(BaseModel):
    cancel_reason: Optional[str] = None

class EventResponse(BaseModel):
    id: int
    team_id: int
    title: str
    event_type: str
    status: str 
    start_time: datetime
    end_time: Optional[datetime] = None
    location: Optional[str] = None
    description: Optional[str] = None
    created_by_trainer_id: int
    default_status: str
    response_deadline_hours: Optional[int] = None
    class Config: from_attributes = True

class AttendancePlayerResponse(BaseModel):
    player_id: int
    player_name: str
    player_number: Optional[int]
    status: str 
    reason: Optional[str] = None
    updated_at: datetime
    class Config: from_attributes = True

# ==================================================
# H E L P E R - F U N K T I O N E N
# ==================================================

# KORRIGIERT: Akzeptiert event_start_time für die Abwesenheitsprüfung
def create_default_attendances(db: Session, event_id: int, team_id: int, default_status_name: str, event_start_time: datetime):
    """ 
    Erstellt Standard-Anwesenheitseinträge für alle Spieler eines Teams.
    Prüft dabei, ob der Spieler für diesen Tag als abwesend gemeldet ist.
    """
    
    try:
        default_status_enum = AttendanceStatus[default_status_name]
    except KeyError:
         default_status_enum = AttendanceStatus.NOT_RESPONDED 

    team_players = db.query(Player).filter(Player.team_id == team_id).all()
    
    for player in team_players:
        existing_attendance = db.query(Attendance).filter(
            Attendance.event_id == event_id,
            Attendance.player_id == player.id
        ).first()
        
        if existing_attendance is None:
            
            # --- NEUE PRÜFUNG: Ist der Spieler an diesem Tag abwesend? ---
            player_absence = db.query(PlayerAbsence).filter(
                PlayerAbsence.player_id == player.id,
                PlayerAbsence.start_date <= event_start_time,
                (PlayerAbsence.end_date >= event_start_time) | (PlayerAbsence.end_date == None)
            ).first()

            final_status = default_status_enum
            final_reason = None

            if player_absence:
                final_status = AttendanceStatus.DECLINED
                final_reason = player_absence.reason.value # z.B. "Urlaub"
            # --- ENDE NEUE PRÜFUNG ---
            
            new_attendance = Attendance(
                event_id=event_id,
                player_id=player.id,
                status=final_status,
                reason=final_reason
            )
            db.add(new_attendance)

# ==================================================
# Endpunkte (Nur für Trainer)
# ==================================================

@router.post("/add", response_model=List[EventResponse]) 
def create_team_event(
    event_data: EventCreate,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # ... (Logik für Deadlines und Regeltermine unverändert) ...
    check_team_auth_and_get_role(db, current_trainer.id, event_data.team_id)
    
    try:
         status_for_new_event = AttendanceStatus[event_data.default_status]
    except KeyError:
         raise HTTPException(status_code=400, detail=f"Ungültiger Standardstatus: {event_data.default_status}")

    final_deadline_hours = event_data.response_deadline_hours

    if final_deadline_hours is None: 
        settings = db.query(TeamSettings).filter(TeamSettings.team_id == event_data.team_id).first()
        if settings:
            if event_data.event_type == EventType.TRAINING:
                final_deadline_hours = settings.training_deadline_hours
            elif event_data.event_type == EventType.GAME:
                final_deadline_hours = settings.game_deadline_hours 
            elif event_data.event_type == EventType.OTHER:
                final_deadline_hours = settings.other_deadline_hours
        
    if final_deadline_hours is not None and final_deadline_hours <= 0:
        final_deadline_hours = None

    events_to_create = []
    
    event_duration = timedelta(hours=1)
    if event_data.end_time and event_data.end_time > event_data.start_time:
        event_duration = event_data.end_time - event_data.start_time
    
    if event_data.is_recurring and event_data.repeat_until and event_data.repeat_frequency == 'weekly':
        
        if event_data.repeat_until.date() < event_data.start_time.date():
             raise HTTPException(status_code=400, detail="Wiederholungsende muss nach dem Startdatum liegen.")
             
        current_date = event_data.start_time.date()
        interval_days = event_data.repeat_interval * 7
        
        while current_date.weekday() != event_data.start_time.weekday():
             current_date += timedelta(days=1)
             
        while current_date <= event_data.repeat_until.date():
            
            start_time_this_week = datetime.combine(current_date, event_data.start_time.time())
            end_time_this_week = start_time_this_week + event_duration
            
            events_to_create.append({
                "start_time": start_time_this_week,
                "end_time": end_time_this_week
            })
            
            current_date += timedelta(days=interval_days)
            
    else:
        events_to_create.append({
            "start_time": event_data.start_time,
            "end_time": event_data.end_time
        })
        
    response_list = []
    
    for event_data_item in events_to_create:
        new_event = TeamEvent(
            team_id=event_data.team_id,
            created_by_trainer_id=current_trainer.id,
            title=event_data.title,
            event_type=event_data.event_type,
            status=EventStatus.PLANNED, 
            start_time=event_data_item["start_time"],
            end_time=event_data_item["end_time"],
            location=event_data.location,
            description=event_data.description,
            default_status=status_for_new_event, 
            response_deadline_hours=final_deadline_hours
        )
        
        db.add(new_event)
        db.flush()
        
        # KORRIGIERT: Übergibt new_event.start_time an die Helferfunktion
        create_default_attendances(
            db, new_event.id, event_data.team_id, 
            event_data.default_status, new_event.start_time
        )
        
        db.refresh(new_event)
        
        response_list.append(EventResponse(
            id=new_event.id,
            team_id=new_event.team_id,
            title=new_event.title,
            event_type=new_event.event_type.value,
            status=new_event.status.value, 
            start_time=new_event.start_time,
            end_time=new_event.end_time,
            location=new_event.location,
            description=new_event.description,
            created_by_trainer_id=new_event.created_by_trainer_id,
            default_status=new_event.default_status.value,
            response_deadline_hours=new_event.response_deadline_hours
        ))
        
    db.commit()
    return response_list


@router.put("/update/{event_id}", response_model=EventResponse)
def update_team_event(
    event_id: int,
    update_data: EventUpdate,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # ... (Logik unverändert) ...
    event = db.query(TeamEvent).filter(TeamEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden.")

    check_team_auth_and_get_role(db, current_trainer.id, event.team_id)

    update_fields = update_data.model_dump(exclude_unset=True)
    
    old_default_status = event.default_status
    
    for key, value in update_fields.items():
        if key == 'default_status':
             value = AttendanceStatus[value]
        
        if event.status == EventStatus.CANCELED and key != 'status':
             raise HTTPException(status_code=400, detail="Abgesagte Termine können nicht bearbeitet werden.")
        
        if key == 'status' and event.status == EventStatus.CANCELED and value == EventStatus.PLANNED:
             event.status = value
             db.query(Attendance).filter(
                 Attendance.event_id == event_id
             ).update({
                 "status": event.default_status, 
                 "reason": None,
                 "updated_at": datetime.utcnow()
             })
             continue
        
        setattr(event, key, value)

    if 'default_status' in update_fields and old_default_status.value != event.default_status.value:
        db.query(Attendance).filter(
            Attendance.event_id == event_id,
            Attendance.status == old_default_status 
        ).update({
            "status": event.default_status 
        })

    db.commit()
    db.refresh(event)
    
    event_status_value = EventStatus.PLANNED.value 
    if event.status is not None:
        event_status_value = event.status.value

    return EventResponse(
        id=event.id,
        team_id=event.team_id,
        title=event.title,
        event_type=event.event_type.value,
        status=event_status_value, 
        start_time=event.start_time,
        end_time=event.end_time,
        location=event.location,
        description=event.description,
        created_by_trainer_id=event.created_by_trainer_id,
        default_status=event.default_status.value,
        response_deadline_hours=event.response_deadline_hours
    )


@router.put("/cancel/{event_id}", response_model=EventResponse)
def cancel_team_event(
    event_id: int,
    cancel_data: EventCancel,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # ... (Logik unverändert) ...
    event = db.query(TeamEvent).filter(TeamEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden.")

    check_team_auth_and_get_role(
        db, 
        current_trainer.id, 
        event.team_id, 
        required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
    )

    if event.status == EventStatus.CANCELED:
        raise HTTPException(status_code=400, detail="Dieser Termin ist bereits abgesagt.")
        
    event.status = EventStatus.CANCELED
    
    cancel_reason_text = f"--- ABGESAGT ({datetime.utcnow().strftime('%d.%m.%Y %H:%M')}) ---: {cancel_data.cancel_reason or 'Kein Grund angegeben.'}"
    event.description = (event.description or "").strip() + ("\n\n" + cancel_reason_text if (event.description or "").strip() else cancel_reason_text)

    db.query(Attendance).filter(
        Attendance.event_id == event_id
    ).update({
        "status": AttendanceStatus.DECLINED, 
        "reason": f"ABGESAGT: {cancel_data.cancel_reason or 'Kein Grund angegeben.'}", 
        "updated_at": datetime.utcnow()
    })

    db.commit()
    db.refresh(event)
    
    event_status_value = EventStatus.PLANNED.value 
    if event.status is not None:
        event_status_value = event.status.value
        
    return EventResponse(
        id=event.id,
        team_id=event.team_id,
        title=event.title,
        event_type=event.event_type.value,
        status=event_status_value, 
        start_time=event.start_time,
        end_time=event.end_time,
        location=event.location,
        description=event.description,
        created_by_trainer_id=event.created_by_trainer_id,
        default_status=event.default_status.value,
        response_deadline_hours=event.response_deadline_hours
    )


@router.get("/list/{team_id}", response_model=List[EventResponse])
def get_team_events(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # ... (Logik mit Null-Check unverändert) ...
    check_team_auth_and_get_role(db, current_trainer.id, team_id)
    
    events = db.query(TeamEvent).filter(
        TeamEvent.team_id == team_id
    ).order_by(TeamEvent.start_time.asc()).all()
    
    response_list = []
    for event in events:
        
        event_status_value = EventStatus.PLANNED.value
        if event.status is not None:
             event_status_value = event.status.value
             
        response_list.append(EventResponse(
            id=event.id,
            team_id=event.team_id,
            title=event.title,
            event_type=event.event_type.value,
            status=event_status_value, 
            start_time=event.start_time,
            end_time=event.end_time,
            location=event.location,
            description=event.description,
            created_by_trainer_id=event.created_by_trainer_id,
            default_status=event.default_status.value,
            response_deadline_hours=event.response_deadline_hours
        ))
        
    return response_list


@router.get("/attendance/{event_id}", response_model=List[AttendancePlayerResponse])
def get_event_attendance(
    event_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # ... (Logik unverändert) ...
    event = db.query(TeamEvent).filter(TeamEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden.")
        
    trainer_role = check_team_auth_and_get_role(db, current_trainer.id, event.team_id)
    
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
    
    if trainer_role in [UserRole.MAIN_COACH, UserRole.TEAM_ADMIN, UserRole.ASSISTANT_COACH]:
         response_list.append(AttendancePlayerResponse(
            player_id=current_trainer.id,
            player_name=current_trainer.username,
            player_number=0, 
            status=trainer_role.value, 
            reason=None,
            updated_at=datetime.utcnow()
        ))
    
    for row in attendances:
        response_list.append(AttendancePlayerResponse(
            player_id=row[0],
            player_name=row[1],
            player_number=row[2],
            status=row[3].name, 
            reason=row[4] if trainer_role in [UserRole.MAIN_COACH, UserRole.TEAM_ADMIN, UserRole.ASSISTANT_COACH] else None, 
            updated_at=row[5]
        ))
        
    return response_list

@router.delete("/delete/{event_id}")
def delete_team_event(
    event_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # ... (Logik unverändert) ...
    event = db.query(TeamEvent).filter(TeamEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden.")
        
    check_team_auth_and_get_role(
        db, 
        current_trainer.id, 
        event.team_id, 
        required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
    )
    
    db.delete(event)
    db.commit()
    
    return {"message": "Termin erfolgreich gelöscht."}