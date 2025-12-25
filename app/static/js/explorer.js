// File Explorer JavaScript - Optimized for Raspberry Pi

let currentPath = '';
let folderCache = {};  // Cache folder contents to avoid refetching
let favorites = new Set();  // Set of favorited file paths
let thumbsdown = new Set();  // Set of thumbs-downed file paths
let showFavoritesOnly = false;  // Filter mode

// ============================================================================
// Unified Drag-Drop System
// ============================================================================

const DragDrop = {
  draggedPath: null,
  draggedType: null,
  
  start(path, type, element) {
    this.draggedPath = path;
    this.draggedType = type;
    element.classList.add('dragging');
  },
  
  end() {
    this.draggedPath = null;
    this.draggedType = null;
    document.querySelectorAll('.dragging, .drop-target, .drop-above, .drop-below, .drop-into').forEach(el => {
      el.classList.remove('dragging', 'drop-target', 'drop-above', 'drop-below', 'drop-into');
    });
  },
  
  canDrop(targetPath) {
    if (!this.draggedPath) return false;
    if (this.draggedPath === targetPath) return false;
    if (this.draggedType === 'folder' && targetPath && targetPath.startsWith(this.draggedPath + '/')) return false;
    return true;
  },
  
  dropIntoFolder(targetFolderPath) {
    if (!this.draggedPath) return;
    if (this.draggedType === 'file') {
      this.moveFile(this.draggedPath, targetFolderPath);
    } else {
      this.moveFolder(this.draggedPath, targetFolderPath);
    }
  },
  
  reorder(targetPath, insertBefore) {
    if (!this.draggedPath) return;
    
    const draggedParent = this.getParentPath(this.draggedPath);
    const targetParent = this.getParentPath(targetPath);
    
    if (draggedParent !== targetParent) {
      this.dropIntoFolder(targetParent);
      return;
    }
    
    fetch('/reorder_items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folder_path: draggedParent,
        dragged_path: this.draggedPath,
        dragged_type: this.draggedType,
        target_path: targetPath,
        insert_before: insertBefore
      })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        invalidateCache(draggedParent);
        loadFiles(currentPath);
      }
    });
  },
  
  moveFile(filePath, targetFolder) {
    fetch('/move_file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath, target_path: targetFolder })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        invalidateCache();
        refreshCurrentView();
      } else {
        alert('Error: ' + data.message);
      }
    });
  },
  
  moveFolder(folderPath, targetFolder) {
    if (targetFolder === folderPath || (targetFolder && targetFolder.startsWith(folderPath + '/'))) {
      return;
    }
    
    fetch('/move_folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: folderPath, target_path: targetFolder })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        invalidateCache();
        refreshCurrentView();
      } else {
        alert('Error: ' + data.message);
      }
    });
  },
  
  getParentPath(path) {
    if (!path || !path.includes('/')) return '';
    return path.substring(0, path.lastIndexOf('/'));
  },
  
  makeDraggable(element, path, type) {
    element.draggable = true;
    element.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      this.start(path, type, element);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', path);
    });
    element.addEventListener('dragend', () => this.end());
  },
  
  makeFolderDropTarget(element, folderPath) {
    element.addEventListener('dragover', (e) => {
      const hasFiles = e.dataTransfer.types.includes('Files');
      if (!hasFiles && !this.canDrop(folderPath)) return;
      e.preventDefault();
      e.stopPropagation();
      element.classList.add('drop-target');
    });
    
    element.addEventListener('dragleave', (e) => {
      if (!element.contains(e.relatedTarget)) {
        element.classList.remove('drop-target');
      }
    });
    
    element.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      element.classList.remove('drop-target');
      
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0 && !this.draggedPath) {
        this.uploadFiles(e.dataTransfer.files, folderPath);
        return;
      }
      
      if (this.canDrop(folderPath)) {
        this.dropIntoFolder(folderPath);
      }
    });
  },
  
  uploadFiles(files, targetFolder) {
    const formData = new FormData();
    let count = 0;
    
    for (let i = 0; i < files.length; i++) {
      if (files[i].name.toLowerCase().match(/\.midi?$/)) {
        formData.append('files', files[i]);
        count++;
      }
    }
    
    if (count === 0) {
      alert('Please drop MIDI files (.mid or .midi)');
      return;
    }
    
    if (targetFolder) {
      formData.append('path', targetFolder);
    }
    
    fetch('/upload', { method: 'POST', body: formData })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        invalidateCache(targetFolder);
        if (targetFolder === currentPath) {
          loadFiles(currentPath);
        }
      } else {
        alert('Upload error: ' + data.message);
      }
    });
  },
  
  makeReorderTarget(element, itemPath) {
    element.addEventListener('dragover', (e) => {
      if (!this.canDrop(itemPath)) return;
      e.preventDefault();
      e.stopPropagation();
      
      const rect = element.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      
      element.classList.remove('drop-above', 'drop-below');
      element.classList.add(e.clientY < midY ? 'drop-above' : 'drop-below');
    });
    
    element.addEventListener('dragleave', () => {
      element.classList.remove('drop-above', 'drop-below');
    });
    
    element.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const insertBefore = element.classList.contains('drop-above');
      element.classList.remove('drop-above', 'drop-below');
      if (this.canDrop(itemPath)) {
        this.reorder(itemPath, insertBefore);
      }
    });
  }
};

