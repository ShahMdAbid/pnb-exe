const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, protocol, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { exec } = require('child_process');

// --- MUST BE OUTSIDE app.whenReady() ---
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'poring-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true
    }
  }
]);

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // <--- ADD THIS to remove the default Windows title bar
    titleBarStyle: 'hidden', // <--- ADD THIS for macOS compatibility
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
  });

  // --- START: MANUAL ZOOM OVERRIDE ---
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Check for Ctrl on Windows/Linux, or Cmd on macOS
    const isZoomModifier = process.platform === 'darwin' ? input.meta : input.control;

    if (isZoomModifier && input.type === 'keyDown') {
      if (input.key === '=' || input.key === '+') {
        const currentZoom = mainWindow.webContents.getZoomLevel();
        mainWindow.webContents.setZoomLevel(currentZoom + 0.5);
        event.preventDefault();
      } else if (input.key === '-') {
        const currentZoom = mainWindow.webContents.getZoomLevel();
        mainWindow.webContents.setZoomLevel(currentZoom - 0.5);
        event.preventDefault();
      } else if (input.key === '0') {
        mainWindow.webContents.setZoomLevel(0);
        event.preventDefault();
      }
    }
  });
  // --- END: MANUAL ZOOM OVERRIDE ---

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // Open DevTools automatically in development mode
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

