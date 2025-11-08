# DATEI: backend/acwr_service.py
# NEU: Kernlogik für die ACWR-Berechnung (Phase 11)

from sqlalchemy.orm import Session
from datetime import datetime, timedelta, date
from typing import Dict, List, Optional, Any
import math

from backend.database import WellnessLog, Player

def calculate_daily_load(log: WellnessLog) -> float:
    """
    Berechnet die interne Belastung (Internal Load) für einen Tag basierend auf Wellness-Daten.
    Formel: (Stress + Muskelkater + (6 - Schlafqualität)) * Session_RPE
    """
    # Inverser Schlaf: 1 (schlecht) -> hohe Belastung (5), 5 (gut) -> niedrige Belastung (1)
    # Wir nehmen 6 - Wert, damit 5 zu 1 wird und 1 zu 5.
    sleep_load = 6 - log.sleep_quality 
    
    # Basis-Belastung aus den Wellness-Faktoren (min 3, max 15)
    base_load = log.stress_level + log.muscle_soreness + sleep_load
    
    # Wenn eine Trainingsbelastung (RPE 1-10) angegeben wurde, multiplizieren wir damit.
    # Wenn kein Training war (RPE nicht angegeben), ist der Faktor 1 (Ruhetag-Grundlast).
    rpe_factor = log.session_rpe if (log.session_rpe and log.session_rpe > 0) else 1.0
    
    total_load = base_load * rpe_factor
    return total_load

def get_player_acwr(db: Session, player_id: int, reference_date: datetime = None) -> Dict[str, Any]:
    """
    Berechnet das Acute:Chronic Workload Ratio (ACWR) für einen Spieler.
    - Acute Load: Durchschnitt der letzten 7 Tage
    - Chronic Load: Durchschnitt der letzten 28 Tage
    """
    if reference_date is None:
        reference_date = datetime.utcnow()

    # Zeiträume definieren (Wir schauen inkl. heute zurück)
    date_28_days_ago = reference_date - timedelta(days=28)
    
    # Logs der letzten 29 Tage holen (um sicherzugehen, dass wir alle nötigen Tage haben)
    logs = db.query(WellnessLog).filter(
        WellnessLog.player_id == player_id,
        WellnessLog.logged_at >= date_28_days_ago
    ).all()
    
    # Tägliche Loads berechnen und Datum zuordnen
    daily_loads = {}
    for log in logs:
        # Nutze das Datum ohne Uhrzeit als Key
        log_date_str = log.logged_at.strftime('%Y-%m-%d')
        # Falls mehrere Logs existieren (sollte nicht sein), überschreibt der letzte
        daily_loads[log_date_str] = calculate_daily_load(log)

    # Helper zum Abrufen des Loads für ein spezifisches Datum
    def get_load_for_day(days_ago: int) -> float:
        target_date = reference_date - timedelta(days=days_ago)
        date_str = target_date.strftime('%Y-%m-%d')
        return daily_loads.get(date_str, 0.0)

    # Acute Load (letzte 7 Tage: heute bis vor 6 Tagen)
    acute_sum = sum([get_load_for_day(i) for i in range(7)])
    acute_load_avg = acute_sum / 7.0

    # Chronic Load (letzte 28 Tage)
    chronic_sum = sum([get_load_for_day(i) for i in range(28)])
    chronic_load_avg = chronic_sum / 28.0
    
    # Ratio berechnen
    ratio = 0.0
    if chronic_load_avg > 0:
        ratio = acute_load_avg / chronic_load_avg
    elif acute_load_avg > 0:
        # Sonderfall: Nur akute Belastung, keine Historie. 
        # Das ist ein sehr hohes Risiko (von 0 auf 100).
        ratio = 2.0 

    # Status bestimmen & Text
    is_high_risk = False
    status_text = "Keine Daten"
    risk_level = 0 # 0=Grau, 1=Grün, 2=Gelb, 3=Rot

    if chronic_load_avg == 0 and acute_load_avg == 0:
         status_text = "Keine Daten"
         risk_level = 0
    elif ratio < 0.80:
        status_text = "Untertraining (Detraining)"
        risk_level = 2 # Gelb (Warnung vor Formverlust)
    elif ratio >= 0.80 and ratio <= 1.30:
        status_text = "Optimal (Sweet Spot)"
        risk_level = 1 # Grün
    elif ratio > 1.30 and ratio <= 1.50:
        status_text = "Erhöhte Belastung"
        risk_level = 2 # Gelb
    elif ratio > 1.50:
        status_text = "HOHES RISIKO (Überlastung)"
        risk_level = 3 # Rot
        is_high_risk = True

    return {
        "acute_load": round(acute_load_avg, 1),
        "chronic_load": round(chronic_load_avg, 1),
        "acwr_ratio": round(ratio, 2),
        "is_high_risk": is_high_risk,
        "status_text": status_text,
        "risk_level": risk_level
    }