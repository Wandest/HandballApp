# DATEI: main.py
import webview
import threading
import uvicorn
from fastapi import (
    FastAPI, Request, Depends, HTTPException, status, Query, Response
)
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from typing import Optional

# WICHTIG: get_db und Trainer, Game, Team-Modelle importieren
# WICHTIG: Wir importieren jetzt die ZENTRALE Cookie-Auth-Funktion
from backend.auth import (
    router as auth_router, 
    get_current_trainer,  # <-- DIE NEUE, ZENTRALE FUNKTION
    get_db
)
from backend.team import router as team_router, get_league_list 
from backend.player import router as player_router, POSITIONS
from backend.game import router as game_router
from backend.action import router as action_router
from backend.custom_action import router as custom_action_router
from backend.public import router as public_router
from backend.database import init_db, Trainer, SessionLocal, Game, Team

# Kategorien für Aktionen
ACTION_CATEGORIES = ["Offensiv", "Defensiv", "Torwart", "Sonstiges"]

app = FastAPI(title="HandballApp Backend")

# Router einbinden
app.include_router(auth_router, prefix="/auth", tags=["Authentication"])
app.include_router(team_router, prefix="/teams", tags=["Teams"])
app.include_router(player_router, prefix="/players", tags=["Players"])
app.include_router(game_router, prefix="/games", tags=["Games"])
app.include_router(action_router, prefix="/actions", tags=["Actions"])
app.include_router(custom_action_router, prefix="/custom-actions", tags=["Custom Actions"]) 
app.include_router(public_router, prefix="/public", tags=["Public Data"])

# Jinja2 Templates für HTML-Seiten
templates = Jinja2Templates(directory="frontend")

# Datenbank initialisieren
init_db()


# --- PROFI-AUTHENTIFIZIERUNG ---
# Die Logik ist jetzt nach backend/auth.py umgezogen und wird
# von hier und allen anderen Routern importiert.
# --- ENDE ---


# Unprotected route: Home / Authentication page
@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "title": "Handball Auswertung"}
    )

# Dashboard-Loader: Leitet immer zur ersten Seite um
@app.get("/app/dashboard", response_class=HTMLResponse)
def app_dashboard(request: Request):
    return templates.TemplateResponse(
        "app_loader.html",
        {"request": request, "title": "Lade Dashboard"}
    )

# NEUE HAUPTSEITE
@app.get("/dashboard", response_class=HTMLResponse)
def dashboard_page(request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    db = SessionLocal()
    try:
        template_vars = {
            "request": request,
            "title": "Dashboard",
            "trainer_name": current_trainer.username,
            "is_verified": current_trainer.is_verified,
            "leagues": get_league_list(),
            "positions": POSITIONS,
            "action_categories": ACTION_CATEGORIES,
            "page_content_template": "dashboard.html"
        }
        return templates.TemplateResponse(
            "app_layout.html", 
            template_vars
        )
    finally:
        db.close()

@app.get("/app/protocol/{game_id}", response_class=HTMLResponse)
def app_protocol_loader(game_id: int, request: Request):
    return templates.TemplateResponse(
        "protocol_loader.html",
        {"request": request, "title": "Lade Protokoll", "game_id_to_load": game_id}
    )

# --- GESCHÜTZTE ROUTEN ---
# Diese verwenden jetzt alle die importierte Cookie-Auth-Funktion

# 1. Team Management
@app.get("/team-management", response_class=HTMLResponse)
def team_management_page(request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    db = SessionLocal()
    try:
        template_vars = {
            "request": request,
            "title": "Team Management",
            "trainer_name": current_trainer.username,
            "is_verified": current_trainer.is_verified,
            "leagues": get_league_list(),
            "positions": POSITIONS,
            "action_categories": ACTION_CATEGORIES,
            "page_content_template": "team_management.html"
        }
        return templates.TemplateResponse(
            "app_layout.html",
            template_vars
        )
    finally:
        db.close()

# 2. Game Planning
@app.get("/game-planning", response_class=HTMLResponse)
def game_planning_page(request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    db = SessionLocal()
    try:
        template_vars = {
            "request": request,
            "title": "Spielplanung",
            "trainer_name": current_trainer.username,
            "is_verified": current_trainer.is_verified,
            "leagues": get_league_list(),
            "positions": POSITIONS,
            "action_categories": ACTION_CATEGORIES,
            "page_content_template": "game_planning.html"
        }
        return templates.TemplateResponse(
            "app_layout.html",
            template_vars
        )
    finally:
        db.close()

# 3. Season Analysis
@app.get("/season-analysis", response_class=HTMLResponse)
def season_analysis_page(request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    db = SessionLocal()
    try:
        template_vars = {
            "request": request,
            "title": "Saison Analyse",
            "trainer_name": current_trainer.username,
            "is_verified": current_trainer.is_verified,
            "leagues": get_league_list(),
            "positions": POSITIONS,
            "action_categories": ACTION_CATEGORIES,
            "page_content_template": "season_analysis.html"
        }
        return templates.TemplateResponse(
            "app_layout.html",
            template_vars
        )
    finally:
        db.close()

# Geschützte Route: Protokoll-Oberfläche
@app.get("/protocol/{game_id}", response_class=HTMLResponse)
def protocol(game_id: int, request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    db = SessionLocal() 
    
    try:
        game = db.query(Game).filter(Game.id == game_id).first()
        if not game:
            raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
        
        team = db.query(Team).filter(Team.id == game.team_id, Team.trainer_id == current_trainer.id).first()
        
        if not team:
            raise HTTPException(status_code=403, detail="Keine Berechtigung für dieses Spiel.")
            
        return templates.TemplateResponse(
            "protocol.html",
            {"request": request, 
             "title": "Spielprotokoll", 
             "game_id": game_id, 
             "team_id": team.id,
             "opponent": game.opponent, 
             "team_name": team.name}
        )
    finally:
        db.close()


# ------------------------------------
# SERVER-START-LOGIK
# ------------------------------------
def start_server(application):
    uvicorn.run(application, host="127.0.0.1", port=8000, reload=False)

if __name__ == "__main__":
    print("Starte FastAPI-Server auf http://127.0.0.1:8000")
    t = threading.Thread(target=start_server, args=(app,), daemon=True)
    t.start()

    print("Starte pywebview Fenster...")
    webview.create_window("Handball Auswertung", "http://127.0.0.1:8000", width=1400, height=800)
    webview.start()

