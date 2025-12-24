#!/bin/bash
# Quick deployment script for pianopi

echo "🚀 Deploying to pianopi..."
rsync -av --exclude='venv/' --exclude='__pycache__/' ./ pianopi:~/piano/
echo "🔄 Restarting MIDI server..."
ssh pianopi "sudo systemctl restart piano"
echo "✅ Deployment complete!"
echo "🌐 Server: http://pianopi.local:8080/"
