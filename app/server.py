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
    "tempo": 100,
    "piano_only": True,  # Filter to piano channels only
    "position": 0,       # Current position in seconds
    "duration": 0,       # Total duration in seconds
    "seek_to": None,     # Target position for seeking (None = no seek)
    "thread_active": False  # Track if playback thread is running
}

# Lock to prevent race conditions when starting/stopping playback
playback_lock = threading.Lock()


# ============================================================================
# MIDI Playback
# ============================================================================

def send_all_notes_off():
    """Send all-notes-off message on all channels to silence any stuck notes"""
    try:
        port = mido.open_output(MIDI_PORT)
        for channel in range(16):
            # All notes off (CC 123)
            port.send(mido.Message('control_change', channel=channel, control=123, value=0))
            # All sound off (CC 120)  
            port.send(mido.Message('control_change', channel=channel, control=120, value=0))
        port.close()
    except Exception as e:
        print(f"Error sending all notes off: {e}")


def stop_and_reset():
    """Stop current playback, wait for thread to finish, then pause before new playback"""
    print("stop_and_reset: stopping playback...")
    state["playing"] = False
    state["paused"] = False
    
    # Wait for playback thread to fully stop
    wait_count = 0
    while state["thread_active"] and wait_count < 20:
        time.sleep(0.1)
        wait_count += 1
    
    if state["thread_active"]:
        print("Warning: playback thread did not stop in time")
    
    # Send all notes off to silence any stuck notes
    send_all_notes_off()
    
    # 1 second pause before new playback as requested
    print("stop_and_reset: pausing 1 second before new playback...")
    time.sleep(1.0)


def get_piano_channels(mid):
    """Scan MIDI file and return channels that have piano instruments (programs 0-7) AND notes"""
    channel_programs = {}
    channels_with_notes = set()
    
    for track in mid.tracks:
        for msg in track:
            if msg.type == 'program_change':
                channel_programs[msg.channel] = msg.program
            elif msg.type == 'note_on' and msg.velocity > 0:
                channels_with_notes.add(msg.channel)
    
    # Find channels with piano programs (0-7) that also have notes
    piano_channels = set()
    for channel, program in channel_programs.items():
        # Programs 0-7 are piano family, channel 9 is always drums
        if program <= 7 and channel != 9 and channel in channels_with_notes:
            piano_channels.add(channel)
    
    # If no piano found, return all non-drum channels that have notes
    if not piano_channels:
        piano_channels = channels_with_notes - {9}
    
    # Always exclude channel 9 (drums)
    piano_channels.discard(9)
    
    return piano_channels


