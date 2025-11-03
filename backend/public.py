# DATEI: backend/public.py
# Enthält alle öffentlichen Endpunkte für das Liga-Scouting.
# NEU: Beinhaltet jetzt die Endpunkte für die öffentlichen Wurfbilder.

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
# KORREKTUR: 'distinct' wurde hier hinzugefügt
from sqlalchemy import func, case, and_, distinct
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import re

from backend.database import SessionLocal, Trainer, Team, Player, Game, Action, CustomAction, game_participations_table
# Wichtig: Wir importieren die Pydantic-Modelle aus action.py, um Redundanz zu vermeiden
from backend.action import PlayerStats, OpponentStats, ShotData, ShotDataResponse

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Pydantic Modelle ---

class PublicTeam(BaseModel):
    id: int
    name: str
    class Config: from_attributes = True

class PublicStatsResponse(BaseModel):
    player_stats: List[PlayerStats]
    opponent_stats: OpponentStats

# --- Endpunkte ---

@router.get("/leagues", response_model=List[str])
def get_public_leagues(db: Session = Depends(get_db)):
    """ Liefert eine Liste aller einzigartigen Ligen von öffentlichen Teams. """
    leagues = db.query(distinct(Team.league)).filter(Team.is_public == True).all()
    return [league[0] for league in leagues if league[0]]

@router.get("/teams/{league_name}", response_model=List[PublicTeam])
def get_public_teams_by_league(league_name: str, db: Session = Depends(get_db)):
    """ Liefert alle öffentlichen Teams für eine bestimmte Liga. """
    teams = db.query(Team).filter(
        Team.league == league_name,
        Team.is_public == True
    ).all()
    return teams

