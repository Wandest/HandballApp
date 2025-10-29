from sqlalchemy import create_engine, Column, Integer, String, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker
# ----------------------------
# Datenbank-Verbindung & Basis
# ----------------------------
DATABASE_URL = "sqlite:///handball.db" 

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ----------------------------
# Tabellen-Definitionen
# ----------------------------
class Trainer(Base):
    __tablename__ = "trainers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    password = Column(String, nullable=False)
    is_verified = Column(Boolean, default=False)
    verification_token = Column(String, nullable=True) 

    teams = relationship("Team", back_populates="trainer")

class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    league = Column(String, nullable=False)
    trainer_id = Column(Integer, ForeignKey("trainers.id"))

    trainer = relationship("Trainer", back_populates="teams")
    players = relationship("Player", back_populates="team")

class Player(Base):
    __tablename__ = "players"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    number = Column(Integer)
    position = Column(String)  # z. B. "Torwart" oder "Feldspieler"
    team_id = Column(Integer, ForeignKey("teams.id"))

    team = relationship("Team", back_populates="players")

# ----------------------------
# Datenbank erstellen (falls noch nicht vorhanden)
# ----------------------------
def init_db():
    Base.metadata.create_all(bind=engine)