<p align="center">
  <img src="https://api.dicebear.com/7.x/adventurer/svg?seed=ArcadeBox&backgroundColor=ff5733&radius=50" width="100" alt="ArcadeBox Logo">
</p>

<h1 align="center">ArcadeBox</h1>

<p align="center">
  <strong>Retro-Arcade-Plattform im Browser — 10 Spiele, Multiplayer-Duelle, Chat und Ranglisten.</strong>
</p>

<p align="center">
  <a href="https://code4-spiel-und-spa-feat-sariye-u-karim.onrender.com"><img src="https://img.shields.io/badge/Live_Demo-ArcadeBox-ff5733?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Live Demo"></a>
  <img src="https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase">
</p>

---

## Was ist ArcadeBox?

ArcadeBox ist eine browserbasierte Spieleplattform, die im Rahmen des Moduls **Softwaresysteme** an der Fachhochschule entstanden ist. Die Idee war einfach: eine Seite, auf der man sich einloggt, Spiele zockt, Highscores jagt und mit Freunden chattet — alles ohne Installation, direkt im Browser.

Was als kleines Projekt angefangen hat, ist über das Semester zu einer vollständigen Plattform gewachsen: mit Echtzeit-Chat, Freundesystem, Push-Benachrichtigungen, einem Rang-System und einem visuellen Stil, der an alte Arcade-Automaten erinnert.

## Features

### Spiele

| Kategorie | Spiel | Beschreibung |
|-----------|-------|--------------|
| **Singleplayer** | Farb-Gedächtnis | Simon-Says-Variante — merke dir die Farbfolge |
| | Turm-Stapler | Timing-basiertes Stapelspiel |
| | Reaktionstest | Wie schnell reagierst du auf das Signal? |
| | Bubble Pop | Triff die Blasen, bevor sie verschwinden |
| | Zahlen-Raten | Finde die geheime Zahl mit möglichst wenigen Versuchen |
| | Info-Wordle | Wordle mit Informatik-Begriffen |
| **Multiplayer** | TicTacToe | Klassiker — gegen KI oder Freunde |
| | Connect Four | Vier gewinnt im Duell |
| | Pong | Retro-Pong, erster mit 5 Punkten gewinnt |
| | Schere Stein Papier | Best of 5 Runden |

### Plattform

- **Freundesystem** — Anfragen senden, annehmen, Freundesliste mit Online-Status
- **Global Chat** — öffentlicher Chatraum mit Lesebestätigungen, Tipp-Anzeige und Datumstrennlinien (WhatsApp-Style)
- **Private Nachrichten** — 1:1-Chat mit Zustellstatus (gesendet / zugestellt / gelesen)
- **Push-Benachrichtigungen** — bei Spieleinladungen und Freundschaftsanfragen, auch im Hintergrund
- **Rang-System** — automatische Ränge basierend auf Highscores (Anfänger bis Legende)
- **Präsenz-Status** — Aktiv, Abwesend, Nicht stören (mit visueller Statusanzeige)
- **100+ Avatare** — generiert über DiceBear, frei wählbar
- **Dark / Light Mode** — umschaltbar, speichert die Präferenz
- **Responsive Design** — funktioniert auf Desktop und Mobilgeräten
- **PWA-fähig** — kann als App auf dem Homescreen installiert werden

## Tech-Stack

```
Frontend       Vanilla HTML / CSS / JavaScript (kein Framework)
Backend        Node.js + Express
Datenbank      Supabase (PostgreSQL)
Hosting        Render.com
Avatare        DiceBear API
Styling        Custom CSS mit CSS-Variablen, Animationen, Retro-Ästhetik
```

Bewusst wurde auf Frontend-Frameworks verzichtet — das gesamte Projekt besteht aus vier Hauptdateien:

| Datei | Zweck | Zeilen |
|-------|-------|-------:|
| `index.html` | Markup, alle Views | ~450 |
| `style.css` | Styling, Animationen, Responsive | ~2.400 |
| `script.js` | Gesamte Frontend-Logik | ~3.100 |
| `server.js` | API, Auth, DB-Zugriffe | ~750 |

## Schnellstart

### Voraussetzungen

- [Node.js](https://nodejs.org/) (v18+)
- Ein [Supabase](https://supabase.com/)-Projekt mit der passenden Tabellenstruktur

### Installation

```bash
# Repository klonen
git clone https://github.com/Spiel-Spass-feat-Sariye-Karim/Code4-Spiel_und_Spa---Feat.-Sariye_u._Karim.git
cd Code4-Spiel_und_Spa---Feat.-Sariye_u._Karim

# Abhängigkeiten installieren
npm install

# Umgebungsvariablen setzen
cp .env.example .env
# → SUPABASE_URL und SUPABASE_KEY eintragen

# Server starten
npm run dev
```

Der Server läuft dann auf `http://localhost:3000`.

### Umgebungsvariablen

| Variable | Beschreibung |
|----------|-------------|
| `SUPABASE_URL` | URL deines Supabase-Projekts |
| `SUPABASE_KEY` | Service-Role-Key (nicht der anon-Key) |
| `PORT` | Server-Port (Standard: 3000) |

## Projektstruktur

```
├── index.html          # Single-Page HTML (Login, Spiele, Chat, Profil)
├── style.css           # Komplettes Styling inkl. Retro-Theme
├── script.js           # Frontend-Logik (Spiele, Chat, UI)
├── server.js           # Express-Backend (API-Routen, Auth, DB)
├── wordle-dict.js      # Wörterbuch für Info-Wordle
├── manifest.json       # PWA-Manifest
├── package.json        # Node.js Dependencies
└── .env                # Umgebungsvariablen (nicht im Repo)
```

## API-Übersicht

| Methode | Endpunkt | Beschreibung |
|---------|----------|-------------|
| `POST` | `/api/register` | Neues Konto erstellen |
| `POST` | `/api/login` | Einloggen |
| `GET` | `/api/friends/:user_id` | Freundesliste laden |
| `POST` | `/api/friends/request` | Freundschaftsanfrage senden |
| `GET` | `/api/chat/global` | Globale Chatnachrichten |
| `POST` | `/api/chat/global` | Nachricht senden |
| `GET` | `/api/chat/private/:uid/:fid` | Private Nachrichten laden |
| `POST` | `/api/lobby/create` | Multiplayer-Lobby erstellen |
| `POST` | `/api/lobby/join` | Lobby beitreten |
| `POST` | `/api/scores` | Highscore speichern |
| `GET` | `/api/scores/top` | Top-Scores aller Spieler |

<sub>Vollständige API-Dokumentation in <code>server.js</code>.</sub>

## Autoren

| | Name | Rolle |
|-|------|-------|
| <img src="https://api.dicebear.com/7.x/adventurer/svg?seed=Karim" width="40"> | **Karim Stührenberg** | Entwicklung, Backend, Frontend, Design |
| <img src="https://api.dicebear.com/7.x/adventurer/svg?seed=Sariye" width="40"> | **Sariye Tas** | Entwicklung, Testing, Konzept |

Entstanden im Wintersemester 2025/26 im Modul **Softwaresysteme**.

## Lizenz

Dieses Projekt ist im Rahmen einer Hochschulveranstaltung entstanden und dient ausschließlich Bildungszwecken.

---

<p align="center">
  <sub>Built with ☕, mass debugging sessions, and way too many CSS lines.</sub>
</p>
