# DATEI: main.py
import webview
import threading
import uvicorn
from fastapi import FastAPI, Request, Depends, HTTPException, status, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles 
from typing import Optional

# WICHTIG: get_db und Trainer, Game, Team-Modelle importieren
from backend.auth import router as auth_router, get_current_trainer
from backend.team import router as team_router, get_league_list 
from backend.player import router as player_router, POSITIONS
from backend.game import router as game_router
from backend.action import router as action_router
from backend.custom_action import router as custom_action_router
from backend.public import router as public_router
from backend.database import init_db, Trainer, SessionLocal, Game, Team

# NEU (PHASE 9): Scouting-Router importieren
from backend.scouting import router as scouting_router

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

# NEU (PHASE 9): Scouting-Router einbinden
app.include_router(scouting_router, prefix="/scouting", tags=["Scouting"])

# Jinja2 Templates für HTML-Seiten
templates = Jinja2Templates(directory="frontend")

# Datenbank initialisieren
init_db()

# Unprotected route: Home / Authentication page
@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "title": "Handball Auswertung"}
    )

# --- GESCHÜTZTE ROUTEN (Laden alle app_layout.html) ---

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
            "page_content_template": "dashboard.html",
        }
        return templates.TemplateResponse(
            "app_layout.html", 
            template_vars
        )
    finally:
        db.close()

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
            "trainer_name": current_trainer.username,
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
            "trainer_name": current_trainer.username,
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


# ==================================================
# REPARIERTE PROTOKOLL-ROUTE
# ==================================================
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
            {
                "request": request,
                "title": f"Protokoll: {team.name} vs. {game.opponent}",
                "game_id": game.id,
                "team_id": team.id,
                "opponent": game.opponent,
                "team_name": team.name,
                "video_url": game.video_url # (PHASE 8)
            }
        )
    finally:
        db.close()


# ------------------------------------
# SERVER-START-LOGIK (EINFACHE & STABILE METHODE)
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