// ============================================================================
// Cache Management
// ============================================================================

function invalidateCache(path) {
  if (path === undefined) {
    folderCache = {};
  } else {
    delete folderCache[path || ''];
  }
}

async function fetchFolder(path) {
  // Return cached if available
  if (folderCache[path || '']) {
    return folderCache[path || ''];
  }
  
  const url = '/all_music' + (path ? '?path=' + encodeURIComponent(path) : '');
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.success) {
    folderCache[path || ''] = data;
  }
  return data;
}

// ============================================================================
// Folder Tree - LAZY LOADING (only fetches what's visible)
// ============================================================================

async function loadFolderTree() {
  const treeContainer = document.getElementById('folderTree');
  if (!treeContainer) return;
  
  treeContainer.innerHTML = '';
  
  // Root item
  const rootItem = createTreeItem('📁 Library', '', 0, true);
  rootItem.classList.add('selected');
  treeContainer.appendChild(rootItem);
  
  // Load only root level folders
  try {
    const data = await fetchFolder('');
    if (data.success && data.folders) {
      data.folders.forEach(folder => {
        const item = createTreeItem('📁 ' + folder.name, folder.path, 1, false);
        treeContainer.appendChild(item);
      });
    }
  } catch (error) {
    console.error('Error loading folder tree:', error);
  }
}

function createTreeItem(name, path, level, isRoot) {
  const item = document.createElement('div');
  item.className = 'tree-item';
  item.dataset.path = path;
  item.style.paddingLeft = (level * 20 + 10) + 'px';
  
  if (!isRoot) {
    DragDrop.makeDraggable(item, path, 'folder');
  }
  DragDrop.makeFolderDropTarget(item, path);
  
  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = name;
  item.appendChild(label);
  
  item.onclick = (e) => {
    e.preventDefault();
    selectFolder(path);
  };
  
  return item;
}

function selectFolder(path) {
  document.querySelectorAll('.tree-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.path === path);
  });
  
  currentPath = path;
  updateBreadcrumbs(path);
  loadFiles(path);
  
  const header = document.getElementById('currentFolderName');
  if (header) {
    header.textContent = path ? '🎵 ' + path.split('/').pop() : '🎵 All Files';
  }
}

// ============================================================================
// Breadcrumbs
// ============================================================================

function updateBreadcrumbs(path) {
  const breadcrumbs = document.getElementById('breadcrumbs');
  if (!breadcrumbs) return;
  breadcrumbs.innerHTML = '';
  
  const root = createBreadcrumb('📁 Library', '');
  breadcrumbs.appendChild(root);
  
  if (path) {
    const parts = path.split('/');
    let currentPathBuild = '';
    
    parts.forEach((part) => {
      const separator = document.createElement('span');
      separator.className = 'breadcrumb-separator';
      separator.textContent = ' / ';
      breadcrumbs.appendChild(separator);
      
      currentPathBuild += (currentPathBuild ? '/' : '') + part;
      const crumb = createBreadcrumb(part, currentPathBuild);
      breadcrumbs.appendChild(crumb);
    });
  }
}

function createBreadcrumb(text, path) {
  const crumb = document.createElement('a');
  crumb.href = '#';
  crumb.className = 'breadcrumb-item';
  crumb.textContent = text;
  crumb.dataset.path = path;
  
  crumb.onclick = (e) => {
    e.preventDefault();
    selectFolder(path);
  };
  
  DragDrop.makeFolderDropTarget(crumb, path);
  return crumb;
}

