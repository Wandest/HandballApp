# DATEI: backend/dashboard_service.py
# +++ NEU: Integriert ACWR-Aggregation für das gesamte Team +++

from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from typing import List, Dict, Any
from datetime import datetime, timedelta, date

from backend.database import (
    Player, TeamEvent, Attendance, PlayerAbsence, 
    AttendanceStatus, EventStatus
)
# WICHTIG: Import des ACWR-Einzelservices
from backend.acwr_service import get_player_acwr

# Definieren der Status-Prioritäten für Verfügbarkeit
STATUS_PRIORITY = {
    "DECLINED": 3,    # Rot (Höchste Priorität)
    "TENTATIVE": 2,   # Gelb
    "NOT_RESPONDED": 1, # Grau
    "ATTENDING": 0     # Grün (Niedrigste Priorität)
}

class PlayerAvailability(object):
    """ Helferklasse zur Aggregierung des Verfügbarkeits-Status. """
    def __init__(self, player: Player):
        self.player_id = player.id
        self.player_name = player.name
        self.player_number = player.number
        self.status = "ATTENDING" 
        self.reason = ""

    def update_status(self, new_status: str, reason: str = ""):
        current_priority = STATUS_PRIORITY.get(self.status, 0)
        new_priority = 0
        
        if new_status == AttendanceStatus.DECLINED.name:
            new_priority = STATUS_PRIORITY["DECLINED"]
            self.reason = reason or "Abgesagt"
        elif new_status == AttendanceStatus.TENTATIVE.name:
            new_priority = STATUS_PRIORITY["TENTATIVE"]
            self.reason = reason or "Vielleicht"
        elif new_status == AttendanceStatus.NOT_RESPONDED.name:
            new_priority = STATUS_PRIORITY["NOT_RESPONDED"]
            self.reason = "Keine Rückmeldung"
        elif new_status not in [e.name for e in AttendanceStatus]:
            # Dies ist ein Grund aus PlayerAbsence (z.B. "Krankheit")
            new_priority = STATUS_PRIORITY["DECLINED"]
            self.reason = new_status 
        
        if new_priority > current_priority:
            self.status = new_status
            if new_priority == STATUS_PRIORITY["TENTATIVE"]: self.status = "TENTATIVE"
            elif new_priority == STATUS_PRIORITY["NOT_RESPONDED"]: self.status = "NOT_RESPONDED"
            elif new_priority == STATUS_PRIORITY["DECLINED"]: self.status = "DECLINED"

def get_team_availability(db: Session, team_id: int) -> List[Dict]:
    """ Aggregiert den Verfügbarkeitsstatus für die nächsten 7 Tage. """
    players = db.query(Player).filter(Player.team_id == team_id).all()
    if not players: return []
    availability_map = {p.id: PlayerAvailability(p) for p in players}
    today_start = datetime.combine(date.today(), datetime.min.time())
    seven_days_end = datetime.combine(today_start + timedelta(days=7), datetime.max.time())

    relevant_events = db.query(TeamEvent).filter(
        TeamEvent.team_id == team_id,
        TeamEvent.start_time >= today_start,
        TeamEvent.start_time <= seven_days_end,
        TeamEvent.status == EventStatus.PLANNED
    ).all()
    relevant_event_ids = [e.id for e in relevant_events]

    absences = db.query(PlayerAbsence).filter(
        PlayerAbsence.player_id.in_(availability_map.keys()),
        PlayerAbsence.start_date <= seven_days_end,
        (PlayerAbsence.end_date >= today_start) | (PlayerAbsence.end_date == None)
    ).all()
    
    attendances = db.query(Attendance).filter(
        Attendance.player_id.in_(availability_map.keys()),
        Attendance.event_id.in_(relevant_event_ids)
    ).all()
    
    for absence in absences:
        if absence.player_id in availability_map:
            availability_map[absence.player_id].update_status(absence.reason.value, absence.reason.value) 

    for att in attendances:
        if att.player_id in availability_map:
            availability_map[att.player_id].update_status(att.status.name, att.reason)
            
    result_list = [
        {
            "player_id": pa.player_id,
            "player_name": pa.player_name,
            "player_number": pa.player_number,
            "status": pa.status, 
            "reason": pa.reason
        }
        for pa in availability_map.values()
    ]
    result_list.sort(key=lambda x: (x['player_number'] is None, x['player_number']))
    return result_list

# +++ NEUE FUNKTION +++
def get_team_acwr_status(db: Session, team_id: int) -> List[Dict]:
    """
    Ermittelt den ACWR-Status für alle Spieler eines Teams und gibt eine Liste
    der Spieler zurück, sortiert nach Risiko (höchstes Risiko zuerst).
    """
    players = db.query(Player).filter(Player.team_id == team_id).all()
    acwr_results = []
    
    for player in players:
        acwr_data = get_player_acwr(db, player.id)
        # Wir fügen nur Spieler hinzu, die überhaupt Daten haben (Ratio > 0)
        # oder die als Hochrisiko eingestuft sind (z.B. durch extreme akute Belastung)
        if acwr_data['acwr_ratio'] > 0 or acwr_data['is_high_risk']:
            acwr_results.append({
                "player_id": player.id,
                "player_name": player.name,
                "player_number": player.number,
                "acwr_ratio": acwr_data['acwr_ratio'],
                "risk_level": acwr_data['risk_level'], # 0=Grau, 1=Grün, 2=Gelb, 3=Rot
                "status_text": acwr_data['status_text']
            })
            
    # Sortieren: Höchstes Risiko-Level zuerst, dann höchstes Ratio
    acwr_results.sort(key=lambda x: (x['risk_level'], x['acwr_ratio']), reverse=True)
    
    return acwr_results