def play_loop():
    """Main playback loop using mido's play() for accurate timing"""
    state["thread_active"] = True
    state["playing"] = True
    print(f"play_loop: starting playback, index={state['index']}")

    thumbsdown = load_thumbsdown()
    
    while state["playing"]:
        if state["index"] >= len(state["tracks"]):
            state["playing"] = False
            break

        track = state["tracks"][state["index"]]
        
        # Skip thumbs-downed tracks
        if track in thumbsdown:
            print(f"play_loop: skipping thumbs-downed track {track}")
            state["index"] += 1
            continue
        
        path = os.path.join(MIDI_DIR, track)
        port = None

        try:
            mid = mido.MidiFile(path)
            port = mido.open_output(MIDI_PORT)

            # Determine which channels to play
            if state.get("piano_only", True):
                allowed_channels = get_piano_channels(mid)
                print(f"Piano-only mode: playing channels {sorted(allowed_channels)}")
            else:
                allowed_channels = set(range(16))  # All channels

            # Pre-compute all messages with absolute timestamps
            messages = []
            abs_time = 0
            for msg in mid:
                abs_time += msg.time
                messages.append((abs_time, msg))
            
            total_duration = abs_time
            state["duration"] = total_duration
            state["position"] = 0
            print(f"Loaded {len(messages)} messages, duration {total_duration:.1f}s")
            
            # Play with absolute timing
            start_time = time.perf_counter()
            pause_offset = 0
            start_position = 0
            
            # Check if we need to seek to a position
            if state.get("seek_to") is not None:
                start_position = state["seek_to"]
                state["seek_to"] = None
            
            msg_index = 0
            
            # Skip to starting position if needed
            if start_position > 0:
                for i, (abs_time_check, msg_check) in enumerate(messages):
                    if abs_time_check >= start_position:
                        msg_index = i
                        break
                print(f"Seeking to {start_position:.1f}s, starting at message {msg_index}")
            
            for i in range(msg_index, len(messages)):
                abs_time, msg = messages[i]

                if not state["playing"]:
                    break

                # Check for seek request
                if state.get("seek_to") is not None:
                    break

                # Handle pause
                while state["paused"]:
                    pause_start = time.perf_counter()
                    while state["paused"] and state["playing"]:
                        time.sleep(0.05)
                        if state.get("seek_to") is not None:
                            break
                    if state["playing"] and state.get("seek_to") is None:
                        pause_offset += time.perf_counter() - pause_start
                    if not state["playing"] or state.get("seek_to") is not None:
                        break

                if not state["playing"] or state.get("seek_to") is not None:
                    break

                # Update current position
                state["position"] = abs_time

                # Calculate when this message should play
                tempo_scale = state["tempo"] / 100
                adjusted_time = (abs_time - start_position) / tempo_scale
                target_time = start_time + pause_offset + adjusted_time
                
                # Wait until target time
                now = time.perf_counter()
                wait_time = target_time - now
                
                if wait_time > 0.001:
                    time.sleep(wait_time)
                elif wait_time < -0.5:
                    print(f"Warning: playback {-wait_time:.2f}s behind schedule")

                # Send the message (filter by channel and type for piano playback)
                if not msg.is_meta:
                    # Filter by channel
                    if hasattr(msg, 'channel') and msg.channel not in allowed_channels:
                        continue
                    
                    # For player piano: only send note_on, note_off, and sustain pedal
                    # Skip control_change (except sustain), pitchwheel, program_change, etc.
                    if msg.type == "note_on":
                        volume_scale = state["volume"] / 127
                        msg = msg.copy(velocity=int(msg.velocity * volume_scale))
                        port.send(msg)
                    elif msg.type == "note_off":
                        port.send(msg)
                    elif msg.type == "control_change" and msg.control == 64:
                        # Sustain pedal (CC 64) - useful for piano
                        port.send(msg)

            # If we broke out due to seek, restart the loop
            if state.get("seek_to") is not None and state["playing"]:
                if port:
                    try:
                        port.close()
                    except:
                        pass
                continue

        except Exception as e:
            print(f"Playback error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # Always close the MIDI port
            if port:
                try:
                    port.close()
                except:
                    pass

        # Only advance to next track if song completed naturally (not stopped by user)
        if state["playing"]:
            state["index"] += 1
            if state["index"] >= len(state["tracks"]):
                state["playing"] = False
                print("play_loop: reached end of playlist")

    # Reset position when stopped
    if not state["playing"]:
        state["position"] = 0
    
    state["thread_active"] = False
    print("play_loop: thread ending")


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
    with playback_lock:
        if state["tracks"]:
            stop_and_reset()
            state["index"] = min(state["index"] + 1, len(state["tracks"]) - 1)
            print(f"next_track: starting track {state['index']}")
            threading.Thread(target=play_loop, daemon=True).start()
    return ("", 204)


@app.route("/prev")
def prev_track():
    with playback_lock:
        if state["tracks"]:
            current_position = state["position"]
            current_index = state["index"]
            
            stop_and_reset()
            
            # If more than 5 seconds into the song, restart current track
            # If within first 5 seconds, go to previous track (unless on first track)
            if current_position > 5 and current_index < len(state["tracks"]):
                # Restart current track
                print(f"prev_track: restarting current track {current_index} (was {current_position:.1f}s in)")
            elif current_index > 0:
                # Go to previous track
                state["index"] = current_index - 1
                print(f"prev_track: going to previous track {state['index']} (was only {current_position:.1f}s in)")
            else:
                # On first track, just restart it
                print(f"prev_track: restarting first track (was {current_position:.1f}s in)")
            
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
    send_all_notes_off()
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
    with playback_lock:
        if state["tracks"] and state["index"] < len(state["tracks"]):
            stop_and_reset()
            print(f"restart_track: restarting track {state['index']}")
            threading.Thread(target=play_loop, daemon=True).start()
    return ("", 204)


@app.route("/play_folder", methods=["POST"])
def play_folder():
    """Play all files in a folder"""
    data = request.get_json()
    folder_path = data.get("path", "").strip().lstrip('/') if data else ""
    start_index = data.get("start_index", 0) if data else 0
    
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
    
    with playback_lock:
        # Stop any current playback properly
        stop_and_reset()
        
        # Set up playback state
        state["folder"] = folder_path or "Library"
        state["tracks"] = tracks
        state["index"] = min(start_index, len(tracks) - 1) if start_index >= 0 else 0
        state["paused"] = False
        
        print(f"play_folder: starting playback of {len(tracks)} files")
        threading.Thread(target=play_loop, daemon=True).start()
    
    return {"success": True, "message": f"Playing {len(tracks)} files"}, 200


@app.route("/play_file", methods=["POST"])
def play_file():
    """Play a specific file (and continue with folder)"""
    data = request.get_json()
    file_path = data.get("path", "").strip().lstrip('/') if data else ""
    
    if not file_path or '..' in file_path:
        return {"success": False, "message": "Invalid path"}, 400
    
    # Get the folder containing this file
    folder_path = os.path.dirname(file_path)
    filename = os.path.basename(file_path)
    
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
    
    # Find the index of the clicked file
    try:
        start_index = sorted_files.index(filename)
    except ValueError:
        return {"success": False, "message": "File not found in folder"}, 404
    
    with playback_lock:
        # Stop any current playback properly
        stop_and_reset()
        
        # Set up playback state
        state["folder"] = folder_path or "Library"
        state["tracks"] = tracks
        state["index"] = start_index
        state["paused"] = False
        
        print(f"play_file: starting playback of {filename}")
        threading.Thread(target=play_loop, daemon=True).start()
    
    return {"success": True, "message": f"Playing {filename}"}, 200


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
        "tempo": state["tempo"],
        "piano_only": state.get("piano_only", True),
        "position": state.get("position", 0),
        "duration": state.get("duration", 0)
    }


