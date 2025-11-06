# DATEI: backend/time_tracking.py
# NEUE DATEI: Entschlackt und stellt die Kernfunktionen zur Verfügung.

from sqlalchemy.orm import Session
from sqlalchemy import func, case, and_, distinct
from datetime import datetime
from typing import List, Optional, Dict, Any

# Importiere nur die nötigen DB-Modelle
from backend.database import Action

def format_seconds(seconds: int) -> str:
    """ Formatiert Sekunden in MM:SS String. """
    if seconds < 0:
        return "N/A"
    minutes = int(seconds // 60)
    remaining_seconds = int(seconds % 60)
    return f"{minutes:02d}:{remaining_seconds:02d}"

class Interval:
    """Einfache Hilfsklasse für Zeit-Intervalle."""
    def __init__(self, start: datetime, end: datetime):
        self.start = start
        self.end = end

def get_halftime_boundary(db: Session, game_id: int) -> Optional[datetime]:
    """
    Findet den genauen Zeitstempel der ersten Aktion in H2.
    """
    first_h2_action = db.query(Action.server_timestamp).filter(
        Action.game_id == game_id,
        Action.time_in_game == 'H2'
    ).order_by(Action.server_timestamp.asc()).first()
    
    return first_h2_action[0] if first_h2_action else None

def get_clock_intervals(db: Session, game_id: int) -> List[Interval]:
    """ 
    Ermittelt ALLE Zeit-Intervalle, in denen die Spieluhr lief.
    """
    clock_intervals = []
    clock_action_types = ['GAME_START', 'GAME_PAUSE', 'GAME_RESUME']
    
    query = db.query(Action.action_type, Action.server_timestamp).filter(
        Action.game_id == game_id,
        Action.action_type.in_(clock_action_types)
    )
        
    clock_actions = query.order_by(Action.server_timestamp.asc()).all()
    
    start_time = None
    for action_type, timestamp in clock_actions:
        if timestamp is None: continue
        
        if action_type == 'GAME_START' or action_type == 'GAME_RESUME':
            if start_time is None:
                start_time = timestamp
        elif action_type == 'GAME_PAUSE':
            if start_time is not None:
                clock_intervals.append(Interval(start=start_time, end=timestamp))
                start_time = None
                
    if start_time is not None:
        clock_intervals.append(Interval(start=start_time, end=datetime.utcnow()))
        
    return clock_intervals

def get_player_intervals(db: Session, game_id: int) -> Dict[int, List[Interval]]:
    """ 
    Ermittelt ALLE Zeit-Intervalle für ALLE Spieler, in denen sie auf dem Feld waren.
    """
    player_intervals_map: Dict[int, List[Interval]] = {}
    
    query = db.query(Action.action_type, Action.server_timestamp, Action.player_id).filter(
        Action.game_id == game_id,
        Action.player_id.isnot(None),
        Action.action_type.in_(['SubIn', 'SubOut'])
    )
        
    player_actions = query.order_by(Action.server_timestamp.asc()).all()
    
    in_time_map: Dict[int, datetime] = {}

    for action_type, timestamp, player_id in player_actions:
        if timestamp is None: continue
        if player_id not in player_intervals_map:
            player_intervals_map[player_id] = []
            
        if action_type == 'SubIn':
            if player_id not in in_time_map:
                in_time_map[player_id] = timestamp
        elif action_type == 'SubOut':
            if player_id in in_time_map:
                in_time = in_time_map[player_id]
                player_intervals_map[player_id].append(Interval(start=in_time, end=timestamp))
                del in_time_map[player_id]
                
    for player_id, in_time in in_time_map.items():
        if player_id not in player_intervals_map:
             player_intervals_map[player_id] = []
        player_intervals_map[player_id].append(Interval(start=in_time, end=datetime.utcnow()))
        
    return player_intervals_map

def calculate_time_on_court(
    all_player_intervals: Dict[int, List[Interval]],
    clock_intervals: List[Interval],
    halftime_boundary: Optional[datetime],
    half: str
) -> Dict[int, int]:
    """
    Berechnet die Spielzeit für jeden Spieler basierend auf Takt-Intervallen und dem H1/H2-Filter.
    Wird von action.py und stats_service.py verwendet.
    """
    player_times_seconds: Dict[int, int] = {}
    
    if not clock_intervals:
        return {player_id: 0 for player_id in all_player_intervals.keys()}
        
    game_start_time = clock_intervals[0].start
    game_end_time = datetime.utcnow() 
    
    boundary: Optional[tuple[datetime, datetime]] = None
    
    if half == 'H1':
        boundary_end = halftime_boundary if halftime_boundary else game_end_time
        boundary = (game_start_time, boundary_end)
    elif half == 'H2':
        if halftime_boundary:
            boundary = (halftime_boundary, game_end_time)
        else:
            return {player_id: 0 for player_id in all_player_intervals.keys()}
    
    for player_id, player_intervals in all_player_intervals.items():
        total_seconds = 0
        
        for p_interval in player_intervals:
            for c_interval in clock_intervals:
                
                overlap_start = max(p_interval.start, c_interval.start)
                overlap_end = min(p_interval.end, c_interval.end)
                
                if overlap_start < overlap_end:
                    
                    if boundary:
                        final_start = max(overlap_start, boundary[0])
                        final_end = min(overlap_end, boundary[1])
                    else:
                        final_start = overlap_start
                        final_end = overlap_end
                        
                    if final_start < final_end:
                        duration = final_end - final_start
                        total_seconds += duration.total_seconds()
                        
        player_times_seconds[player_id] = int(total_seconds)
            
    return player_times_seconds

def calculate_all_player_times(
    db: Session, 
    game_id: int, 
    player_ids: List[int],
    half: str
) -> Dict[int, int]:
    """
    Führt den gesamten Ablauf für ein EINZELNES Spiel aus (für Live-Statistiken).
    """
    clock_intervals = get_clock_intervals(db, game_id)
    all_player_intervals = get_player_intervals(db, game_id)
    halftime_boundary = get_halftime_boundary(db, game_id)
    
    results = calculate_time_on_court(all_player_intervals, clock_intervals, halftime_boundary, half)
    
    return {pid: results.get(pid, 0) for pid in player_ids}