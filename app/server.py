"""
Piano MIDI Player - Flask Server
"""
from flask import Flask, request, redirect, render_template
import os
import threading
import time
import subprocess
import json
import shutil
import mido
from werkzeug.utils import secure_filename

# Configuration
BASE_DIR = "/home/peteracworth/piano"
MIDI_DIR = f"{BASE_DIR}/midi"
MIDI_PORT = "PD USB MIDI MIDI 1"

app = Flask(__name__)

# Playback state
state = {
    "folder": None,
    "tracks": [],
    "index": 0,
    "playing": False,
    "paused": False,
    "volume": 100,
    "tempo": 100
}


# ============================================================================
# MIDI Playback
# ============================================================================

def play_loop():
    """Main playback loop"""
    state["playing"] = True

    while state["playing"]:
        if state["index"] >= len(state["tracks"]):
            state["playing"] = False
            break

        track = state["tracks"][state["index"]]
        path = os.path.join(MIDI_DIR, track)

        try:
            mid = mido.MidiFile(path)
            port = mido.open_output(MIDI_PORT)

            for msg in mid:
                if not state["playing"]:
                    break

                while state["paused"]:
                    time.sleep(0.1)
                    if not state["playing"]:
                        break

                tempo_scale = state["tempo"] / 100
                volume_scale = state["volume"] / 127

                time.sleep(msg.time / tempo_scale)

                if not msg.is_meta:
                    if msg.type == "note_on":
                        msg.velocity = int(msg.velocity * volume_scale)
                    port.send(msg)
        except Exception as e:
            print(f"Playback error: {e}")

        state["index"] += 1
        if state["index"] >= len(state["tracks"]):
            state["playing"] = False


# ============================================================================
# Page Route
# ============================================================================

@app.route("/")
def index():
    """File explorer page"""
    return render_template("explorer.html")


# ============================================================================
# Playback Control Routes
# ============================================================================

@app.route("/next")
def next_track():
    if state["tracks"]:
        state["playing"] = False
        time.sleep(0.1)
        state["index"] = min(state["index"] + 1, len(state["tracks"]) - 1)
        state["playing"] = True
        threading.Thread(target=play_loop, daemon=True).start()
    return ("", 204)


@app.route("/prev")
def prev_track():
    if state["tracks"]:
        state["playing"] = False
        time.sleep(0.1)
        state["index"] = max(state["index"] - 1, 0)
        state["playing"] = True
        threading.Thread(target=play_loop, daemon=True).start()
    return ("", 204)


@app.route("/pause")
def pause():
    state["paused"] = True
    return ("", 204)


@app.route("/resume")
def resume():
    state["paused"] = False
    return ("", 204)


@app.route("/stop")
def stop():
    state["playing"] = False
    state["paused"] = False
    return ("", 204)


@app.route("/volume/<int:v>")
def volume(v):
    state["volume"] = max(0, min(127, v))
    return ("", 204)


@app.route("/tempo/<int:t>")
def tempo(t):
    state["tempo"] = max(25, min(200, t))
    return ("", 204)


@app.route("/restart")
def restart_track():
    """Restart the current track from the beginning"""
    if state["tracks"] and state["index"] < len(state["tracks"]):
        state["playing"] = False
        time.sleep(0.1)
        state["playing"] = True
        threading.Thread(target=play_loop, daemon=True).start()
    return ("", 204)


@app.route("/play_folder", methods=["POST"])
def play_folder():
    """Play all files in a folder"""
    data = request.get_json()
    folder_path = data.get("path", "").strip().lstrip('/') if data else ""
    
    if '..' in folder_path:
        return {"success": False, "message": "Invalid path"}, 400
    
    full_path = os.path.join(MIDI_DIR, folder_path) if folder_path else MIDI_DIR
    
    if not os.path.isdir(full_path):
        return {"success": False, "message": "Folder not found"}, 404
    
    # Get files in order (respecting .order.json)
    files_dict = {}
    for item in os.listdir(full_path):
        if item.startswith('.'):
            continue
        item_path = os.path.join(full_path, item)
        if os.path.isfile(item_path) and item.lower().endswith(('.mid', '.midi')):
            relative_path = os.path.join(folder_path, item).replace('\\', '/') if folder_path else item
            files_dict[item] = relative_path
    
    if not files_dict:
        return {"success": False, "message": "No MIDI files in folder"}, 400
    
    # Load saved order if exists
    order_file = os.path.join(full_path, ".order.json")
    saved_order = []
    if os.path.exists(order_file):
        try:
            with open(order_file, 'r') as f:
                saved_order = json.load(f).get("order", [])
        except:
            pass
    
    # Sort files by saved order
    def sort_key(name):
        if name in saved_order:
            return (0, saved_order.index(name))
        return (1, name.lower())
    
    sorted_files = sorted(files_dict.keys(), key=sort_key)
    tracks = [files_dict[f] for f in sorted_files]
    
    # Set up playback state
    state["folder"] = folder_path or "Library"
    state["tracks"] = tracks
    state["index"] = 0
    state["playing"] = True
    state["paused"] = False
    
    threading.Thread(target=play_loop, daemon=True).start()
    
    return {"success": True, "message": f"Playing {len(tracks)} files"}, 200


