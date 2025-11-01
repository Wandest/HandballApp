# DATEI: backend/custom_action.py
# (KEINE ÄNDERUNGEN NÖTIG)

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

from backend.database import SessionLocal, Trainer, Team, CustomAction
from backend.auth import get_current_trainer 

router = APIRouter()

# -----------------------------
# Pydantic Modelle
# -----------------------------
class CustomActionCreate(BaseModel):
    name: str
    category: Optional[str] = None
    team_id: int 

class CustomActionResponse(BaseModel):
    id: int
    name: str
    category: Optional[str] = None
    team_id: int

    class Config:
        from_attributes = True

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

# EIGENE AKTION HINZUFÜGEN
@router.post("/add", response_model=CustomActionResponse)
def create_custom_action(
    action_data: CustomActionCreate,
    current_trainer: Trainer = Depends(get_current_trainer), 
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(
        Team.id == action_data.team_id,
        Team.trainer_id == current_trainer.id
    ).first()
    
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für dieses Team.")

    existing_action = db.query(CustomAction).filter(
        CustomAction.team_id == action_data.team_id,
        CustomAction.name == action_data.name
    ).first()

    if existing_action:
        raise HTTPException(status_code=400, detail="Dieses Team hat bereits eine Aktion mit diesem Namen.")
    
    new_action = CustomAction(
        name=action_data.name,
        category=action_data.category,
        team_id=action_data.team_id
    )
    db.add(new_action)
    db.commit()
    db.refresh(new_action)

    return new_action

# EIGENE AKTIONEN AUFLISTEN
@router.get("/list", response_model=List[CustomActionResponse])
def list_custom_actions(
    team_id: int = Query(...), 
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(
        Team.id == team_id,
        Team.trainer_id == current_trainer.id
    ).first()
    
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für dieses Team.")

    actions = db.query(CustomAction).filter(
        CustomAction.team_id == team_id
    ).order_by(CustomAction.name.asc()).all()
    
    return actions

# EIGENE AKTION LÖSCHEN
@router.delete("/delete/{action_id}")
def delete_custom_action(
    action_id: int,
    team_id: int = Query(...), 
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    team = db.query(Team).filter(
        Team.id == team_id,
        Team.trainer_id == current_trainer.id
    ).first()
    
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für dieses Team.")

    action = db.query(CustomAction).filter(
        CustomAction.id == action_id,
        CustomAction.team_id == team_id
    ).first()

    if not action:
        raise HTTPException(status_code=404, detail="Aktion nicht gefunden oder gehört nicht zu diesem Team.")

    db.delete(action)
    db.commit()

    return {"message": "Aktion erfolgreich gelöscht."}
