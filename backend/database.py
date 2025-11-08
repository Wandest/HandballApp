# DATEI: backend/database.py
# +++ NEU: Fügt WellnessLog und Injury Modelle für Athletik-Tracking hinzu (Phase 11) +++

from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey, Table, Float, Text, DateTime, Enum
from sqlalchemy.orm import sessionmaker, relationship
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
import enum
from pydantic import BaseModel
from typing import Optional, Dict

# SQLite Datenbank (wird im Hauptverzeichnis der App erstellt)
SQLALCHEMY_DATABASE_URL = "sqlite:///./handball.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# ==================================================
# ENUMS
# ==================================================
class UserRole(enum.Enum):
    MAIN_COACH = "MAIN_COACH"
    ASSISTANT_COACH = "ASSISTANT_COACH"
    TEAM_ADMIN = "TEAM_ADMIN"

class EventType(enum.Enum):
    TRAINING = "Training"
    GAME = "Spiel"
    OTHER = "Sonstiges"

class EventStatus(enum.Enum):
    PLANNED = "Geplant"
    CANCELED = "Abgesagt"
    COMPLETED = "Abgeschlossen"

class AttendanceStatus(enum.Enum):
    ATTENDING = "Zugesagt"
    DECLINED = "Abgesagt"
    TENTATIVE = "Vielleicht"
    NOT_RESPONDED = "Keine Antwort"

class AbsenceReason(enum.Enum):
    ILLNESS = "Krankheit"
    INJURY = "Verletzung"
    VACATION = "Urlaub"
    WORK = "Arbeit/Schule"
    OTHER = "Sonstiges"
    
class InjuryStatus(enum.Enum): # NEU: Status der Verletzung
    ACUTE = "Akut"
    CHRONIC = "Chronisch"
    REHAB = "Reha"
    CLEARED = "Ausgeheilt"

# ==================================================
# NEUTRALES PYDANTIC MODELL FÜR STATISTIKEN
# ==================================================
class PlayerStats(BaseModel):
    player_id: int
    player_name: str
    player_number: Optional[int] = None
    position: Optional[str] = None
    games_played: int = 0
    goals: int = 0
    misses: int = 0
    tech_errors: int = 0
    fehlpaesse: int = 0
    seven_meter_goals: int = 0
    seven_meter_misses: int = 0
    seven_meter_caused: int = 0
    seven_meter_saves: int = 0
    seven_meter_received: int = 0
    saves: int = 0
    opponent_goals_received: int = 0
    custom_counts: Dict[str, int] = {}
    time_on_court_seconds: int = 0 
    time_on_court_display: str = "00:00" 
    class Config: from_attributes = True

# ==================================================
# AS-SOZIATIONSTABELLEN
# ==================================================
team_trainer_association = Table(
    "team_trainer_association",
    Base.metadata,
    Column("team_id", Integer, ForeignKey("teams.id"), primary_key=True),
    Column("trainer_id", Integer, ForeignKey("trainers.id"), primary_key=True),
    Column("role", Enum(UserRole), default=UserRole.ASSISTANT_COACH)
)
game_participations_table = Table(
    "game_participations",
    Base.metadata,
    Column("game_id", Integer, ForeignKey("games.id"), primary_key=True),
    Column("player_id", Integer, ForeignKey("players.id"), primary_key=True),
)
# ==================================================


# ==================================================
# 1. Trainer (User) Modell
# ==================================================
class Trainer(Base):
    __tablename__ = "trainers"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True) 
    email = Column(String, unique=True, index=True)
    password = Column(String) 
    is_verified = Column(Boolean, default=False) 
    verification_token = Column(String, nullable=True)
    
    teams_managed = relationship(
        "Team",
        secondary=team_trainer_association,
        back_populates="coaches"
    )

    scouting_reports = relationship("ScoutingReport", back_populates="trainer", cascade="all, delete-orphan")
    created_events = relationship("TeamEvent", back_populates="creator", foreign_keys="[TeamEvent.created_by_trainer_id]")
    
    created_drills = relationship("Drill", back_populates="creator", cascade="all, delete-orphan")


# ---------------------------------
# 2. Team (Mannschaft) Modell
# ---------------------------------
class Team(Base):
    __tablename__ = "teams"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    league = Column(String)
    is_public = Column(Boolean, default=False, nullable=False) 
    
    coaches = relationship(
        "Trainer",
        secondary=team_trainer_association,
        back_populates="teams_managed"
    )

    players = relationship("Player", back_populates="team", cascade="all, delete-orphan") 
    games = relationship("Game", back_populates="team", cascade="all, delete-orphan") 
    custom_actions = relationship("CustomAction", back_populates="team", cascade="all, delete-orphan")
    scouting_reports = relationship("ScoutingReport", back_populates="team", cascade="all, delete-orphan")
    events = relationship("TeamEvent", back_populates="team", cascade="all, delete-orphan")
    settings = relationship("TeamSettings", back_populates="team", uselist=False, cascade="all, delete-orphan")
    
    drill_categories = relationship("DrillCategory", back_populates="team", cascade="all, delete-orphan")
    drills = relationship("Drill", back_populates="team", cascade="all, delete-orphan")


