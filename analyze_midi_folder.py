#!/usr/bin/env python3
"""
Analyze MIDI files in a folder and report track counts.
Usage: python3 analyze_midi_folder.py [folder_path]
"""

import os
import sys
import mido

def get_piano_channels(mid):
    """Return channels with piano instruments (programs 0-7) that have notes"""
    channel_programs = {}
    channels_with_notes = set()
    
    for track in mid.tracks:
        for msg in track:
            if msg.type == 'program_change':
                channel_programs[msg.channel] = msg.program
            elif msg.type == 'note_on' and msg.velocity > 0:
                channels_with_notes.add(msg.channel)
    
    piano_channels = set()
    for channel, program in channel_programs.items():
        if program <= 7 and channel != 9 and channel in channels_with_notes:
            piano_channels.add(channel)
    
    return piano_channels, channels_with_notes

def analyze_file(filepath):
    """Analyze a single MIDI file"""
    try:
        mid = mido.MidiFile(filepath)
        piano_channels, all_channels = get_piano_channels(mid)
        
        # Count channels with notes (excluding drums on ch 9)
        non_drum_channels = all_channels - {9}
        
        return {
            'total_tracks': len(mid.tracks),
            'channels_with_notes': len(non_drum_channels),
            'piano_channels': len(piano_channels),
            'piano_channel_list': sorted(piano_channels),
            'has_drums': 9 in all_channels
        }
    except Exception as e:
        return {'error': str(e)}

def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/musik')
    
    if not os.path.isdir(folder):
        print(f"Error: {folder} is not a directory")
        sys.exit(1)
    
    print(f"Analyzing MIDI files in: {folder}")
    print("=" * 80)
    print(f"{'File':<50} {'Tracks':>8} {'Piano':>8} {'Channels'}")
    print("-" * 80)
    
    total_files = 0
    files_with_piano = 0
    errors = 0
    
    for root, dirs, files in os.walk(folder):
        for filename in sorted(files):
            if filename.lower().endswith(('.mid', '.midi')):
                filepath = os.path.join(root, filename)
                rel_path = os.path.relpath(filepath, folder)
                
                result = analyze_file(filepath)
                total_files += 1
                
                if 'error' in result:
                    print(f"{rel_path:<50} ERROR: {result['error']}")
                    errors += 1
                else:
                    # Truncate long paths
                    display_path = rel_path if len(rel_path) <= 50 else '...' + rel_path[-47:]
                    
                    piano_info = f"{result['piano_channels']}/{result['channels_with_notes']}"
                    channels = ','.join(map(str, result['piano_channel_list'])) if result['piano_channel_list'] else '-'
                    drums = ' +drums' if result['has_drums'] else ''
                    
                    print(f"{display_path:<50} {result['total_tracks']:>8} {piano_info:>8} {channels}{drums}")
                    
                    if result['piano_channels'] > 0:
                        files_with_piano += 1
    
    print("=" * 80)
    print(f"Total files: {total_files}")
    print(f"Files with piano: {files_with_piano}")
    print(f"Files without piano: {total_files - files_with_piano - errors}")
    print(f"Errors: {errors}")

if __name__ == '__main__':
    main()

