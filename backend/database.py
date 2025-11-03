# DATEI: backend/database.py
# (KORRIGIERT: AmbiguousForeignKeysError behoben)

from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey, Table, Float 
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
    teams = relationship("Team", back_populates="trainer", cascade="all, delete-orphan")

# ---------------------------------
# 2. Team (Mannschaft) Modell
# ---------------------------------
class Team(Base):
    __tablename__ = "teams"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    league = Column(String)
    is_public = Column(Boolean, default=False, nullable=False) 
    trainer_id = Column(Integer, ForeignKey("trainers.id"))
    trainer = relationship("Trainer", back_populates="teams")
    players = relationship("Player", back_populates="team", cascade="all, delete-orphan") 
    games = relationship("Game", back_populates="team", cascade="all, delete-orphan") 
    custom_actions = relationship("CustomAction", back_populates="team", cascade="all, delete-orphan")


# --- Verknüpfungstabelle ---
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
    team = relationship("Team", back_populates="players")
    
    # ==================================================
    # KORRIGIERTE RELATIONSHIPS (BUGFIX)
    # ==================================================
    # Aktionen, die dieser Spieler SELBST ausgeführt hat
    actions = relationship(
        "Action", 
        foreign_keys="[Action.player_id]", 
        back_populates="player", 
        cascade="all, delete-orphan"
    )
    
    # Aktionen (Gegentore), die passiert sind, als dieser Spieler (Torwart) AKTIV war
    actions_as_goalie = relationship(
        "Action", 
        foreign_keys="[Action.active_goalie_id]", 
        back_populates="active_goalie"
    )
    # ==================================================
    
    games_participated = relationship(
        "Game",
        secondary=game_participations_table,
        back_populates="participating_players" # <--- KORREKTUR
    )

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
    team = relationship("Team", back_populates="games")
    actions = relationship("Action", back_populates="game", cascade="all, delete-orphan") 

    participating_players = relationship(
        "Player",
        secondary=game_participations_table,
        back_populates="games_participated"
    )
    
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
    
    # ==================================================
    # KORRIGIERTE FOREIGN KEYS (BUGFIX)
    # ==================================================
    player_id = Column(Integer, ForeignKey("players.id"), nullable=True) 
    active_goalie_id = Column(Integer, ForeignKey("players.id"), nullable=True)
    
    # Beziehung zum Spieler, der die Aktion ausgeführt hat
    player = relationship(
        "Player", 
        foreign_keys=[player_id], 
        back_populates="actions"
    )
    
    # Beziehung zum Torwart, der während der Aktion aktiv war
    active_goalie = relationship(
        "Player", 
        foreign_keys=[active_goalie_id], 
        back_populates="actions_as_goalie"
    )
    # ==================================================
    
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


# Initialisierungsfunktion
def init_db():
    Base.metadata.create_all(bind=engine)

