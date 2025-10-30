from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey
from sqlalchemy.orm import sessionmaker, relationship
from sqlalchemy.ext.declarative import declarative_base

# SQLite Datenbank (wird im Hauptverzeichnis der App erstellt)
SQLALCHEMY_DATABASE_URL = "sqlite:///./handball.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

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

    # Beziehungen
    teams = relationship("Team", back_populates="trainer", cascade="all, delete-orphan")
    # custom_actions-Beziehung wurde entfernt (ist jetzt an Team gebunden)

# ---------------------------------
# 2. Team (Mannschaft) Modell
# ---------------------------------
class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    league = Column(String)
    trainer_id = Column(Integer, ForeignKey("trainers.id"))

    # Beziehungen
    trainer = relationship("Trainer", back_populates="teams")
    players = relationship("Player", back_populates="team", cascade="all, delete-orphan") 
    games = relationship("Game", back_populates="team", cascade="all, delete-orphan") 
    # NEUE BEZIEHUNG: (Team-spezifische Aktionen)
    custom_actions = relationship("CustomAction", back_populates="team", cascade="all, delete-orphan")


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

    # Beziehungen
    team = relationship("Team", back_populates="players")
    actions = relationship("Action", back_populates="player", cascade="all, delete-orphan") 

# ---------------------------------
# 4. Game (Spiel) Modell
# --- HIER SIND DIE ÄNDERUNGEN ---
# ---------------------------------
class Game(Base):
    __tablename__ = "games"

    id = Column(Integer, primary_key=True, index=True)
    opponent = Column(String)
    date = Column(String)
    team_id = Column(Integer, ForeignKey("teams.id"))
    
    # --- NEUE SPALTEN ---
    # Kategorie: 'Saison', 'Testspiel', 'Turnier'
    game_category = Column(String, default="Testspiel", nullable=False)
    # Name des Turniers (nur relevant, wenn Kategorie 'Turnier' ist)
    tournament_name = Column(String, nullable=True) 
    # --- ENDE NEUE SPALTEN ---

    # Beziehungen
    team = relationship("Team", back_populates="games")
    actions = relationship("Action", back_populates="game", cascade="all, delete-orphan") 


# ---------------------------------
# 5. Action (Aktion/Event) Modell
# ---------------------------------
class Action(Base):
    __tablename__ = "actions"

    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("games.id"))
    player_id = Column(Integer, ForeignKey("players.id"), nullable=True) 
    
    action_type = Column(String) # Speichert "Goal", "Miss", oder den Namen der CustomAction
    time_in_game = Column(String)
    
    # Beziehungen
    game = relationship("Game", back_populates="actions")
    player = relationship("Player", back_populates="actions")

# ---------------------------------
# 6. CustomAction (Definition) Modell
# ---------------------------------
class CustomAction(Base):
    __tablename__ = "custom_actions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    category = Column(String, nullable=True) 
    
    # Verknüpfung zum Team statt zum Trainer
    team_id = Column(Integer, ForeignKey("teams.id"))
    
    # Beziehung
    team = relationship("Team", back_populates="custom_actions")


# Initialisierungsfunktion
def init_db():
    Base.metadata.create_all(bind=engine)

