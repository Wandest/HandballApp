# DATEI: backend/team.py
# +++ ERWEITERT: Routen für TeamSettings (Standard-Deadlines) +++

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import List, Optional

from backend.database import SessionLocal, Trainer, Team, UserRole, team_trainer_association, TeamSettings # WICHTIG: TeamSettings importieren
from backend.auth import get_current_trainer, check_team_auth_and_get_role
from sqlalchemy import select 

router = APIRouter()

# -----------------------------
# Datenbank-Hilfsfunktionen
# -----------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# KORRIGIERT (Wunsch des Benutzers): Detaillierte Ligenliste
def get_league_list(): 
    return [
        "Männer - 1. Bundesliga", "Männer - 2. Bundesliga", "Männer - 3. Liga Nord",
        "Männer - Regionalliga West", "Männer - Oberliga", "Männer - Verbandsliga",
        "Männer - Landesliga", "Männer - Bezirksliga", "Männer - Kreisliga",
        "Frauen - 1. Bundesliga", "Frauen - 2. Bundesliga", "Frauen - 3. Liga Nord",
        "Frauen - Regionalliga West", "Frauen - Oberliga", "Frauen - Verbandsliga",
        "Frauen - Landesliga", "Frauen - Bezirksliga", "Frauen - Kreisliga",
        "A-Jugend männlich - 1. Bundesliga", "A-Jugend männlich - 2. Bundesliga",
        "A-Jugend männlich - Regionalliga", "A-Jugend männlich - Oberliga",
        "A-Jugend männlich - Kreisliga",
        "B-Jugend männlich - Bundesliga", "B-Jugend männlich - Regionalliga",
        "B-Jugend männlich - Oberliga", "B-Jugend männlich - Kreisliga",
        "C-Jugend männlich - Regionalliga", "C-Jugend männlich - Oberliga",
        "C-Jugend männlich - Kreisliga",
        "A-Jugend weiblich - 1. Bundesliga", "A-Jugend weiblich - 2. Bundesliga",
        "A-Jugend weiblich - Regionalliga", "A-Jugend weiblich - Oberliga",
        "A-Jugend weiblich - Kreisliga",
        "B-Jugend weiblich - Bundesliga", "B-Jugend weiblich - Regionalliga",
        "B-Jugend weiblich - Oberliga", "B-Jugend weiblich - Kreisliga",
        "C-Jugend weiblich - Regionalliga", "C-Jugend weiblich - Oberliga",
        "C-Jugend weiblich - Kreisliga",
    ]

# -----------------------------
# Pydantic Modelle (NEU: für Deadlines)
# -----------------------------

class TeamSettingsResponse(BaseModel):
    game_deadline_hours: int
    tournament_deadline_hours: int
    testspiel_deadline_hours: int
    training_deadline_hours: int
    other_deadline_hours: int

    class Config:
        from_attributes = True

class TeamSettingsUpdate(TeamSettingsResponse):
    pass 

class TeamCreate(BaseModel):
    name: str
    league: str

class TeamResponse(BaseModel):
    id: int
    name: str
    league: str
    is_public: bool

    class Config:
        from_attributes = True

class TeamPublicToggleResponse(BaseModel):
    is_public: bool
    name: str

class CoachManagementRequest(BaseModel):
    email: EmailStr

class CoachResponse(BaseModel):
    id: int
    username: str
    email: EmailStr
    role: UserRole

    class Config:
        from_attributes = True

class CoachRoleUpdate(BaseModel):
    coach_id: int
    new_role: UserRole

class CoachSwapRequest(BaseModel):
    new_main_coach_id: int

# -----------------------------
# Team-Endpunkte (Phase 2 & 10.2)
# -----------------------------