// ============================================================================
// File List Display
// ============================================================================

async function loadFiles(path) {
  const container = document.getElementById('fileContainer');
  if (!container) return;
  container.innerHTML = '<p>Loading...</p>';
  
  try {
    const data = await fetchFolder(path);
    
    if (data.success) {
      renderFiles(data.files || [], data.folders || []);
    } else {
      container.innerHTML = '<p>Error: ' + (data.message || 'Failed to load') + '</p>';
    }
  } catch (error) {
    container.innerHTML = '<p>Error loading files</p>';
    console.error('Error:', error);
  }
}

function renderFiles(files, folders) {
  const container = document.getElementById('fileContainer');
  container.innerHTML = '';
  
  currentFiles = files.map(f => f.path);
  
  // Add ".." parent folder link if not at root
  if (currentPath) {
    const parentDiv = document.createElement('div');
    parentDiv.className = 'file-item folder-item parent-folder';
    parentDiv.innerHTML = `
      <span class="file-icon">📁</span>
      <span class="file-name">..</span>
    `;
    parentDiv.onclick = () => {
      const parentPath = currentPath.includes('/') 
        ? currentPath.substring(0, currentPath.lastIndexOf('/'))
        : '';
      selectFolder(parentPath);
    };
    container.appendChild(parentDiv);
  }
  
  if (files.length === 0 && folders.length === 0 && !currentPath) {
    container.innerHTML = '<p class="empty-message">This folder is empty.<br><span style="font-size: 0.9em; color: #888;">Drop MIDI files here to upload</span></p>';
    return;
  }
  
  folders.forEach(folder => container.appendChild(createFolderElement(folder)));
  files.forEach(file => container.appendChild(createFileElement(file)));
  
  // Re-apply playing highlight after rendering
  if (currentlyPlayingPath) {
    highlightPlayingFile(currentlyPlayingPath);
  }
}

function createFolderElement(folder) {
  const div = document.createElement('div');
  div.className = 'file-item folder-item';
  div.dataset.path = folder.path;
  
  div.innerHTML = `
    <span class="file-icon">📁</span>
    <span class="file-name">${escapeHtml(folder.name)}</span>
    <div class="file-actions">
      <button title="Rename">✏️</button>
      <button title="Delete">🗑️</button>
    </div>
  `;
  
  const buttons = div.querySelectorAll('button');
  buttons[0].onclick = (e) => { e.stopPropagation(); showRenameFolder(folder.path, folder.name); };
  buttons[1].onclick = (e) => { e.stopPropagation(); deleteFolder(folder.path); };
  
  div.onclick = () => selectFolder(folder.path);
  
  DragDrop.makeDraggable(div, folder.path, 'folder');
  DragDrop.makeFolderDropTarget(div, folder.path);
  
  return div;
}

function createFileElement(file) {
  const div = document.createElement('div');
  div.className = 'file-item';
  div.dataset.path = file.path;
  
  const isFavorite = favorites.has(file.path);
  const isThumbsdown = thumbsdown.has(file.path);
  
  // Add visual indicator for thumbs-downed files
  if (isThumbsdown) {
    div.classList.add('thumbsdown');
  }
  
  div.innerHTML = `
    <span class="file-icon">🎵</span>
    <span class="file-name">${escapeHtml(file.name)}</span>
    <div class="file-actions">
      <button class="favorite-btn ${isFavorite ? 'active' : ''}" title="Favorite">${isFavorite ? '❤️' : '🤍'}</button>
      <button class="thumbsdown-btn ${isThumbsdown ? 'active' : ''}" title="Skip this song">${isThumbsdown ? '👎' : '👎🏻'}</button>
      <button title="File Info">ℹ️</button>
      <button title="Delete">🗑️</button>
    </div>
  `;
  
  const buttons = div.querySelectorAll('button');
  buttons[0].onclick = (e) => { e.stopPropagation(); toggleFavorite(file.path, buttons[0]); };
  buttons[1].onclick = (e) => { e.stopPropagation(); toggleThumbsdown(file.path, buttons[1], div); };
  buttons[2].onclick = (e) => { e.stopPropagation(); showFileInfo(file.path); };
  buttons[3].onclick = (e) => { e.stopPropagation(); deleteFile(file.path); };
  
  div.onclick = (e) => {
    if (e.target.closest('.file-actions')) return;
    playFile(file.path);
  };
  
  DragDrop.makeDraggable(div, file.path, 'file');
  DragDrop.makeReorderTarget(div, file.path);
  
  return div;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// Folder Management
// ============================================================================

function showCreateFolder() {
  document.getElementById('createFolderModal').style.display = 'block';
  document.getElementById('newFolderName').value = '';
  document.getElementById('newFolderName').focus();
}

function createFolder() {
  const name = document.getElementById('newFolderName').value.trim();
  if (!name) { alert('Please enter a folder name'); return; }
  
  fetch('/create_folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, path: currentPath })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      document.getElementById('createFolderModal').style.display = 'none';
      invalidateCache(currentPath);
      refreshCurrentView();
    } else {
      alert('Error: ' + data.message);
    }
  });
}

