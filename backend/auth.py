# DATEI: backend/auth.py (FINAL KORRIGIERT: Behebt 404 Fehler beim Verifizierungslink und ermöglicht MVP Login)

from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from jose import jwt, JWTError
from pydantic import BaseModel, EmailStr, Field, model_validator
from typing import List, Optional, Union 
import re
import uuid
from datetime import datetime, timedelta 
from sqlalchemy import select 

from backend.database import SessionLocal, Trainer, Player, Team, UserRole, team_trainer_association 

router = APIRouter()
# Passwort-Hashing
pwd_context = CryptContext(schemes=["sha256_crypt"], deprecated="auto")
# JWT-Konfiguration
SECRET_KEY = "supergeheimeschluessel123" 
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 1 Tag Gültigkeit

# ----------------------------------------------------
# PASWORT-HELPER & JWT-HELPER
# ----------------------------------------------------
def verify_password(plain_password: str, hashed_password: str) -> bool:
    """ Überprüft, ob das Klartext-Passwort mit dem Hash übereinstimmt. """
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """ Erstellt einen Hash für das gegebene Passwort. """
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    to_encode.update({"sub": data.get("identifier") or data.get("email")})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# ----------------------------------------------------
# DATENBANK-HELPER & PYDANTIC MODELLE
# ----------------------------------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class TrainerBase(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(min_length=6)

    @model_validator(mode='after')
    def validate_username_and_password_strength(self):
        # NOTE: Ihr tatsächlicher Validator-Code muss hier stehen, falls er gelöscht wurde
        return self

class UsernameCheck(BaseModel):
    username: str

class EmailCheck(BaseModel):
    email: EmailStr
    
class AvailabilityResponse(BaseModel):
    available: bool
    alternatives: List[str] 

class Credentials(BaseModel):
    username: str
    password: str
    
# ----------------------------------------------------
# AUTORISIERUNGS-HELFER (DEPENDENCIES)
# ----------------------------------------------------

def get_current_user_data_from_token(request: Request, db: Session):
    """ Interne Funktion: Liest Token aus Cookie und decodiert User-Daten. """
    token = request.cookies.get("access_token")
    if not token:
        return None
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_type: str = payload.get("user_type")
        identifier: str = payload.get("identifier")
        
        if user_type == "trainer":
            trainer = db.query(Trainer).filter((Trainer.username == identifier) | (Trainer.email == identifier)).first()
            return {"user": trainer, "type": "trainer"} if trainer else None
        
        if user_type == "player":
            player = db.query(Player).filter(Player.email == identifier, Player.is_active == True).first()
            return {"user": player, "type": "player"} if player else None
            
        return None
        
    except JWTError:
        return None 
        
CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Nicht authentifiziert. Bitte neu einloggen.",
    headers={"WWW-Authenticate": "Bearer"},
)
FORBIDDEN_EXCEPTION = HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="Keine ausreichende Berechtigung.",
)


def get_current_trainer(request: Request, db: Session = Depends(get_db)):
    """ Dependency für TRAINER-EXKLUSIVE Routen. Löst 401/403 aus, wenn kein Trainer. """
    user_data = get_current_user_data_from_token(request, db)
    
    if user_data is None:
        raise CREDENTIALS_EXCEPTION
        
    if user_data["type"] != "trainer":
        raise FORBIDDEN_EXCEPTION 

    return user_data["user"]


def get_current_player_only(request: Request, db: Session = Depends(get_db)):
    """ Dependency für SPIELER-EXKLUSIVE Routen. Löst 401/403 aus, wenn kein Spieler. """
    user_data = get_current_user_data_from_token(request, db)
    
    if user_data is None:
        raise CREDENTIALS_EXCEPTION
        
    if user_data["type"] != "player":
        raise FORBIDDEN_EXCEPTION 

    return user_data["user"]


