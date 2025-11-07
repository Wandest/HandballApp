# DATEI: main.py (KORRIGIERT: Fügt den neuen /drills Router hinzu)
import webview
import threading
import uvicorn
from fastapi import FastAPI, Request, Depends, HTTPException, status, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates 
from fastapi.staticfiles import StaticFiles 
from typing import Optional, List, Dict 

from sqlalchemy.orm import Session

# WICHTIG: get_db und Trainer, Game, Team-Modelle importieren
from backend.auth import router as auth_router, get_current_trainer, get_current_player_only
from backend.team import router as team_router, get_league_list 
from backend.player import router as player_router, POSITIONS
from backend.game import router as game_router
from backend.action import router as action_router
from backend.custom_action import router as custom_action_router
from backend.public import router as public_router
from backend.scouting import router as scouting_router
from backend.database import init_db, Trainer, SessionLocal, Game, Team, Player, EventType

from backend.player_portal import router as player_portal_router 
from backend.calendar import router as calendar_router
from backend.absence import router as absence_router
from backend.dashboard_service import get_team_availability

# NEU: Übungs-DB Router
from backend.drill import router as drill_router

# Kategorien für Aktionen
ACTION_CATEGORIES = ["Offensiv", "Defensiv", "Torwart", "Sonstiges"]

app = FastAPI(title="HandballApp Backend")

# Statische Dateien (für SVGs, CSS) bereitstellen
app.mount("/static", StaticFiles(directory="frontend/static"), name="static")

# Router einbinden
app.include_router(auth_router, prefix="/auth", tags=["Authentication"])
app.include_router(team_router, prefix="/teams", tags=["Teams"])
app.include_router(player_router, prefix="/players", tags=["Players"])
app.include_router(game_router, prefix="/games", tags=["Games"])
app.include_router(action_router, prefix="/actions", tags=["Actions"])
app.include_router(custom_action_router, prefix="/custom-actions", tags=["Custom Actions"]) 
app.include_router(public_router, prefix="/public", tags=["Public Data"])
app.include_router(scouting_router, prefix="/scouting", tags=["Scouting"])
app.include_router(player_portal_router) 
app.include_router(calendar_router) 
app.include_router(absence_router)
# NEU: Übungs-DB Router einbinden (Präfix /drills ist in drill.py definiert)
app.include_router(drill_router)

# Jinja2 Templates für HTML-Seiten
templates = Jinja2Templates(directory="frontend")

# Datenbank initialisieren
init_db()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ==================================================
# ÖFFENTLICHE ROUTEN (z.B. Login)
# ==================================================
@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "title": "Handball Auswertung"}
    )

# ==================================================
# TRAINER-DASHBOARD (Geschützt & Trainer-Exklusiv)
# ==================================================

