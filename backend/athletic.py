# DATEI: backend/athletic.py
# +++ FIX: Korrigiert die fehlerhafte Trainer-Dependency-Injection (Behebt 500 Fehler) +++

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import datetime, date, timedelta

from backend.database import (
    SessionLocal, Player, WellnessLog, Injury, InjuryStatus,
    Trainer 
)
from backend.auth import get_current_player_only, get_current_trainer, check_team_auth_and_get_role

# Prefix entfernt, da er schon in main.py gesetzt wird
router = APIRouter(
    tags=["Athletics (Player/Wellness)"],
)

# Datenbanksession
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ==================================================
# Pydantic Modelle für WellnessLog und Injury
# ==================================================

class WellnessCreate(BaseModel):
    sleep_quality: int # 1-5
    muscle_soreness: int # 1-5
    stress_level: int # 1-5
    session_rpe: Optional[int] = Field(None, ge=1, le=10) # 1-10

class WellnessResponse(WellnessCreate):
    id: int
    logged_at: datetime
    class Config:
        from_attributes = True


# --- INJURY MODELLE ---
class InjuryCreate(BaseModel):
    player_id: int 
    description: str
    location: Optional[str] = None
    status: InjuryStatus
    start_date: date
    end_date: Optional[date] = None
    notes: Optional[str] = None

class InjuryUpdate(BaseModel):
    description: Optional[str] = None
    location: Optional[str] = None
    status: Optional[InjuryStatus] = None 
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    notes: Optional[str] = None

class InjuryResponse(BaseModel):
    id: int
    player_id: int
    description: str
    location: Optional[str] = None
    status: str 
    start_date: datetime
    end_date: Optional[datetime] = None
    notes: Optional[str] = None
    
    class Config:
        from_attributes = True

# ==================================================
# ENDPUNKTE: WELLNESS LOG (NUR FÜR SPIELER)
# ==================================================

@router.post("/wellness/add", response_model=WellnessResponse)
def log_wellness_entry(
    wellness_data: WellnessCreate,
    current_player: Player = Depends(get_current_player_only),
    db: Session = Depends(get_db)
):
    """ Erlaubt einem Spieler, einen neuen Wellness-Eintrag zu loggen. """
    
    for field in ['sleep_quality', 'muscle_soreness', 'stress_level']:
        value = getattr(wellness_data, field)
        if not (1 <= value <= 5):
            raise HTTPException(status_code=400, detail=f"{field} muss zwischen 1 und 5 liegen.")
            
    if wellness_data.session_rpe is not None and not (1 <= wellness_data.session_rpe <= 10):
        raise HTTPException(status_code=400, detail="session_rpe muss zwischen 1 und 10 liegen.")

    today_start = datetime.combine(date.today(), datetime.min.time())
    
    existing_entry = db.query(WellnessLog).filter(
        WellnessLog.player_id == current_player.id,
        WellnessLog.logged_at >= today_start
    ).first()
    
    if existing_entry:
        raise HTTPException(status_code=400, detail="Sie haben heute bereits einen Wellness-Eintrag geloggt. Nur ein Eintrag pro Tag erlaubt.")
        
    new_log = WellnessLog(
        player_id=current_player.id,
        sleep_quality=wellness_data.sleep_quality,
        muscle_soreness=wellness_data.muscle_soreness,
        stress_level=wellness_data.stress_level,
        session_rpe=wellness_data.session_rpe
    )
    
    db.add(new_log)
    db.commit()
    db.refresh(new_log)
    
    return new_log

@router.get("/wellness/latest", response_model=Optional[WellnessResponse])
def get_latest_wellness_entry(
    current_player: Player = Depends(get_current_player_only),
    db: Session = Depends(get_db)
):
    """ Liefert den letzten Wellness-Eintrag des Spielers (zum Anzeigen im Dashboard). """
    latest_log = db.query(WellnessLog).filter(
        WellnessLog.player_id == current_player.id
    ).order_by(WellnessLog.logged_at.desc()).first()
    
    return latest_log