# ---------------------------------
# 3. Player (Spieler) Modell
# ---------------------------------
class Player(Base):
    __tablename__ = "players"
    id = Column(Integer, primary_key=True, index=True) 
    
    name = Column(String)
    number = Column(Integer, nullable=True)
    position = Column(String, nullable=True)
    team_id = Column(Integer, ForeignKey("teams.id"))
    
    email = Column(String, unique=True, index=True, nullable=True)
    password = Column(String, nullable=True)
    is_active = Column(Boolean, default=False)
    invitation_token = Column(String, nullable=True)
    
    team = relationship("Team", back_populates="players")
    
    actions_as_field_player = relationship( 
        "Action", 
        foreign_keys="[Action.player_id]", 
        back_populates="player", 
        cascade="all, delete-orphan"
    )
    
    actions_as_active_goalie = relationship( 
        "Action", 
        foreign_keys="[Action.active_goalie_id]", 
        back_populates="active_goalie"
    )
    
    games_participated = relationship(
        "Game",
        secondary=game_participations_table,
        back_populates="participating_players"
    )
    
    event_attendances = relationship("Attendance", back_populates="player") 
    absences = relationship("PlayerAbsence", back_populates="player", cascade="all, delete-orphan")

    # NEU: Beziehungen für Phase 11
    wellness_logs = relationship("WellnessLog", back_populates="player", cascade="all, delete-orphan")
    injuries = relationship("Injury", back_populates="player", cascade="all, delete-orphan")


# ---------------------------------
# 4. Game (Spiel) Modell
# ---------------------------------
class Game(Base):
    __tablename__ = "games"
    id = Column(Integer, primary_key=True, index=True)
    opponent = Column(String)
    date = Column(String)
    team_id = Column(Integer, ForeignKey("teams.id"))
    game_category = Column(String, default="Testspiel", nullable=False)
    tournament_name = Column(String, nullable=True) 
    
    video_url = Column(String, nullable=True) 

    team = relationship("Team", back_populates="games")
    actions = relationship("Action", back_populates="game", cascade="all, delete-orphan") 

    participating_players = relationship(
        "Player",
        secondary=game_participations_table,
        back_populates="games_participated"
    )
    
    scouting_reports = relationship("ScoutingReport", back_populates="game")
    
# ---------------------------------
# 5. Action (Aktion/Event) Modell
# ---------------------------------
class Action(Base):
    __tablename__ = "actions"
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("games.id"))
    action_type = Column(String) 
    time_in_game = Column(String)
    
    x_coordinate = Column(Float, nullable=True)
    y_coordinate = Column(Float, nullable=True)
    
    video_timestamp = Column(String, nullable=True) 
    
    server_timestamp = Column(DateTime, default=datetime.utcnow) 

    player_id = Column(Integer, ForeignKey("players.id"), nullable=True) 
    active_goalie_id = Column(Integer, ForeignKey("players.id"), nullable=True)
    
    player = relationship(
        "Player", 
        foreign_keys=[player_id], 
        back_populates="actions_as_field_player"
    )
    
    active_goalie = relationship(
        "Player", 
        foreign_keys=[active_goalie_id], 
        back_populates="actions_as_active_goalie"
    )
    
    game = relationship("Game", back_populates="actions")

# ---------------------------------
# 6. CustomAction (Definition) Modell
# ---------------------------------
class CustomAction(Base):
    __tablename__ = "custom_actions"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    category = Column(String, nullable=True) 
    team_id = Column(Integer, ForeignKey("teams.id"))
    team = relationship("Team", back_populates="custom_actions")

# ---------------------------------
# 7. ScoutingReport Modell 
# ---------------------------------
class ScoutingReport(Base):
    __tablename__ = "scouting_reports"
    id = Column(Integer, primary_key=True, index=True)
    
    title = Column(String, index=True)
    content = Column(Text, nullable=True) 
    opponent_name = Column(String, index=True)
    game_id = Column(Integer, ForeignKey("games.id"), nullable=True)
    
    team_id = Column(Integer, ForeignKey("teams.id"))
    trainer_id = Column(Integer, ForeignKey("trainers.id"))
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    game = relationship("Game", back_populates="scouting_reports")
    team = relationship("Team", back_populates="scouting_reports")
    trainer = relationship("Trainer", back_populates="scouting_reports")

# ---------------------------------
# 8. TeamSettings (Standard-Deadlines)
# ---------------------------------
class TeamSettings(Base):
    __tablename__ = "team_settings"
    team_id = Column(Integer, ForeignKey("teams.id"), primary_key=True)
    
    game_deadline_hours = Column(Integer, default=48)
    tournament_deadline_hours = Column(Integer, default=72)
    testspiel_deadline_hours = Column(Integer, default=48)
    training_deadline_hours = Column(Integer, default=24)
    other_deadline_hours = Column(Integer, default=24)

    team = relationship("Team", back_populates="settings")