function showRenameFolder(folderPath, folderName) {
  document.getElementById('renameFolderModal').style.display = 'block';
  document.getElementById('renameFolderName').value = folderName;
  document.getElementById('renameFolderName').focus();
  document.getElementById('renameFolderModal').dataset.folderPath = folderPath;
}

function renameFolder() {
  const folderPath = document.getElementById('renameFolderModal').dataset.folderPath;
  const newName = document.getElementById('renameFolderName').value.trim();
  if (!newName) { alert('Please enter a new folder name'); return; }
  
  fetch('/rename_folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_path: folderPath, new_name: newName })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      document.getElementById('renameFolderModal').style.display = 'none';
      invalidateCache();
      refreshCurrentView();
    } else {
      alert('Error: ' + data.message);
    }
  });
}

function deleteFolder(folderPath) {
  if (!confirm('Delete this folder? It must be empty.')) return;
  
  fetch('/delete_folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: folderPath })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      invalidateCache();
      refreshCurrentView();
    } else {
      alert('Error: ' + data.message);
    }
  });
}

// ============================================================================
// File Management
// ============================================================================

function deleteFile(filePath) {
  if (!confirm('Delete this file permanently?')) return;
  
  fetch('/delete_file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      invalidateCache(currentPath);
      loadFiles(currentPath);
    } else {
      alert('Error: ' + data.message);
    }
  });
}

// ============================================================================
// File Container Drop Target
// ============================================================================

function setupFileContainerDrop() {
  const container = document.getElementById('fileContainer');
  if (!container) return;
  
  container.addEventListener('dragover', (e) => {
    if (e.target === container || e.target.classList.contains('empty-message')) {
      if (e.dataTransfer.types.includes('Files') && !DragDrop.draggedPath) {
        e.preventDefault();
        container.classList.add('drop-target');
      }
    }
  });
  
  container.addEventListener('dragleave', (e) => {
    if (!container.contains(e.relatedTarget)) {
      container.classList.remove('drop-target');
    }
  });
  
  container.addEventListener('drop', (e) => {
    container.classList.remove('drop-target');
    if ((e.target === container || e.target.classList.contains('empty-message')) && 
        e.dataTransfer.files.length > 0 && !DragDrop.draggedPath) {
      e.preventDefault();
      e.stopPropagation();
      DragDrop.uploadFiles(e.dataTransfer.files, currentPath);
    }
  });
}

// ============================================================================
// Refresh - optimized to only reload what's needed
// ============================================================================

async function refreshCurrentView() {
  loadFolderTree();
  loadFiles(currentPath);
  updateBreadcrumbs(currentPath);
}

// ============================================================================
// Playback Controls
// ============================================================================

let currentFiles = [];
let isPlaying = false;
let isPaused = false;
let statusInterval = null;
let currentlyPlayingPath = null;  // Track currently playing file for highlighting

function setVolume(value) {
  document.getElementById('volumeValue').textContent = value;
  fetch('/volume/' + value);
}

function setTempo(value) {
  document.getElementById('tempoValue').textContent = value + '%';
  fetch('/tempo/' + value);
}

function togglePianoOnly() {
  fetch('/toggle_piano_only')
  .then(r => r.json())
  .then(data => updatePianoOnlyButton(data.piano_only));
}

function updatePianoOnlyButton(isOn) {
  const btn = document.getElementById('pianoOnlyBtn');
  if (!btn) return;
  btn.textContent = isOn ? 'ON' : 'OFF';
  btn.classList.toggle('active', isOn);
}

