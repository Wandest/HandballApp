from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request
from backend import auth  # WICHTIG: Voller Pfad

app = FastAPI()

# DER ENTSCHEIDENDE PUNKT: Füge den Router hier hinzu
app.include_router(auth.router, prefix="/auth", tags=["Authentication"]) 

# Statische Dateien (CSS, JS)
app.mount("/static", StaticFiles(directory="frontend"), name="static")

templates = Jinja2Templates(directory="frontend")

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request, "title": "Handball-Analyse"})