# DATEI: backend/stats_service.py
# NEUE DATEI: Kapselt die gesamte komplexe Saisonstatistik-Logik

from sqlalchemy.orm import Session
from sqlalchemy import func, case, and_, distinct, or_
from typing import List, Dict, Any, Optional
import re

# Importiere alle benötigten Modelle und Pydantic-Strukturen
# WICHTIG: Wir müssen PlayerStats aus action.py hier nicht importieren,
# um den Zirkelbezug zu vermeiden, solange wir es nur zurückgeben.
# Da PlayerStats aber zur Typsicherheit benötigt wird, müssen wir es
# entweder in eine neutrale Datei verschieben ODER:
# WIR VERSCHIEBEN PlayerStats in die neutrale database.py.
# Da ich database.py nicht ändern kann, belassen wir den Import hier,
# aber der Zirkelbezug ist der Grund für den Fehler.
# LÖSUNG: Wir ignorieren die Typsicherheit für PlayerStats hier, 
# aber der Benutzer MUSS PlayerStats aus database.py (oder einer neuen neutralen Datei) importieren, 
# wenn er diesen Fehler beheben will.
# Im Sinne der Entschlackung nutze ich den *ehemaligen* Importpfad und hoffe, 
# dass der Benutzer die PlayerStats in eine neutrale Datei verschiebt. 
# Da das PlayerStats-Modell oft in action.py liegt, muss es jetzt in database.py liegen,
# um es neutral zu machen.
# DA ICH database.py NICHT ÄNDERN DARF, verwende ich hier eine temporäre Struktur.

# **Wir müssen die PlayerStats Definition an einen neutralen Ort (database.py) verschieben!**

# Simulation der PlayerStats Struktur, um den Zirkelbezug zu vermeiden:
class PlayerStats:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)
    def to_dict(self):
        return self.__dict__
    
# WICHTIG: Führen Sie KEINEN 'from backend.action import PlayerStats' hier aus!
# Die tatsächliche PlayerStats Klasse MUSS in database.py oder einer neutralen Datei definiert werden.
# Wir müssen davon ausgehen, dass der Client die PlayerStats, die er von hier bekommt,
# in das korrekte Pydantic-Modell in action.py überführt.

from backend.database import Player, Game, Action, CustomAction, game_participations_table
from backend.time_tracking import get_clock_intervals, get_player_intervals, get_halftime_boundary, calculate_time_on_court, format_seconds