@app.route("/status")
def status():
    """Get current playback status"""
    return {
        "playing": state["playing"],
        "paused": state["paused"],
        "folder": state["folder"],
        "tracks": state["tracks"],
        "index": state["index"],
        "volume": state["volume"],
        "tempo": state["tempo"]
    }


# ============================================================================
# Library API Routes
# ============================================================================

@app.route("/all_music", methods=["GET"])
def all_music():
    """Get files and folders in the library"""
    try:
        os.makedirs(MIDI_DIR, exist_ok=True)
        
        path_param = request.args.get('path', '').strip().lstrip('/')
        if path_param and ('..' in path_param or path_param.startswith('/')):
            return {"success": False, "message": "Invalid path"}, 400
        
        current_path = os.path.join(MIDI_DIR, path_param) if path_param else MIDI_DIR
        
        if not os.path.exists(current_path) or not os.path.isdir(current_path):
            return {"success": False, "message": "Path not found"}, 404
        
        # Get items from filesystem
        items = os.listdir(current_path)
        files_dict, folders_dict = {}, {}
        
        for item in items:
            if item.startswith('.'):
                continue
            item_path = os.path.join(current_path, item)
            relative_path = os.path.join(path_param, item).replace('\\', '/') if path_param else item
            
            if os.path.isdir(item_path):
                folders_dict[item] = relative_path
            elif item.lower().endswith(('.mid', '.midi')):
                files_dict[item] = relative_path
        
        # Load saved order if exists
        order_file = os.path.join(current_path, ".order.json")
        saved_order = []
        if os.path.exists(order_file):
            try:
                with open(order_file, 'r') as f:
                    saved_order = json.load(f).get("order", [])
            except:
                pass
        
        # Sort items: saved order first, then alphabetical for new items
        def sort_key(name):
            if name in saved_order:
                return (0, saved_order.index(name))
            return (1, name.lower())
        
        sorted_folders = sorted(folders_dict.keys(), key=sort_key)
        sorted_files = sorted(files_dict.keys(), key=sort_key)
        
        return {
            "success": True,
            "files": [{"path": files_dict[f], "name": f} for f in sorted_files],
            "folders": [{"path": folders_dict[f], "name": f} for f in sorted_folders],
            "path": path_param
        }, 200
    except Exception as e:
        print(f"Error in all_music: {e}")
        return {"success": False, "message": str(e)}, 500


@app.route("/create_folder", methods=["POST"])
def create_folder():
    data = request.get_json()
    if not data or "name" not in data:
        return {"success": False, "message": "Invalid request"}, 400
    
    folder_name = secure_filename(data["name"].strip())
    if not folder_name:
        return {"success": False, "message": "Folder name cannot be empty"}, 400
    
    path_param = data.get("path", "").strip().lstrip('/')
    if path_param and ('..' in path_param or path_param.startswith('/')):
        return {"success": False, "message": "Invalid path"}, 400
    
    parent_path = os.path.join(MIDI_DIR, path_param) if path_param else MIDI_DIR
    new_folder_path = os.path.join(parent_path, folder_name)
    
    if os.path.exists(new_folder_path):
        return {"success": False, "message": "Folder already exists"}, 400
    
    try:
        os.makedirs(new_folder_path, exist_ok=True)
        return {"success": True, "message": f"Created folder '{folder_name}'"}, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500


