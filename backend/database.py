# DATEI: backend/database.py
# +++ NEU: ERWEITERT UM 'default_status' FÜR EVENTS +++
# +++ NEU: ERWEITERT UM 'response_deadline_hours' FÜR EVENTS +++

from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey, Table, Float, Text, DateTime, Enum
from sqlalchemy.orm import sessionmaker, relationship
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
import enum

# SQLite Datenbank (wird im Hauptverzeichnis der App erstellt)
SQLALCHEMY_DATABASE_URL = "sqlite:///./handball.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# ==================================================
# ENUM für Trainer-Rollen
# ==================================================
class UserRole(enum.Enum):
    MAIN_COACH = "MAIN_COACH"
    ASSISTANT_COACH = "ASSISTANT_COACH"
    TEAM_ADMIN = "TEAM_ADMIN"

# +++ NEUE ENUMS FÜR PHASE 12 +++
class EventType(enum.Enum):
    TRAINING = "Training"
    GAME = "Spiel"
    OTHER = "Sonstiges"

class AttendanceStatus(enum.Enum):
    ATTENDING = "Zugesagt"
    DECLINED = "Abgesagt"
    TENTATIVE = "Vielleicht"
    NOT_RESPONDED = "Keine Antwort"
# +++ ENDE NEUE ENUMS +++


# ==================================================
# Assoziationstabelle (Trainer : Team)
# ==================================================
team_trainer_association = Table(
    "team_trainer_association",
    Base.metadata,
    Column("team_id", Integer, ForeignKey("teams.id"), primary_key=True),
    Column("trainer_id", Integer, ForeignKey("trainers.id"), primary_key=True),
    Column("role", Enum(UserRole), default=UserRole.ASSISTANT_COACH)
)
# ==================================================


# ---------------------------------
# 1. Trainer (User) Modell
# ---------------------------------
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
    
    # +++ NEU: Beziehung zu erstellten Events (Phase 12) +++
    created_events = relationship("TeamEvent", back_populates="creator", foreign_keys="[TeamEvent.created_by_trainer_id]")

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
    
    # +++ NEU: Beziehung zu Events (Phase 12) +++
    events = relationship("TeamEvent", back_populates="team", cascade="all, delete-orphan")


# --- Verknüpfungstabelle (Spieler:Spiel) ---
game_participations_table = Table(
    "game_participations",
    Base.metadata,
    Column("game_id", Integer, ForeignKey("games.id"), primary_key=True),
    Column("player_id", Integer, ForeignKey("players.id"), primary_key=True),
)
# --- ENDE ---


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
    
    # Felder für Spieler-Login
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
    
    # +++ NEU: Beziehung zu Anwesenheiten (Phase 10) +++
    event_attendances = relationship("Attendance", back_populates="player", cascade="all, delete-orphan")

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
    
    video_url = Column(String, nullable=True) # (PHASE 8)

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
    
    video_timestamp = Column(String, nullable=True) # (PHASE 8)
    
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
# 7. ScoutingReport Modell (Phase 9)
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


# +++ NEUES MODELL (PHASE 12) +++
# ---------------------------------
# 8. TeamEvent (Kalender-Termin) Modell
# ---------------------------------
class TeamEvent(Base):
    __tablename__ = "team_events"
    id = Column(Integer, primary_key=True, index=True)
    
    team_id = Column(Integer, ForeignKey("teams.id"))
    created_by_trainer_id = Column(Integer, ForeignKey("trainers.id"))
    
    title = Column(String, index=True)
    event_type = Column(Enum(EventType), default=EventType.TRAINING)
    
    start_time = Column(DateTime, default=datetime.utcnow)
    end_time = Column(DateTime, nullable=True)
    
    location = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    
    default_status = Column(Enum(AttendanceStatus), default=AttendanceStatus.NOT_RESPONDED)
    
    # +++ NEUE SPALTE (PHASE 10/12) +++
    # Antwortfrist in Stunden VOR 'start_time'. 
    # 'None' oder 0 bedeutet keine Frist.
    response_deadline_hours = Column(Integer, nullable=True) 
    
    team = relationship("Team", back_populates="events")
    creator = relationship("Trainer", back_populates="created_events", foreign_keys=[created_by_trainer_id])
    
    # Beziehung zur Anwesenheits-Tabelle
    attendances = relationship("Attendance", back_populates="event", cascade="all, delete-orphan")


# +++ NEUES MODELL (PHASE 10/12) +++
# ---------------------------------
# 9. Attendance (Anwesenheit) Modell
# ---------------------------------
class Attendance(Base):
    __tablename__ = "attendances"
    event_id = Column(Integer, ForeignKey("team_events.id"), primary_key=True)
    player_id = Column(Integer, ForeignKey("players.id"), primary_key=True)
    
    status = Column(Enum(AttendanceStatus), default=AttendanceStatus.NOT_RESPONDED)
    reason = Column(String, nullable=True) # z.B. "Krank", "Urlaub"
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    event = relationship("TeamEvent", back_populates="attendances")
    player = relationship("Player", back_populates="event_attendances")


# Initialisierungsfunktion
def init_db():
    Base.metadata.create_all(bind=engine)