def check_team_auth_and_get_role(db: Session, trainer_id: int, team_id: int, required_roles: Optional[List[UserRole]] = None) -> UserRole:
    """ Prüft Trainer-Berechtigung für ein Team. """
    
    stmt = select(team_trainer_association.c.role).where(
        team_trainer_association.c.trainer_id == trainer_id,
        team_trainer_association.c.team_id == team_id
    )
    result = db.execute(stmt).scalar_one_or_none()

    if result is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Sie sind kein Trainer dieses Teams oder haben keine Berechtigung für diese Aktion."
        )

    trainer_role = UserRole(result)

    if required_roles:
        if trainer_role not in required_roles:
            required_role_names = [role.value for role in required_roles]
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Sie haben nicht die erforderliche Rolle ({', '.join(required_role_names)}) für diese Aktion."
            )
            
    return trainer_role


# ----------------------------------------------------
# ENDPUNKTE (ROUTEN)
# ----------------------------------------------------

# --- 1. REGISTRIERUNG ---
@router.post("/register", status_code=status.HTTP_201_CREATED)
def register_trainer(trainer_data: TrainerBase, db: Session = Depends(get_db)):
    
    if db.query(Trainer).filter(Trainer.username == trainer_data.username).first():
        raise HTTPException(status_code=400, detail="Dieser Benutzername ist bereits vergeben.")
    if db.query(Trainer).filter(Trainer.email == trainer_data.email).first():
        raise HTTPException(status_code=400, detail="Diese E-Mail-Adresse wird bereits verwendet.")
        
    if db.query(Player).filter(Player.email == trainer_data.email).first():
        raise HTTPException(status_code=400, detail="Diese E-Mail-Adresse wird bereits von einem Spieler-Account verwendet. Bitte wählen Sie eine andere E-Mail oder loggen Sie sich als Spieler ein.")

    hashed_password = get_password_hash(trainer_data.password)
    
    new_trainer = Trainer(
        username=trainer_data.username,
        email=trainer_data.email,
        password=hashed_password,
        verification_token=str(uuid.uuid4()), 
        is_verified=False 
    )
    
    db.add(new_trainer)
    db.commit()
    db.refresh(new_trainer)
    
    # FIX: Korrigierter Link verwendet den korrekten Endpunkt /verify-email
    verification_link = f"http://127.0.0.1:8000/auth/verify-email?token={new_trainer.verification_token}" 
    print(f"--- EMAIL SIMULATION ---: Sende Verifizierungs-Link an {new_trainer.email}: {verification_link}")

    return {"message": "Registrierung erfolgreich. Bitte verifizieren Sie Ihr Konto über den gesendeten Link."}


# --- 2. VERIFIZIERUNG ---
@router.get("/verify-email")
def verify_email(token: str, db: Session = Depends(get_db)):
    trainer = db.query(Trainer).filter(Trainer.verification_token == token).first()

    if not trainer:
        raise HTTPException(status_code=404, detail="Ungültiger oder abgelaufener Verifizierungslink.")

    if trainer.is_verified:
        return {"message": "Ihr Konto ist bereits verifiziert."}

    trainer.is_verified = True
    trainer.verification_token = None 
    db.commit()
    
    return {"message": "Verifizierung erfolgreich! Sie können sich jetzt einloggen."}


# --- 3. VERFÜGBARKEITSPRÜFUNG EMAIL (Wiederhergestellt) ---
@router.post("/check-email-availability", response_model=AvailabilityResponse)
def check_email_availability(email_check: EmailCheck, db: Session = Depends(get_db)):
    """ PRÜFT, OB E-MAIL ALS TRAINER ODER SPIELER EXISTIERT. """
    trainer = db.query(Trainer).filter(Trainer.email == email_check.email).first()
    player = db.query(Player).filter(Player.email == email_check.email).first()
    
    if trainer or player:
        return AvailabilityResponse(available=False, alternatives=[])
    else:
        return AvailabilityResponse(available=True, alternatives=[])