@router.get("/stats/season/{team_id}", response_model=PublicStatsResponse)
def get_public_season_stats(team_id: int, db: Session = Depends(get_db)):
    """ 
    Liefert die aggregierten Saison-Statistiken (Spieler + Gegner) 
    für ein einzelnes öffentliches Team.
    """
    team = db.query(Team).filter(Team.id == team_id, Team.is_public == True).first()
    if not team:
        raise HTTPException(status_code=404, detail="Öffentliches Team nicht gefunden.")

    # --- Spieler-Statistik (Kopiert und angepasst aus action.py) ---
    saison_games_ids = [g[0] for g in db.query(Game.id).filter(
        Game.team_id == team_id, Game.game_category == 'Saison'
    ).all()]
    
    player_stats_list = []
    if saison_games_ids:
        games_played_count = db.query(
            game_participations_table.c.player_id,
            func.count(game_participations_table.c.game_id).label('games_played')
        ).filter(
            game_participations_table.c.game_id.in_(saison_games_ids)
        ).group_by(game_participations_table.c.player_id).subquery()

        custom_actions = db.query(CustomAction).filter(CustomAction.team_id == team.id).all()
        custom_action_names = [ca.name for ca in custom_actions]
        
        case_statements = [
            func.count(case((Action.action_type == 'Goal', 1), else_=None)).label('goals'),
            func.count(case((Action.action_type == 'Miss', 1), else_=None)).label('misses'),
            func.count(case((Action.action_type.in_(['TechError', 'Fehlpass']), 1), else_=None)).label('tech_errors'),
            func.count(case((Action.action_type == 'Fehlpass', 1), else_=None)).label('fehlpaesse'),
            func.count(case((Action.action_type == 'Goal_7m', 1), else_=None)).label('seven_meter_goals'),
            func.count(case((Action.action_type == 'Miss_7m', 1), else_=None)).label('seven_meter_misses'),
            func.count(case((Action.action_type == 'SEVEN_METER_CAUSED', 1), else_=None)).label('seven_meter_caused'),
            func.count(case((Action.action_type == 'Save', 1), else_=None)).label('saves'),
            func.count(case((Action.action_type == 'SEVEN_METER_SAVE', 1), else_=None)).label('seven_meter_saves'),
            func.count(case((Action.action_type == 'SEVEN_METER_RECEIVED', 1), else_=None)).label('seven_meter_received'),
            func.count(case(
                (and_(Action.action_type == 'OppGoal', Action.active_goalie_id == Player.id), 1),
                else_=None
            )).label('opponent_goals_received')
        ]
        
        safe_custom_labels = {}
        for name in custom_action_names:
            safe_label = f"custom_{re.sub(r'[^A-Za-z0-9_]', '_', name)}"
            safe_custom_labels[name] = safe_label
            case_statements.append(
                func.count(case((Action.action_type == name, 1), else_=None)).label(safe_label)
            )
        
        # ==================================================
        # KORREKTUR HIER: Die Query-Struktur wurde repariert
        # (entspricht jetzt der aus action.py)
        # ==================================================
        stats_query = db.query(
            Player.id, Player.name, Player.number, Player.position,
            func.coalesce(games_played_count.c.games_played, 0).label('games_played'),
            *case_statements 
        ).select_from(Player)\
        .outerjoin(games_played_count, Player.id == games_played_count.c.player_id)\
        .outerjoin(Action, 
            and_(
                (Action.player_id == Player.id) | (Action.active_goalie_id == Player.id),
                Action.game_id.in_(saison_games_ids)
            )
        )\
        .filter(Player.team_id == team.id)\
        .group_by(Player.id, Player.name, Player.number, Player.position, games_played_count.c.games_played)\
        .order_by(Player.number.asc())
        # ==================================================
        # ENDE DER KORREKTUR
        # ==================================================
        
        stats_results = stats_query.all()
        for row in stats_results:
            row_data = row._asdict()
            custom_counts_dict = {name: row_data.get(safe_label, 0) for name, safe_label in safe_custom_labels.items()}
            player_stats_list.append(PlayerStats(
                player_id=row_data.get('id'), player_name=row_data.get('name'),
                player_number=row_data.get('number'), position=row_data.get('position'),
                games_played=row_data.get('games_played', 0), 
                goals=row_data.get('goals', 0),
                misses=row_data.get('misses', 0),
                tech_errors=row_data.get('tech_errors', 0),
                fehlpaesse=row_data.get('fehlpaesse', 0),
                seven_meter_goals=row_data.get('seven_meter_goals', 0),
                seven_meter_misses=row_data.get('seven_meter_misses', 0),
                seven_meter_caused=row_data.get('seven_meter_caused', 0),
                seven_meter_saves=row_data.get('seven_meter_saves', 0),
                seven_meter_received=row_data.get('seven_meter_received', 0),
                saves=row_data.get('saves', 0),
                opponent_goals_received=row_data.get('opponent_goals_received', 0),
                custom_counts=custom_counts_dict
            ))
    else:
        # Fallback, wenn keine Spiele vorhanden sind
        players = db.query(Player).filter(Player.team_id == team_id).all()
        player_stats_list = [PlayerStats(
            player_id=p.id, player_name=p.name, player_number=p.number, position=p.position,
            games_played=0, goals=0, misses=0, tech_errors=0, fehlpaesse=0,
            seven_meter_goals=0, seven_meter_misses=0, seven_meter_caused=0, 
            seven_meter_saves=0, seven_meter_received=0, saves=0, 
            opponent_goals_received=0, custom_counts={}
        ) for p in players]

    # --- Gegner-Statistik (Kopiert und angepasst aus action.py) ---
    saison_games_subquery = db.query(Game.id).filter(
        Game.team_id == team_id, Game.game_category == 'Saison'
    ).subquery()

    opp_stats_query = db.query(
        func.count(case((Action.action_type == 'OppGoal', 1), else_=None)).label('opponent_goals'),
        func.count(case((and_(Action.action_type == 'OppMiss', Action.player_id.is_(None)), 1), else_=None)).label('opponent_misses'),
        func.count(case((and_(Action.action_type == 'OppTechError', Action.player_id.is_(None)), 1), else_=None)).label('opponent_tech_errors')
    ).filter(Action.game_id.in_(saison_games_subquery))
    opp_stats_result = opp_stats_query.first()
    
    if not opp_stats_result:
        opponent_stats_obj = OpponentStats(opponent_goals=0, opponent_misses=0, opponent_tech_errors=0)
    else:
        opponent_stats_obj = OpponentStats(
            opponent_goals=opp_stats_result.opponent_goals,
            opponent_misses=opp_stats_result.opponent_misses,
            opponent_tech_errors=opp_stats_result.opponent_tech_errors
        )

    return PublicStatsResponse(
        player_stats=player_stats_list,
        opponent_stats=opponent_stats_obj
    )


