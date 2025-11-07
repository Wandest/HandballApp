# DATEI: backend/drill.py
# +++ FIX: Importiert 'Query' von FastAPI, um NameError zu beheben +++

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from backend.database import (
    SessionLocal, Trainer, Team, 
    Drill, DrillCategory
)
from backend.auth import get_current_trainer, check_team_auth_and_get_role, UserRole

router = APIRouter(
    prefix="/drills",
    tags=["Training (Drills)"],
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
# Pydantic Modelle für Übungen (Drills)
# ==================================================

# --- Kategorien ---
class DrillCategoryCreate(BaseModel):
    name: str
    team_id: int

class DrillCategoryResponse(BaseModel):
    id: int
    name: str
    team_id: int

    class Config:
        from_attributes = True

# --- Übungen (Drills) ---
class DrillBase(BaseModel):
    title: str
    description: Optional[str] = None
    duration_minutes: Optional[int] = None
    media_url: Optional[str] = None # z.B. YouTube-Link
    category_id: Optional[int] = None

class DrillCreate(DrillBase):
    team_id: int

class DrillResponse(DrillBase):
    id: int
    team_id: int
    creator_id: int
    category_name: Optional[str] = None # Den Namen der Kategorie mitsenden

    class Config:
        from_attributes = True

# ==================================================
# Endpunkte: Kategorien
# ==================================================

@router.post("/categories/add", response_model=DrillCategoryResponse)
def create_drill_category(
    category_data: DrillCategoryCreate,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    """ Erstellt eine neue Übungs-Kategorie (z.B. 'Aufwärmen', 'Abwehr'). """
    check_team_auth_and_get_role(db, current_trainer.id, category_data.team_id)
    
    existing = db.query(DrillCategory).filter(
        DrillCategory.team_id == category_data.team_id,
        DrillCategory.name == category_data.name
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="Eine Kategorie mit diesem Namen existiert bereits in diesem Team.")

    new_category = DrillCategory(
        name=category_data.name,
        team_id=category_data.team_id
    )
    db.add(new_category)
    db.commit()
    db.refresh(new_category)
    return new_category

@router.get("/categories/list/{team_id}", response_model=List[DrillCategoryResponse])
def get_drill_categories(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    """ Listet alle Übungs-Kategorien für ein Team auf. """
    check_team_auth_and_get_role(db, current_trainer.id, team_id)
    categories = db.query(DrillCategory).filter(DrillCategory.team_id == team_id).order_by(DrillCategory.name.asc()).all()
    return categories

@router.delete("/categories/delete/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_drill_category(
    category_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    """ Löscht eine Kategorie (Nur Admins/Haupttrainer). """
    category = db.query(DrillCategory).filter(DrillCategory.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Kategorie nicht gefunden.")
        
    check_team_auth_and_get_role(
        db, current_trainer.id, category.team_id, 
        required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
    )
    
    # Setzt die Kategorie bei allen Übungen in dieser Kategorie auf NULL
    db.query(Drill).filter(Drill.category_id == category_id).update({"category_id": None})
    
    db.delete(category)
    db.commit()
    return None

# ==================================================
# Endpunkte: Übungen (Drills)
# ==================================================

@router.post("/add", response_model=DrillResponse)
def create_drill(
    drill_data: DrillCreate,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    """ Erstellt eine neue Übung und weist sie einem Team und optional einer Kategorie zu. """
    check_team_auth_and_get_role(db, current_trainer.id, drill_data.team_id)
    
    # Prüfen, ob die Kategorie (falls angegeben) zum Team gehört
    category_name = None
    if drill_data.category_id:
        category = db.query(DrillCategory).filter(
            DrillCategory.id == drill_data.category_id,
            DrillCategory.team_id == drill_data.team_id
        ).first()
        if not category:
            raise HTTPException(status_code=404, detail="Kategorie nicht gefunden oder gehört nicht zu diesem Team.")
        category_name = category.name

    new_drill = Drill(
        title=drill_data.title,
        description=drill_data.description,
        duration_minutes=drill_data.duration_minutes,
        media_url=drill_data.media_url,
        category_id=drill_data.category_id,
        team_id=drill_data.team_id,
        creator_id=current_trainer.id
    )
    db.add(new_drill)
    db.commit()
    db.refresh(new_drill)
    
    response = DrillResponse.from_orm(new_drill)
    response.category_name = category_name
    return response

@router.get("/list/{team_id}", response_model=List[DrillResponse])
def get_drills(
    team_id: int,
    category_id: Optional[int] = Query(None), # Optionaler Filter
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    """ Listet alle Übungen für ein Team auf, optional gefiltert nach Kategorie. """
    check_team_auth_and_get_role(db, current_trainer.id, team_id)
    
    query = db.query(Drill, DrillCategory.name.label("category_name")).outerjoin(
        DrillCategory, Drill.category_id == DrillCategory.id
    ).filter(Drill.team_id == team_id)
    
    if category_id:
        query = query.filter(Drill.category_id == category_id)
        
    drills_with_category = query.order_by(Drill.title.asc()).all()
    
    response_list = []
    for drill, cat_name in drills_with_category:
        response = DrillResponse.from_orm(drill)
        response.category_name = cat_name
        response_list.append(response)
        
    return response_list

@router.put("/update/{drill_id}", response_model=DrillResponse)
def update_drill(
    drill_id: int,
    drill_data: DrillBase, # Erlaubt keine Änderung der team_id oder creator_id
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    drill = db.query(Drill).filter(Drill.id == drill_id).first()
    if not drill:
        raise HTTPException(status_code=404, detail="Übung nicht gefunden.")
        
    check_team_auth_and_get_role(db, current_trainer.id, drill.team_id)
    
    # Nur der Ersteller oder ein Admin/Haupttrainer darf bearbeiten
    if drill.creator_id != current_trainer.id:
        check_team_auth_and_get_role(
            db, current_trainer.id, drill.team_id,
            required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
        )
        
    # Kategorie validieren
    category_name = None
    if drill_data.category_id:
        category = db.query(DrillCategory).filter(
            DrillCategory.id == drill_data.category_id,
            DrillCategory.team_id == drill.team_id
        ).first()
        if not category:
            raise HTTPException(status_code=404, detail="Kategorie nicht gefunden oder gehört nicht zu diesem Team.")
        category_name = category.name
    
    # Daten aktualisieren
    drill.title = drill_data.title
    drill.description = drill_data.description
    drill.duration_minutes = drill_data.duration_minutes
    drill.media_url = drill_data.media_url
    drill.category_id = drill_data.category_id
    drill.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(drill)
    
    response = DrillResponse.from_orm(drill)
    response.category_name = category_name
    return response

@router.delete("/delete/{drill_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_drill(
    drill_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    drill = db.query(Drill).filter(Drill.id == drill_id).first()
    if not drill:
        raise HTTPException(status_code=404, detail="Übung nicht gefunden.")
        
    # Nur der Ersteller oder ein Admin/Haupttrainer darf löschen
    if drill.creator_id != current_trainer.id:
        check_team_auth_and_get_role(
            db, current_trainer.id, drill.team_id,
            required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
        )
        
    db.delete(drill)
    db.commit()
    return None