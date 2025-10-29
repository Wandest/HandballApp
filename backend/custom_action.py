from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List

from backend.database import SessionLocal, Trainer, CustomAction
from backend.auth import get_current_trainer 

router = APIRouter()

# -----------------------------
# Pydantic Modelle für CustomActions
# -----------------------------
class CustomActionCreate(BaseModel):
    name: str = Field(min_length=3, max_length=50)
    key: str = Field(min_length=3, max_length=20)
    is_goalkeeper_action: bool = False

class CustomActionResponse(BaseModel):
    id: int
    name: str
    key: str
    is_goalkeeper_action: bool
    trainer_id: int

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

# AKTION HINZUFÜGEN (Geschützt)
@router.post("/add", response_model=CustomActionResponse)
def create_custom_action(
    action_data: CustomActionCreate,
    current_trainer: Trainer = Depends(get_current_trainer), 
    db: Session = Depends(get_db)
):
    # Prüfe auf eindeutigen Key FÜR DEN TRAINER
    existing_key = db.query(CustomAction).filter(
        CustomAction.trainer_id == current_trainer.id,
        CustomAction.key == action_data.key
    ).first()
    if existing_key:
        raise HTTPException(status_code=400, detail=f"Der Schlüssel '{action_data.key}' ist für Sie bereits vergeben.")
        
    # Prüfe, ob Key die Konvention erfüllt
    if not re.match(r'^[A-Z0-9_]+$', action_data.key):
        raise HTTPException(status_code=400, detail="Key darf nur Großbuchstaben, Zahlen und Unterstriche enthalten.")


    new_action = CustomAction(
        trainer_id=current_trainer.id,
        name=action_data.name,
        key=action_data.key,
        is_goalkeeper_action=action_data.is_goalkeeper_action
    )
    db.add(new_action)
    db.commit()
    db.refresh(new_action)

    return new_action

# ALLE AKTIONEN LADEN (Geschützt)
@router.get("/list", response_model=List[CustomActionResponse])
def list_custom_actions(
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    actions = db.query(CustomAction).filter(
        CustomAction.trainer_id == current_trainer.id
    ).all()
    
    return actions

# AKTION LÖSCHEN (Geschützt)
@router.delete("/delete/{action_id}")
def delete_custom_action(
    action_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    action = db.query(CustomAction).filter(
        CustomAction.id == action_id,
        CustomAction.trainer_id == current_trainer.id
    ).first()

    if not action:
        raise HTTPException(status_code=404, detail="Aktion nicht gefunden oder keine Berechtigung.")
        
    # Löschen der Aktion
    db.delete(action)
    db.commit()

    return {"message": "Individuelle Aktion erfolgreich gelöscht."}