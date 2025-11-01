# DATEI: backend/public.py
# (KEINE ÄNDERUNGEN NÖTIG - Nutzt keine Authentifizierung)

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, case, distinct
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import urllib.parse 
import re

from backend.database import (
    SessionLocal, Team, Player, Game, Action, 
    CustomAction, game_participations_table, Trainer
)
# Importiere Pydantic-Modelle direkt
from backend.action import PlayerStats, OpponentStats 

router = APIRouter()

# -----------------------------
# Pydantic Modelle für Öffentliche Daten
# -----------------------------

class PublicTeamResponse(BaseModel):
    id: int
    name: str
    league: str

    class Config:
        from_attributes = True

class PublicSeasonStatsResponse(BaseModel):
    player_stats: List[PlayerStats]
    opponent_stats: OpponentStats 

# Datenbanksession (unabhängig von auth)
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# -----------------------------
# Öffentliche Endpunkte (Kein Token erforderlich)
# -----------------------------

@router.get("/leagues", response_model=List[str])
def get_public_leagues(db: Session = Depends(get_db)):
    leagues_query = db.query(distinct(Team.league)).filter(
        Team.is_public == True
    ).all()
    
    leagues = [league[0] for league in leagues_query]
    return leagues

@router.get("/teams/{league_name}", response_model=List[PublicTeamResponse])
def get_public_teams_by_league(league_name: str, db: Session = Depends(get_db)):
    decoded_league_name = urllib.parse.unquote(league_name)
    
    results = db.query(
        Team.id,
        Team.name,
        Team.league
    ).filter(
        Team.league == decoded_league_name,
        Team.is_public == True
    ).all()
    
    response_teams = []
    for team_id, team_name, team_league in results:
        response_teams.append(PublicTeamResponse(
            id=team_id,
            name=team_name,
            league=team_league
        ))
    
    return response_teams