function playFolder() {
  if (currentFiles.length === 0) {
    alert('No files in this folder to play');
    return;
  }
  
  fetch('/play_folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: currentPath })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      isPlaying = true;
      isPaused = false;
      updatePlayPauseButton();
      startStatusPolling();
    } else {
      alert('Error: ' + data.message);
    }
  });
}

function playFile(filePath) {
  fetch('/play_file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      isPlaying = true;
      isPaused = false;
      updatePlayPauseButton();
      startStatusPolling();
    }
  });
}

function togglePlayPause() {
  if (!isPlaying) {
    playFolder();
  } else if (isPaused) {
    fetch('/resume').then(() => { isPaused = false; updatePlayPauseButton(); });
  } else {
    fetch('/pause').then(() => { isPaused = true; updatePlayPauseButton(); });
  }
}

function stopPlayback() {
  fetch('/stop').then(() => {
    isPlaying = false;
    isPaused = false;
    updatePlayPauseButton();
    updateNowPlaying(null);
    highlightPlayingFile(null);
  });
}

function skipForward() { fetch('/next').then(updateStatus); }
function skipBack() { fetch('/prev').then(updateStatus); }
function restartTrack() { fetch('/restart').then(updateStatus); }

function updatePlayPauseButton() {
  const playIcon = document.getElementById('playIcon');
  const pauseIcon = document.getElementById('pauseIcon');
  const btn = document.getElementById('playPauseBtn');
  if (!playIcon || !pauseIcon || !btn) return;
  
  playIcon.style.display = (isPlaying && !isPaused) ? 'none' : 'block';
  pauseIcon.style.display = (isPlaying && !isPaused) ? 'block' : 'none';
  btn.title = isPlaying ? (isPaused ? 'Resume' : 'Pause') : 'Play';
}

function updateNowPlaying(track) {
  const label = document.getElementById('nowPlayingLabel');
  const trackSpan = document.getElementById('nowPlayingTrack');
  if (!label || !trackSpan) return;
  
  if (track) {
    label.textContent = isPaused ? 'Paused:' : 'Now Playing:';
    trackSpan.textContent = track.split('/').pop();
  } else {
    label.textContent = 'Stopped';
    trackSpan.textContent = '';
  }
}

function highlightPlayingFile(path) {
  document.querySelectorAll('.file-item.playing').forEach(el => el.classList.remove('playing'));
  if (path) {
    const item = document.querySelector('.file-item[data-path="' + path + '"]');
    if (item) item.classList.add('playing');
  }
}

function startStatusPolling() {
  if (statusInterval) clearInterval(statusInterval);
  statusInterval = setInterval(updateStatus, 1000);
  updateStatus();
}

function updateStatus() {
  fetch('/status')
  .then(r => r.json())
  .then(data => {
    isPlaying = data.playing;
    isPaused = data.paused;
    updatePlayPauseButton();
    updatePianoOnlyButton(data.piano_only);
    
    if (data.playing && data.tracks && data.tracks.length > 0 && data.index < data.tracks.length) {
      currentlyPlayingPath = data.tracks[data.index];
      updateNowPlaying(currentlyPlayingPath);
      highlightPlayingFile(currentlyPlayingPath);
      // Start polling if not already polling (e.g. page load while playing)
      if (!statusInterval) {
        statusInterval = setInterval(updateStatus, 1000);
      }
    } else if (!data.playing) {
      currentlyPlayingPath = null;
      updateNowPlaying(null);
      highlightPlayingFile(null);
      if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
    }
    
    const volSlider = document.getElementById('volumeSlider');
    const volValue = document.getElementById('volumeValue');
    const tempoSlider = document.getElementById('tempoSlider');
    const tempoValue = document.getElementById('tempoValue');
    
    if (volSlider) volSlider.value = data.volume;
    if (volValue) volValue.textContent = data.volume;
    if (tempoSlider) tempoSlider.value = data.tempo;
    if (tempoValue) tempoValue.textContent = data.tempo + '%';
    
    updateProgressSlider(data.position || 0, data.duration || 0);
  });
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins + ':' + (secs < 10 ? '0' : '') + secs;
}

function updateProgressSlider(position, duration) {
  const slider = document.getElementById('progressSlider');
  const elapsed = document.getElementById('elapsedTime');
  const total = document.getElementById('totalTime');
  
  if (!slider || !elapsed || !total) return;
  if (slider.dataset.dragging === 'true') return;
  
  elapsed.textContent = formatTime(position);
  total.textContent = formatTime(duration);
  
  if (duration > 0) {
    slider.max = duration;
    slider.value = position;
  } else {
    slider.max = 100;
    slider.value = 0;
  }
}

