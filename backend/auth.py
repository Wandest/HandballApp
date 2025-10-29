from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from jose import jwt, JWTError
from pydantic import BaseModel, EmailStr, Field, model_validator
from pydantic_core import PydanticCustomError
from typing import List, Optional
import re
import uuid
from datetime import datetime, timedelta

# Expliziter Import von 'database'
from backend.database import SessionLocal, Trainer 

router = APIRouter()
# Passwort-Hashing
pwd_context = CryptContext(schemes=["sha256_crypt"], deprecated="auto")
# JWT-Konfiguration
SECRET_KEY = "supergeheimeschluessel123" 
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

# OAuth2PasswordBearer definiert das Schema für Token in Headern
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login") 

# Datenbanksession
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Exception für ungültige Zugangsdaten
CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Zugangsdaten sind ungültig oder Token ist abgelaufen",
    headers={"WWW-Authenticate": "Bearer"},
)

# -----------------------------
# Pydantic Modelle (Schemas)
# -----------------------------
class TrainerCreate(BaseModel):
    username: str
    email: EmailStr
    password: str = Field(min_length=8)

    @model_validator(mode='after')
    def validate_username_and_password_strength(self):
        
        username = self.username
        if not re.match(r'^[a-zA-Z0-9]+$', username):
             raise ValueError("Der Benutzername darf nur Buchstaben und Zahlen enthalten (keine Leerzeichen oder Sonderzeichen).")
             
        password = self.password
        rules = [
            (r'[A-Z]', 'Mindestens 1 Großbuchstabe'),
            (r'[a-z]', 'Mindestens 1 Kleinbuchstabe'),
            (r'\d', 'Mindestens 1 Ziffer'),
            (r'[@$!%*?&]', 'Mindestens 1 Sonderzeichen (@$!%*?&)'),
        ]
        failed_rules = []
        for regex, error_msg in rules:
            if not re.search(regex, password):
                failed_rules.append(error_msg)

        if failed_rules:
            error_message = f"Das Passwort erfüllt folgende Anforderungen nicht: {', '.join(failed_rules)}."
            raise ValueError(error_message)

        return self

class TrainerLogin(BaseModel):
    username: str
    password: str

class UsernameCheck(BaseModel):
    username: str
    
class EmailCheck(BaseModel):
    email: EmailStr

class AvailabilityResponse(BaseModel):
    available: bool
    alternatives: List[str]

class Token(BaseModel):
    access_token: str
    token_type: str

# -----------------------------
# Hilfsfunktionen
# -----------------------------
def hash_password(password: str):
    return pwd_context.hash(password)

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    to_encode.update({"sub": data["username"]})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

# Abhängigkeitsfunktion zum Überprüfen des Tokens
def get_current_trainer(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub") 
        if username is None:
            raise CREDENTIALS_EXCEPTION
    except JWTError:
        raise CREDENTIALS_EXCEPTION
    
    trainer = db.query(Trainer).filter(Trainer.username == username).first()
    
    if trainer is None:
        raise CREDENTIALS_EXCEPTION
    
    # NEU: Entferne die Verifizierungsprüfung hier. Sie wird im Dashboard selbst durchgeführt.
    # if not trainer.is_verified:
    #     raise HTTPException(...)

    return trainer 

# -----------------------------
# Endpunkte
# -----------------------------

@router.post("/check-username")
def check_username(user_check: UsernameCheck, db: Session = Depends(get_db)):
    trainer = db.query(Trainer).filter(Trainer.username == user_check.username).first()
    
    if trainer:
        return {"exists": True, "message": "Benutzer gefunden. Bitte Passwort eingeben."}
    else:
        return {"exists": False, "message": "Benutzer nicht gefunden. Bitte registrieren Sie sich."}

@router.post("/check-email-availability", response_model=AvailabilityResponse)
def check_email_availability(email_check: EmailCheck, db: Session = Depends(get_db)):
    trainer = db.query(Trainer).filter(Trainer.email == email_check.email).first()
    
    if trainer:
        return AvailabilityResponse(available=False, alternatives=[])
    else:
        return AvailabilityResponse(available=True, alternatives=[])


@router.post("/check-availability", response_model=AvailabilityResponse)
def check_availability(user_check: UsernameCheck, db: Session = Depends(get_db)):
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


@router.post("/register")
def register_trainer(trainer: TrainerCreate, db: Session = Depends(get_db)):
    if db.query(Trainer).filter(Trainer.username == trainer.username).first():
        raise HTTPException(status_code=400, detail="Dieser Benutzername ist bereits vergeben.")
    if db.query(Trainer).filter(Trainer.email == trainer.email).first():
        raise HTTPException(status_code=400, detail="Diese E-Mail-Adresse ist bereits registriert.")

    hashed_pw = hash_password(trainer.password)
    verification_token = str(uuid.uuid4()) 

    new_trainer = Trainer(
        username=trainer.username,
        email=trainer.email, 
        password=hashed_pw,
        is_verified=False,
        verification_token=verification_token
    )
    db.add(new_trainer)
    db.commit()

    verification_link = f"http://127.0.0.1:8000/auth/verify?token={verification_token}"

    return {
        "msg": "Trainer erfolgreich registriert. Bitte E-Mail überprüfen.",
        "verification_link": verification_link
    }

@router.get("/verify")
def verify_trainer(token: str, db: Session = Depends(get_db)):
    trainer = db.query(Trainer).filter(Trainer.verification_token == token).first()

    if not trainer:
        raise HTTPException(status_code=400, detail="Ungültiger oder abgelaufener Verifizierungs-Token.")
    
    if trainer.is_verified:
        return {"msg": "Konto ist bereits verifiziert."}

    trainer.is_verified = True
    trainer.verification_token = None
    db.commit()

    return {"msg": "E-Mail-Adresse erfolgreich verifiziert! Du kannst dich jetzt einloggen."}


@router.post("/login", response_model=Token)
def login_trainer(credentials: TrainerLogin, db: Session = Depends(get_db)):
    trainer = db.query(Trainer).filter(Trainer.username == credentials.username).first()
    
    if not trainer or not verify_password(credentials.password, trainer.password):
        raise HTTPException(status_code=401, detail="Falscher Benutzername oder Passwort")

    # NEU: Die Verifizierungsprüfung wird hier entfernt!
    # if not trainer.is_verified:
    #     raise HTTPException(status_code=403, detail="Konto ist nicht verifiziert. Bitte E-Mail überprüfen.")

    token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(data={"username": trainer.username}, expires_delta=token_expires) 
    return {"access_token": access_token, "token_type": "bearer"}