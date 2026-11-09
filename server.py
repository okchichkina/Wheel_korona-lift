import sqlite3
from fastapi import FastAPI, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

app = FastAPI(title="Wheel of Fortune API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = "prizes.db"

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS prizes (
                id TEXT PRIMARY KEY,
                name TEXT,
                amount INTEGER,
                weight INTEGER,
                image TEXT
            )
        """)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM prizes")
        if cursor.fetchone()[0] == 0:
            defaults = [
                ("prize_1", "Блокнот", 50, 50, "images/notebook.png"),
                ("prize_2", "Ручка", 100, 30, "images/pen.png"),
                ("prize_3", "Кепка", 10, 10, "images/cap.png"),
            ]
            cursor.executemany("INSERT INTO prizes VALUES (?, ?, ?, ?, ?)", defaults)

@app.on_event("startup")
def startup():
    init_db()

# Отдаем актуальные остатки фронтенду
@app.get("/api/prizes")
def get_prizes():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute("SELECT * FROM prizes").fetchall()

class WinRequest(BaseModel):
    prize_id: str

# Фронтенд сообщает, какой приз он выбрал, и мы списываем 1 штуку
@app.post("/api/record_win")
def record_win(req: WinRequest):
    with sqlite3.connect(DB_PATH) as conn:
        # Условие amount > 0 защищает базу от ухода в минус
        conn.execute(
            "UPDATE prizes SET amount = amount - 1 WHERE id = ? AND amount > 0", 
            (req.prize_id,)
        )
    return {"status": "success"}

# Админ-панель для организатора
@app.get("/admin", response_class=HTMLResponse)
def admin_panel():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        prizes = conn.execute("SELECT * FROM prizes ORDER BY id").fetchall()
        
    html = """
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Управление призами</title>
        <style>
            body { font-family: sans-serif; padding: 20px; }
            table { border-collapse: collapse; width: 100%; max-width: 600px; }
            th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
            input[type=number] { width: 80px; padding: 5px; }
            button { padding: 5px 15px; background: #FF4C00; color: white; border: none; border-radius: 4px; }
        </style>
    </head>
    <body>
        <h2>Остатки призов Linvol</h2>
        <table>
            <tr><th>Приз</th><th>Остаток</th><th>Действие</th></tr>
    """
    for p in prizes:
        html += f"""
        <tr>
            <form action='/admin/update' method='POST'>
                <input type='hidden' name='prize_id' value='{p['id']}'>
                <td>{p['name']}</td>
                <td><input type='number' name='amount' value='{p['amount']}'></td>
                <td><button type='submit'>Сохранить</button></td>
            </form>
        </tr>
        """
    html += "</table></body></html>"
    return html

@app.post("/admin/update")
def update_prize(prize_id: str = Form(...), amount: int = Form(...)):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("UPDATE prizes SET amount = ? WHERE id = ?", (amount, prize_id))
    return RedirectResponse(url="/admin", status_code=303)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)