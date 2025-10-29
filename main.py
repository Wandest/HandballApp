import webview
import threading
import uvicorn
from backend.database import init_db

def start_server():
    uvicorn.run("backend.server:app", host="127.0.0.1", port=8000, reload=False)

if __name__ == "__main__":
    init_db()  # Datenbank und Tabellen erzeugen

    t = threading.Thread(target=start_server, daemon=True)
    t.start()

    webview.create_window("Handball Auswertung", "http://127.0.0.1:8000", width=1200, height=800)
    webview.start()
