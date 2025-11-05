# DATEI: backend/time_tracking.py
# NEUE DATEI ZUM ENTSCHLACKEN (auf Wunsch des Benutzers)
# Enthält die gesamte Logik zur Berechnung der Spielzeit (Time on Court)
# Löst den "H2 00:00"-Bug durch eine "Halftime-Boundary"-Methode

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
        # WICHTIG: Kein 'half'-Tag mehr, da dies den Bug verursacht hat

def get_halftime_boundary(db: Session, game_id: int) -> Optional[datetime]:
    """
    Findet den genauen Zeitstempel der ersten Aktion in H2.
    Dies dient als "Trennlinie" (Boundary).
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
    clock_action_types = ['GAME_START', 'GAME_PAUSE']
    
    query = db.query(Action.action_type, Action.server_timestamp).filter(
        Action.game_id == game_id,
        Action.action_type.in_(clock_action_types)
    )
        
    clock_actions = query.order_by(Action.server_timestamp.asc()).all()
    
    start_time = None
    for action_type, timestamp in clock_actions:
        if timestamp is None: continue
        if action_type == 'GAME_START':
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

def calculate_all_player_times(
    db: Session, 
    game_id: int, 
    player_ids: List[int],
    half: str
) -> Dict[int, int]:
    """
    Dies ist die KERNFUNKTION, die von action.py aufgerufen wird.
    Sie berechnet die Zeit für alle Spieler und respektiert den H1/H2-Filter.
    """
    
    # 1. Lade alle Intervalle für das gesamte Spiel
    clock_intervals = get_clock_intervals(db, game_id)
    all_player_intervals = get_player_intervals(db, game_id)
    
    # 2. Finde die H1/H2-Trennlinie
    halftime_boundary = get_halftime_boundary(db, game_id)
    
    # 3. Definiere das Zeitfenster (Boundary) für die Berechnung
    game_start_time = clock_intervals[0].start if clock_intervals else datetime.utcnow()
    game_end_time = datetime.utcnow()
    
    boundary: Optional[tuple[datetime, datetime]] = None
    
    if half == 'H1':
        # H1 ist vom Spielstart bis zur H2-Trennlinie (oder bis jetzt, falls H2 nie gestartet wurde)
        boundary_end = halftime_boundary if halftime_boundary else game_end_time
        boundary = (game_start_time, boundary_end)
    elif half == 'H2':
        # H2 ist von der Trennlinie bis jetzt
        if halftime_boundary:
            boundary = (halftime_boundary, game_end_time)
        else:
            # Wenn H2 nie gestartet wurde, ist die Zeit für H2 = 0
            return {player_id: 0 for player_id in player_ids}
    # else: 'ALL' -> boundary bleibt None (keine Einschränkung)

    
    # 4. Berechne die Zeit für jeden Spieler
    player_times_seconds: Dict[int, int] = {}
    
    for player_id in player_ids:
        total_seconds = 0
        player_intervals = all_player_intervals.get(player_id, [])
        
        if not clock_intervals or not player_intervals:
            player_times_seconds[player_id] = 0
            continue

        for p_interval in player_intervals:
            for c_interval in clock_intervals:
                
                # Finde die Überschneidung von Spieler-auf-Feld und Uhr-läuft
                overlap_start = max(p_interval.start, c_interval.start)
                overlap_end = min(p_interval.end, c_interval.end)
                
                if overlap_start < overlap_end:
                    
                    # JETZT: Wende den H1/H2-Filter (boundary) an
                    if boundary:
                        final_start = max(overlap_start, boundary[0])
                        final_end = min(overlap_end, boundary[1])
                    else:
                        # (half == 'ALL')
                        final_start = overlap_start
                        final_end = overlap_end
                        
                    if final_start < final_end:
                        duration = final_end - final_start
                        total_seconds += duration.total_seconds()
                        
        player_times_seconds[player_id] = int(total_seconds)
            
    return player_times_seconds