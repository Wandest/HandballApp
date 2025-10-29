import webview
import threading
import uvicorn

from fastapi import FastAPI, Request, Depends
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from backend.auth import router as auth_router, get_current_trainer
from backend.team import router as team_router 
from backend.player import router as player_router
from backend.game import router as game_router
from backend.action import router as action_router # Wichtig: Action-Router importieren
from backend.database import init_db, Trainer

app = FastAPI(title="HandballApp Backend")

# Router einbinden
app.include_router(auth_router, prefix="/auth", tags=["Authentication"])
app.include_router(team_router, prefix="/teams", tags=["Teams"])
app.include_router(player_router, prefix="/players", tags=["Players"])
app.include_router(game_router, prefix="/games", tags=["Games"])
app.include_router(action_router, prefix="/actions", tags=["Actions"]) # Wichtig: Action-Router einbinden

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

# Diese Route wird vom Frontend aufgerufen, um das Dashboard mit Token-Handling zu laden
@app.get("/app/dashboard", response_class=HTMLResponse)
def app_dashboard(request: Request):
    return templates.TemplateResponse(
        "app_loader.html",
        {"request": request, "title": "Lade Dashboard"}
    )

# Geschützte Route: Der eigentliche Dashboard-Inhalt (Zugriff nur mit gültigem Token)
@app.get("/dashboard", response_class=HTMLResponse)
def dashboard(request: Request, current_trainer: Trainer = Depends(get_current_trainer)):
    return templates.TemplateResponse(
        "dashboard.html",
        {"request": request, "title": "Dashboard", "trainer_name": current_trainer.name}
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