# ---------------------------------
# 9. TeamEvent (Kalender-Termin) Modell
# ---------------------------------
class TeamEvent(Base):
    __tablename__ = "team_events"
    id = Column(Integer, primary_key=True, index=True)
    
    team_id = Column(Integer, ForeignKey("teams.id"))
    created_by_trainer_id = Column(Integer, ForeignKey("trainers.id"))
    
    title = Column(String, index=True)
    event_type = Column(Enum(EventType), default=EventType.TRAINING)
    
    status = Column(Enum(EventStatus), default=EventStatus.PLANNED) 
    
    start_time = Column(DateTime, default=datetime.utcnow)
    end_time = Column(DateTime, nullable=True)
    
    location = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    
    default_status = Column(Enum(AttendanceStatus), default=AttendanceStatus.NOT_RESPONDED)
    
    response_deadline_hours = Column(Integer, nullable=True) 
    
    planned_drill_ids = Column(String, nullable=True) 
    
    team = relationship("Team", back_populates="events")
    creator = relationship("Trainer", back_populates="created_events", foreign_keys=[created_by_trainer_id])
    
    attendances = relationship("Attendance", back_populates="event", cascade="all, delete-orphan")

# ---------------------------------
# 10. Attendance (Anwesenheit) Modell
# ---------------------------------
class Attendance(Base):
    __tablename__ = "attendances"
    event_id = Column(Integer, ForeignKey("team_events.id"), primary_key=True)
    player_id = Column(Integer, ForeignKey("players.id"), primary_key=True)
    
    status = Column(Enum(AttendanceStatus), default=AttendanceStatus.NOT_RESPONDED)
    reason = Column(String, nullable=True) 
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    event = relationship("TeamEvent", back_populates="attendances")
    player = relationship("Player", back_populates="event_attendances") 

# ---------------------------------
# 11. PlayerAbsence
# ---------------------------------
class PlayerAbsence(Base):
    __tablename__ = "player_absences"
    id = Column(Integer, primary_key=True, index=True)
    player_id = Column(Integer, ForeignKey("players.id"))
    
    start_date = Column(DateTime, default=datetime.utcnow)
    end_date = Column(DateTime, nullable=True)
    reason = Column(Enum(AbsenceReason), default=AbsenceReason.OTHER)
    notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    player = relationship("Player", back_populates="absences")


# ==================================================
# NEUE MODELLE (PHASE 11): ATHLETIK & WELLNESS
# ==================================================

# ---------------------------------
# 12. WellnessLog (NEUES MODELL)
# ---------------------------------
class WellnessLog(Base):
    __tablename__ = "wellness_logs"
    id = Column(Integer, primary_key=True, index=True)
    player_id = Column(Integer, ForeignKey("players.id"))
    
    # RPE-Werte (Skala 1-5 oder 1-10, hier 1-5 für einfacheres UI)
    sleep_quality = Column(Integer, nullable=False) # 1 (schlecht) - 5 (sehr gut)
    muscle_soreness = Column(Integer, nullable=False) # 1 (kein) - 5 (extrem)
    stress_level = Column(Integer, nullable=False) # 1 (gering) - 5 (hoch)
    
    # Optional: Gefühlte Belastung der letzten Einheit (RPE der Session)
    session_rpe = Column(Integer, nullable=True) 
    
    logged_at = Column(DateTime, default=datetime.utcnow)
    
    player = relationship("Player", back_populates="wellness_logs")


# ---------------------------------
# 13. Injury (NEUES MODELL)
# ---------------------------------
class Injury(Base):
    __tablename__ = "injuries"
    id = Column(Integer, primary_key=True, index=True)
    player_id = Column(Integer, ForeignKey("players.id"))
    
    description = Column(String, nullable=False)
    location = Column(String, nullable=True) # z.B. Knie, Schulter
    status = Column(Enum(InjuryStatus), default=InjuryStatus.ACUTE)
    
    start_date = Column(DateTime, default=datetime.utcnow)
    end_date = Column(DateTime, nullable=True)
    
    notes = Column(Text, nullable=True)
    
    player = relationship("Player", back_populates="injuries")


# ---------------------------------
# 14. DrillCategory (NEUES MODELL)
# ---------------------------------
class DrillCategory(Base):
    __tablename__ = "drill_categories"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    team_id = Column(Integer, ForeignKey("teams.id"))
    
    team = relationship("Team", back_populates="drill_categories")
    drills = relationship("Drill", back_populates="category", cascade="all, delete-orphan")

# ---------------------------------
# 15. Drill (NEUES MODELL)
# ---------------------------------
class Drill(Base):
    __tablename__ = "drills"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    description = Column(Text, nullable=True)
    duration_minutes = Column(Integer, nullable=True) 
    media_url = Column(String, nullable=True) 
    
    team_id = Column(Integer, ForeignKey("teams.id"))
    category_id = Column(Integer, ForeignKey("drill_categories.id"), nullable=True)
    creator_id = Column(Integer, ForeignKey("trainers.id"))
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    team = relationship("Team", back_populates="drills")
    category = relationship("DrillCategory", back_populates="drills")
    creator = relationship("Trainer", back_populates="created_drills")


# Initialisierungsfunktion
def init_db():
    Base.metadata.create_all(bind=engine)