let seekTimeout = null;

function seekTo(position) {
  if (seekTimeout) clearTimeout(seekTimeout);
  seekTimeout = setTimeout(() => {
    fetch('/seek/' + position);
  }, 100);
}

function setupProgressSlider() {
  const slider = document.getElementById('progressSlider');
  if (!slider) return;
  
  slider.addEventListener('mousedown', () => slider.dataset.dragging = 'true');
  slider.addEventListener('touchstart', () => slider.dataset.dragging = 'true');
  slider.addEventListener('mouseup', () => {
    slider.dataset.dragging = 'false';
    seekTo(parseFloat(slider.value));
  });
  slider.addEventListener('touchend', () => {
    slider.dataset.dragging = 'false';
    seekTo(parseFloat(slider.value));
  });
  slider.addEventListener('input', () => {
    const elapsed = document.getElementById('elapsedTime');
    if (elapsed) elapsed.textContent = formatTime(parseFloat(slider.value));
  });
}

// ============================================================================
// File Info Modal
// ============================================================================

function showFileInfo(filePath) {
  const modal = document.getElementById('fileInfoModal');
  const overlay = document.getElementById('modalOverlay');
  const title = document.getElementById('fileInfoTitle');
  const content = document.getElementById('fileInfoContent');
  
  title.textContent = filePath.split('/').pop();
  content.innerHTML = '<p style="text-align:center;">Loading...</p>';
  
  modal.style.display = 'block';
  overlay.style.display = 'block';
  
  fetch('/analyze_file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      content.innerHTML = renderFileInfo(data.analysis);
    } else {
      content.innerHTML = '<p class="error">Error: ' + data.message + '</p>';
    }
  })
  .catch(() => {
    content.innerHTML = '<p class="error">Error loading file info</p>';
  });
}

function renderFileInfo(info) {
  let html = '<div class="info-grid">';
  
  html += '<div class="info-section"><h4>📋 General</h4><table class="info-table">';
  html += `<tr><td>Duration</td><td>${formatTime(info.duration_seconds)}</td></tr>`;
  html += `<tr><td>Type</td><td>${info.type_name}</td></tr>`;
  html += `<tr><td>Tracks</td><td>${info.num_tracks}</td></tr>`;
  html += `<tr><td>Total Notes</td><td>${info.total_notes.toLocaleString()}</td></tr>`;
  if (info.tempo_bpm) html += `<tr><td>Tempo</td><td>${info.tempo_bpm} BPM</td></tr>`;
  html += '</table></div>';
  
  html += '<div class="info-section"><h4>🎹 Piano</h4>';
  if (info.has_piano) {
    html += `<p class="status-good">✅ Piano tracks found (Ch: ${info.piano_channels.join(', ')})</p>`;
  } else {
    html += '<p class="status-warn">⚠️ No piano tracks - will play all instruments</p>';
  }
  html += '</div>';
  
  if (info.warnings && info.warnings.length > 0) {
    html += '<div class="info-section warnings"><h4>⚠️ Warnings</h4>';
    info.warnings.forEach(w => html += `<p class="warning-item">${w}</p>`);
    html += '</div>';
  }
  
  html += '</div>';
  
  html += '<div class="info-section"><h4>🎼 Tracks</h4>';
  html += '<table class="tracks-table"><tr><th>Ch</th><th>Instrument</th><th>Notes</th><th>Range</th></tr>';
  
  info.track_info.forEach(track => {
    if (track.notes > 0) {
      let rowClass = track.is_piano ? 'piano-track' : (track.is_drums ? 'drums-track' : '');
      const name = track.name ? `<br><small>${track.name}</small>` : '';
      html += `<tr class="${rowClass}">`;
      html += `<td>${track.channel !== null ? track.channel : '-'}</td>`;
      html += `<td>${track.instrument || 'Unknown'}${name}</td>`;
      html += `<td>${track.notes.toLocaleString()}</td>`;
      html += `<td>${track.note_range || '-'}</td>`;
      html += '</tr>';
    }
  });
  
  html += '</table></div>';
  return html;
}

function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.style.display = 'none';
}

// ============================================================================
// Favorites
// ============================================================================

async function loadFavorites() {
  try {
    const response = await fetch('/favorites');
    const data = await response.json();
    if (data.success) {
      favorites = new Set(data.favorites);
    }
  } catch (error) {
    console.error('Error loading favorites:', error);
  }
}