# --- 4. PRÜFUNG DER EXISTENZ DES USERS (Hybrider Trainer/Spieler-Check) ---
@router.post("/check-username")
def check_username(user_check: UsernameCheck, db: Session = Depends(get_db)):
    identifier = user_check.username
    is_email = re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', identifier)
    
    user_to_check = None
    user_type = None

    # 1. VERSUCH: TRAINER SUCHE
    trainer = db.query(Trainer).filter(Trainer.username == identifier).first()
    if not trainer and is_email:
        trainer = db.query(Trainer).filter(Trainer.email == identifier).first()

    if trainer:
        user_to_check = trainer
        user_type = "trainer"
    else:
        # 2. VERSUCH: SPIELER SUCHE (NUR über E-Mail und wenn aktiv)
        if is_email:
            player = db.query(Player).filter(Player.email == identifier, Player.is_active == True).first()
            if player:
                user_to_check = player
                user_type = "player"

    if user_to_check:
        return {
            "exists": True, 
            "user_type": user_type,  
            "message": f"{user_type.capitalize()} gefunden. Bitte Passwort eingeben."
        }
    else:
        return {
            "exists": False, 
            "message": "Benutzer nicht gefunden. Bitte registrieren Sie sich."
        }
        
# --- 5. VERFÜGBARKEITSPRÜFUNG USERNAME (Wiederhergestellt) ---
@router.post("/check-availability", response_model=AvailabilityResponse)
def check_availability(user_check: UsernameCheck, db: Session = Depends(get_db)):
    """ PRÜFT, OB USERNAME NOCH VERFÜGBAR IST. """
    username = user_check.username
    alternatives = []
    if not re.match(r'^[a-zA-Z0-9]+$', username):
        return AvailabilityResponse(available=False, alternatives=[])
    trainer = db.query(Trainer).filter(Trainer.username == username).first()
    if not trainer:
        return AvailabilityResponse(available=True, alternatives=[])
    else:
        base_username = username
        match = re.match(r'(.+?)(\d+)$', username)
        if match:
            base_username = match.group(1)
        for i in range(1, 4):
            alternative = f"{base_username}{i}"
            if not db.query(Trainer).filter(Trainer.username == alternative).first():
                alternatives.append(alternative)
        return AvailabilityResponse(available=False, alternatives=alternatives)


# --- 6. LOGIN (Token-Erstellung und Cookie-Setzung) ---
@router.post("/token") 
def login_for_access_token(
    credentials: Credentials, 
    response: Response, 
    db: Session = Depends(get_db)
):
    identifier = credentials.username
    is_email = re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', identifier)
    
    user_to_log_in = None
    user_type = None

    # 1. TRAINER-SUCHE
    trainer = db.query(Trainer).filter(Trainer.username == identifier).first()
    if not trainer and is_email:
        trainer = db.query(Trainer).filter(Trainer.email == identifier).first()

    if trainer:
        user_to_log_in = trainer
        user_type = "trainer"
    else:
        # 2. SPIELER-SUCHE
        if is_email:
            player = db.query(Player).filter(Player.email == identifier, Player.is_active == True).first()
            if player:
                user_to_log_in = player
                user_type = "player"

    # 3. ÜBERPRÜFUNG DES GEFUNDENEN USERS
    if not user_to_log_in or not verify_password(credentials.password, user_to_log_in.password):
        raise HTTPException(status_code=401, detail="Falsche Anmeldedaten")
        
    # FIX: Die 403-Sperre wurde entfernt, um den MVP-Fluss zu ermöglichen
        
    # 4. TOKEN ERSTELLEN
    token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    if user_type == "player":
        token_data = {"user_type": user_type, "identifier": user_to_log_in.email}
    else: 
        token_data = {"user_type": user_type, "identifier": user_to_log_in.username or user_to_log_in.email}

    access_token = create_access_token(
        data=token_data, 
        expires_delta=token_expires
    )
    
    # 5. COOKIE SETZEN
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,       
        secure=False,        
        samesite="strict",   
        max_age=int(token_expires.total_seconds()) 
    )
    
    # 6. KORRIGIERTE ANZEIGENAMEN-LOGIK
    if user_type == "trainer":
        username_display = user_to_log_in.username or user_to_log_in.email
    else: # player
        username_display = user_to_log_in.name
    
    # 7. RETURN: Gib den Zielpfad zurück
    target_url = "/player-dashboard" if user_type == "player" else "/dashboard"
    
    return {
        "message": f"{user_type.capitalize()}-Login erfolgreich", 
        "username": username_display, 
        "user_type": user_type,
        "is_verified": getattr(user_to_log_in, 'is_verified', True),
        "redirect_url": target_url 
    }

# --- 7. LOGOUT ---
@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("access_token")
    return {"message": "Erfolgreich abgemeldet"}