@app.route("/seek/<float:position>")
def seek(position):
    """Seek to a position in the current track (in seconds)"""
    if not state["playing"] and not state["paused"]:
        return {"success": False, "message": "Nothing playing"}, 400
    
    duration = state.get("duration", 0)
    if position < 0:
        position = 0
    elif position > duration:
        position = duration
    
    state["seek_to"] = position
    
    # If paused, unpause to allow seek to take effect
    if state["paused"]:
        state["paused"] = False
    
    return {"success": True, "position": position}


@app.route("/toggle_piano_only")
def toggle_piano_only():
    """Toggle piano-only mode (filter non-piano instruments)"""
    state["piano_only"] = not state.get("piano_only", True)
    return {"piano_only": state["piano_only"]}


# General MIDI instrument names
GM_INSTRUMENTS = [
    "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano",
    "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet",
    "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
    "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
    "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)",
    "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics",
    "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass",
    "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
    "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
    "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2",
    "Choir Aahs", "Voice Oohs", "Synth Choir", "Orchestra Hit",
    "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
    "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet",
    "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
    "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)", "Lead 5 (charang)",
    "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)",
    "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)", "Pad 5 (bowed)",
    "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
    "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)",
    "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
    "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bagpipe", "Fiddle", "Shanai",
    "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
    "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot"
]

@app.route("/analyze_file", methods=["POST"])
def analyze_file():
    """Analyze a MIDI file for potential issues"""
    data = request.get_json()
    file_path = data.get("path", "").strip().lstrip('/') if data else ""
    
    if not file_path or '..' in file_path:
        return {"success": False, "message": "Invalid path"}, 400
    
    full_path = os.path.join(MIDI_DIR, file_path)
    
    if not os.path.exists(full_path):
        return {"success": False, "message": "File not found"}, 404
    
    try:
        mid = mido.MidiFile(full_path)
        
        # Analyze the file
        info = {
            "filename": os.path.basename(file_path),
            "type": mid.type,
            "type_name": ["Single Track", "Multi-Track Sync", "Multi-Track Async"][mid.type],
            "ticks_per_beat": mid.ticks_per_beat,
            "num_tracks": len(mid.tracks),
            "track_info": [],
            "total_notes": 0,
            "duration_seconds": mid.length,
            "has_piano": False,
            "piano_channels": [],
            "warnings": []
        }
        
        for i, track in enumerate(mid.tracks):
            track_info = {
                "index": i,
                "name": None,
                "channel": None,
                "program": None,
                "instrument": None,
                "is_piano": False,
                "is_drums": False,
                "notes": 0,
                "note_range": None
            }
            
            channels = set()
            programs = {}
            note_min, note_max = 127, 0
            
            for msg in track:
                if msg.type == 'track_name':
                    track_info["name"] = msg.name
                elif msg.type == 'program_change':
                    channels.add(msg.channel)
                    programs[msg.channel] = msg.program
                elif msg.type == 'note_on' and msg.velocity > 0:
                    track_info["notes"] += 1
                    note_min = min(note_min, msg.note)
                    note_max = max(note_max, msg.note)
                    if hasattr(msg, 'channel'):
                        channels.add(msg.channel)
            
            # Set channel and instrument info
            if channels:
                ch = list(channels)[0]
                track_info["channel"] = ch
                if ch == 9:
                    track_info["is_drums"] = True
                    track_info["instrument"] = "Drums/Percussion"
                elif ch in programs:
                    prog = programs[ch]
                    track_info["program"] = prog
                    track_info["instrument"] = GM_INSTRUMENTS[prog] if prog < len(GM_INSTRUMENTS) else f"Program {prog}"
                    if prog <= 7:
                        track_info["is_piano"] = True
                        info["has_piano"] = True
                        if ch not in info["piano_channels"]:
                            info["piano_channels"].append(ch)
            
            if track_info["notes"] > 0:
                track_info["note_range"] = f"{note_min}-{note_max}"
                info["total_notes"] += track_info["notes"]
            
            # Only include tracks with notes or names
            if track_info["notes"] > 0 or track_info["name"]:
                info["track_info"].append(track_info)
        
        # Check for potential issues
        if info["type"] == 2:
            info["warnings"].append("Type 2 MIDI (async tracks) may have timing issues")
        
        if not info["has_piano"]:
            info["warnings"].append("No piano tracks found - will play all instruments")
        
        # Check tempo
        for track in mid.tracks:
            for msg in track:
                if msg.type == 'set_tempo':
                    info["tempo_bpm"] = round(mido.tempo2bpm(msg.tempo))
                    break
        
        return {"success": True, "analysis": info}, 200
        
    except Exception as e:
        return {"success": False, "message": f"Error analyzing file: {str(e)}"}, 500