async function loadThumbsdown() {
  try {
    const response = await fetch('/thumbsdown_list');
    const data = await response.json();
    if (data.success) {
      thumbsdown = new Set(data.thumbsdown);
    }
  } catch (error) {
    console.error('Error loading thumbsdown:', error);
  }
}

function toggleThumbsdown(filePath, button, fileElement) {
  fetch('/thumbsdown', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      if (data.is_thumbsdown) {
        thumbsdown.add(filePath);
        button.textContent = '👎';
        button.classList.add('active');
        fileElement.classList.add('thumbsdown');
        
        // Only skip if this is the currently playing song
        if (currentlyPlayingPath === filePath) {
          skipForward();
        }
      } else {
        thumbsdown.delete(filePath);
        button.textContent = '👎🏻';
        button.classList.remove('active');
        fileElement.classList.remove('thumbsdown');
      }
    }
  });
}

function toggleFavorite(filePath, button) {
  fetch('/favorite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      if (data.is_favorite) {
        favorites.add(filePath);
        button.textContent = '❤️';
        button.classList.add('active');
      } else {
        favorites.delete(filePath);
        button.textContent = '🤍';
        button.classList.remove('active');
        
        // If showing favorites only and we just unfavorited, refresh
        if (showFavoritesOnly) {
          showAllFavorites();
        }
      }
    }
  });
}

function goToPlayingTrack() {
  // Get current playing track from status
  fetch('/status')
  .then(r => r.json())
  .then(data => {
    if (data.playing && data.tracks && data.tracks.length > 0 && data.index < data.tracks.length) {
      const currentTrack = data.tracks[data.index];
      // Get the folder path (everything before the last /)
      const folderPath = currentTrack.includes('/') 
        ? currentTrack.substring(0, currentTrack.lastIndexOf('/'))
        : '';
      
      // Turn off favorites filter if active
      if (showFavoritesOnly) {
        showFavoritesOnly = false;
        const btn = document.getElementById('favoritesFilterBtn');
        if (btn) {
          btn.classList.remove('active');
          btn.querySelector('.heart').textContent = '♡';
        }
      }
      
      // Navigate to the folder
      selectFolder(folderPath);
    } else {
      alert('No track is currently playing');
    }
  });
}

function toggleFavoritesFilter() {
  showFavoritesOnly = !showFavoritesOnly;
  
  const btn = document.getElementById('favoritesFilterBtn');
  if (btn) {
    btn.classList.toggle('active', showFavoritesOnly);
    btn.querySelector('.heart').textContent = showFavoritesOnly ? '❤️' : '♡';
  }
  
  // Update header and breadcrumbs
  const header = document.getElementById('currentFolderName');
  const breadcrumbs = document.getElementById('breadcrumbs');
  
  if (showFavoritesOnly) {
    if (header) header.textContent = '❤️ Favorites';
    if (breadcrumbs) breadcrumbs.innerHTML = '<span class="breadcrumb-item">❤️ All Favorites</span>';
    showAllFavorites();
  } else {
    if (header) header.textContent = currentPath ? '🎵 ' + currentPath.split('/').pop() : '🎵 All Files';
    updateBreadcrumbs(currentPath);
    loadFiles(currentPath);
  }
}

function showAllFavorites() {
  const container = document.getElementById('fileContainer');
  if (!container) return;
  
  if (favorites.size === 0) {
    container.innerHTML = '<p class="empty-message">No favorites yet.<br><span style="font-size: 0.9em; color: #888;">Click the 🤍 on any track to add it to favorites</span></p>';
    return;
  }
  
  // Create file objects from all favorites
  const files = Array.from(favorites).map(path => ({
    path: path,
    name: path.split('/').pop()
  }));
  
  // Sort alphabetically
  files.sort((a, b) => a.name.localeCompare(b.name));
  
  // Update currentFiles for playback
  currentFiles = files.map(f => f.path);
  
  // Render
  container.innerHTML = '';
  files.forEach(file => container.appendChild(createFileElement(file)));
}

// ============================================================================
// Initialize
// ============================================================================

document.addEventListener('DOMContentLoaded', async function() {
  await loadFavorites();
  await loadThumbsdown();
  loadFolderTree();
  loadFiles('');
  setupFileContainerDrop();
  setupProgressSlider();
  updateStatus();
});