# TEAM ERSTELLEN
@router.post("/add", response_model=TeamResponse)
def create_team(
    team: TeamCreate,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    existing_team = db.query(Team).join(team_trainer_association).filter(
        team_trainer_association.c.trainer_id == current_trainer.id,
        Team.name == team.name
    ).first()

    if existing_team:
        raise HTTPException(status_code=400, detail="Sie verwalten bereits eine Mannschaft mit diesem Namen.")

    new_team = Team(name=team.name, league=team.league, is_public=False)
    db.add(new_team)
    db.flush() 

    db.execute(
        team_trainer_association.insert().values(
            team_id=new_team.id,
            trainer_id=current_trainer.id,
            role=UserRole.MAIN_COACH
        )
    )
    
    # NEU: Standardeinstellungen für das Team erstellen
    new_settings = TeamSettings(team_id=new_team.id)
    db.add(new_settings)

    db.commit()
    db.refresh(new_team)

    return new_team

# TEAMS AUFLISTEN
@router.get("/list", response_model=List[TeamResponse])
def list_teams(
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    teams = db.query(Team).join(team_trainer_association).filter(
        team_trainer_association.c.trainer_id == current_trainer.id
    ).all()
    
    return teams

# PUBLIC TOGGLE
@router.post("/toggle-public/{team_id}", response_model=TeamPublicToggleResponse)
def toggle_team_public(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    check_team_auth_and_get_role(
        db, 
        current_trainer.id, 
        team_id, 
        required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
    )

    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Mannschaft nicht gefunden.")
    
    team.is_public = not team.is_public
    db.commit()
    db.refresh(team)

    return TeamPublicToggleResponse(is_public=team.is_public, name=team.name)

# TEAM LÖSCHEN
@router.delete("/delete/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    check_team_auth_and_get_role(
        db, 
        current_trainer.id, 
        team_id, 
        required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
    )
    
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Mannschaft nicht gefunden.")
    
    db.delete(team)
    db.commit()


# -------------------------------------------------------------------
# NEU: Team-Settings Endpunkte
# -------------------------------------------------------------------

@router.get("/settings/{team_id}", response_model=TeamSettingsResponse)
def get_team_settings(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    check_team_auth_and_get_role(db, current_trainer.id, team_id)

    settings = db.query(TeamSettings).filter(TeamSettings.team_id == team_id).first()
    
    if not settings:
        # Erzeuge Standardeinstellungen, falls sie noch nicht existieren (sollte durch create_team bereits existieren, aber als Fallback)
        new_settings = TeamSettings(team_id=team_id)
        db.add(new_settings)
        db.commit()
        db.refresh(new_settings)
        settings = new_settings
        
    return settings

@router.put("/settings/{team_id}", response_model=TeamSettingsResponse)
def update_team_settings(
    team_id: int,
    settings_data: TeamSettingsUpdate,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    # Nur Admins/Haupttrainer dürfen die Standard-Deadlines ändern
    check_team_auth_and_get_role(
        db, 
        current_trainer.id, 
        team_id, 
        required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
    )

    settings = db.query(TeamSettings).filter(TeamSettings.team_id == team_id).first()
    
    if not settings:
         raise HTTPException(status_code=404, detail="Einstellungen nicht gefunden.")
         
    # Aktualisiere die Felder
    settings.game_deadline_hours = settings_data.game_deadline_hours
    settings.tournament_deadline_hours = settings_data.tournament_deadline_hours
    settings.testspiel_deadline_hours = settings_data.testspiel_deadline_hours
    settings.training_deadline_hours = settings_data.training_deadline_hours
    settings.other_deadline_hours = settings_data.other_deadline_hours

    db.commit()
    db.refresh(settings)
        
    return settings


# -------------------------------------------------------------------
# Trainer-Manager-Endpunkte (unverändert)
# -------------------------------------------------------------------

# Trainer-Staff auflisten (Jeder Trainer im Team darf dies)
@router.get("/staff/{team_id}", response_model=List[CoachResponse])
def list_team_staff(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    check_team_auth_and_get_role(db, current_trainer.id, team_id)

    staff_data = db.query(
        Trainer.id,
        Trainer.username,
        Trainer.email,
        team_trainer_association.c.role
    ).join(
        team_trainer_association,
        team_trainer_association.c.trainer_id == Trainer.id
    ).filter(
        team_trainer_association.c.team_id == team_id
    ).all()
    
    response_list = []
    for id, username, email, role_str in staff_data:
        response_list.append(CoachResponse(
            id=id,
            username=username,
            email=email,
            role=UserRole(role_str) 
        ))
        
    return response_list


# Trainer hinzufügen (MAIN_COACH oder TEAM_ADMIN erforderlich)
@router.post("/staff/add/{team_id}", response_model=CoachResponse)
def add_coach_to_team(
    team_id: int,
    coach_data: CoachManagementRequest,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    check_team_auth_and_get_role(
        db, 
        current_trainer.id, 
        team_id, 
        required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
    )
    
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Mannschaft nicht gefunden.")

    new_coach = db.query(Trainer).filter(Trainer.email == coach_data.email).first()
    if not new_coach:
        raise HTTPException(status_code=404, detail="Kein Trainer-Account mit dieser E-Mail gefunden. Der Co-Trainer muss sich zuerst registrieren.")
        
    existing_association = db.query(team_trainer_association).filter(
        team_trainer_association.c.team_id == team_id,
        team_trainer_association.c.trainer_id == new_coach.id
    ).first()
    
    if existing_association:
        raise HTTPException(status_code=400, detail="Dieser Trainer ist bereits Mitglied des Teams.")
        
    db.execute(
        team_trainer_association.insert().values(
            team_id=team_id,
            trainer_id=new_coach.id,
            role=UserRole.ASSISTANT_COACH 
        )
    )
    db.commit()

    return CoachResponse(
        id=new_coach.id,
        username=new_coach.username,
        email=new_coach.email,
        role=UserRole.ASSISTANT_COACH
    )


# Trainer-Rolle aktualisieren (MAIN_COACH oder TEAM_ADMIN erforderlich)
@router.post("/staff/role/{team_id}", response_model=CoachResponse)
def update_coach_role(
    team_id: int,
    role_update_data: CoachRoleUpdate,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    check_team_auth_and_get_role(
        db, 
        current_trainer.id, 
        team_id, 
        required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
    )

    if current_trainer.id == role_update_data.coach_id:
        raise HTTPException(status_code=400, detail="Sie können Ihre eigene Rolle nicht direkt über diesen Endpunkt ändern. Nutzen Sie den 'swap_main_coach'-Endpunkt.")
        
    check_team_auth_and_get_role(db, role_update_data.coach_id, team_id)
    target_coach = db.query(Trainer).filter(Trainer.id == role_update_data.coach_id).first()
    
    if not target_coach:
        raise HTTPException(status_code=404, detail="Ziel-Trainer nicht gefunden.")
    
    critical_coaches_count = db.query(team_trainer_association).filter(
        team_trainer_association.c.team_id == team_id,
        team_trainer_association.c.role.in_([UserRole.MAIN_COACH, UserRole.TEAM_ADMIN])
    ).count()
    
    is_downgrading_critical_role = db.query(team_trainer_association).filter(
        team_trainer_association.c.team_id == team_id,
        team_trainer_association.c.trainer_id == role_update_data.coach_id,
        team_trainer_association.c.role.in_([UserRole.MAIN_COACH, UserRole.TEAM_ADMIN])
    ).first() is not None and role_update_data.new_role not in [UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
    
    if is_downgrading_critical_role and critical_coaches_count == 1:
        raise HTTPException(
            status_code=400, 
            detail="Dieser Trainer ist der einzige Haupttrainer/Admin. Es muss zuerst eine andere Person in eine dieser Rollen befördert werden."
        )

    db.execute(
        team_trainer_association.update().where(
            team_trainer_association.c.team_id == team_id,
            team_trainer_association.c.trainer_id == role_update_data.coach_id
        ).values(role=role_update_data.new_role)
    )
    db.commit()

    return CoachResponse(
        id=target_coach.id,
        username=target_coach.username,
        email=target_coach.email,
        role=role_update_data.new_role
    )


# Trainer entfernen (MAIN_COACH oder TEAM_ADMIN erforderlich)
@router.delete("/staff/remove/{team_id}/{coach_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_coach_from_team(
    team_id: int,
    coach_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    check_team_auth_and_get_role(
        db, 
        current_trainer.id, 
        team_id, 
        required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
    )

    critical_coaches_count = db.query(team_trainer_association).filter(
        team_trainer_association.c.team_id == team_id,
        team_trainer_association.c.role.in_([UserRole.MAIN_COACH, UserRole.TEAM_ADMIN])
    ).count()

    is_removing_critical_role = db.query(team_trainer_association).filter(
        team_trainer_association.c.team_id == team_id,
        team_trainer_association.c.trainer_id == coach_id,
        team_trainer_association.c.role.in_([UserRole.MAIN_COACH, UserRole.TEAM_ADMIN])
    ).first() is not None

    if is_removing_critical_role and critical_coaches_count == 1:
        raise HTTPException(
            status_code=400, 
            detail="Dieser Trainer/Admin kann nicht entfernt werden, da er der letzte mit Hauptzugriff ist. Ernennen Sie zuerst einen Nachfolger."
        )

    delete_stmt = team_trainer_association.delete().where(
        team_trainer_association.c.team_id == team_id,
        team_trainer_association.c.trainer_id == coach_id
    )
    result = db.execute(delete_stmt)
    
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Trainer war kein Mitglied dieses Teams.")
        
    db.commit()


# Tausch der MAIN_COACH Rolle (Atomic Operation)
@router.post("/staff/swap_main_coach/{team_id}", status_code=status.HTTP_200_OK)
def swap_main_coach(
    team_id: int,
    swap_data: CoachSwapRequest,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db)
):
    check_team_auth_and_get_role(
        db, 
        current_trainer.id, 
        team_id, 
        required_roles=[UserRole.MAIN_COACH, UserRole.TEAM_ADMIN]
    )

    current_main_coach_id = current_trainer.id
    new_main_coach_id = swap_data.new_main_coach_id

    if current_main_coach_id == new_main_coach_id:
        raise HTTPException(status_code=400, detail="Dieser Trainer ist bereits der Haupttrainer.")
        
    check_team_auth_and_get_role(db, new_main_coach_id, team_id)

    db.execute(
        team_trainer_association.update().where(
            team_trainer_association.c.team_id == team_id,
            team_trainer_association.c.trainer_id == current_main_coach_id
        ).values(role=UserRole.ASSISTANT_COACH)
    )

    db.execute(
        team_trainer_association.update().where(
            team_trainer_association.c.team_id == team_id,
            team_trainer_association.c.trainer_id == new_main_coach_id
        ).values(role=UserRole.MAIN_COACH)
    )

    db.commit()
    return {"message": "Haupttrainer-Rolle erfolgreich getauscht. Sie sind nun Co-Trainer."}