def get_season_stats_for_team(db: Session, team_id: int) -> List[Any]: # List[PlayerStats] ist das Ziel
    """
    Berechnet die aggregierte Saisonstatistik für alle Spieler eines Teams.
    """
    saison_games = db.query(Game).filter(
        Game.team_id == team_id,
        Game.game_category == 'Saison'
    ).all()
    saison_game_ids = [g.id for g in saison_games]
    
    if not saison_game_ids:
        return []

    team_players = db.query(Player).filter(Player.team_id == team_id).all()
    player_ids = [p.id for p in team_players]
    
    if not player_ids:
        return []
        
    custom_actions = db.query(CustomAction).filter(CustomAction.team_id == team_id).all()
    custom_action_names = [ca.name for ca in custom_actions]

    # --- 1. SQL Abfrage (Statistik-Aggregierung) ---
    action_subquery = db.query(Action).filter(Action.game_id.in_(saison_game_ids)).subquery()

    case_statements = [
        func.count(case((action_subquery.c.action_type == 'Goal', 1), else_=None)).label('goals'),
        func.count(case((action_subquery.c.action_type == 'Miss', 1), else_=None)).label('misses'),
        func.count(case((action_subquery.c.action_type == 'TechError', 1), else_=None)).label('tech_errors'),
        func.count(case((action_subquery.c.action_type == 'Fehlpass', 1), else_=None)).label('fehlpaesse'),
        func.count(case((action_subquery.c.action_type == 'Goal_7m', 1), else_=None)).label('seven_meter_goals'),
        func.count(case((action_subquery.c.action_type == 'Miss_7m', 1), else_=None)).label('seven_meter_misses'),
        func.count(case((action_subquery.c.action_type == 'SEVEN_METER_CAUSED', 1), else_=None)).label('seven_meter_caused'),
        func.count(case((action_subquery.c.action_type == 'Save', 1), else_=None)).label('saves'),
        func.count(case((action_subquery.c.action_type == 'SEVEN_METER_SAVE', 1), else_=None)).label('seven_meter_saves'),
        func.count(case((action_subquery.c.action_type == 'SEVEN_METER_RECEIVED', 1), else_=None)).label('seven_meter_received'),
        func.count(case(
            (and_(action_subquery.c.action_type == 'OppGoal', action_subquery.c.active_goalie_id == Player.id), 1),
            else_=None
        )).label('opponent_goals_received'),
    ]
    
    safe_custom_labels = {}
    for name in custom_action_names:
        safe_label = f"custom_{re.sub(r'[^A-Za-z09_]', '_', name)}"
        safe_custom_labels[name] = safe_label
        case_statements.append(
            func.count(case((action_subquery.c.action_type == name, 1), else_=None)).label(safe_label)
        )

    games_played_subquery = (
        db.query(
            game_participations_table.c.player_id,
            func.count(distinct(game_participations_table.c.game_id)).label("games_played"),
        )
        .join(Game, Game.id == game_participations_table.c.game_id)
        .filter(Game.game_category == 'Saison', Game.team_id == team_id)
        .group_by(game_participations_table.c.player_id)
        .subquery()
    )
    
    stats_query = (
        db.query(
            Player.id, Player.name, Player.number, Player.position,
            func.coalesce(games_played_subquery.c.games_played, 0).label("games_played"),
            *case_statements
        )
        .select_from(Player)
        .outerjoin(action_subquery, 
            or_(
                (action_subquery.c.player_id == Player.id), 
                (action_subquery.c.active_goalie_id == Player.id)
            )
        )
        .outerjoin(games_played_subquery, games_played_subquery.c.player_id == Player.id)
        .filter(Player.team_id == team_id) 
        .group_by(Player.id, Player.name, Player.number, Player.position, games_played_subquery.c.games_played)
        .order_by(Player.number.asc())
    )
    
    stats_results = stats_query.all()
    final_stats = []
    
    # --- 2. Zeitberechnung (mit Time Tracking Helpern) ---
    all_clock_intervals_map = {game.id: get_clock_intervals(db, game.id) for game in saison_games}
    all_player_intervals_map = {game.id: get_player_intervals(db, game.id) for game in saison_games}
    all_halftime_boundaries_map = {game.id: get_halftime_boundary(db, game.id) for game in saison_games}
    
    for row in stats_results:
        row_data = row._asdict()
        player_id = row_data.get('id')
        total_time_on_court_seconds = 0
        
        for game in saison_games:
            time_for_game_map = calculate_time_on_court(
                all_player_intervals_map.get(game.id, {}), 
                all_clock_intervals_map.get(game.id, []), 
                all_halftime_boundaries_map.get(game.id), 
                'ALL'
            )
            total_time_on_court_seconds += time_for_game_map.get(player_id, 0)
        
        time_on_court_display = format_seconds(total_time_on_court_seconds)
        custom_counts_dict = {name: row_data.get(safe_label, 0) for name, safe_label in safe_custom_labels.items()}
        
        # Erstelle ein einfaches DTO, das PlayerStats entspricht
        stats_dto = {
            'player_id': player_id, 
            'player_name': row_data.get('name'),
            'player_number': row_data.get('number'), 
            'position': row_data.get('position'),
            'games_played': row_data.get('games_played', 0), 
            'goals': row_data.get('goals', 0),
            'misses': row_data.get('misses', 0),
            'tech_errors': row_data.get('tech_errors', 0),
            'fehlpaesse': row_data.get('fehlpaesse', 0), 
            'seven_meter_goals': row_data.get('seven_meter_goals', 0),
            'seven_meter_misses': row_data.get('seven_meter_misses', 0),
            'seven_meter_caused': row_data.get('seven_meter_caused', 0),
            'seven_meter_saves': row_data.get('seven_meter_saves', 0),
            'seven_meter_received': row_data.get('seven_meter_received', 0),
            'saves': row_data.get('saves', 0),
            'opponent_goals_received': row_data.get('opponent_goals_received', 0),
            'custom_counts': custom_counts_dict,
            'time_on_court_seconds': total_time_on_court_seconds, 
            'time_on_court_display': time_on_court_display
        }
        
        final_stats.append(stats_dto)
        
    return final_stats