# ==================================================
# NEU: Endpunkt für öffentliches Spieler-Wurfbild
# ==================================================
@router.get("/shots/season/{team_id}", response_model=List[ShotDataResponse])
def get_public_season_shot_charts(team_id: int, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.id == team_id, Team.is_public == True).first()
    if not team:
        raise HTTPException(status_code=404, detail="Öffentliches Team nicht gefunden.")
        
    saison_games_ids = [g[0] for g in db.query(Game.id).filter(
        Game.team_id == team_id, Game.game_category == 'Saison'
    ).all()]
    if not saison_games_ids: return [] 
    
    shot_action_types = ['Goal', 'Miss', 'Goal_7m', 'Miss_7m']
    shots_query = db.query(
        Action.player_id, Action.action_type,
        Action.x_coordinate, Action.y_coordinate,
        Player.name, Player.number
    ).join(Player, Player.id == Action.player_id)\
    .filter(
        Action.game_id.in_(saison_games_ids),
        Action.action_type.in_(shot_action_types),
        Action.x_coordinate.isnot(None),
        Action.y_coordinate.isnot(None)
    ).all()
    
    player_shots: Dict[int, Dict[str, Any]] = {}
    for shot in shots_query:
        if shot.player_id not in player_shots:
            player_shots[shot.player_id] = {
                "player_id": shot.player_id,
                "player_name": shot.name or "Unbekannt",
                "player_number": shot.number, "shots": []
            }
        player_shots[shot.player_id]["shots"].append(ShotData(
            action_type=shot.action_type,
            x_coordinate=shot.x_coordinate,
            y_coordinate=shot.y_coordinate
        ))
    return list(player_shots.values())

# ==================================================
# NEU: Endpunkt für öffentliches Spieler-Fehlerbild
# ==================================================
@router.get("/stats/errors/season/{team_id}", response_model=List[ShotDataResponse])
def get_public_season_error_charts(team_id: int, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.id == team_id, Team.is_public == True).first()
    if not team:
        raise HTTPException(status_code=404, detail="Öffentliches Team nicht gefunden.")
        
    saison_games_ids = [g[0] for g in db.query(Game.id).filter(
        Game.team_id == team_id, Game.game_category == 'Saison'
    ).all()]
    if not saison_games_ids: return [] 
    
    error_action_types = ['TechError', 'Fehlpass']
    errors_query = db.query(
        Action.player_id, Action.action_type,
        Action.x_coordinate, Action.y_coordinate,
        Player.name, Player.number
    ).join(Player, Player.id == Action.player_id)\
    .filter(
        Action.game_id.in_(saison_games_ids),
        Action.action_type.in_(error_action_types),
        Action.x_coordinate.isnot(None),
        Action.y_coordinate.isnot(None)
    ).all()
    
    player_errors: Dict[int, Dict[str, Any]] = {}
    for error in errors_query:
        if error.player_id not in player_errors:
            player_errors[error.player_id] = {
                "player_id": error.player_id,
                "player_name": error.name or "Unbekannt",
                "player_number": error.number, "shots": []
            }
        player_errors[error.player_id]["shots"].append(ShotData(
            action_type=error.action_type,
            x_coordinate=error.x_coordinate,
            y_coordinate=error.y_coordinate
        ))
    return list(player_errors.values())

# ==================================================
# NEU: Endpunkt für öffentliches Gegner-Wurfbild
# ==================================================
@router.get("/shots/opponent/season/{team_id}", response_model=List[ShotData])
def get_public_season_opponent_shot_charts(team_id: int, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.id == team_id, Team.is_public == True).first()
    if not team:
        raise HTTPException(status_code=404, detail="Öffentliches Team nicht gefunden.")
        
    saison_games_ids = [g[0] for g in db.query(Game.id).filter(
        Game.team_id == team_id, Game.game_category == 'Saison'
    ).all()]
    
    if not saison_games_ids: return [] 

    shot_action_types = ['OppGoal', 'OppMiss']
    shots_query = db.query(
        Action.action_type,
        Action.x_coordinate,
        Action.y_coordinate
    ).filter(
        Action.game_id.in_(saison_games_ids),
        Action.action_type.in_(shot_action_types),
        Action.x_coordinate.isnot(None),
        Action.y_coordinate.isnot(None)
    ).all()

    response_list = []
    for shot in shots_query:
        response_list.append(ShotData(
            action_type=shot.action_type,
            x_coordinate=shot.x_coordinate,
            y_coordinate=shot.y_coordinate
        ))
    
    return response_list