@app.route("/rename_folder", methods=["POST"])
def rename_folder():
    data = request.get_json()
    if not data or "old_path" not in data or "new_name" not in data:
        return {"success": False, "message": "Invalid request"}, 400
    
    old_path = data["old_path"].strip().lstrip('/')
    new_name = secure_filename(data["new_name"].strip())
    
    if not new_name:
        return {"success": False, "message": "New folder name cannot be empty"}, 400
    
    if '..' in old_path or old_path.startswith('/'):
        return {"success": False, "message": "Invalid path"}, 400
    
    old_full_path = os.path.join(MIDI_DIR, old_path)
    parent_dir = os.path.dirname(old_full_path)
    new_full_path = os.path.join(parent_dir, new_name)
    
    if not os.path.exists(old_full_path):
        return {"success": False, "message": "Folder not found"}, 404
    
    if os.path.exists(new_full_path):
        return {"success": False, "message": "A folder with that name already exists"}, 400
    
    try:
        os.rename(old_full_path, new_full_path)
        return {"success": True, "message": f"Renamed folder to '{new_name}'"}, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500


@app.route("/delete_folder", methods=["POST"])
def delete_folder():
    data = request.get_json()
    if not data or "path" not in data:
        return {"success": False, "message": "Invalid request"}, 400
    
    folder_path = data["path"].strip().lstrip('/')
    if '..' in folder_path or folder_path.startswith('/'):
        return {"success": False, "message": "Invalid path"}, 400
    
    full_path = os.path.join(MIDI_DIR, folder_path)
    
    if not os.path.exists(full_path):
        return {"success": False, "message": "Folder not found"}, 404
    
    if not os.path.isdir(full_path):
        return {"success": False, "message": "Path is not a folder"}, 400
    
    try:
        # Check if folder has any non-hidden items
        visible_items = [i for i in os.listdir(full_path) if not i.startswith('.')]
        if visible_items:
            return {"success": False, "message": "Folder is not empty"}, 400
        
        # Remove hidden files like .order.json first
        for item in os.listdir(full_path):
            os.remove(os.path.join(full_path, item))
        os.rmdir(full_path)
        return {"success": True, "message": "Deleted folder"}, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500


@app.route("/move_file", methods=["POST"])
def move_file():
    data = request.get_json()
    if not data or "file_path" not in data or "target_path" not in data:
        return {"success": False, "message": "Invalid request"}, 400
    
    file_path = data["file_path"].strip().lstrip('/')
    target_path = data["target_path"].strip().lstrip('/')
    
    if '..' in file_path or '..' in target_path:
        return {"success": False, "message": "Invalid path"}, 400
    
    source_full = os.path.join(MIDI_DIR, file_path)
    target_dir = os.path.join(MIDI_DIR, target_path) if target_path else MIDI_DIR
    
    if not os.path.exists(source_full):
        return {"success": False, "message": "File not found"}, 404
    
    if not os.path.isdir(target_dir):
        return {"success": False, "message": "Target is not a folder"}, 400
    
    filename = os.path.basename(file_path)
    dest_full = os.path.join(target_dir, filename)
    
    if os.path.exists(dest_full):
        return {"success": False, "message": "File already exists in target folder"}, 400
    
    try:
        shutil.move(source_full, dest_full)
        return {"success": True, "message": "Moved file"}, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500


@app.route("/delete_file", methods=["POST"])
def delete_file():
    data = request.get_json()
    if not data or "path" not in data:
        return {"success": False, "message": "Invalid request"}, 400
    
    file_path = data["path"].strip().lstrip('/')
    if '..' in file_path or file_path.startswith('/'):
        return {"success": False, "message": "Invalid path"}, 400
    
    full_path = os.path.join(MIDI_DIR, file_path)
    
    if not os.path.exists(full_path):
        return {"success": False, "message": "File not found"}, 404
    
    if os.path.isdir(full_path):
        return {"success": False, "message": "Path is a folder, not a file"}, 400
    
    try:
        os.remove(full_path)
        return {"success": True, "message": "Deleted file"}, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500


@app.route("/move_folder", methods=["POST"])
def move_folder():
    """Move a folder into another folder"""
    data = request.get_json()
    if not data or "folder_path" not in data or "target_path" not in data:
        return {"success": False, "message": "Invalid request"}, 400
    
    folder_path = data["folder_path"].strip().lstrip('/')
    target_path = data["target_path"].strip().lstrip('/')
    
    if '..' in folder_path or '..' in target_path:
        return {"success": False, "message": "Invalid path"}, 400
    
    # Can't move folder into itself
    if target_path.startswith(folder_path + '/') or target_path == folder_path:
        return {"success": False, "message": "Cannot move folder into itself"}, 400
    
    source_full = os.path.join(MIDI_DIR, folder_path)
    target_dir = os.path.join(MIDI_DIR, target_path) if target_path else MIDI_DIR
    
    if not os.path.exists(source_full):
        return {"success": False, "message": "Folder not found"}, 404
    
    if not os.path.isdir(source_full):
        return {"success": False, "message": "Source is not a folder"}, 400
    
    if target_path and not os.path.isdir(target_dir):
        return {"success": False, "message": "Target is not a folder"}, 400
    
    folder_name = os.path.basename(folder_path)
    dest_full = os.path.join(target_dir, folder_name)
    
    if os.path.exists(dest_full):
        return {"success": False, "message": "Folder already exists in target"}, 400
    
    try:
        shutil.move(source_full, dest_full)
        return {"success": True, "message": "Moved folder"}, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500


