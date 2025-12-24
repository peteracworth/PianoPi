// File Explorer JavaScript

let currentPath = '';
let folderTreeData = {};

// ============================================================================
// Unified Drag-Drop System
// ============================================================================

const DragDrop = {
  draggedPath: null,
  draggedType: null,  // 'file' or 'folder'
  
  // Start dragging an item
  start(path, type, element) {
    this.draggedPath = path;
    this.draggedType = type;
    element.classList.add('dragging');
  },
  
  // End dragging
  end() {
    this.draggedPath = null;
    this.draggedType = null;
    // Clean up all visual indicators
    document.querySelectorAll('.dragging, .drop-target, .drop-above, .drop-below, .drop-into').forEach(el => {
      el.classList.remove('dragging', 'drop-target', 'drop-above', 'drop-below', 'drop-into');
    });
  },
  
  // Check if we can drop on a target
  canDrop(targetPath) {
    if (!this.draggedPath) return false;
    if (this.draggedPath === targetPath) return false;
    // Can't drop folder into itself or its children
    if (this.draggedType === 'folder' && targetPath && targetPath.startsWith(this.draggedPath + '/')) return false;
    return true;
  },
  
  // Execute the drop - move item into target folder
  dropIntoFolder(targetFolderPath) {
    if (!this.draggedPath) return;
    
    if (this.draggedType === 'file') {
      this.moveFile(this.draggedPath, targetFolderPath);
    } else {
      this.moveFolder(this.draggedPath, targetFolderPath);
    }
  },
  
  // Reorder items within same folder
  reorder(targetPath, insertBefore) {
    if (!this.draggedPath) return;
    
    const draggedParent = this.getParentPath(this.draggedPath);
    const targetParent = this.getParentPath(targetPath);
    
    // If different folders, do a move instead
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
        loadFiles(currentPath);
        loadFolderTree();
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
        refreshAll();
      } else {
        alert('Error: ' + data.message);
      }
    });
  },
  
  moveFolder(folderPath, targetFolder) {
    if (targetFolder === folderPath || (targetFolder && targetFolder.startsWith(folderPath + '/'))) {
      return; // Can't move into self
    }
    
    fetch('/move_folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: folderPath, target_path: targetFolder })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        refreshAll();
      } else {
        alert('Error: ' + data.message);
      }
    });
  },
  
  getParentPath(path) {
    if (!path || !path.includes('/')) return '';
    return path.substring(0, path.lastIndexOf('/'));
  },
  
  // Make an element draggable
  makeDraggable(element, path, type) {
    element.draggable = true;
    
    element.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      this.start(path, type, element);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', path);
    });
    
    element.addEventListener('dragend', () => {
      this.end();
    });
  },
  
  // Make an element a drop target for moving items INTO it (folder target)
  // Also accepts external file drops from desktop
  makeFolderDropTarget(element, folderPath) {
    element.addEventListener('dragover', (e) => {
      // Accept internal drag or external files
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
      
      // Check for external file drop (from desktop)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0 && !this.draggedPath) {
        this.uploadFiles(e.dataTransfer.files, folderPath);
        return;
      }
      
      // Internal drag-drop
      if (this.canDrop(folderPath)) {
        this.dropIntoFolder(folderPath);
      }
    });
  },
  
  // Upload files to a folder
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
        refreshAll();
      } else {
        alert('Upload error: ' + data.message);
      }
    });
  },
  
  // Make an element a reorder target (for reordering within same folder)
  makeReorderTarget(element, itemPath) {
    element.addEventListener('dragover', (e) => {
      if (!this.canDrop(itemPath)) return;
      e.preventDefault();
      e.stopPropagation();
      
      const rect = element.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      
      element.classList.remove('drop-above', 'drop-below');
      if (e.clientY < midY) {
        element.classList.add('drop-above');
      } else {
        element.classList.add('drop-below');
      }
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
// Folder Tree
// ============================================================================

async function loadFolderTree() {
  const treeContainer = document.getElementById('folderTree');
  if (!treeContainer) return;
  treeContainer.innerHTML = '<div class="tree-loading">Loading...</div>';
  
  try {
    folderTreeData = await fetchFolderStructure('');
    renderFolderTree();
  } catch (error) {
    treeContainer.innerHTML = '<p>Error loading folders</p>';
    console.error('Error loading folder tree:', error);
  }
}

async function fetchFolderStructure(path) {
  const url = '/all_music' + (path ? '?path=' + encodeURIComponent(path) : '');
  const response = await fetch(url);
  const data = await response.json();
  
  if (!data.success) throw new Error(data.message || 'Failed to load');
  
  const result = {
    path: path,
    name: path ? path.split('/').pop() : 'Library',
    folders: [],
    files: data.files || []
  };
  
  for (const folder of (data.folders || [])) {
    result.folders.push(await fetchFolderStructure(folder.path));
  }
  
  return result;
}

function renderFolderTree() {
  const treeContainer = document.getElementById('folderTree');
  treeContainer.innerHTML = '';
  
  // Root item
  const rootItem = createTreeItem('📁 Library', '', 0);
  rootItem.classList.add('selected');
  treeContainer.appendChild(rootItem);
  
  renderTreeLevel(treeContainer, folderTreeData.folders, 1);
}

function renderTreeLevel(container, folders, level) {
  folders.forEach(folder => {
    const item = createTreeItem('📁 ' + folder.name, folder.path, level);
    container.appendChild(item);
    
    if (folder.folders.length > 0) {
      const childContainer = document.createElement('div');
      childContainer.className = 'tree-children';
      childContainer.dataset.path = folder.path;
      renderTreeLevel(childContainer, folder.folders, level + 1);
      container.appendChild(childContainer);
    }
  });
}

function createTreeItem(name, path, level) {
  const item = document.createElement('div');
  item.className = 'tree-item';
  item.dataset.path = path;
  item.style.paddingLeft = (level * 20 + 10) + 'px';
  
  // Make non-root items draggable
  if (path) {
    DragDrop.makeDraggable(item, path, 'folder');
  }
  
  // All items are drop targets
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
// Breadcrumbs (with drop targets)
// ============================================================================

function updateBreadcrumbs(path) {
  const breadcrumbs = document.getElementById('breadcrumbs');
  if (!breadcrumbs) return;
  breadcrumbs.innerHTML = '';
  
  // Root breadcrumb
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
  
  // Make breadcrumb a drop target
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
    const url = '/all_music' + (path ? '?path=' + encodeURIComponent(path) : '');
    const response = await fetch(url);
    const data = await response.json();
    
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
  
  // Store for playback
  currentFiles = files.map(f => f.path);
  
  if (files.length === 0 && folders.length === 0) {
    container.innerHTML = '<p class="empty-message">This folder is empty.<br><span style="font-size: 0.9em; color: #888;">Drop MIDI files here to upload</span></p>';
    return;
  }
  
  // Render folders
  folders.forEach(folder => {
    container.appendChild(createFolderElement(folder));
  });
  
  // Render files
  files.forEach(file => {
    container.appendChild(createFileElement(file));
  });
}

function createFolderElement(folder) {
  const div = document.createElement('div');
  div.className = 'file-item folder-item';
  div.dataset.path = folder.path;
  
  const icon = document.createElement('span');
  icon.className = 'file-icon';
  icon.textContent = '📁';
  
  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = folder.name;
  
  const actions = document.createElement('div');
  actions.className = 'file-actions';
  
  const renameBtn = document.createElement('button');
  renameBtn.textContent = '✏️';
  renameBtn.title = 'Rename';
  renameBtn.onclick = (e) => { e.stopPropagation(); showRenameFolder(folder.path, folder.name); };
  
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '🗑️';
  deleteBtn.title = 'Delete';
  deleteBtn.onclick = (e) => { e.stopPropagation(); deleteFolder(folder.path); };
  
  actions.appendChild(renameBtn);
  actions.appendChild(deleteBtn);
  
  div.appendChild(icon);
  div.appendChild(name);
  div.appendChild(actions);
  
  // Click to navigate
  div.onclick = () => selectFolder(folder.path);
  
  // Make draggable and drop target
  DragDrop.makeDraggable(div, folder.path, 'folder');
  DragDrop.makeFolderDropTarget(div, folder.path);
  
  return div;
}

function createFileElement(file) {
  const div = document.createElement('div');
  div.className = 'file-item';
  div.dataset.path = file.path;
  
  const icon = document.createElement('span');
  icon.className = 'file-icon';
  icon.textContent = '🎵';
  
  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = file.name;
  
  const actions = document.createElement('div');
  actions.className = 'file-actions';
  
  const infoBtn = document.createElement('button');
  infoBtn.textContent = 'ℹ️';
  infoBtn.title = 'File Info';
  infoBtn.onclick = (e) => { e.stopPropagation(); showFileInfo(file.path); };
  
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '🗑️';
  deleteBtn.title = 'Delete';
  deleteBtn.onclick = (e) => { e.stopPropagation(); deleteFile(file.path); };
  
  actions.appendChild(infoBtn);
  actions.appendChild(deleteBtn);
  
  div.appendChild(icon);
  div.appendChild(name);
  div.appendChild(actions);
  
  // Click to play this file
  div.onclick = (e) => {
    // Don't play if clicking on action buttons
    if (e.target.closest('.file-actions')) return;
    playFile(file.path);
  };
  
  // Make draggable and reorder target
  DragDrop.makeDraggable(div, file.path, 'file');
  DragDrop.makeReorderTarget(div, file.path);
  
  return div;
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
      refreshAll();
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
      refreshAll();
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
      refreshAll();
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
      loadFiles(currentPath);
    } else {
      alert('Error: ' + data.message);
    }
  });
}

// ============================================================================
// File Container Drop Target (for uploading to current folder)
// ============================================================================

function setupFileContainerDrop() {
  const container = document.getElementById('fileContainer');
  if (!container) return;
  
  container.addEventListener('dragover', (e) => {
    // Only show drop target for external files when not over a specific item
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
    // Only handle if dropping on container itself (not on items)
    if ((e.target === container || e.target.classList.contains('empty-message')) && 
        e.dataTransfer.files.length > 0 && !DragDrop.draggedPath) {
      e.preventDefault();
      e.stopPropagation();
      DragDrop.uploadFiles(e.dataTransfer.files, currentPath);
    }
  });
}

// ============================================================================
// Refresh
// ============================================================================

async function refreshAll() {
  await loadFolderTree();
  await loadFiles(currentPath);
  updateBreadcrumbs(currentPath);
  
  setTimeout(() => {
    const item = document.querySelector('.tree-item[data-path="' + currentPath + '"]');
    if (item) item.classList.add('selected');
  }, 100);
}

// ============================================================================
// Playback Controls
// ============================================================================

let currentFiles = [];
let isPlaying = false;
let isPaused = false;
let statusInterval = null;

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
  .then(data => {
    updatePianoOnlyButton(data.piano_only);
  });
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
    } else {
      alert('Error: ' + data.message);
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
      updateNowPlaying(data.tracks[data.index]);
      highlightPlayingFile(data.tracks[data.index]);
    } else if (!data.playing) {
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
    
    // Update progress slider
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
  
  // Don't update if user is dragging
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
  // Debounce seek requests
  if (seekTimeout) clearTimeout(seekTimeout);
  seekTimeout = setTimeout(() => {
    fetch('/seek/' + position)
    .then(r => r.json())
    .then(data => {
      if (!data.success) {
        console.log('Seek failed:', data.message);
      }
    });
  }, 100);
}