// --- START: SINGLE INSTANCE LOCK ---
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // If we couldn't get the lock, it means another instance is already running. Quit immediately.
  app.quit();
} else {
  // If someone tries to open a second instance, focus the existing window instead.
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // App is ready, create the window
  app.whenReady().then(() => {
    // --- WORKSPACE & PATH MANAGEMENT ---
    const userDataPath = app.getPath('userData');
    const prefsPath = path.join(userDataPath, 'preferences.json');

    // Default to the OS AppData folder
    let currentWorkspace = userDataPath;

    if (fs.existsSync(prefsPath)) {
      try {
        const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        if (prefs.workspacePath && fs.existsSync(prefs.workspacePath)) {
          currentWorkspace = prefs.workspacePath;
        }
      } catch (e) {
        console.error("Failed to read workspace preferences", e);
      }
    }

    // Dynamic path helpers
    const getAssetsDir = () => path.join(currentWorkspace, 'assets');
    const getNotesDir = () => path.join(currentWorkspace, 'notes');
    const getExportsDir = () => path.join(currentWorkspace, 'Exports'); // FIXED: Now strictly follows the workspace!

    const initDirs = () => {
      if (!fs.existsSync(getAssetsDir())) fs.mkdirSync(getAssetsDir(), { recursive: true });
      if (!fs.existsSync(getNotesDir())) fs.mkdirSync(getNotesDir(), { recursive: true });
      if (!fs.existsSync(getExportsDir())) fs.mkdirSync(getExportsDir(), { recursive: true });
    };
    initDirs();

    ipcMain.handle('get-workspace', () => currentWorkspace);

    // FIXED: The Migration Engine that actually moves your files!
    ipcMain.handle('change-workspace', async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Workspace Folder',
        properties: ['openDirectory', 'createDirectory']
      });

      if (result.canceled) return null;

      const newWorkspace = result.filePaths[0];

      // Don't do anything if they picked the exact same folder
      if (newWorkspace === currentWorkspace) return currentWorkspace;

      const newAssetsDir = path.join(newWorkspace, 'assets');
      const newNotesDir = path.join(newWorkspace, 'notes');

      if (!fs.existsSync(newAssetsDir)) fs.mkdirSync(newAssetsDir, { recursive: true });
      if (!fs.existsSync(newNotesDir)) fs.mkdirSync(newNotesDir, { recursive: true });

      // MIGRATION: Copy existing notes and images to the new Google Drive folder
      try {
        if (fs.existsSync(getAssetsDir())) {
          fs.cpSync(getAssetsDir(), newAssetsDir, { recursive: true });
        }
        if (fs.existsSync(getNotesDir())) {
          fs.cpSync(getNotesDir(), newNotesDir, { recursive: true });
        }
        const oldWorkspaceJson = path.join(currentWorkspace, 'workspace.json');
        if (fs.existsSync(oldWorkspaceJson)) {
          fs.copyFileSync(oldWorkspaceJson, path.join(newWorkspace, 'workspace.json'));
        }
      } catch (e) {
        console.error("Failed to copy files during migration:", e);
      }

      // Update to new workspace
      currentWorkspace = newWorkspace;
      fs.writeFileSync(prefsPath, JSON.stringify({ workspacePath: currentWorkspace }));
      initDirs();

      return currentWorkspace;
    });

    // --- NATIVE ASSET INFRASTRUCTURE ---
    protocol.handle('poring-asset', async (request) => {
      try {
        let assetName = request.url.replace(/^poring-asset:\/\//i, '');
        assetName = assetName.replace(/\/$/, '');

        let filePath = path.join(getAssetsDir(), assetName);

        // Fallback: If it's missing in Google Drive, check the original AppData just in case
        if (!fs.existsSync(filePath)) {
          const fallbackPath = path.join(userDataPath, 'assets', assetName);
          if (fs.existsSync(fallbackPath)) filePath = fallbackPath;
        }

        const fileData = fs.readFileSync(filePath);
        return new Response(fileData, {
          status: 200,
          headers: {
            'Content-Type': assetName.endsWith('.png') ? 'image/png' : 'image/jpeg',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (err) {
        return new Response('Not Found', { status: 404 });
      }
    });

    ipcMain.handle('save-asset', async (event, { filename, buffer }) => {
      const filePath = path.join(getAssetsDir(), filename);
      fs.writeFileSync(filePath, Buffer.from(buffer));
      return `poring-asset://${filename}`;
    });

    // --- NATIVE NOTES INFRASTRUCTURE ---
    let cachedNotesHash = {};

    ipcMain.handle('load-workspace', () => {
      const workspaceJsonPath = path.join(currentWorkspace, 'workspace.json');
      if (!fs.existsSync(workspaceJsonPath)) return null;

      try {
        const data = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf8'));
        const safeName = (name) => name.replace(/[^a-zA-Z0-9 -]/g, '').trim() || 'Untitled';

        const notes = data.noteMeta.map(meta => {
          const mdPath = path.join(getNotesDir(), `${safeName(meta.name)}_${meta.id}.md`);
          const content = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
          cachedNotesHash[meta.id] = content.length + meta.name;
          return { ...meta, content };
        });
        return { notes, folders: data.folders, activeNoteId: data.activeNoteId };
      } catch (err) {
        return null;
      }
    });

    ipcMain.handle('sync-workspace', (event, { notes, folders, activeNoteId }) => {
      const safeName = (name) => name.replace(/[^a-zA-Z0-9 -]/g, '').trim() || 'Untitled';
      const noteMeta = notes.map(n => ({ id: n.id, name: n.name, folderId: n.folderId }));
      fs.writeFileSync(path.join(currentWorkspace, 'workspace.json'), JSON.stringify({ folders, activeNoteId, noteMeta }, null, 2));

      const currentFileNames = new Set();
      const activeNotesDir = getNotesDir();

      notes.forEach(n => {
        if (n.id.startsWith('about-poring-notebook')) return;
        const fileName = `${safeName(n.name)}_${n.id}.md`;
        currentFileNames.add(fileName);
        const hash = n.content.length + n.name;
        if (cachedNotesHash[n.id] !== hash) {
          fs.writeFileSync(path.join(activeNotesDir, fileName), n.content || '');
          cachedNotesHash[n.id] = hash;
        }
      });

      if (fs.existsSync(activeNotesDir)) {
        const files = fs.readdirSync(activeNotesDir);
        files.forEach(file => {
          if (file.endsWith('.md') && !currentFileNames.has(file)) {
            try { fs.unlinkSync(path.join(activeNotesDir, file)); } catch (e) { }
          }
        });
      }
      return true;
    });

    ipcMain.on('open-notes-folder', () => {
      shell.openPath(currentWorkspace);
    });

    // --- GOOGLE DOCS EXPORT PIPELINE (PANDOC ENGINE) ---
    ipcMain.handle('export-to-docx', async (event, { markdown, title }) => {
      return new Promise((resolve, reject) => {
        try {
          const tempDir = app.getPath('temp');
          const safeTitle = title.replace(/[^a-zA-Z0-9 -]/g, '').trim() || 'Document';

          const mdPath = path.join(tempDir, `${safeTitle}.md`);
          // FIXED: .docx exports now save permanently into your Workspace/Exports folder!
          const docxPath = path.join(getExportsDir(), `${safeTitle}.docx`);

          let processedMd = markdown;
          const mathBlocks = [];

          processedMd = processedMd.replace(/\$\$([\s\S]*?)\$\$/g, (match, content) => {
            const placeholder = `%%BLOCKMATH${mathBlocks.length}%%`;
            mathBlocks.push({ placeholder, content: `$$${content}$$` });
            return placeholder;
          });
          processedMd = processedMd.replace(/\$([^$]+?)\$/g, (match, content) => {
            const placeholder = `%%INLINEMATH${mathBlocks.length}%%`;
            mathBlocks.push({ placeholder, content: `$${content}$` });
            return placeholder;
          });

          processedMd = processedMd.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, altText, url) => {
            if (url.startsWith('poring-asset://')) {
              const filename = url.replace('poring-asset://', '');

              // Dynamically grab image from current workspace
              let absPath = path.join(getAssetsDir(), filename);
              // Fallback check
              if (!fs.existsSync(absPath)) {
                absPath = path.join(userDataPath, 'assets', filename);
              }
              absPath = absPath.replace(/\\/g, '/');

              let widthStr = "";
              if (altText.includes('|')) {
                const parts = altText.split('|');
                const w = parts[1].trim();
                if (/^\d+$/.test(w)) widthStr = `{width=${w}px}`;
              }
              return `![](${absPath})${widthStr}`;
            }
            return match;
          });

          const stripTags = (text) => {
            const tags = ['red', 'blue', 'green', 'orange', 'purple', 'gray', 'center', 'right', 'left'];
            const regex = new RegExp(`\\b(?:${tags.join('|')})\\[`, 'g');
            let match;
            while ((match = regex.exec(text)) !== null) {
              const start = match.index;
              const open = start + match[0].length - 1;
              let depth = 1; let j = open + 1;
              while (j < text.length && depth > 0) {
                if (text[j] === '[') depth++;
                else if (text[j] === ']') depth--;
                j++;
              }
              if (depth === 0) {
                const end = j - 1;
                const innerContent = text.substring(open + 1, end);
                text = text.substring(0, start) + innerContent + text.substring(j);
                regex.lastIndex = 0;
              } else { regex.lastIndex = open + 1; }
            }
            return text;
          };

          processedMd = stripTags(processedMd);
          processedMd = processedMd.replace(/^\s*\/\/(\d+)\s*$/gm, (match) => {
            const num = parseInt(match.replace(/\//g, '').trim(), 10);
            return '\n'.repeat(num);
          });
          processedMd = processedMd.replace(/^\s*\*\*\*\s*$/gm, '');

          const footnotes = [];
          processedMd = processedMd.replace(/\[\[(.+?)\]\]\(([\s\S]+?)\)/g, (match, word, desc) => {
            const index = footnotes.length + 1;
            footnotes.push(`[^${index}]: ${desc.trim()}`);
            return `${word}[^${index}]`;
          });

          mathBlocks.forEach(item => {
            processedMd = processedMd.replace(item.placeholder, item.content);
          });
          if (footnotes.length > 0) processedMd += '\n\n' + footnotes.join('\n');

          fs.writeFileSync(mdPath, processedMd, 'utf8');
          const command = `pandoc "${mdPath}" -f markdown -t docx -o "${docxPath}"`;

          exec(command, (error) => {
            if (error) {
              console.error("Pandoc Error:", error);
              return reject({ success: false, error: 'Pandoc failed: ' + error.message });
            }
            // FIXED: Automatically opens the workspace folder so you clearly see the file
            shell.showItemInFolder(docxPath);
            resolve({ success: true, docxPath: docxPath });
          });
        } catch (err) {
          reject({ success: false, error: err.message });
        }
      });
    });

    createWindow();
    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
// --- END: SINGLE INSTANCE LOCK ---

ipcMain.on('print-to-pdf', async (event, { html, title }) => {
  // If html is null/falsy: print the sender window directly (preserves blob: image URLs).
  // If html is a string: load into a hidden window (web-browser fallback path).
  let printWindow = null;
  let targetWC;

  if (html) {
    printWindow = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    targetWC = printWindow.webContents;
  } else {
    // Print the live renderer — all blob: URLs are already resolved here.
    targetWC = event.sender;
  }

  // Wait 800ms so the @media print <style> injected by React has been applied.
  setTimeout(async () => {
    try {
      const pdfData = await targetWC.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        // 'default' uses standard browser margins; we override via @page in CSS.
        margins: { marginType: 'default' }
      });

      const mainWindow = BrowserWindow.fromWebContents(event.sender);
      const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save PDF',
        defaultPath: `${title || 'Document'}.pdf`,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      });

      if (canceled || !filePath) {
        event.sender.send('print-to-pdf-cancelled');
        return;
      }

      try {
        fs.writeFileSync(filePath, pdfData);
        event.sender.send('print-to-pdf-success', filePath);
      } catch (fsError) {
        if (fsError.code === 'EBUSY') {
          event.sender.send('print-to-pdf-error', 'File is open in another program. Close it and try again.');
        } else {
          throw fsError;
        }
      }
    } catch (error) {
      console.error('PDF generation failed:', error);
      event.sender.send('print-to-pdf-error', error.message);
    } finally {
      if (printWindow) printWindow.close();
    }
  }, 800);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- CLIPBOARD LISTENER ---
let clipboardInterval = null;
let lastText = '';
let lastImage = null;

ipcMain.on('start-clipboard-listener', (event) => {
  // Always clear any existing interval to ensure we attach to the NEW window sender (fixes HMR/Reload issues)
  if (clipboardInterval) {
    clearInterval(clipboardInterval);
    clipboardInterval = null;
  }

  // Initialize state to current clipboard to avoid duplicate entry on start
  lastText = clipboard.readText();
  const initialImage = clipboard.readImage();
  lastImage = initialImage.isEmpty() ? null : initialImage.toDataURL();

  clipboardInterval = setInterval(() => {
    const currentText = clipboard.readText();
    const currentNativeImage = clipboard.readImage();
    const currentImage = currentNativeImage.isEmpty() ? null : currentNativeImage.toDataURL();

    // Prioritize image over text if both change
    if (currentImage && currentImage !== lastImage) {
      lastImage = currentImage;
      lastText = currentText;

      event.sender.send('clipboard-update', {
        type: 'image',
        dataURL: currentImage
      });
      return;
    }

    // Check for text changes
    if (currentText && currentText !== lastText) {
      lastText = currentText;
      event.sender.send('clipboard-update', {
        type: 'text',
        text: currentText
      });
    }
  }, 500);
});

ipcMain.on('stop-clipboard-listener', () => {
  if (clipboardInterval) {
    clearInterval(clipboardInterval);
    clipboardInterval = null;
  }
});

// Add this at the bottom of electron.cjs
ipcMain.on('window-minimize', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.minimize();
});

ipcMain.on('window-maximize', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});

ipcMain.on('window-close', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.close();
});

// --- AUTO UPDATER & EXTERNAL LINKS ---
ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

ipcMain.on('check-for-updates', (event) => {
  const win = BrowserWindow.getAllWindows()[0];
  const currentVersion = app.getVersion();

  // autoUpdater hangs in local development, so we bypass it here
  if (process.env.NODE_ENV === 'development') {
    if (win) win.webContents.send('update-message', `Dev mode (v${currentVersion})`);
    return;
  }

  if (win) win.webContents.send('update-message', `Checking... (v${currentVersion})`);

  // Catch network/config errors so it doesn't hang forever
  autoUpdater.checkForUpdates().catch(err => {
    if (win) win.webContents.send('update-message', `Error checking updates (v${currentVersion})`);
  });
});

autoUpdater.on('update-available', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('update-message', 'Update found! Downloading...');
});

autoUpdater.on('update-not-available', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('update-message', `Up to date (v${app.getVersion()})`);
});

autoUpdater.on('update-downloaded', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('update-message', 'Update downloaded! Restarting in 3s...');
  setTimeout(() => {
    autoUpdater.quitAndInstall();
  }, 3000);
});

autoUpdater.on('error', (err) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('update-message', 'Error checking for updates.');
});
