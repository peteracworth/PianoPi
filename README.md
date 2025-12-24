# Piano MIDI Player

A web-based MIDI file explorer and player for Raspberry Pi that sends MIDI output to a connected piano.

## Technology Stack

### Backend
- **Python 3** with **Flask** web framework
- **mido** library for MIDI file parsing and playback
- Runs as a **systemd service** (`piano.service`)

### Frontend
- **Vanilla JavaScript** (no frameworks)
- **Jinja2** templates (Flask's default)
- **CSS** (plain, no preprocessors)
- Drag-and-drop UI for file/folder management

### Hardware
- **Raspberry Pi** (remote server)
- **USB MIDI output** (`PD USB MIDI MIDI 1`) → connected to piano

### Deployment
- **rsync** over SSH for file sync
- **systemd** for service management
- Server accessible at `http://pianopi.local:8080/`

## Data Storage

All data is filesystem-based (no database).

### Server-side folder structure

```
/home/peteracworth/piano/
└── midi/
    ├── song1.mid             # MIDI files can be at root
    ├── song2.mid
    ├── .order.json           # Custom sort order (hidden)
    ├── Classical/            # Or organized in subfolders
    │   ├── Bach_Prelude.mid
    │   ├── Mozart_Sonata.mid
    │   └── .order.json       # Order within this folder
    └── Jazz/
        └── Take_Five.mid
```

- **MIDI files** can be organized in nested subfolders
- **Custom ordering** is saved per-folder in `.order.json` files
- Drag-and-drop to reorder files and move between folders

## Project Structure

```
pianopi/                      # Development (local)
├── app/
│   ├── server.py             # Flask app
│   ├── templates/            # Jinja2 HTML templates
│   │   ├── base.html         # Base template
│   │   └── explorer.html     # File explorer page
│   └── static/
│       ├── css/style.css     # Stylesheet
│       └── js/explorer.js    # Frontend JavaScript
├── deploy.sh                 # Deployment script
└── venv/                     # Python virtual environment
```

## Features

- **File Explorer**: Navigate nested folders like Windows Explorer
- **Playback Controls**: Play all files in current folder
- **Real-time Controls**: Volume and tempo adjustment during playback
- **Skip/Restart**: Previous track, next track, restart current track
- **File Management**: Upload, delete, move files between folders
- **Folder Management**: Create, rename, delete, reorder folders
- **Drag & Drop**: Reorder items, move files/folders by dragging

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/` | GET | File explorer page |
| `/status` | GET | Current playback status |
| `/play_folder` | POST | Play all files in folder |
| `/stop` | GET | Stop playback |
| `/pause` | GET | Pause playback |
| `/resume` | GET | Resume playback |
| `/next` | GET | Next track |
| `/prev` | GET | Previous track |
| `/restart` | GET | Restart current track |
| `/volume/<v>` | GET | Set volume (0-127) |
| `/tempo/<t>` | GET | Set tempo (25-200%) |
| `/all_music` | GET | List files/folders |
| `/upload` | POST | Upload MIDI files |
| `/create_folder` | POST | Create folder |
| `/rename_folder` | POST | Rename folder |
| `/delete_folder` | POST | Delete folder |
| `/move_file` | POST | Move file |
| `/delete_file` | POST | Delete file |
| `/move_folder` | POST | Move folder |
| `/reorder_items` | POST | Reorder items |

## Deployment

```bash
./deploy.sh
```

This syncs files to the Raspberry Pi and restarts the service.