@app.get("/dashboard", response_class=HTMLResponse)
def dashboard_page(request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    db = SessionLocal()
    try:
        template_vars = {
            "request": request,
            "title": "Dashboard",
            "display_name": current_trainer.username,
            "user_type": "trainer", 
            "is_verified": current_trainer.is_verified,
            "leagues": get_league_list(),
            "positions": POSITIONS,
            "action_categories": ACTION_CATEGORIES,
            "page_content_template": "dashboard.html",
        }
        return templates.TemplateResponse(
            "app_layout.html", 
            template_vars
        )
    finally:
        db.close()

@app.get("/dashboard/availability/{team_id}", response_model=List[Dict])
def get_dashboard_availability(
    team_id: int,
    current_trainer: Trainer = Depends(get_current_trainer),
    db: Session = Depends(get_db) 
):
    return get_team_availability(db, team_id)


# ==================================================
# SPIELER-DASHBOARD (Geschützt & Spieler-Exklusiv)
# ==================================================

@app.get("/player-dashboard", response_class=HTMLResponse)
def player_dashboard_page(request: Request, current_player: Player = Depends(get_current_player_only)):
    db = SessionLocal()
    try:
        from backend.database import AbsenceReason
        template_vars = {
            "request": request,
            "title": f"Spieler Portal: {current_player.name}",
            "display_name": current_player.name, 
            "user_type": "player",
            "is_verified": True, 
            "leagues": [],
            "positions": POSITIONS,
            "action_categories": ACTION_CATEGORIES,
            "page_content_template": "player_dashboard.html",
            "absence_reasons": [e.value for e in AbsenceReason] 
        }
        return templates.TemplateResponse(
            "app_layout.html", 
            template_vars
        )
    finally:
        db.close()

@app.get("/player-calendar", response_class=HTMLResponse)
def player_calendar_page(request: Request, current_player: Player = Depends(get_current_player_only)):
    db = SessionLocal()
    try:
        from backend.database import AbsenceReason
        template_vars = {
            "request": request,
            "title": "Alle Termine",
            "display_name": current_player.name, 
            "user_type": "player",
            "is_verified": True, 
            "leagues": [],
            "positions": POSITIONS,
            "action_categories": ACTION_CATEGORIES,
            "page_content_template": "player_calendar.html", 
            "absence_reasons": [e.value for e in AbsenceReason] 
        }
        return templates.TemplateResponse(
            "app_layout.html", 
            template_vars
        )
    finally:
        db.close()

# --- RESTLICHE TRAINER-EXKLUSIVE ROUTEN (Dependency bleibt get_current_trainer) ---

@app.get("/team-management", response_class=HTMLResponse)
def team_management_page(request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    db = SessionLocal()
    try:
        template_vars = {
            "request": request,
            "title": "Team Management",
            "display_name": current_trainer.username,
            "user_type": "trainer",
            "is_verified": current_trainer.is_verified,
            "leagues": get_league_list(),
            "positions": POSITIONS,
            "action_categories": ACTION_CATEGORIES,
            "page_content_template": "team_management.html",
        }
        return templates.TemplateResponse(
            "app_layout.html",
            template_vars
        )
    finally:
        db.close()

@app.get("/game-planning", response_class=HTMLResponse)
def game_planning_page(request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    db = SessionLocal()
    try:
        template_vars = {
            "request": request,
            "title": "Spielplanung",
            "display_name": current_trainer.username,
            "user_type": "trainer",
            "is_verified": current_trainer.is_verified,
            "leagues": get_league_list(),
            "positions": POSITIONS,
            "action_categories": ACTION_CATEGORIES,
            "page_content_template": "game_planning.html", 
        }
        return templates.TemplateResponse(
            "app_layout.html",
            template_vars
        )
    finally:
        db.close()

@app.get("/calendar", response_class=HTMLResponse)
def calendar_page(request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    db = SessionLocal()
    try:
        from backend.database import EventType 
        
        template_vars = {
            "request": request,
            "title": "Kalender & Termine",
            "display_name": current_trainer.username,
            "user_type": "trainer",
            "is_verified": current_trainer.is_verified,
            "leagues": get_league_list(),
            "positions": POSITIONS,
            "action_categories": ACTION_CATEGORIES,
            "page_content_template": "calendar.html", 
            "event_types": [e.value for e in EventType] 
        }
        return templates.TemplateResponse(
            "app_layout.html",
            template_vars
        )
    finally:
        db.close()

# NEU: Route für die Übungs-DB-Seite
@app.get("/drills", response_class=HTMLResponse)
def drills_page(request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    db = SessionLocal()
    try:
        template_vars = {
            "request": request,
            "title": "Übungs-Datenbank",
            "display_name": current_trainer.username,
            "user_type": "trainer",
            "is_verified": current_trainer.is_verified,
            "leagues": get_league_list(),
            "positions": POSITIONS,
            "action_categories": ACTION_CATEGORIES,
            "page_content_template": "drills.html", # Verweist auf die neue HTML-Datei
        }
        return templates.TemplateResponse(
            "app_layout.html",
            template_vars
        )
    finally:
        db.close()


@app.get("/season-analysis", response_class=HTMLResponse)
def season_analysis_page(request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    db = SessionLocal()
    try:
        template_vars = {
            "request": request,
            "title": "Saison Analyse",
            "display_name": current_trainer.username,
            "user_type": "trainer",
            "is_verified": current_trainer.is_verified,
            "leagues": get_league_list(),
            "positions": POSITIONS,
            "action_categories": ACTION_CATEGORIES,
            "page_content_template": "season_analysis.html",
        }
        return templates.TemplateResponse(
            "app_layout.html",
            template_vars
        )
    finally:
        db.close()

@app.get("/league-scouting", response_class=HTMLResponse)
def league_scouting_page(request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    db = SessionLocal()
    try:
        template_vars = {
            "request": request,
            "title": "Liga Scouting", 
            "display_name": current_trainer.username,
            "user_type": "trainer",
            "is_verified": current_trainer.is_verified,
            "leagues": get_league_list(),
            "positions": POSITIONS,
            "action_categories": ACTION_CATEGORIES,
            "page_content_template": "league_scouting.html", 
        }
        return templates.TemplateResponse(
            "app_layout.html",
            template_vars
        )
    finally:
        db.close()


@app.get("/protocol/{game_id}", response_class=HTMLResponse)
def protocol(game_id: int, request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    db = SessionLocal() 
    
    try:
        game = db.query(Game).filter(Game.id == game_id).first()
        if not game:
            raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
        
        team = db.query(Team).filter(Team.id == game.team_id).first()
        
        if not team:
            raise HTTPException(status_code=404, detail="Zugehöriges Team nicht gefunden.")
            
        return templates.TemplateResponse(
            "protocol.html", 
            {
                "request": request,
                "title": f"Protokoll: {team.name} vs. {game.opponent}",
                "game_id": game.id,
                "team_id": team.id,
                "opponent": game.opponent,
                "team_name": team.name,
                "video_url": game.video_url 
            }
        ) 
    finally:
        db.close()


# ------------------------------------
# SERVER-START-LOGIK (UNVERÄNDERT)
# ------------------------------------

def start_server():
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)

if __name__ == "__main__":
    
    # Starte den Uvicorn-Server in einem separaten Thread
    t = threading.Thread(target=start_server, daemon=True)
    t.start()

    # Starte das pywebview-Fenster im Haupt-Thread
    webview.create_window(
        "Handball Auswertung", 
        "http://127.0.0.1:8000", 
        width=1400, 
        height=800
    )
    webview.start(debug=True)