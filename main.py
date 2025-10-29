import webview
import threading
import uvicorn
from fastapi import FastAPI, Request, Depends, HTTPException, status
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from backend.auth import router as auth_router, get_current_trainer
from backend.team import router as team_router 
from backend.player import router as player_router
from backend.game import router as game_router
from backend.action import router as action_router
from backend.custom_action import router as custom_action_router
from backend.database import init_db, Trainer, Game, Team, SessionLocal

app = FastAPI(title="HandballApp Backend")

# Router einbinden
app.include_router(auth_router, prefix="/auth", tags=["Authentication"])
app.include_router(team_router, prefix="/teams", tags=["Teams"])
app.include_router(player_router, prefix="/players", tags=["Players"])
app.include_router(game_router, prefix="/games", tags=["Games"])
app.include_router(action_router, prefix="/actions", tags=["Actions"])
app.include_router(custom_action_router, prefix="/custom-actions", tags=["Custom Actions"])

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

@app.get("/app/dashboard", response_class=HTMLResponse)
def app_dashboard(request: Request):
    return templates.TemplateResponse(
        "app_loader.html",
        {"request": request, "title": "Lade Dashboard"}
    )

# NEU HIER EINGEFÜGT: Ungeschützte Route, die den Protokoll-Loader lädt
@app.get("/app/protocol/{game_id}", response_class=HTMLResponse)
def app_protocol_loader(game_id: int, request: Request):
    return templates.TemplateResponse(
        "protocol_loader.html",
        {"request": request, "title": "Lade Protokoll"}
    )
# ENDE NEU

# Geschützte Route: Der eigentliche Dashboard-Inhalt
@app.get("/dashboard", response_class=HTMLResponse)
def dashboard(request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    db = SessionLocal()
    trainer_data = db.query(Trainer).filter(Trainer.id == current_trainer.id).first()
    db.close()

    if not trainer_data:
        raise HTTPException(status_code=404, detail="Trainer nicht gefunden.")
    
    return templates.TemplateResponse(
        "dashboard.html",
        {"request": request, "title": "Dashboard", 
         "trainer_name": trainer_data.username,
         "is_verified": trainer_data.is_verified 
        }
    )

# Geschützte Route: Protokoll-Oberfläche
@app.get("/protocol/{game_id}", response_class=HTMLResponse)
def protocol(game_id: int, request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    db = SessionLocal() 
    
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        db.close()
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
    
    team = db.query(Team).filter(Team.id == game.team_id, Team.trainer_id == current_trainer.id).first()
    db.close()
    
    if not team:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für dieses Spiel.")
        
    return templates.TemplateResponse(
        "protocol.html",
        {"request": request, "title": "Spielprotokoll", "game_id": game_id, "opponent": game.opponent, "team_name": team.name}
    )


# ------------------------------------
# SERVER-START-LOGIK
# ------------------------------------
def start_server(application):
    uvicorn.run(application, host="127.0.0.1", port=8000, reload=False)

if __name__ == "__main__":
    t = threading.Thread(target=start_server, args=(app,), daemon=True)
    t.start()

    webview.create_window("Handball Auswertung", "http://127.0.0.1:8000", width=1200, height=800)
    webview.start()