@router.get("/stats/season/{team_id}", response_model=PublicSeasonStatsResponse)
def get_public_season_stats(team_id: int, db: Session = Depends(get_db)):
    team = db.query(Team).filter(
        Team.id == team_id,
        Team.is_public == True
    ).first()
    
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung oder Team nicht öffentlich.")
        
    # --- Spieler-Statistiken (Logik wie in action.py) ---
    saison_games_query = db.query(Game.id).filter(
        Game.team_id == team_id,
        Game.game_category == 'Saison'
    )
    saison_games_ids = [g[0] for g in saison_games_query.all()]
    
    player_stats_list: List[PlayerStats] = []
    
    if not saison_games_ids:
        players = db.query(Player).filter(Player.team_id == team_id).all()
        for p in players:
            player_stats_list.append(PlayerStats(
                player_id=p.id, player_name=p.name, player_number=p.number, position=p.position,
                games_played=0, goals=0, misses=0, tech_errors=0, seven_meter_goals=0,
                seven_meter_misses=0, seven_meter_caused=0, seven_meter_saves=0,
                seven_meter_received=0, saves=0, opponent_goals_received=0, custom_counts={}
            ))
    else:
        games_played_count = db.query(
            game_participations_table.c.player_id,
            func.count(game_participations_table.c.game_id).label('games_played')
        ).filter(
            game_participations_table.c.game_id.in_(saison_games_ids)
        ).group_by(
            game_participations_table.c.player_id
        ).subquery()

        custom_actions = db.query(CustomAction).filter(CustomAction.team_id == team.id).all()
        custom_action_names = [ca.name for ca in custom_actions]
        case_statements = [
            func.count(case((Action.action_type == 'Goal', 1), else_=None)).label('goals'),
            func.count(case((Action.action_type == 'Miss', 1), else_=None)).label('misses'),
            func.count(case((Action.action_type == 'TechError', 1), else_=None)).label('tech_errors'),
            func.count(case((Action.action_type == 'Goal_7m', 1), else_=None)).label('seven_meter_goals'),
            func.count(case((Action.action_type == 'Miss_7m', 1), else_=None)).label('seven_meter_misses'),
            func.count(case((Action.action_type == 'SEVEN_METER_CAUSED', 1), else_=None)).label('seven_meter_caused'),
            func.count(case((Action.action_type == 'SEVEN_METER_SAVE', 1), else_=None)).label('seven_meter_saves'),
            func.count(case((Action.action_type == 'SEVEN_METER_RECEIVED', 1), else_=None)).label('seven_meter_received'),
            func.count(case((Action.action_type == 'Save', 1), else_=None)).label('saves'),
            func.count(case((Action.action_type == 'OppGoal', 1), else_=None)).label('opponent_goals_received')
        ]
        
        safe_custom_labels = {}
        for name in custom_action_names:
            safe_label = f"custom_{re.sub(r'[^A-Za-z0-9_]', '_', name)}"
            safe_custom_labels[name] = safe_label
            case_statements.append(
                func.count(case((Action.action_type == name, 1), else_=None)).label(safe_label)
            )
        
        stats_query = db.query(
            Player.id, Player.name, Player.number, Player.position,
            func.coalesce(games_played_count.c.games_played, 0).label('games_played'),
            *case_statements 
        ).select_from(Player)\
        .outerjoin(games_played_count, Player.id == games_played_count.c.player_id)\
        .outerjoin(Action, 
            (Action.player_id == Player.id) & 
            (Action.game_id.in_(saison_games_ids))
        )\
        .filter(Player.team_id == team_id)\
        .group_by(
            Player.id, Player.name, Player.number, Player.position, 
            games_played_count.c.games_played
        )\
        .order_by(Player.number.asc())
        
        stats_results = stats_query.all()
        
        for row in stats_results:
            row_data = row._asdict()
            custom_counts_dict = {}
            for name, safe_label in safe_custom_labels.items():
                custom_counts_dict[name] = row_data.get(safe_label, 0)
            
            player_stats_list.append(PlayerStats(
                player_id=row_data.get('id'), player_name=row_data.get('name'),
                player_number=row_data.get('number'), position=row_data.get('position'),
                games_played=row_data.get('games_played', 0),
                goals=row_data.get('goals', 0), misses=row_data.get('misses', 0),
                tech_errors=row_data.get('tech_errors', 0),
                seven_meter_goals=row_data.get('seven_meter_goals', 0),
                seven_meter_misses=row_data.get('seven_meter_misses', 0),
                seven_meter_caused=row_data.get('seven_meter_caused', 0),
                seven_meter_saves=row_data.get('seven_meter_saves', 0),
                seven_meter_received=row_data.get('seven_meter_received', 0),
                saves=row_data.get('saves', 0),
                opponent_goals_received=row_data.get('opponent_goals_received', 0),
                custom_counts=custom_counts_dict
            ))
            
    # --- Gegner-Statistiken ---
    opponent_stats_result = OpponentStats(opponent_goals=0, opponent_misses=0, opponent_tech_errors=0)
    if saison_games_ids:
        opponent_stats_query = db.query(
            func.count(case((Action.action_type == 'OppGoal', 1), else_=None)).label('opponent_goals'),
            func.count(case((Action.action_type == 'OppMiss', 1), else_=None)).label('opponent_misses'),
            func.count(case((Action.action_type == 'OppTechError', 1), else_=None)).label('opponent_tech_errors')
        ).filter(
            Action.game_id.in_(saison_games_ids), 
            Action.player_id.is_(None) 
        )
        stats_result = opponent_stats_query.first()
        if stats_result:
            opponent_stats_result = OpponentStats(
                opponent_goals=stats_result.opponent_goals,
                opponent_misses=stats_result.opponent_misses,
                opponent_tech_errors=stats_result.opponent_tech_errors
            )
    
    return PublicSeasonStatsResponse(
        player_stats=player_stats_list,
        opponent_stats=opponent_stats_result
    )
