# Deployment Information

## Quick Deploy
```bash
./deploy.sh
```

## Manual Deployment Command
```bash
rsync -av ./ pianopi:~/piano/
```

**Note:** SSH key has been set up for the `pianopi` host.

## Live Server
- **URL:** http://pianopi.local:8080/
- **Host:** pianopi.local
- **Port:** 8080

## Server Configuration
- **Base Directory:** `/home/peteracworth/piano` (on the remote server)
- **Playlist Directory:** `/home/peteracworth/piano/playlists`
- **MIDI Port:** `PD USB MIDI MIDI 1`