# ============================================================================
# Library API Routes
# ============================================================================

@app.route("/all_music", methods=["GET"])
def all_music():
    """Get files and folders in the library - optimized with scandir"""
    try:
        os.makedirs(MIDI_DIR, exist_ok=True)
        
        path_param = request.args.get('path', '').strip().lstrip('/')
        if path_param and ('..' in path_param or path_param.startswith('/')):
            return {"success": False, "message": "Invalid path"}, 400
        
        current_path = os.path.join(MIDI_DIR, path_param) if path_param else MIDI_DIR
        
        if not os.path.isdir(current_path):
            return {"success": False, "message": "Path not found"}, 404
        
        # Use scandir for better performance (avoids extra stat calls)
        files_dict, folders_dict = {}, {}
        
        with os.scandir(current_path) as entries:
            for entry in entries:
                if entry.name.startswith('.'):
                    continue
                relative_path = os.path.join(path_param, entry.name).replace('\\', '/') if path_param else entry.name
                
                if entry.is_dir():
                    folders_dict[entry.name] = relative_path
                elif entry.is_file() and entry.name.lower().endswith(('.mid', '.midi')):
                    files_dict[entry.name] = relative_path
        
        # Load saved order if exists
        order_file = os.path.join(current_path, ".order.json")
        saved_order = []
        if os.path.exists(order_file):
            try:
                with open(order_file, 'r') as f:
                    saved_order = json.load(f).get("order", [])
            except:
                pass
        
        # Convert to set for O(1) lookup
        saved_order_set = set(saved_order)
        saved_order_idx = {name: i for i, name in enumerate(saved_order)}
        
        # Sort items: saved order first, then alphabetical
        def sort_key(name):
            if name in saved_order_set:
                return (0, saved_order_idx[name])
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


# ============================================================================
# Favorites
# ============================================================================

FAVORITES_FILE = os.path.join(BASE_DIR, "favorites.json")
THUMBSDOWN_FILE = os.path.join(BASE_DIR, "thumbsdown.json")

def load_favorites():
    """Load favorites from JSON file"""
    if os.path.exists(FAVORITES_FILE):
        try:
            with open(FAVORITES_FILE, 'r') as f:
                return set(json.load(f))
        except:
            pass
    return set()

def save_favorites(favorites):
    """Save favorites to JSON file"""
    with open(FAVORITES_FILE, 'w') as f:
        json.dump(list(favorites), f)

def load_thumbsdown():
    """Load thumbs-down list from JSON file"""
    if os.path.exists(THUMBSDOWN_FILE):
        try:
            with open(THUMBSDOWN_FILE, 'r') as f:
                return set(json.load(f))
        except:
            pass
    return set()

def save_thumbsdown(thumbsdown):
    """Save thumbs-down list to JSON file"""
    with open(THUMBSDOWN_FILE, 'w') as f:
        json.dump(list(thumbsdown), f)

@app.route("/favorites", methods=["GET"])
def get_favorites():
    """Get list of favorited files"""
    favorites = load_favorites()
    return {"success": True, "favorites": list(favorites)}, 200

