# DATEI: backend/custom_action.py
# (KORRIGIERT: Autorisierung nutzt check_team_auth_and_get_role)

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List

from backend.database import SessionLocal, Trainer, Team, CustomAction
from backend.auth import get_current_trainer, check_team_auth_and_get_role

router = APIRouter()

# ... (Pydantic Modelle unverändert) ...

class CustomActionBase(BaseModel):
    name: str
    category: str

class CustomActionCreate(CustomActionBase):
    team_id: int

class CustomActionResponse(CustomActionBase):
    id: int
    team_id: int
    class Config: from_attributes = True

# Datenbanksession
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Endpunkte ---

@router.post("/add", response_model=CustomActionResponse)
def create_custom_action(
    action_data: CustomActionCreate,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # Berechtigung prüfen: Jeder Trainer im Team darf Custom Actions erstellen
    check_team_auth_and_get_role(db, current_trainer.id, action_data.team_id)

    # Team muss existieren (wird implizit in check_team_auth_and_get_role geprüft)
    
    new_action = CustomAction(
        name=action_data.name,
        category=action_data.category,
        team_id=action_data.team_id
    )
    db.add(new_action)
    db.commit()
    db.refresh(new_action)
    return new_action

@router.get("/list", response_model=List[CustomActionResponse])
def list_custom_actions(
    team_id: int = Query(...),
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # Berechtigung prüfen
    check_team_auth_and_get_role(db, current_trainer.id, team_id)

    actions = db.query(CustomAction).filter(CustomAction.team_id == team_id).all()
    return actions

@router.delete("/delete/{action_id}")
def delete_custom_action(
    action_id: int,
    team_id: int = Query(...),
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # Berechtigung prüfen
    check_team_auth_and_get_role(db, current_trainer.id, team_id)

    action = db.query(CustomAction).filter(
        CustomAction.id == action_id,
        CustomAction.team_id == team_id
    ).first()
    
    if not action:
        raise HTTPException(status_code=404, detail="Aktion nicht gefunden oder gehört nicht zu diesem Team.")
    
    db.delete(action)
    db.commit()
    return {"message": "Aktion erfolgreich gelöscht."}