function setupProgressSlider() {
  const slider = document.getElementById('progressSlider');
  if (!slider) return;
  
  slider.addEventListener('mousedown', () => {
    slider.dataset.dragging = 'true';
  });
  
  slider.addEventListener('touchstart', () => {
    slider.dataset.dragging = 'true';
  });
  
  slider.addEventListener('mouseup', () => {
    slider.dataset.dragging = 'false';
    seekTo(parseFloat(slider.value));
  });
  
  slider.addEventListener('touchend', () => {
    slider.dataset.dragging = 'false';
    seekTo(parseFloat(slider.value));
  });
  
  slider.addEventListener('input', () => {
    // Update time display while dragging
    const elapsed = document.getElementById('elapsedTime');
    if (elapsed) {
      elapsed.textContent = formatTime(parseFloat(slider.value));
    }
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
  .catch(err => {
    content.innerHTML = '<p class="error">Error loading file info</p>';
  });
}

function renderFileInfo(info) {
  let html = '<div class="info-grid">';
  
  // Basic info
  html += '<div class="info-section">';
  html += '<h4>📋 General</h4>';
  html += '<table class="info-table">';
  html += `<tr><td>Duration</td><td>${formatTime(info.duration_seconds)}</td></tr>`;
  html += `<tr><td>Type</td><td>${info.type_name}</td></tr>`;
  html += `<tr><td>Tracks</td><td>${info.num_tracks}</td></tr>`;
  html += `<tr><td>Total Notes</td><td>${info.total_notes.toLocaleString()}</td></tr>`;
  if (info.tempo_bpm) {
    html += `<tr><td>Tempo</td><td>${info.tempo_bpm} BPM</td></tr>`;
  }
  html += '</table>';
  html += '</div>';
  
  // Piano info
  html += '<div class="info-section">';
  html += '<h4>🎹 Piano</h4>';
  if (info.has_piano) {
    html += `<p class="status-good">✅ Piano tracks found (Ch: ${info.piano_channels.join(', ')})</p>`;
  } else {
    html += '<p class="status-warn">⚠️ No piano tracks - will play all instruments</p>';
  }
  html += '</div>';
  
  // Warnings
  if (info.warnings && info.warnings.length > 0) {
    html += '<div class="info-section warnings">';
    html += '<h4>⚠️ Warnings</h4>';
    info.warnings.forEach(w => {
      html += `<p class="warning-item">${w}</p>`;
    });
    html += '</div>';
  }
  
  html += '</div>';
  
  // Track list
  html += '<div class="info-section">';
  html += '<h4>🎼 Tracks</h4>';
  html += '<table class="tracks-table">';
  html += '<tr><th>Ch</th><th>Instrument</th><th>Notes</th><th>Range</th></tr>';
  
  info.track_info.forEach(track => {
    if (track.notes > 0) {
      let rowClass = '';
      if (track.is_piano) rowClass = 'piano-track';
      else if (track.is_drums) rowClass = 'drums-track';
      
      const name = track.name ? `<br><small>${track.name}</small>` : '';
      html += `<tr class="${rowClass}">`;
      html += `<td>${track.channel !== null ? track.channel : '-'}</td>`;
      html += `<td>${track.instrument || 'Unknown'}${name}</td>`;
      html += `<td>${track.notes.toLocaleString()}</td>`;
      html += `<td>${track.note_range || '-'}</td>`;
      html += '</tr>';
    }
  });
  
  html += '</table>';
  html += '</div>';
  
  return html;
}

function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.style.display = 'none';
}

// ============================================================================
// Initialize
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
  loadFolderTree();
  loadFiles('');
  setupFileContainerDrop();
  setupProgressSlider();
  updateStatus();
});