@app.route("/favorite", methods=["POST"])
def toggle_favorite():
    """Toggle favorite status for a file"""
    data = request.get_json()
    if not data or "path" not in data:
        return {"success": False, "message": "Invalid request"}, 400
    
    file_path = data["path"].strip()
    favorites = load_favorites()
    
    if file_path in favorites:
        favorites.remove(file_path)
        is_favorite = False
    else:
        favorites.add(file_path)
        is_favorite = True
    
    save_favorites(favorites)
    return {"success": True, "is_favorite": is_favorite}, 200


@app.route("/thumbsdown_list", methods=["GET"])
def get_thumbsdown():
    """Get list of thumbs-down files"""
    thumbsdown = load_thumbsdown()
    return {"success": True, "thumbsdown": list(thumbsdown)}, 200


@app.route("/thumbsdown", methods=["POST"])
def toggle_thumbsdown():
    """Toggle thumbs-down status for a file"""
    data = request.get_json()
    if not data or "path" not in data:
        return {"success": False, "message": "Invalid request"}, 400
    
    file_path = data["path"].strip()
    thumbsdown = load_thumbsdown()
    
    if file_path in thumbsdown:
        thumbsdown.remove(file_path)
        is_thumbsdown = False
    else:
        thumbsdown.add(file_path)
        is_thumbsdown = True
    
    save_thumbsdown(thumbsdown)
    return {"success": True, "is_thumbsdown": is_thumbsdown}, 200


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


@app.route("/reset_prodigy")
def reset_prodigy():
    """
    Attempt to reset the Prodigy 2 MIDI device without power cycling.
    Sends various MIDI reset messages to recover from a stuck state.
    """
    # Stop any current playback first
    state["playing"] = False
    state["paused"] = False
    time.sleep(0.2)
    
    try:
        port = mido.open_output(MIDI_PORT)
        
        # Step 1: All Notes Off on all channels (CC 123)
        for channel in range(16):
            port.send(mido.Message('control_change', channel=channel, control=123, value=0))
        time.sleep(0.05)
        
        # Step 2: All Sound Off on all channels (CC 120)
        for channel in range(16):
            port.send(mido.Message('control_change', channel=channel, control=120, value=0))
        time.sleep(0.05)
        
        # Step 3: Reset All Controllers on all channels (CC 121)
        for channel in range(16):
            port.send(mido.Message('control_change', channel=channel, control=121, value=0))
        time.sleep(0.05)
        
        # Step 4: Send MIDI System Reset (0xFF)
        # This is a system realtime message that tells devices to reset to power-on state
        try:
            port.send(mido.Message('reset'))
        except Exception as e:
            print(f"System Reset not supported: {e}")
        
        port.close()
        
        # Step 5: Try USB device reset as fallback
        try:
            # Find and reset USB MIDI device
            usb_reset_result = reset_usb_midi_device()
            if usb_reset_result:
                print("USB MIDI device reset successful")
        except Exception as e:
            print(f"USB reset failed or not available: {e}")
        
        return "<html><body><h2>✅ Reset commands sent to Prodigy 2</h2><p>If the device is still unresponsive, a power cycle may be required.</p><a href='/'>← Back to Library</a></body></html>", 200
        
    except Exception as e:
        return f"<html><body><h2>❌ Reset failed</h2><p>Error: {e}</p><a href='/'>← Back to Library</a></body></html>", 500


def reset_usb_midi_device():
    """
    Attempt to reset USB MIDI device by finding it and triggering a USB reset.
    This forces the device to re-enumerate.
    """
    try:
        import usb.core
        import usb.util
        
        # Find USB MIDI devices (class 1 = Audio, subclass 3 = MIDI Streaming)
        # Also look for common MIDI device vendor IDs
        devices = list(usb.core.find(find_all=True, bDeviceClass=0x01))
        
        if not devices:
            # Try finding by interface class instead
            devices = list(usb.core.find(find_all=True))
            devices = [d for d in devices if any(
                getattr(cfg, 'bInterfaceClass', 0) == 1 
                for cfg in d.configurations() 
                for intf in cfg.interfaces() 
                for alt in intf
            )]
        
        for device in devices:
            try:
                print(f"Resetting USB device: {device.idVendor:04x}:{device.idProduct:04x}")
                device.reset()
                return True
            except Exception as e:
                print(f"Could not reset device: {e}")
                continue
        
        return False
    except ImportError:
        print("pyusb not installed - USB reset not available")
        return False
    except Exception as e:
        print(f"USB reset error: {e}")
        return False


# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
