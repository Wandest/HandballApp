# DATEI: backend/player.py
# (KORRIGIERT: Verschiebt send_player_invitation_email hierher, um Import-Fehler zu beheben)

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import List, Optional
import uuid 

from backend.database import SessionLocal, Trainer, Team, Player
from backend.auth import get_current_trainer, check_team_auth_and_get_role 

router = APIRouter()

# --- Konstanten ---
POSITIONS = ["Torwart", "Linksaußen", "Rechtsaußen", "Rückraum Links", "Rückraum Mitte", "Rückraum Rechts", "Kreisläufer"]

# --- Pydantic Modelle ---

class PlayerBase(BaseModel):
    name: str
    number: Optional[int] = None
    position: Optional[str] = None

class PlayerCreate(PlayerBase):
    team_id: int

class PlayerResponse(PlayerBase):
    id: int
    team_id: int
    email: Optional[str] = None
    is_active: bool

    class Config:
        from_attributes = True

class PlayerInvite(BaseModel):
    email: EmailStr

# --- Datenbank-Helfer ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Helper-Funktion zur Berechtigungsprüfung ---
def check_team_auth(team_id: int, trainer_id: int, db: Session) -> Team:
    # Dies ist eine redundante Funktion, da wir check_team_auth_and_get_role nutzen,
    # aber wir belassen sie für Abwärtskompatibilität, falls sie noch woanders aufgerufen wird.
    from backend.database import team_trainer_association
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team or not db.query(team_trainer_association).filter(
        team_trainer_association.c.team_id == team_id,
        team_trainer_association.c.trainer_id == trainer_id
    ).first():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Keine Berechtigung für dieses Team.")
    return team


# ==================================================
# KORRIGIERT (FIX): send_player_invitation_email Funktion
# WIRD HIER DEFINIERT
# ==================================================
async def send_player_invitation_email(email: str, token: str):
    """
    Simulierter E-Mail-Versand. Korrigiert den Linkpfad.
    WICHTIG: Ersetze dies durch deine echte E-Mail-Sende-Logik (SMTP, SendGrid, etc.).
    """
    # Verweist auf die öffentliche Route in public.py, die das HTML-Formular lädt
    invitation_link = f"http://127.0.0.1:8000/public/activate-account?token={token}"
    
    print("="*50)
    print(f"SIMULIERE SPIELER-EINLADUNGS-E-MAIL AN: {email}")
    print(f"EINLADUNGS-LINK: {invitation_link}")
    print("="*50)
# ==================================================


# --- API-Endpunkte (Logik unverändert) ---

@router.post("/add", response_model=PlayerResponse)
def create_player(
    player_data: PlayerCreate,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    check_team_auth_and_get_role(db, current_trainer.id, player_data.team_id)
    
    new_player = Player(
        name=player_data.name,
        number=player_data.number,
        position=player_data.position,
        team_id=player_data.team_id
    )
    db.add(new_player)
    db.commit()
    db.refresh(new_player)
    return new_player

@router.delete("/delete/{player_id}")
def delete_player(
    player_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    player = db.query(Player).filter(Player.id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden.")
    
    check_team_auth_and_get_role(db, current_trainer.id, player.team_id)
    
    db.delete(player)
    db.commit()
    return {"message": "Spieler erfolgreich gelöscht."}

@router.get("/list/{team_id}", response_model=List[PlayerResponse])
def list_players(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    check_team_auth_and_get_role(db, current_trainer.id, team_id)
    
    players = db.query(Player).filter(Player.team_id == team_id).order_by(Player.number.asc()).all()
    return players


@router.post("/invite/{player_id}", response_model=PlayerResponse)
async def invite_player(
    player_id: int,
    invite_data: PlayerInvite,
    background_tasks: BackgroundTasks, 
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    player = db.query(Player).filter(Player.id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden.")
    
    check_team_auth_and_get_role(db, current_trainer.id, player.team_id)
    
    existing_player = db.query(Player).filter(Player.email == invite_data.email).first()
    if existing_player and existing_player.id != player_id:
        raise HTTPException(status_code=400, detail="Diese E-Mail-Adresse wird bereits von einem anderen Spieler verwendet.")
    
    existing_trainer = db.query(Trainer).filter(Trainer.email == invite_data.email).first()
    if existing_trainer:
        raise HTTPException(status_code=400, detail="Diese E-Mail-Adresse wird bereits von einem Trainer-Account verwendet.")

    if player.is_active:
        raise HTTPException(status_code=400, detail="Dieser Spieler hat bereits einen aktiven Account.")
        
    token = str(uuid.uuid4())
    
    player.email = invite_data.email
    player.invitation_token = token
    player.is_active = False 
    player.password = None
    
    db.commit()
    db.refresh(player)
    
    background_tasks.add_task(send_player_invitation_email, player.email, token)
    
    return player
