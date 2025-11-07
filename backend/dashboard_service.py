# DATEI: backend/dashboard_service.py
# NEUE DATEI: Service zur Berechnung des aggregierten Spieler-Status (Phase 12 Ampel)

from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from typing import List, Dict
from datetime import datetime, timedelta, date

from backend.database import (
    Player, TeamEvent, Attendance, PlayerAbsence, 
    AttendanceStatus, EventStatus
)

# Definieren der Status-Prioritäten
# Ein Spieler, der einmal "Abgesagt" hat, ist ROT, 
# selbst wenn er bei einem anderen Termin "Zugesagt" hat.
STATUS_PRIORITY = {
    "DECLINED": 3,    # Rot (Höchste Priorität)
    "TENTATIVE": 2,   # Gelb
    "NOT_RESPONDED": 1, # Grau
    "ATTENDING": 0     # Grün (Niedrigste Priorität)
}

class PlayerAvailability(object):
    """
    Interne Helferklasse zur Aggregierung des Status.
    """
    def __init__(self, player: Player):
        self.player_id = player.id
        self.player_name = player.name
        self.player_number = player.number
        self.status = "ATTENDING" # Standard: Grün (Verfügbar)
        self.reason = ""

    def update_status(self, new_status: str, reason: str = ""):
        # Wandle Enum-Namen (z.B. AttendanceStatus.DECLINED.name) 
        # oder Enum-Werte (z.B. AbsenceReason.ILLNESS.value) in Status um
        
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
            
        # Prüfen, ob die Abwesenheit einen Grund liefert (z.B. "Krankheit")
        elif new_status not in [e.name for e in AttendanceStatus]:
            # Dies ist ein Grund aus PlayerAbsence (z.B. "Krankheit")
            new_priority = STATUS_PRIORITY["DECLINED"]
            self.reason = new_status # z.B. "Krankheit"

        
        if new_priority > current_priority:
            self.status = new_status
            # Überschreibe den Status mit DECLINED, wenn es ein TENTATIVE oder NOT_RESPONDED war
            if new_priority == STATUS_PRIORITY["TENTATIVE"]:
                self.status = "TENTATIVE"
            elif new_priority == STATUS_PRIORITY["NOT_RESPONDED"]:
                self.status = "NOT_RESPONDED"
            elif new_priority == STATUS_PRIORITY["DECLINED"]:
                 self.status = "DECLINED"


def get_team_availability(db: Session, team_id: int) -> List[Dict]:
    """
    Aggregiert den Verfügbarkeitsstatus für alle Spieler eines Teams 
    für die nächsten 7 Tage.
    """
    
    # 1. Spieler des Teams holen und Status-Map initialisieren
    players = db.query(Player).filter(Player.team_id == team_id).all()
    if not players:
        return []
        
    availability_map: Dict[int, PlayerAvailability] = {
        p.id: PlayerAvailability(p) for p in players
    }
    
    # 2. Zeitraum definieren (Heute 00:00 bis 7 Tage 23:59)
    today_start = datetime.combine(date.today(), datetime.min.time())
    seven_days_end = datetime.combine(today_start + timedelta(days=7), datetime.max.time())

    # 3. Alle relevanten Termine in diesem Zeitraum finden
    relevant_events = db.query(TeamEvent).filter(
        TeamEvent.team_id == team_id,
        TeamEvent.start_time >= today_start,
        TeamEvent.start_time <= seven_days_end,
        TeamEvent.status == EventStatus.PLANNED # Ignoriere abgesagte Termine
    ).all()
    
    relevant_event_ids = [e.id for e in relevant_events]

    # 4. Alle Abwesenheiten (Krank, Urlaub) in diesem Zeitraum finden
    absences = db.query(PlayerAbsence).filter(
        PlayerAbsence.player_id.in_(availability_map.keys()),
        # Überlappungslogik:
        # Die Abwesenheit beginnt vor dem Ende unseres Zeitraums
        PlayerAbsence.start_date <= seven_days_end,
        # Und die Abwesenheit endet nach Beginn unseres Zeitraums (oder endet nie)
        (PlayerAbsence.end_date >= today_start) | (PlayerAbsence.end_date == None)
    ).all()
    
    # 5. Alle Anwesenheits-Antworten für die relevanten Termine finden
    attendances = db.query(Attendance).filter(
        Attendance.player_id.in_(availability_map.keys()),
        Attendance.event_id.in_(relevant_event_ids)
    ).all()
    
    # 6. Logik: Status für jeden Spieler aggregieren
    
    # Zuerst die härtesten Gründe (Krank, Urlaub) eintragen
    for absence in absences:
        if absence.player_id in availability_map:
            # .reason.value (z.B. "Krankheit")
            availability_map[absence.player_id].update_status(absence.reason.value, absence.reason.value) 

    # Dann die Event-Antworten (überschreiben nur, wenn Priorität höher)
    for att in attendances:
        if att.player_id in availability_map:
            # .status.name (z.B. "DECLINED")
            availability_map[att.player_id].update_status(att.status.name, att.reason)
            
    # 7. Ergebnis formatieren
    result_list = [
        {
            "player_id": pa.player_id,
            "player_name": pa.player_name,
            "player_number": pa.player_number,
            "status": pa.status, # (ATTENDING, DECLINED, TENTATIVE, NOT_RESPONDED)
            "reason": pa.reason
        }
        for pa in availability_map.values()
    ]
    
    result_list.sort(key=lambda x: (x['player_number'] is None, x['player_number']))
    
    return result_list