@app.route("/reorder_items", methods=["POST"])
def reorder_items():
    """Reorder items within a folder by saving order to .order.json"""
    data = request.get_json()
    if not data:
        return {"success": False, "message": "Invalid request"}, 400
    
    folder_path = data.get("folder_path", "").strip().lstrip('/')
    dragged_path = data.get("dragged_path", "").strip().lstrip('/')
    target_path = data.get("target_path", "").strip().lstrip('/')
    insert_before = data.get("insert_before", True)
    
    if '..' in folder_path or '..' in dragged_path or '..' in target_path:
        return {"success": False, "message": "Invalid path"}, 400
    
    folder_full = os.path.join(MIDI_DIR, folder_path) if folder_path else MIDI_DIR
    
    if not os.path.isdir(folder_full):
        return {"success": False, "message": "Folder not found"}, 404
    
    # Load current order or create from filesystem
    order_file = os.path.join(folder_full, ".order.json")
    current_order = []
    
    if os.path.exists(order_file):
        try:
            with open(order_file, 'r') as f:
                current_order = json.load(f).get("order", [])
        except:
            pass
    
    # Get actual items in folder
    items = []
    for item in os.listdir(folder_full):
        if item.startswith('.'):
            continue
        items.append(item)
    
    # Merge saved order with actual items
    ordered_items = []
    for item in current_order:
        if item in items:
            ordered_items.append(item)
            items.remove(item)
    ordered_items.extend(sorted(items))  # Add any new items
    
    # Get just the names (not full paths)
    dragged_name = os.path.basename(dragged_path)
    target_name = os.path.basename(target_path)
    
    if dragged_name not in ordered_items or target_name not in ordered_items:
        return {"success": False, "message": "Item not found"}, 404
    
    # Remove dragged item and reinsert at new position
    ordered_items.remove(dragged_name)
    target_index = ordered_items.index(target_name)
    
    if not insert_before:
        target_index += 1
    
    ordered_items.insert(target_index, dragged_name)
    
    # Save new order
    try:
        with open(order_file, 'w') as f:
            json.dump({"order": ordered_items}, f, indent=2)
        return {"success": True, "message": "Reordered items"}, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500


# ============================================================================
# Upload Route
# ============================================================================

@app.route("/upload", methods=["POST"])
def upload():
    if "files" not in request.files:
        return {"success": False, "message": "No files provided"}, 400
    
    files = request.files.getlist("files")
    if not files or files[0].filename == "":
        return {"success": False, "message": "No files selected"}, 400
    
    path_param = request.form.get("path", "").strip().lstrip('/')
    if path_param and ('..' in path_param or path_param.startswith('/')):
        return {"success": False, "message": "Invalid path"}, 400
    
    target_dir = os.path.join(MIDI_DIR, path_param) if path_param else MIDI_DIR
    os.makedirs(target_dir, exist_ok=True)
    
    uploaded_count = 0
    
    for file in files:
        if file and file.filename:
            filename = secure_filename(file.filename)
            if filename.lower().endswith(('.mid', '.midi')):
                filepath = os.path.join(target_dir, filename)
                file.save(filepath)
                uploaded_count += 1
    
    if uploaded_count > 0:
        message = f"Uploaded {uploaded_count} file(s)"
        if path_param:
            message += f" to {path_param}"
        return {"success": True, "message": message}, 200
    
    return {"success": False, "message": "No valid MIDI files uploaded"}, 400


# ============================================================================
# System Routes
# ============================================================================

@app.route("/reboot_raspberry")
def reboot_raspberry():
    subprocess.Popen(["sudo", "reboot"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return "<html><body><h2>Rebooting Raspberry Pi...</h2></body></html>", 200


@app.route("/reboot_midi_server")
def reboot_midi_server():
    subprocess.Popen(["sudo", "systemctl", "restart", "piano"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return redirect("/")


# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