@router.get("/wellness/history/{player_id}", response_model=List[WellnessResponse])
def get_wellness_history(
    player_id: int,
    current_trainer: Trainer = Depends(get_current_trainer), # [FIX] Korrekte Injection
    db: Session = Depends(get_db)
):
    """ Liefert die Wellness-Historie eines Spielers (Trainer-Zugriff). """
    player = db.query(Player).filter(Player.id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden.")
    
    check_team_auth_and_get_role(db, current_trainer.id, player.team_id)
    
    thirty_days_ago = datetime.now() - timedelta(days=30)
    
    history = db.query(WellnessLog).filter(
        WellnessLog.player_id == player_id,
        WellnessLog.logged_at >= thirty_days_ago
    ).order_by(WellnessLog.logged_at.desc()).all()
    
    return history


# ==================================================
# ENDPUNKTE: INJURY MANAGEMENT (NUR FÜR TRAINER)
# ==================================================

@router.post("/injuries/add", response_model=InjuryResponse)
def create_injury(
    injury_data: InjuryCreate,
    current_trainer: Trainer = Depends(get_current_trainer), # [FIX] Korrekte Injection
    db: Session = Depends(get_db)
):
    """ Erlaubt einem Trainer, eine neue Verletzung für einen Spieler zu loggen. """
    player = db.query(Player).filter(Player.id == injury_data.player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden.")
    
    check_team_auth_and_get_role(db, current_trainer.id, player.team_id)
    
    start_datetime = datetime.combine(injury_data.start_date, datetime.min.time())
    end_datetime = datetime.combine(injury_data.end_date, datetime.min.time()) if injury_data.end_date else None
    
    new_injury = Injury(
        player_id=injury_data.player_id,
        description=injury_data.description,
        location=injury_data.location,
        status=injury_data.status,
        start_date=start_datetime,
        end_date=end_datetime,
        notes=injury_data.notes
    )
    
    db.add(new_injury)
    db.commit()
    db.refresh(new_injury)
    
    response_data = InjuryResponse.from_orm(new_injury)
    response_data.status = new_injury.status.value
    return response_data


@router.put("/injuries/update/{injury_id}", response_model=InjuryResponse)
def update_injury(
    injury_id: int,
    update_data: InjuryUpdate,
    current_trainer: Trainer = Depends(get_current_trainer), # [FIX] Korrekte Injection
    db: Session = Depends(get_db)
):
    """ Aktualisiert eine bestehende Verletzung. """
    injury = db.query(Injury).filter(Injury.id == injury_id).first()
    if not injury:
        raise HTTPException(status_code=404, detail="Verletzungseintrag nicht gefunden.")

    player = db.query(Player).filter(Player.id == injury.player_id).first()
    check_team_auth_and_get_role(db, current_trainer.id, player.team_id)

    update_fields = update_data.model_dump(exclude_unset=True)

    for key, value in update_fields.items():
        if key in ['start_date', 'end_date'] and isinstance(value, date):
            setattr(injury, key, datetime.combine(value, datetime.min.time()))
        elif key == 'status' and value is not None:
             setattr(injury, key, value)
        elif value is not None:
            setattr(injury, key, value)
            
    db.commit()
    db.refresh(injury)
    
    response_data = InjuryResponse.from_orm(injury)
    response_data.status = injury.status.value 
    return response_data


@router.get("/injuries/list/{player_id}", response_model=List[InjuryResponse])
def list_player_injuries(
    player_id: int,
    current_trainer: Trainer = Depends(get_current_trainer), # [FIX] Korrekte Injection
    db: Session = Depends(get_db)
):
    """ Listet alle Verletzungen eines Spielers auf (Trainer-Zugriff). """
    player = db.query(Player).filter(Player.id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden.")

    check_team_auth_and_get_role(db, current_trainer.id, player.team_id)
    
    injuries = db.query(Injury).filter(
        Injury.player_id == player_id
    ).order_by(Injury.start_date.desc()).all()
    
    response_list = []
    for injury in injuries:
         response_data = InjuryResponse.from_orm(injury)
         response_data.status = injury.status.value
         response_list.append(response_data)
         
    return response_list


# ==================================================
# ENDPUNKTE: BELASTUNGS-ANALYSE (NEU: ACWR Platzhalter)
# ==================================================

@router.get("/acwr/report/{player_id}", response_model=Dict[str, float])
def get_acwr_report(
    player_id: int,
    current_trainer: Trainer = Depends(get_current_trainer), # [FIX] Korrekte Injection
    db: Session = Depends(get_db)
):
    """ 
    [Platzhalter] Berechnet die Akute/Chronische Belastung (ACWR) (Phase 11). 
    """
    player = db.query(Player).filter(Player.id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden.")
    
    check_team_auth_and_get_role(db, current_trainer.id, player.team_id)

    return {
        "acute_load_7d": 1500.0,
        "chronic_load_28d": 1350.0,
        "acwr_ratio": 1.11,
        "is_high_risk": 0 
    }