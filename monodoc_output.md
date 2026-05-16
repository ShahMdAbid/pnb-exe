<notes>
- Some files may have been excluded based on .gitignore rules and monodoc's configuration
- Binary files are not included in this packed representation.
</notes>

## Directory Structure

```text
├── .gitignore
├── electron.cjs
├── index.html
├── netlify.toml
├── package.json
├── preload.cjs
├── src
│   ├── App.css
│   ├── App.jsx
│   ├── assets
│   │   ├── Begula.png
│   │   └── sust_logo.png
│   ├── components
│   │   ├── ColorfulEditor.jsx
│   │   ├── DrawMode.jsx
│   │   └── LivePreviewEditor.jsx
│   ├── guide.md
│   ├── main.jsx
│   └── utils
│       ├── aiService.js
│       └── poringFileHandler.js
└── vite.config.js
```

### .gitignore

```gitignore
node_modules
dist
dist-electron
.env
.env.local
.DS_Store

```

### electron.cjs

```cjs
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

```

### index.html

```html
<!doctype html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <link rel="icon" type="image/svg+xml" href="/vite.svg" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Poring Notebook</title>
</head>

<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>

</html>
```

### netlify.toml

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

```

### package.json

```json
{
    "name": "poring-notebook",
    "private": true,
    "version": "1.1.3",
    "type": "module",
    "main": "electron.cjs",
    "scripts": {
        "electron:start": "cross-env NODE_ENV=development concurrently \"node ./node_modules/vite/bin/vite.js\" \"wait-on http://localhost:5173 && electron .\"",
        "electron:build": "node ./node_modules/vite/bin/vite.js build && electron-builder",
        "dev": "node ./node_modules/vite/bin/vite.js",
        "build": "node ./node_modules/vite/bin/vite.js build",
        "lint": "eslint .",
        "preview": "node ./node_modules/vite/bin/vite.js preview"
    },
    "dependencies": {
        "@codemirror/lang-markdown": "^6.5.0",
        "@codemirror/language-data": "^6.5.2",
        "@codemirror/view": "^6.42.0",
        "@google/genai": "^1.52.0",
        "@uiw/react-codemirror": "^4.25.9",
        "cors": "^2.8.6",
        "dotenv": "^17.4.2",
        "electron-updater": "^6.8.3",
        "express": "^5.2.1",
        "file-saver": "^2.0.5",
        "jszip": "^3.10.1",
        "katex": "^0.16.9",
        "localforage": "^1.10.0",
        "lucide-react": "^0.344.0",
        "prismjs": "^1.30.0",
        "react": "^18.2.0",
        "react-dom": "^18.2.0",
        "react-markdown": "^9.0.1",
        "react-simple-code-editor": "^0.14.1",
        "rehype-katex": "^7.0.0",
        "rehype-raw": "^7.0.0",
        "remark-breaks": "^4.0.0",
        "remark-footnotes": "^4.0.1",
        "remark-gfm": "^4.0.0",
        "remark-math": "^6.0.0"
    },
    "devDependencies": {
        "@types/react": "^18.2.66",
        "@types/react-dom": "^18.2.22",
        "@vitejs/plugin-react": "^4.2.1",
        "concurrently": "^9.2.1",
        "cross-env": "^10.1.0",
        "electron": "^41.3.0",
        "electron-builder": "^26.8.1",
        "eslint": "^8.57.0",
        "eslint-plugin-react": "^7.34.1",
        "eslint-plugin-react-hooks": "^4.6.0",
        "eslint-plugin-react-refresh": "^0.4.6",
        "vite": "^5.2.0",
        "wait-on": "^9.0.5"
    },
    "build": {
        "appId": "com.poringnotebook.app",
        "productName": "Poring Notebook",
        "artifactName": "Poring-Notebook-Setup-${version}.${ext}",
        "directories": {
            "output": "dist-electron"
        },
        "files": [
            "dist/**/*",
            "electron.cjs",
            "preload.cjs"
        ],
        "publish": [
            {
                "provider": "github",
                "owner": "ShahMdAbid",
                "repo": "pnb-exe"
            }
        ],
        "win": {
            "target": "nsis"
        }
    }
}
```

### preload.cjs

```cjs
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    printToPDF: (html, title) => ipcRenderer.send('print-to-pdf', { html, title }),
    onPrintSuccess: (callback) => ipcRenderer.on('print-to-pdf-success', (event, path) => callback(path)),
    onPrintError: (callback) => ipcRenderer.on('print-to-pdf-error', (event, error) => callback(error)),
    onPrintCancelled: (callback) => ipcRenderer.on('print-to-pdf-cancelled', () => callback()),
    removeAllPrintListeners: () => {
        ipcRenderer.removeAllListeners('print-to-pdf-success');
        ipcRenderer.removeAllListeners('print-to-pdf-error');
        ipcRenderer.removeAllListeners('print-to-pdf-cancelled');
    },
    startClipboardListener: () => ipcRenderer.send('start-clipboard-listener'),
    stopClipboardListener: () => ipcRenderer.send('stop-clipboard-listener'),
    onClipboardUpdate: (callback) => {
        ipcRenderer.removeAllListeners('clipboard-update');
        ipcRenderer.on('clipboard-update', (event, data) => callback(data));
    },
    windowMinimize: () => ipcRenderer.send('window-minimize'),
    windowMaximize: () => ipcRenderer.send('window-maximize'),
    windowClose: () => ipcRenderer.send('window-close'),

    // --- AUTO UPDATER & EXTERNAL LINKS ---
    openExternal: (url) => ipcRenderer.send('open-external', url),
    checkForUpdates: () => ipcRenderer.send('check-for-updates'),
    onUpdateMessage: (callback) => {
        ipcRenderer.removeAllListeners('update-message');
        ipcRenderer.on('update-message', (event, message) => callback(message));
    },
    saveAsset: (filename, buffer) => ipcRenderer.invoke('save-asset', { filename, buffer }),
    loadWorkspace: () => ipcRenderer.invoke('load-workspace'),
    syncWorkspace: (data) => ipcRenderer.invoke('sync-workspace', data),
    openNotesFolder: () => ipcRenderer.send('open-notes-folder'),
    exportToDocx: (data) => ipcRenderer.invoke('export-to-docx', data),

    // --- NEW: WORKSPACE MANAGEMENT ---
    getWorkspace: () => ipcRenderer.invoke('get-workspace'),
    changeWorkspace: () => ipcRenderer.invoke('change-workspace'),
});

```

### src/App.css

```css
@import url('https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;700&family=Inter:wght@400;700&family=JetBrains+Mono&family=Source+Code+Pro:wght@400;600&display=block');
/* Imports the official Computer Modern (LaTeX) fonts */
@import url('https://cdn.jsdelivr.net/gh/bitjson/cm-web-fonts@latest/fonts.css');

* {
  box-sizing: border-box;
}

:root {
  --p-font: 'Computer Modern Serif', serif;
  --p-size: 11px;
  --bg-dark: #1e1e1e;
  --bg-sidebar: #f8f8f8;
  --bg-editor: #fdfdfd;
  --bg-preview: #ffffff;
  /* Changed from #525659 to seamlessly blend with the PDF page */
  --accent: #3b82f6;
  --text-main: #232323;
  --text-sidebar: #232323;
  --border-color: #e0e0e0;
  --bg-modal-input: #f5f5f5;
  --bg-modal-btn: #f5f5f5;
}

.dark-theme {
  --bg-dark: #121212;
  --bg-sidebar: #0f0f0f;
  --bg-editor: #16161e;
  --bg-preview: #ffffff;
  /* Keep white in dark mode to blend with the white A4 paper */
  --text-main: #ffffff !important;
  --text-sidebar: #e0e0e0;
  --border-color: #333333;
  --bg-modal-input: #121212;
  --bg-modal-btn: #121212;
}

/* Styled Links */
.styled-link {
  color: #3b82f6 !important;
  text-decoration: underline;
  cursor: pointer;
  font-weight: 500;
}

.styled-link:hover {
  color: #60a5fa !important;
}

/* Image Captions */
.resized-image {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

.image-paragraph {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 1.5em 0 !important;
}

.image-caption {
  margin-top: 8px;
  font-size: 0.9em;
  color: #666;
  font-style: italic;
  font-family: var(--p-font);
}

.dark-theme .image-caption {
  color: #aaa;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: 16px;
  /* Force base font size for consistent rendering */
}

body,
html,
#root {
  height: 100%;
  width: 100%;
  overflow: hidden;
  font-family: var(--p-font);
}

.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: var(--bg-preview);
}

/* Header */
.header {
  height: 38px;
  background: #000;
  color: white;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 15px;
  z-index: 100;
  border-bottom: none;
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo {
  font-weight: 700;
  font-size: 1.1rem;
  color: #fff;
}

.btn {
  background: transparent;
  border: none;
  color: #ccc;
  cursor: pointer;
  padding: 8px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  transition: 0.2s;
}

.btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

/* Modern Button Gradient */
.btn-primary,
.btn-insert,
.btn-magic {
  background: linear-gradient(135deg, var(--accent), #2563eb);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2);
}

.btn-primary:hover,
.btn-insert:hover,
.btn-magic:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  border-color: transparent;
}

.btn-primary:active,
.btn-insert:active,
.btn-magic:active {
  transform: translateY(0);
}

.btn-primary.btn-sm {
  padding: 6px 14px;
  font-size: 0.8rem;
  border-radius: 6px;
}

/* Insert & Magic Buttons specific override */
.btn-insert,
.btn-magic {
  padding: 6px 12px;
  background: white;
  /* Default background for these two if they aren't primary */
  color: var(--text-main);
  border: 1px solid var(--border-color);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.dark-theme .btn-insert,
.dark-theme .btn-magic {
  background: #2a2a2a;
  border-color: #444;
}

.btn-insert:hover,
.btn-magic:hover {
  background: var(--bg-editor);
  border-color: var(--accent);
  color: var(--accent);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.btn-magic {
  background: var(--bg-editor);
  color: #8b5cf6 !important;
  /* Keep a hint of purple */
  border: 1px solid var(--border-color) !important;
  padding: 6px 10px !important;
  border-radius: 6px !important;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 0;
  transition: all 0.2s;
}

.dark-theme .btn-magic {
  background: #2a2a2a;
}

.btn-magic:hover {
  border-color: #8b5cf6 !important;
  background: rgba(139, 92, 246, 0.05);
  transform: translateY(-1px);
}

.btn-custom-refine {
  background: var(--bg-editor);
  color: var(--text-main);
  border: 1px solid var(--border-color);
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 0;
  transition: all 0.2s;
}

.btn-custom-refine:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(59, 130, 246, 0.05);
}

.dark-theme .btn-custom-refine {
  background: #2a2a2a;
}

.btn-undo-refine {
  background: var(--bg-editor);
  color: #f59e0b !important;
  /* Amber/Orange for revert action */
  border: 1px solid var(--border-color) !important;
  padding: 6px 10px !important;
  border-radius: 6px !important;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.btn-undo-refine:hover {
  border-color: #f59e0b !important;
  background: rgba(245, 158, 11, 0.05);
  transform: translateY(-1px);
}

.dark-theme .btn-undo-refine {
  background: #2a2a2a;
}

.btn-export {
  background: var(--bg-editor);
  color: var(--text-main);
  border: 1px solid var(--border-color);
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  transition: all 0.2s;
}

.dark-theme .btn-export {
  background: #2a2a2a;
}

.btn-export:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(59, 130, 246, 0.05);
}

.typo-select {
  background: #333;
  color: white;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.85rem;
}

.typo-size {
  width: 50px;
  background: #333;
  color: white;
  border: none;
  padding: 4px;
  border-radius: 4px;
  text-align: center;
}

/* Main Layout */
.main-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Sidebar Native Redesign */
.sidebar {
  width: 260px;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
}

.sidebar.collapsed {
  width: 0;
  overflow: hidden;
  border-right: none;
}

.sidebar-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sidebar-action-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.sidebar-icon-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-editor);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  padding: 6px 0;
  border-radius: 6px;
  cursor: pointer;
  transition: 0.2s;
}

.sidebar-icon-btn:hover {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.sidebar-search {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 10px;
  color: #888;
}

.sidebar-search input {
  width: 100%;
  padding: 8px 10px 8px 32px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-editor);
  color: var(--text-main);
  font-size: 0.85rem;
  outline: none;
  transition: border-color 0.2s;
}

.sidebar-search input:focus {
  border-color: var(--accent);
}

.folder-title {
  color: var(--text-main) !important;
  font-weight: 600;
  opacity: 0.85 !important;
}

.folder-title:hover {
  opacity: 1 !important;
}

.child-note {
  padding-left: 36px !important;
  font-size: 0.85rem;
}

.sidebar-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

/* Folder Group */
.folder-group {
  margin-bottom: 4px;
}

/* Note Items - Base */
.note-item {
  position: relative;
  padding: 10px 16px;
  cursor: pointer;
  color: var(--text-sidebar);
  opacity: 0.7;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: all 0.15s ease;
  border-left: 3px solid transparent;
}

.note-item:hover {
  background: rgba(255, 255, 255, 0.05);
  opacity: 1;
}

/* Folder Style - Override */
.note-item[style*="color: rgb(110, 142, 251)"] {
  font-weight: 600;
  opacity: 1;
  padding: 12px 16px;
  background: rgba(110, 142, 251, 0.08);
  border-left: 3px solid rgba(110, 142, 251, 0.4);
}

.note-item[style*="color: rgb(110, 142, 251)"]:hover {
  background: rgba(110, 142, 251, 0.12);
}

/* Nested Note Style */
.note-item[style*="padding-left: 30px"] {
  padding-left: 42px !important;
  border-left: 2px solid rgba(255, 255, 255, 0.08);
  margin-left: 12px;
  font-size: 0.88rem;
}

/* Active State */
.note-item.active {
  background: rgba(59, 130, 246, 0.15);
  color: white;
  opacity: 1;
  border-left: 3px solid var(--accent);
  font-weight: 500;
}

.note-item span {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Trash Icon - Hover Only */
.hover-icon {
  opacity: 0;
  transition: opacity 0.2s;
  color: #ff6b6b;
  cursor: pointer;
  margin-left: 4px;
}

.note-item:hover .hover-icon {
  opacity: 1;
}

.hover-icon:hover {
  color: #ff4d4d;
  transform: scale(1.1);
}

/* Item Actions Container */
.item-actions {
  position: absolute;
  right: 12px;
  display: flex;
  gap: 6px;
  align-items: center;
}

.btn-danger {
  background: #ff4d4d;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-danger:hover {
  background: #ff3333;
}

/* Editor Sector */
.editor-pane {
  flex: 1;
  background: var(--bg-editor);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-color);
  min-width: 0;
}

.editor-info-bar {
  padding: 10px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-editor);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--text-main);
  min-height: 54px;
}

.refining-status {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  font-weight: 600;
}

.btn-magic:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
}

.ai-buttons-group {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  /* Push to the right if space allows, but they stay together */
}

/* Insert Dropdown */
/* Insert Dropdown */
.insert-dropdown-container,
.export-dropdown-container {
  position: relative;
  display: inline-block;
}

.btn-insert {
  background: var(--bg-editor);
  color: var(--text-main);
  border: 1px solid var(--border-color);
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  transition: all 0.2s;
}

.dark-theme .btn-insert {
  background: #2a2a2a;
}

.btn-insert:hover,
.btn-insert.active {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(59, 130, 246, 0.05);
}

.export-menu {
  right: 0;
  left: auto;
  /* Align to right for export menu */
  min-width: 140px;
}

.insert-menu {
  position: absolute;
  top: 110%;
  left: 0;
  background: var(--bg-sidebar);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  min-width: 160px;
  z-index: 1000;
  overflow: hidden;
  animation: dropdownFadeIn 0.2s ease-out;
}

@keyframes dropdownFadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.insert-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.2s;
  color: var(--text-main);
}

.insert-option:hover {
  background: var(--accent);
  color: white;
}

.insert-option svg {
  opacity: 0.7;
}

.insert-option:hover svg {
  opacity: 1;
}

/* Tools Dropdown & Sub-menus */
.tools-dropdown-container {
  position: relative;
  display: inline-block;
}

.tools-menu {
  min-width: 180px;
  overflow: visible;
  /* Allow sub-menu to overflow */
}

.sub-menu-trigger {
  position: relative;
  display: flex;
  justify-content: space-between;
}

.color-submenu {
  position: absolute;
  top: 0;
  left: 100%;
  margin-left: 2px;
  min-width: 140px;
  z-index: 1001;
  background: var(--bg-sidebar);
  border: 1px solid var(--border-color);
  box-shadow: 4px 4px 20px rgba(0, 0, 0, 0.2);
}

.color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.bg-red {
  background-color: #ef4444;
}

.bg-blue {
  background-color: #3b82f6;
}

.bg-green {
  background-color: #10b981;
}

.bg-orange {
  background-color: #f59e0b;
}

.bg-purple {
  background-color: #8b5cf6;
}

.bg-gray {
  background-color: #6b7280;
}

.dark-theme .color-submenu {
  background: #2a2a2a;
}

/* Cover Page Picker Modal */
.cover-picker-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
}

.cover-picker-modal {
  background: var(--bg-sidebar);
  width: 90%;
  max-width: 600px;
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  padding: 24px;
  color: var(--text-main);
  border: 1px solid var(--border-color);
}

.cover-picker-modal .modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.cover-picker-modal .modal-header h3 {
  margin: 0;
  font-size: 1.25rem;
}

.cover-picker-modal .close-btn {
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.cover-picker-modal .close-btn:hover {
  opacity: 1;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.template-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: transform 0.2s;
}

.template-card:hover {
  transform: translateY(-4px);
}

.template-card span {
  font-size: 0.9rem;
  font-weight: 500;
}

.template-preview {
  width: 100%;
  aspect-ratio: 1 / 1.414;
  /* A4 aspect ratio */
  background: white;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 15px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.template-preview .line {
  height: 4px;
  background: #eee;
  margin-bottom: 8px;
  border-radius: 2px;
}

.template-preview .line.title {
  height: 8px;
  background: var(--accent);
  width: 100%;
}

.template-preview .line.subtitle {
  width: 70%;
}

.template-preview .line.author {
  width: 50%;
  margin-top: auto;
}

/* Specific Preview Variations */
.template-preview.professional {
  align-items: center;
}

.template-preview.professional .line {
  width: 60%;
}

.template-preview.professional .line.title {
  width: 90%;
  margin-top: 20%;
}

.template-preview.minimalist {
  align-items: flex-end;
}

.template-preview.minimalist .line.title {
  width: 80%;
  margin-top: 10%;
}

.template-preview.minimalist .line.author {
  width: 40%;
  margin-top: auto;
}

.template-preview.academic {
  align-items: center;
}

.template-preview.academic .line.school {
  width: 70%;
  margin-top: 5%;
}

.template-preview.academic .line.title {
  width: 85%;
  margin-top: 30%;
}

.template-preview.academic .line.author {
  width: 50%;
  margin-top: auto;
}

.dark-theme .template-preview .line {
  background: #3d3d3d;
}

.template-section h4 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #888;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 4px;
}

.template-scroll-area {
  max-height: 400px;
  overflow-y: auto;
  padding-right: 8px;
}

.btn-save-tpl {
  background: rgba(59, 130, 246, 0.1);
  color: var(--accent);
  border: 1px solid rgba(59, 130, 246, 0.2);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
}

.btn-save-tpl:hover {
  background: var(--accent);
  color: white;
}

.template-preview.custom {
  position: relative;
  background: #fdfdfd;
  font-size: 6px;
  color: #ccc;
  overflow: hidden;
  padding: 10px;
  line-height: 1.2;
}

.dark-theme .template-preview.custom {
  background: #1e1e1e;
}

.tpl-delete-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  background: #fff;
  border: 1px solid #eee;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ff6b6b;
  opacity: 0;
  transition: all 0.2s;
  z-index: 10;
}

.template-card:hover .tpl-delete-btn {
  opacity: 1;
}

.tpl-delete-btn:hover {
  background: #ff6b6b;
  color: white;
  transform: scale(1.1);
}

.tpl-content-hint {
  opacity: 0.5;
  -webkit-user-select: none;
  user-select: none;
}


.editor-textarea {
  flex: 1;
  width: 100%;
  border: none;
  /* Reduced padding to fit more text */
  padding: 20px 25px;
  background: var(--bg-editor);

  /* OVERLEAF FONT SETTINGS */
  font-family: 'Source Code Pro', 'Menlo', 'Monaco', monospace !important;
  font-size: 13.5px;
  /* Slightly smaller for density */
  line-height: 1.5;
  /* Tighter than 1.7 to see more lines */

  outline: none;
  resize: none;
  color: var(--text-main);

  /* CURSOR VISIBILITY FIX */
  caret-color: var(--accent);
  /* Makes cursor Bright Blue */
}

.dark-theme .editor-textarea {
  background-color: #1c1c1c;
}

/* Preview Sector */
.preview-pane {
  flex: 1;
  background: var(--bg-preview) !important;
  /* This will now be white */
  overflow-y: auto;
  overflow-x: auto;
  padding: 0 0 40px 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.preview-header {
  width: 100%;
  min-width: max-content;
  /* Forces it to cover scroll width */
  padding: 10px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-editor);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--text-main);
  position: sticky;
  top: 0;
  left: 0;
  /* Sticks to the left edge when scrolling right */
  z-index: 100;
  min-height: 54px;
}

.pages-stack {
  display: flex;
  flex-direction: column;
  gap: 0;
  position: relative;
  width: 100%;
}


.page-container {
  background: white !important;
  width: 210mm;
  min-height: 297mm;
  padding: 20mm;
  position: relative;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  box-shadow: none !important;
  /* Ensures seamless blend with the background */
  border: none !important;
}

/* Page Guides */
.preview-content {
  position: relative;
  margin: 0 auto;
  /* Safely centers the A4 page without clipping the left side */
  display: flex;
  flex-direction: column;
}

.page-guides-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  margin: 0 auto;
  /* Centers perfectly over the paper */
  width: 210mm;
  /* Forces exact paper width */
  height: 100%;
  pointer-events: none;
  z-index: 50;
}

.page-guide {
  position: absolute;
  width: 100%;
  left: 0;
}

.danger-zone {
  position: absolute;
  top: -2px;
  /* Thinner */
  width: 100%;
  height: 4px;
  /* Thinner */
  background: rgba(239, 68, 68, 0.1);
  border-top: 1px solid rgba(239, 68, 68, 0.2);
  border-bottom: 1px solid rgba(239, 68, 68, 0.2);
}

.guide-line {
  width: 100%;
  border-bottom: 1px dashed rgba(239, 68, 68, 0.4);
  /* Thinner and softer */
}

.guide-label {
  position: absolute;
  right: 0;
  /* Align flush right to the paper edge */
  top: -10px;
  /* Vertically center on the new thin line */
  font-size: 10px;
  font-weight: 800;
  color: #dc2626;
  background: white;
  padding: 2px 6px;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(220, 38, 38, 0.15);
  border: 1px solid #fecaca;
  z-index: 60;
}

/* Manual Page Breaks (Invisible markers for PageGuides) */
.manual-page-break {
  position: relative;
  page-break-before: always !important;
  break-before: page !important;
  height: 0 !important;
  margin: 0 !important;
  border: none !important;
  visibility: hidden;
}


/* User-controlled spacing between blocks */
/* User-controlled spacing between blocks - CONSOLIDATED BELOW */

/* Remove trailing margin from the last block */
.markdown-body>*:last-child {
  margin-bottom: 0 !important;
}

/* Ensure no double-spacing from internal margins */
.markdown-body>*>*:first-child {
  margin-top: 0 !important;
}

.markdown-body>*>*:last-child {
  margin-bottom: 0 !important;
}

.markdown-body>p,
.markdown-body>h1,
.markdown-body>h2,
.markdown-body>h3,
.markdown-body>h4,
.markdown-body>h5,
.markdown-body>h6,
.markdown-body>blockquote,
.markdown-body>pre,
.markdown-body>ul,
.markdown-body>ol {
  margin: 0 !important;
  margin-top: var(--block-spacing, 0.3em) !important;
  margin-bottom: 0 !important;
  padding-bottom: 0 !important;
}

/* Ensure the absolute top of the page has zero gap */
.markdown-body>*:first-child {
  margin-top: 0 !important;
}

/* --- Global Text and Layout Consistency --- */

.markdown-body {
  /* Ensure the base font and size apply consistently */
  font-family: var(--p-font, 'Inter', sans-serif);
  font-size: var(--p-size, 15px);
  line-height: 1.6;
  /* Essential for readability and spacing */
  /* Robust text wrapping to prevent layout overflow */
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: break-word;
  max-width: 100%;
}

/* Academic Tables Styling */
.markdown-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.5rem 0;
  font-size: 0.95em;
  page-break-inside: avoid;
  border: 1px solid #e0e0e0;
}

.markdown-body thead {
  background-color: #f7f7f7;
}

.markdown-body th {
  font-weight: 700;
  text-align: left;
  background: #f8f9fa;
  color: #333;
}

.markdown-body th,
.markdown-body td {
  padding: 12px 15px;
  border: 1px solid #eaebec;
}

.markdown-body tbody tr:nth-child(even) {
  background-color: #fafbfc;
}

.markdown-body tbody tr:hover {
  background-color: #f1f4f8;
}



/* Ensure margins exist between standard paragraphs */
/* Paragraph rules consolidated above */

/* Color Helpers for Syntax: R<< text >> G<< text >> etc */
.red {
  color: #ff6b6b !important;
}

.blue {
  color: #4dabf7 !important;
}

.green {
  color: #51cf66 !important;
}

.orange {
  color: #ff922b !important;
}

.purple {
  color: #b197fc !important;
}

.gray {
  color: #868e96 !important;
}

/* Alignment Helpers */
.center {
  text-align: center !important;
  display: block;
  margin-left: auto;
  margin-right: auto;
}

.right {
  text-align: right !important;
  display: block;
}

.left {
  text-align: left !important;
  display: block;
}

/* Decoration Helpers */
.markdown-body mark {
  background-color: #fff3bf;
  /* Soft yellow */
  color: inherit;
  padding: 0 2px;
  border-radius: 2px;
}

.bg-red {
  background-color: #ffe3e3 !important;
}

.bg-blue {
  background-color: #e7f5ff !important;
}

.bg-green {
  background-color: #ebfbee !important;
}

.bg-orange {
  background-color: #fff4e6 !important;
}

.bg-purple {
  background-color: #f3f0ff !important;
}

.bg-gray {
  background-color: #f1f3f5 !important;
}

/* Dark mode adjustments for highlights */
.dark-theme .markdown-body mark {
  background-color: #5c531e;
  color: #fff;
}

.dark-theme .bg-red {
  background-color: #5b2d2d !important;
}

.dark-theme .bg-blue {
  background-color: #1e3a5c !important;
}

.dark-theme .bg-green {
  background-color: #244b2d !important;
}

.dark-theme .bg-orange {
  background-color: #5c4124 !important;
}

.dark-theme .bg-purple {
  background-color: #3b2d5c !important;
}

.dark-theme .bg-gray {
  background-color: #343a40 !important;
}

.underline {
  text-decoration: underline !important;
}

.underline {
  text-decoration: underline !important;
}

/* --- Fixes for Math Display --- */

.math-center-wrapper {
  display: block !important;
  text-align: center !important;
  width: 100%;
  margin: 1em 0 !important;
  overflow-x: auto;
  overflow-y: hidden;
}

/* Ensure the inner math shrinks to fit and doesn't get cut off when scrolling horizontally */
.math-center-wrapper>.katex {
  display: inline-block !important;
  text-align: center !important;
}


/* --- Fixes for Headers and List Alignment --- */

.markdown-body h1,
.markdown-body h2,
.markdown-body h3 {
  margin-top: 1.5em;
  /* Space above headers */
  margin-bottom: 0.75em;
  /* Space below headers */
  padding-bottom: 0.1em;
  font-weight: 600;
  /* Bold titles for steps */
}

/* Ensure inline math doesn't affect surrounding line height too much */
.katex {
  /* Use baseline alignment to stop minor jitter */
  vertical-align: baseline;
  line-height: 1;
}

.markdown-body pre {
  white-space: pre-wrap !important;
  word-break: break-all !important;
  background: #f6f8fa;
  padding: 15px;
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.9em;
  margin: 15px 0;
}

.markdown-body code {
  background: #f3f4f6;
  padding: 2px 4px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.9em;
}


/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.8);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--bg-editor);
  padding: 30px 30px 20px 30px;
  border-radius: 12px;
  width: 500px;
  max-height: 85vh;
  /* Makes it fit the screen */
  overflow-y: auto;
  /* Makes it scrollable */
  display: flex;
  flex-direction: column;
  gap: 25px;
  /* Less dense */
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  color: var(--text-main);
  border: 1px solid var(--border-color);
  position: relative;
  /* For the top-right close button */
}

.modal-close-top {
  position: absolute;
  top: 20px;
  right: 20px;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.2s;
  color: var(--text-main);
}

.modal-close-top:hover {
  opacity: 1;
  color: #ff4d4d;
}

.setting-section-title {
  margin-bottom: 12px;
  font-size: 0.85rem;
  color: var(--accent);
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 6px;
}

.api-keys-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.api-key-input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.api-key-input-group label {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.8;
}

.modal-content h3 {
  font-size: 1.1rem;
  color: var(--text-main);
}

.modal-content input {
  padding: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-modal-input);
  color: var(--text-main);
  border-radius: 6px;
  font-family: inherit;
  outline: none;
}

.btn-get-api {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 8px 12px;
  border-radius: 6px;
  transition: all 0.2s;
}

.btn-get-api:hover {
  background: rgba(59, 130, 246, 0.1);
  text-decoration: underline;
}

.modal-btns {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.modal-btns button {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  cursor: pointer;
  background: var(--bg-modal-btn);
  color: var(--text-main);
  font-weight: 500;
  transition: all 0.2s;
}

.modal-btns button:hover {
  background: var(--border-color);
}

/* Custom Refine Modal Specifics */
.custom-refine-modal {
  width: 500px !important;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
}

.modal-label {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: block;
  margin-bottom: 8px;
}

.custom-refine-textarea {
  width: 100%;
  min-height: 100px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-modal-input);
  color: var(--text-main);
  font-family: inherit;
  font-size: 0.9rem;
  resize: vertical;
}

.custom-refine-presets {
  margin-top: 20px;
  border-top: 1px solid var(--border-color);
  padding-top: 15px;
}

.presets-list {
  max-height: 150px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preset-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-sidebar);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: 0.2s;
}

.preset-item:hover {
  border-color: var(--accent);
  background: var(--bg-editor);
}

.preset-text {
  font-size: 0.85rem;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 10px;
}

.preset-delete {
  opacity: 0.4;
  transition: 0.2s;
  color: #ff6b6b;
}

.preset-item:hover .preset-delete {
  opacity: 1;
}

.btn-secondary {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent !important;
  border: 1px solid var(--border-color) !important;
  color: var(--text-main) !important;
  font-size: 0.8rem !important;
}

.btn-secondary:hover {
  background: var(--bg-sidebar) !important;
  border-color: var(--accent) !important;
}


.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

/* Scrollbars */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 10px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.3);
}

/* Sync Scrolling Indicators */
.sync-target {
  cursor: pointer;
  transition: background 0.2s;
}

.sync-target:hover {
  background: rgba(59, 130, 246, 0.05);
  /* Very subtle blue highlight on hover */
  border-radius: 4px;
}

/* Export Menu Dropdown */
.export-dropdown-container {
  position: relative;
  display: inline-block;
}

.export-menu {
  position: absolute;
  top: 100%;
  right: 0;
  width: 200px;
  background: var(--bg-editor);
  border: 1px solid var(--border-color);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border-radius: 8px;
  margin-top: 8px;
  z-index: 1000;
  overflow: hidden;
  animation: fadeIn 0.2s ease;
}

.export-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.2s;
  font-size: 0.9rem;
  color: var(--text-main);
}

.export-option:hover {
  background: var(--bg-sidebar);
  color: var(--accent);
}

.export-option svg {
  opacity: 0.7;
}

.export-option:hover svg {
  opacity: 1;
}

.arrow {
  transition: transform 0.2s;
}

.arrow.up {
  transform: rotate(180deg);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* --- Colorful Editor Component Styles --- */
.colorful-editor-container {
  height: 100%;
  width: 100%;
  overflow-y: auto;
  background-color: var(--editor-bg);
  position: relative;
  scroll-behavior: smooth;
}

.colorful-editor {
  min-height: 100%;
  width: 100%;
  counter-reset: line;
  position: relative;
}

/* Base styles for the editor */
.colorful-editor textarea,
.colorful-editor pre {
  font-family: 'JetBrains Mono', 'Fira Code', monospace !important;
  font-size: 14px !important;
  line-height: 24px !important;
  padding-left: 60px !important;
  /* Space for line numbers */
  tab-size: 4 !important;
  white-space: pre-wrap !important;
  word-break: break-all !important;
}

/* 
 * CRITICAL: Force exact monospacing to prevent cursor offset bugs. 
 * Any fake bold or italic width differences break react-simple-code-editor alignment.
 */
.colorful-editor textarea,
.colorful-editor pre,
.colorful-editor pre * {
  font-weight: normal !important;
  font-style: normal !important;
  letter-spacing: normal !important;
}

/* Line Number Styling */
.editorLineNumber {
  position: absolute;
  left: 0;
  width: 45px;
  text-align: right;
  padding-right: 15px;
  color: #888;
  font-size: 11px;
  -webkit-user-select: none;
  user-select: none;
  border-right: 1px solid #ddd;
  background: #f9f9f9;
  pointer-events: none;
}

.dark-theme .editorLineNumber {
  background: #16161e;
  border-right: 1px solid #24283b;
  color: #888;
  /* Brightened for visibility */
}

/* Custom Poring Tokens - Monochrome and High Contrast */
.token.poring-keyword,
.token.poring-color,
.token.poring-align,
.token.poring-math {
  color: inherit !important;
  font-weight: inherit;
  font-style: inherit;
}

.token.poring-align .token.poring-keyword,
.token.poring-align .token.punctuation {
  color: #b91c1c !important;
  /* Deep Red */
  font-weight: bold;
}

/* Ensure text inside poring-align respects the theme */
.token.poring-align {
  color: inherit !important;
}

/* Ensure poring-color keywords and wrappers are also themed correctly */
.token.poring-color .token.poring-keyword,
.token.poring-color .token.punctuation {
  color: #b91c1c !important;
  font-weight: bold;
}

.token.poring-color {
  color: inherit !important;
}

.token.poring-keyword {
  font-weight: bold;
}

.token.poring-indent {
  color: #ddd;
}

.dark-theme .token.poring-indent {
  color: #2a2a3a;
}

.colorful-editor pre,
.colorful-editor code,
.colorful-editor textarea {
  color: var(--text-main) !important;
}

.token.bold,
.token.italic,
.token.list,
.token.link,
.token.code {
  color: inherit !important;
}

.token.bold {
  font-weight: bold;
}

.token.italic {
  font-style: italic;
}

.markdown-body {
  color: #000000 !important;
  /* Force Black text for document regardless of theme */
  font-family: var(--p-font);
  font-size: var(--p-size);
}


.page-container {
  background: white !important;
  /* Force White background for document regardless of theme */
}

/* --- Keyword Explanation System --- */
.keyword-ref {
  color: #3b82f6 !important;
  text-decoration: none;
  border-bottom: 1px dashed #3b82f6;
  cursor: pointer;
  font-weight: 500;
}

.keyword-ref:hover {
  color: #2563eb !important;
  border-bottom-style: solid;
}

.explanation-section {
  margin-top: 50px;
  border-top: 2px solid #e0e0e0;
  padding-top: 20px;
}

.explanation {
  border-left: 3px solid #3b82f6;
  padding: 12px 16px;
  margin: 20px 0;
  background: #f8f9fa;
  border-radius: 0 6px 6px 0;
}

.explanation .back-link {
  display: inline-block;
  margin-top: 8px;
  color: #3b82f6 !important;
  text-decoration: none;
  font-size: 0.9em;
  font-weight: 500;
}

.explanation .back-link:hover {
  text-decoration: underline;
}

/* Prism Theme Overrides */
.token.header,
.token.title {
  color: #2e7d32 !important;
  font-weight: bold;
}

.token.list {
  color: #d32f2f;
}

.token.code {
  background: #f0f0f0;
  border-radius: 3px;
  color: #c2185b;
}

.dark-theme .token.code {
  background: #2d2d2d;
  color: #f48fb1;
}

/* Toast Notification */
.toast-container {
  position: fixed;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9000;
  pointer-events: none;
  animation: toast-fade-in 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.toast-message {
  background: rgba(0, 0, 0, 0.75);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  color: white;
  padding: 10px 24px;
  border-radius: 50px;
  font-size: 0.9rem;
  font-weight: 500;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
  white-space: nowrap;
}

.dark-theme .toast-message {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.05);
}

@keyframes toast-fade-in {
  0% {
    opacity: 0;
    transform: translate(-50%, 20px);
  }

  100% {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

/* Window Drag & Control Styles */
.header {
  -webkit-app-region: drag;
  /* Makes the header act like a title bar */
}

/* IMPORTANT: Everything clickable inside the header must have no-drag */
.header button,
.header select,
.header input,
.no-drag {
  -webkit-app-region: no-drag;
}

.window-controls {
  display: flex;
  height: 100%;
  align-items: center;
  margin-left: 10px;
}

.window-btn {
  background: transparent;
  border: none;
  color: #ccc;
  padding: 6px 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: 0.2s;
  border-radius: 4px;
}

.window-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.window-btn.close:hover {
  background: #e81123;
  /* Windows native red close color */
  color: white;
}

/* View Mode Toggle Styles */
.view-toggles {
  display: flex;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 2px;
  margin: 0 15px;
}

.btn-view {
  background: transparent;
  border: none;
  color: #aaa;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-view:hover {
  color: white;
}

.btn-view.active {
  background: #3b82f6;
  color: white;
}

/* FIX THE SQUISHED TEXT BUG YOU SHOWED IN YOUR SCREENSHOTS */
.editor-pane,
.preview-pane {
  min-width: 0 !important;
}

.header {
  flex-wrap: nowrap;
  overflow: hidden;
}

.header-right {
  flex-shrink: 0;
  /* Prevents the window controls from being squished */
}

.view-toggles {
  flex-shrink: 1;
  /* Allows the middle section to adapt if screen is tiny */
  min-width: 0;
  overflow-x: auto;
}

.view-toggles::-webkit-scrollbar {
  display: none;
  /* Hides scrollbar in the header if it gets too tight */
}

/* --- INLINE FORMATTING TOOLBAR --- */
.format-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--bg-sidebar);
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  margin-right: 8px;
}

.format-btn {
  background: transparent;
  border: none;
  color: var(--text-main);
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.6;
  transition: all 0.2s;
}

.format-btn:hover {
  background: var(--bg-editor);
  opacity: 1;
  color: var(--accent);
  transform: translateY(-1px);
}

.toolbar-divider {
  width: 1px;
  height: 16px;
  background: var(--border-color);
  margin: 0 4px;
}

/* --- Draw Mode Sidebar Layout --- */
.draw-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: #f1f5f9;
  z-index: 9999;
  display: flex;
  flex-direction: row;
  font-family: 'Inter', sans-serif;
}

.dark-theme .draw-overlay {
  background: #121212;
}

/* Sidebar */
.draw-sidebar {
  width: 280px;
  background: white;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  box-shadow: 2px 0 10px rgba(0, 0, 0, 0.05);
  z-index: 10;
}

.dark-theme .draw-sidebar {
  background: #1e1e1e;
  border-right-color: #333;
}

.draw-sidebar-header {
  padding: 20px;
  border-bottom: 1px solid #e5e7eb;
}

.dark-theme .draw-sidebar-header {
  border-bottom-color: #333;
}

.draw-sidebar-header h2 {
  font-size: 1.1rem;
  font-weight: 600;
  color: #111827;
  margin: 0 0 4px 0;
}

.dark-theme .draw-sidebar-header h2 {
  color: #f3f4f6;
}

.draw-sidebar-header p {
  font-size: 0.75rem;
  color: #6b7280;
  margin: 0;
}

/* Sidebar Content & Tools */
.draw-sidebar-content {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.draw-section-title {
  font-size: 0.7rem;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
  margin-top: 24px;
}

.draw-section-title:first-child {
  margin-top: 0;
}

.dark-theme .draw-section-title {
  color: #9ca3af;
}

/* Grid Cards */
.draw-tools-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.draw-tool-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px 0;
  cursor: pointer;
  color: #4b5563;
  transition: all 0.2s;
}

.dark-theme .draw-tool-card {
  background: #2a2a2a;
  border-color: #444;
  color: #d1d5db;
}

.draw-tool-card span {
  font-size: 0.65rem;
  font-weight: 500;
  margin-top: 4px;
}

.draw-tool-card:hover {
  background: #f9fafb;
}

.dark-theme .draw-tool-card:hover {
  background: #333;
}

.draw-tool-card.active {
  background: #eef2ff;
  border-color: #a5b4fc;
  color: #4f46e5;
}

.dark-theme .draw-tool-card.active {
  background: rgba(79, 70, 229, 0.2);
  border-color: #4f46e5;
  color: #a5b4fc;
}

/* Properties */
.draw-property-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid #f3f4f6;
  font-size: 0.85rem;
  font-weight: 500;
  color: #374151;
}

.dark-theme .draw-property-row {
  border-bottom-color: #333;
  color: #d1d5db;
}

.draw-property-row.color-row {
  flex-direction: column;
  align-items: flex-start;
}

/* Switch */
.draw-switch {
  width: 40px;
  height: 20px;
  background: #d1d5db;
  border-radius: 12px;
  position: relative;
  cursor: pointer;
  transition: 0.2s;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
}

.draw-switch.on {
  background: #4f46e5;
}

.draw-switch-thumb {
  width: 16px;
  height: 16px;
  background: white;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.draw-switch.on .draw-switch-thumb {
  left: 22px;
}

/* Colors */
.draw-colors {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.draw-color-swatch {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.1s;
}

.draw-color-swatch:hover {
  transform: scale(1.1);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
}

.draw-color-swatch.active {
  border-color: #111827;
  transform: scale(1.1);
  box-shadow: 0 0 0 2px white;
}

.dark-theme .draw-color-swatch.active {
  border-color: white;
  box-shadow: 0 0 0 2px #1e1e1e;
}

/* Slider */
.draw-slider {
  width: 100%;
  accent-color: #4f46e5;
  cursor: pointer;
}

.draw-line-val {
  font-family: monospace;
  color: #6b7280;
  font-size: 0.75rem;
}

/* Actions row */
.draw-actions-row {
  display: flex;
  gap: 8px;
}

.draw-action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  color: #374151;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: 0.2s;
}

.dark-theme .draw-action-btn {
  background: #2a2a2a;
  border-color: #444;
  color: #d1d5db;
}

.draw-action-btn:hover:not(:disabled) {
  background: #f9fafb;
}

.draw-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.draw-action-btn.danger {
  color: #ef4444;
  border-color: #fecaca;
}

.draw-action-btn.danger:hover:not(:disabled) {
  background: #fef2f2;
}

.dark-theme .draw-action-btn.danger {
  background: #3b2d2d;
  border-color: #5b2d2d;
}

/* Sidebar Footer (Save/Close) */
.draw-sidebar-footer {
  padding: 20px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  gap: 12px;
  background: #f9fafb;
}

.dark-theme .draw-sidebar-footer {
  background: #1a1a1a;
  border-top-color: #333;
}

.draw-btn-cancel {
  flex: 1;
  padding: 10px;
  background: transparent;
  border: none;
  color: #6b7280;
  font-weight: 500;
  cursor: pointer;
  border-radius: 8px;
}

.draw-btn-cancel:hover {
  background: #e5e7eb;
  color: #111827;
}

.draw-btn-save {
  flex: 2;
  padding: 10px;
  background: #4f46e5;
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(79, 70, 229, 0.2);
}

.draw-btn-save:hover {
  background: #4338ca;
}

/* Canvas Area */
.draw-canvas-container {
  flex: 1;
  background: #f1f5f9;
  overflow: auto;
  /* Allows scrollbars to appear when zoomed */
  padding: 40px;
  display: flex;
  /* Flex container to center the image */
}

.dark-theme .draw-canvas-container {
  background: #1a1a1a;
}

.draw-canvas-wrapper {
  background: white;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
  border: 1px solid #e5e7eb;
  margin: auto;
  /* Automatically centers within the flex container */
  flex-shrink: 0;
  /* Prevents the image from being squished when zooming in */
  transition: width 0.1s, height 0.1s;
  /* Smooth zoom transition */
}

.dark-theme .draw-canvas-wrapper {
  border-color: #333;
}

.draw-canvas {
  display: block;
}

/* Empty State */
.draw-empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.draw-empty-card {
  background: rgba(255, 255, 255, 0.8);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  padding: 30px;
  border-radius: 16px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.dark-theme .draw-empty-card {
  background: rgba(30, 30, 30, 0.8);
  border-color: #333;
}

.draw-empty-card h4 {
  margin: 16px 0 4px 0;
  font-size: 1.1rem;
  color: #1f2937;
}

.dark-theme .draw-empty-card h4 {
  color: #f3f4f6;
}

.draw-empty-card p {
  margin: 0;
  font-size: 0.85rem;
  color: #6b7280;
}


.cm-cursor {
  border-left-color: var(--text-main) !important;
}

.cm-content {
  caret-color: var(--text-main) !important;
}

/* --- ELITE SETTINGS MODAL --- */
.settings-modal-container {
  width: 640px !important;
  max-height: 85vh;
  padding: 0 !important;
  display: flex;
  flex-direction: column;
  background: var(--bg-editor);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.settings-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-editor);
  z-index: 10;
}

.settings-header h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-main);
}

.settings-body {
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
  background: var(--bg-sidebar);
  /* Fixed: Was --bg-preview */
}

.dark-theme .settings-body {
  background: #0a0a0a;
  /* A nice deep background to contrast with the cards */
}

.settings-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-label-main {
  font-size: 0.75rem;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-left: 4px;
}

/* Card-based Grouping */
.settings-card {
  background: var(--bg-editor);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.settings-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
}

.settings-row:last-child {
  border-bottom: none;
}

.settings-row-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.settings-row-title {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-main);
}

.settings-row-desc {
  font-size: 0.75rem;
  color: #888;
}

/* Inputs & Selects */
.elite-input,
.elite-select {
  width: 100%;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-modal-input);
  /* Fixed: Was --bg-preview */
  color: var(--text-main);
  font-size: 0.85rem;
  font-family: var(--p-font);
  transition: all 0.2s ease;
  outline: none;
}

.elite-input:focus,
.elite-select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

/* Force dark mode colors on the dropdown menu items */
.elite-select option {
  background: var(--bg-editor);
  color: var(--text-main);
}

/* Modern Toggle Switch */
.elite-toggle {
  position: relative;
  width: 44px;
  height: 24px;
  background-color: var(--border-color);
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.elite-toggle.active {
  background-color: var(--accent);
}

.elite-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  background-color: white;
  border-radius: 50%;
  transition: transform 0.2s cubic-bezier(0.4, 0.0, 0.2, 1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.elite-toggle.active .elite-toggle-thumb {
  transform: translateX(20px);
}

/* Footer */
.settings-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-editor);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.settings-footer-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Radio buttons made elegant */
.elite-radio-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-editor);
  transition: background 0.2s;
  cursor: pointer;
}

.elite-radio-row:last-child {
  border-bottom: none;
}

.elite-radio-row.active {
  background: rgba(59, 130, 246, 0.05);
}

.custom-radio {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.elite-radio-row.active .custom-radio {
  border-color: var(--accent);
}

.custom-radio-inner {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0;
  transition: 0.2s;
}

.elite-radio-row.active .custom-radio-inner {
  opacity: 1;
}

/* SMART CONTENT ZOOM */
.sidebar-scroll,
.colorful-editor-container,
.pages-stack {
  zoom: var(--content-zoom, 1);
}
```

### src/App.jsx

```javascript
import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkFootnotes from 'remark-footnotes';
import remarkBreaks from 'remark-breaks';
// PDF export uses native browser print - no external library needed
import localforage from 'localforage';
import { saveAs } from 'file-saver';
import { exportPoringFile, importPoringFile } from './utils/poringFileHandler';
import ColorfulEditor from './components/ColorfulEditor';
import LivePreviewEditor from './components/LivePreviewEditor';

// Standard memoization ensures the editors don't re-render unless their props change.
import { memo } from 'react';
const MemoizedColorfulEditor = memo(ColorfulEditor);
const MemoizedLiveEditor = memo(LivePreviewEditor);

import { EditorView } from '@codemirror/view';
import {
    Plus, FolderPlus, Folder, FileText, ChevronLeft, ChevronRight,
    Download, Trash2, Edit3, ChevronDown, Sun, Moon, Sparkles,
    Loader2, Settings, X, ClipboardCheck, PanelLeftClose, PanelLeftOpen,
    Bot, ExternalLink, Upload, Wand2, RotateCcw, Wrench, Palette, Scissors,
    AlignLeft, AlignCenter, AlignRight, Minus, Square, Columns, PenTool, Eye,
    Search, FilePlus, Bold, Italic, Underline, Strikethrough, Highlighter, Pen,
    Monitor, Cloud, MessageSquareText
} from 'lucide-react';
import DrawMode from './components/DrawMode';
import 'katex/dist/katex.min.css';
import './App.css';
import guideContent from './guide.md?raw';
import {
    processAiRequest,
    MAGIC_REFINE_PROMPT,
    CUSTOM_REFINE_SYSTEM_PROMPT,
    BREAK_MATH_PROMPT,
    CLIPBOARD_FIXER_PROMPT
} from './utils/aiService';

// --- HELPER: Database Persistence ---
// --- NATIVE ASSET MANAGER ---
const saveImageToAssetStore = async (fileOrBlob) => {
    const ext = fileOrBlob.type.includes('png') ? 'png' : 'jpg';
    const filename = `img_${Date.now()}.${ext}`;

    // 1. NATIVE ELECTRON PATH (Ultra Fast)
    if (window.electronAPI && window.electronAPI.saveAsset) {
        // Just send the raw ArrayBuffer. Electron handles the conversion.
        const arrayBuffer = await fileOrBlob.arrayBuffer();
        await window.electronAPI.saveAsset(filename, arrayBuffer);
        return `poring-asset://${filename}`;
    }

    // 2. LEGACY WEB FALLBACK
    const key = `poring_img_${Date.now()}`;
    const buffer = await fileOrBlob.arrayBuffer();
    const pureBlob = new Blob([buffer], { type: fileOrBlob.type || 'image/png' });
    await localforage.setItem(key, pureBlob);
    return key;
};

import SustLogo from './assets/sust_logo.png';
import BegulaImg from './assets/Begula.png';

// --- HELPER: Asset Mapping (Obfuscation) ---
const ASSET_MAP = {
    SUST_LOGO: SustLogo,
    BEGULA_IMG: BegulaImg
};

// --- HELPER: Cover Page Templates ---
const COVER_TEMPLATES = {
    sust_eee: `center[#Shahjalal University of Science and Technology]
//1

![Image|200](SUST_LOGO)

//1

center[blue[##Department of Electrical & Electronic Engineering] ]
//1

center[###Course Title: ]
center[###Course Code:]
//1

center[red[###Lab Report / Assignment]]
//2

###Experiment no. : 
###**Experiment name**: 

| **Submitted By:** | **Submitted To:** |
| :---------------- | :---------------- |
| Name <br> Reg. No. :| Teacher's name  <br> Designation <br> Department |


center[####Submission date : [today]]

***
`
};



// --- PDF CONFIGURATION ---
const PDF_CONFIG = {
    margin: 10, // mm
};

// --- STABLE COMPONENTS ---

const CustomImage = ({ src, alt }) => {
    const [imgSrc, setImgSrc] = useState(src);
    const parts = alt ? alt.split('|') : ["Image"];
    const width = parts[1] || '400';
    const caption = parts[2] || null;

    useEffect(() => {
        let objectUrl = null;
        const resolvedSrc = ASSET_MAP[src] || src;

        if (resolvedSrc && resolvedSrc.startsWith('poring-asset://')) {
            // NATIVE PATH: Let the browser engine handle it directly! No memory leaks.
            setImgSrc(resolvedSrc);
        } else if (resolvedSrc && resolvedSrc.startsWith('poring_img_')) {
            // LEGACY PATH: Fallback for older notes
            localforage.getItem(resolvedSrc).then(blob => {
                if (blob) {
                    objectUrl = URL.createObjectURL(blob);
                    setImgSrc(objectUrl);
                }
            }).catch(err => console.error("Error loading legacy image:", err));
        } else {
            setImgSrc(resolvedSrc);
        }

        return () => {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [src]);

    const handleDoubleClick = () => {
        if (src.startsWith('poring_img_') || src.startsWith('poring-asset://')) {
            window.dispatchEvent(new CustomEvent('request-image-edit', { detail: src }));
        }
    };

    const imageElement = (
        <img
            src={imgSrc}
            alt={parts[0]}
            // Removed display: block so flexbox can align it side-by-side
            style={{ width: caption ? '100%' : `${width}px`, cursor: 'pointer', maxWidth: '100%', height: 'auto', borderRadius: '4px' }}
            className="resized-image"
            onDoubleClick={handleDoubleClick}
            title="Double click to edit in Draw Mode"
        />
    );

    if (caption) {
        return (
            <figure style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: 0, width: `${width}px`, maxWidth: '100%' }}>
                {imageElement}
                <figcaption className="image-caption">{caption}</figcaption>
            </figure>
        );
    }
    return imageElement;
};

const PageGuides = ({ contentRef }) => {
    const [guides, setGuides] = useState([]);

    useEffect(() => {
        let ro, mo;

        const calculateGuides = () => {
            if (!contentRef.current) return;
            const container = contentRef.current.querySelector('.page-container');
            if (!container) return;

            // 1. Core Dimensions
            const { width: containerWidthPx } = container.getBoundingClientRect();
            const pxPerMm = containerWidthPx / 210;
            const contentHeightPx = 257 * pxPerMm; // A4 printable height (roughly)
            const topPaddingPx = 20 * pxPerMm;

            // 2. Offsets
            const parentRect = contentRef.current.parentElement.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const containerTopOffset = (containerRect.top - parentRect.top) + contentRef.current.parentElement.scrollTop;

            // 3. Find all manual breaks
            const manualBreaks = Array.from(container.querySelectorAll('.manual-page-break')).map(el => {
                const rect = el.getBoundingClientRect();
                return rect.top - containerRect.top;
            }).sort((a, b) => a - b);

            const totalHeight = container.scrollHeight;
            const newGuides = [];
            let currentAnchor = topPaddingPx;
            let globalPageNum = 1;

            // 4. Interleaved Logical Loop
            while (true) {
                // Find if there's a manual break before the next auto break
                const nextAutoPos = currentAnchor + contentHeightPx;
                const manualBreak = manualBreaks.find(pos => pos > currentAnchor && pos <= nextAutoPos);

                if (manualBreak) {
                    // Manual break takes priority
                    newGuides.push({
                        position: containerTopOffset + manualBreak,
                        pageNumber: globalPageNum++,
                    });
                    currentAnchor = manualBreak; // Reset anchor to the manual break position
                } else if (nextAutoPos + 5 < totalHeight) {
                    // Standard automatic break
                    newGuides.push({
                        position: containerTopOffset + nextAutoPos,
                        pageNumber: globalPageNum++,
                    });
                    currentAnchor = nextAutoPos; // Reset anchor to the auto break position
                } else {
                    // Check if there are any remaining manual breaks after currentAnchor
                    const remainingManualBreak = manualBreaks.find(pos => pos > currentAnchor);
                    if (remainingManualBreak) {
                        newGuides.push({
                            position: containerTopOffset + remainingManualBreak,
                            pageNumber: globalPageNum++,
                        });
                        currentAnchor = remainingManualBreak;
                    } else {
                        break;
                    }
                }
            }
            setGuides(newGuides);
        };

        calculateGuides();

        ro = new ResizeObserver(calculateGuides);
        if (contentRef.current) ro.observe(contentRef.current);

        mo = new MutationObserver(calculateGuides);
        if (contentRef.current) {
            mo.observe(contentRef.current, { childList: true, subtree: true, characterData: true });
        }

        return () => {
            if (ro) ro.disconnect();
            if (mo) mo.disconnect();
        };
    }, [contentRef]);

    return (
        <div className="page-guides-container">
            {guides.map((guide, index) => (
                <div key={index} className="page-guide" style={{ top: `${guide.position}px` }}>
                    <div className="danger-zone" />
                    <div className="guide-line" />
                    <span className="guide-label">{guide.pageNumber}</span>
                </div>
            ))}
        </div>
    );
};

// Helper to inject line numbers ONLY if they exist
const SafeInject = ({ node, children, tagName, ...props }) => {
    const line = node?.position?.start?.line;
    const Component = tagName;
    const className = props.className || '';

    // If we have a line number, tag it.
    // We removed the isMath guard because top-level math containers (math math-display) 
    // should be sync targets, while deep KaTeX inners don't have node positions anyway.
    if (line) {
        return <Component {...props} data-source-line={line} className={`sync-target ${className}`}>{children}</Component>;
    }
    return <Component {...props}>{children}</Component>;
};

const MarkdownComponents = {
    img: CustomImage,
    a: (props) => <a {...props} className="styled-link" target="_blank" rel="noopener noreferrer" />,
    hr: () => null,
    p: (props) => {
        const children = React.Children.toArray(props.children);

        // Find all images and non-images in this paragraph
        const images = children.filter(child => child.props && child.type === CustomImage);
        const nonImages = children.filter(child => !(child.props && child.type === CustomImage));

        // Check if the non-image content is just empty space/newlines
        const hasOnlyImagesAndWhitespace = nonImages.every(child => typeof child === 'string' && child.trim() === '');

        if (images.length > 0 && hasOnlyImagesAndWhitespace) {
            return (
                <div
                    className="image-gallery sync-target"
                    data-source-line={props.node?.position?.start?.line}
                    // This Flexbox wrapper allows multiple images to sit side-by-side centered!
                    style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', flexWrap: 'wrap', margin: '1.5em 0' }}
                >
                    {props.children}
                </div>
            );
        }
        return <SafeInject tagName="p" {...props} />;
    },
    h1: (props) => <SafeInject tagName="h1" {...props} />,
    h2: (props) => <SafeInject tagName="h2" {...props} />,
    h3: (props) => <SafeInject tagName="h3" {...props} />,
    h4: (props) => <SafeInject tagName="h4" {...props} />,
    blockquote: (props) => <SafeInject tagName="blockquote" {...props} />,
    li: (props) => <SafeInject tagName="li" {...props} />,
    pre: (props) => <SafeInject tagName="pre" {...props} />,
    span: (props) => <SafeInject tagName="span" {...props} />,
    div: (props) => <SafeInject tagName="div" {...props} />,
    mark: (props) => <SafeInject tagName="mark" {...props} />,
    table: (props) => <table {...props} />,
    thead: (props) => <thead {...props} />,
    tbody: (props) => <tbody {...props} />,
    tr: (props) => <tr {...props} />,
    th: (props) => <th {...props} />,
    td: (props) => <td {...props} />,
};

// --- BLOCK PARSER ---
// DEPRECATED: We now use a single pass to preserve list contexts


const ABOUT_NOTE = {
    id: 'about-poring-notebook-v2',
    name: 'User guide & Changelog',
    content: guideContent
};

const GEMINI_MODELS = [
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' }
];

function App() {
    // Add a booting state
    const [isBooting, setIsBooting] = useState(true);

    // Initialize with empty arrays/defaults instead of localStorage
    const [notes, setNotes] = useState([ABOUT_NOTE]);
    const [folders, setFolders] = useState([]);
    const [activeNoteId, setActiveNoteId] = useState(ABOUT_NOTE.id);
    const [viewMode, setViewMode] = useState('split');
    const [searchQuery, setSearchQuery] = useState('');
    const [drawModeState, setDrawModeState] = useState({ isOpen: false, editKey: null });
    const [workspacePath, setWorkspacePath] = useState('Loading...');

    // Add this near your other useState declarations
    const [explanationModal, setExplanationModal] = useState({ isOpen: false, keyword: '', text: '' });

    // Add this function to handle opening the modal
    const handleOpenExplanation = () => {
        const view = editorRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const selectedText = view.state.sliceDoc(from, to);
        
        if (!selectedText.trim()) {
            alert("Please highlight a word or phrase first!");
            return;
        }
        
        setExplanationModal({ isOpen: true, keyword: selectedText, text: '' });
    };

    // Add this function to handle saving the explanation
    const handleSaveExplanation = () => {
        const view = editorRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const { keyword, text } = explanationModal;
        
        const insertText = `[[${keyword}]](${text})`;
        
        view.dispatch({
            changes: { from, to, insert: insertText },
            selection: { anchor: from + insertText.length }
        });
        
        view.focus();
        setExplanationModal({ isOpen: false, keyword: '', text: '' });
    };

    // Listen for Double Click from Preview
    useEffect(() => {
        const handleImageEdit = (e) => {
            setDrawModeState({ isOpen: true, editKey: e.detail });
        };
        window.addEventListener('request-image-edit', handleImageEdit);
        return () => window.removeEventListener('request-image-edit', handleImageEdit);
    }, []);

    // Function to open Draw Mode based on Editor Cursor
    const handleOpenDrawMode = () => {
        const view = editorRef.current;
        if (!view) return;

        const { from, to } = view.state.selection.main;
        const line = view.state.doc.lineAt(from);

        // Check if cursor is on a line with an image tag
        const imageRegex = /!\[.*?\]\(((?:poring-asset:\/\/img_|poring_img_).*?)\)/;
        const match = line.text.match(imageRegex);

        if (match) {
            // Edit existing image from editor cursor
            setDrawModeState({ isOpen: true, editKey: match[1] });
        } else {
            // Open blank draw mode
            setDrawModeState({ isOpen: true, editKey: null });
        }
        setIsInsertMenuOpen(false); // Close dropdown if it was open
    };

    // Function that fires when "Save" is clicked inside DrawMode
    const handleSaveDrawing = (newKey, oldKey) => {
        const view = editorRef.current;

        if (oldKey) {
            // We were editing an existing image. Find and replace its key in the document.
            if (view) {
                const currentText = view.state.doc.toString();
                if (currentText.includes(oldKey)) {
                    const start = currentText.indexOf(oldKey);
                    view.dispatch({
                        changes: { from: start, to: start + oldKey.length, insert: newKey }
                    });
                }
            } else {
                editorTextRef.current = editorTextRef.current.replace(oldKey, newKey);
                setInitialEditorValue(editorTextRef.current);
            }
        } else if (view) {
            // We created a brand new drawing. Insert it at cursor position.
            const markdown = `\n![Image | ${imageWidths.pasted}](${newKey})\n`;
            const { from, to } = view.state.selection.main;
            view.dispatch({
                changes: { from, to, insert: markdown },
                selection: { anchor: from + markdown.length }
            });
            view.focus();
        }

        setDrawModeState({ isOpen: false, editKey: null });
    };

    // --- PERFORMANCE UPGRADE: UNCONTROLLED EDITOR STATE ---
    const editorTextRef = useRef('');
    const [lastTypeTime, setLastTypeTime] = useState(Date.now());
    const prevNoteIdRef = useRef(activeNoteId);

    // 1. SYNC REF ON NOTE SWITCH (Runs during render to prevent stale data on mount)
    if (prevNoteIdRef.current !== activeNoteId) {
        const currentNote = notes.find(n => n.id === activeNoteId);
        editorTextRef.current = currentNote?.content || '';
        prevNoteIdRef.current = activeNoteId;
    }

    // 2. The Editor onChange (Fires on every keystroke, NO re-renders!)
    const handleEditorChange = React.useCallback((val) => {
        editorTextRef.current = val; 
        setLastTypeTime(Date.now()); // Ping React to trigger the debouncer
    }, []);

    // 3. The SMART Preview Updater & Auto-Saver
    useEffect(() => {
        // Small files (< 20k chars): update every 600ms. Massive files: update every 2500ms
        const textLength = editorTextRef.current?.length || 0;
        const delay = textLength > 20000 ? 2500 : 600; 

        const handler = setTimeout(() => {
            const currentNote = notes.find(n => n.id === activeNoteId);
            if (currentNote && currentNote.content !== editorTextRef.current) {
                updateContent(editorTextRef.current);
            }
        }, delay);

        return () => clearTimeout(handler);
    }, [lastTypeTime, activeNoteId]);

    const handleDropNote = (e, targetFolderId) => {
        e.preventDefault();
        const noteId = e.dataTransfer.getData('noteId');
        if (!noteId) return;

        setNotes(prevNotes => prevNotes.map(n =>
            n.id === noteId ? { ...n, folderId: targetFolderId } : n
        ));
    };

    useEffect(() => {
        const loadAppData = async () => {
            try {
                // 1. TRY NATIVE LOAD FIRST
                let workspace = null;
                if (window.electronAPI && window.electronAPI.loadWorkspace) {
                    workspace = await window.electronAPI.loadWorkspace();
                    // NEW: Fetch the workspace path
                    const path = await window.electronAPI.getWorkspace();
                    setWorkspacePath(path);
                }

                if (workspace && workspace.notes && workspace.notes.length > 0) {
                    // NATIVE LOAD SUCCESSFUL
                    setNotes([ABOUT_NOTE, ...workspace.notes]);
                    setFolders(workspace.folders || []);
                    setActiveNoteId(workspace.activeNoteId || ABOUT_NOTE.id);
                } else {
                    // 2. LEGACY WEB FALLBACK & MIGRATION
                    const savedNotes = await localforage.getItem('poring_notes') || [];
                    const savedFolders = await localforage.getItem('poring_folders') || [];
                    const savedActiveId = await localforage.getItem('poring_active_note') || ABOUT_NOTE.id;

                    const filtered = savedNotes.filter(n =>
                        !n.id.startsWith('about-poring-notebook') &&
                        n.id !== 'welcome-note-default'
                    );

                    setNotes([ABOUT_NOTE, ...filtered]);
                    setFolders(savedFolders);
                    setActiveNoteId(savedActiveId);

                    // AUTO-MIGRATION: Save these old DB notes straight to the OS Native Folder!
                    if (window.electronAPI && window.electronAPI.syncWorkspace && filtered.length > 0) {
                        await window.electronAPI.syncWorkspace({ notes: filtered, folders: savedFolders, activeNoteId: savedActiveId });
                        console.log("Auto-Migrated IndexedDB notes to Native OS Folder!");
                    }
                }
            } catch (error) {
                console.error("Failed to load data", error);
            } finally {
                setIsBooting(false); // App is ready!
            }
        };
        loadAppData();
    }, []);

    useEffect(() => {
        // Migration Script: Runs once to convert custom syntax to HTML
        const hasMigrated = localStorage.getItem('poring_syntax_migrated_v2');
        
        if (!hasMigrated && notes.length > 1) { // > 1 to ignore just the About Note
            console.log("Migrating custom syntax to Standard HTML...");
            
            const migratedNotes = notes.map(note => {
                if (note.id.startsWith('about-')) return note;
                let text = note.content;

                // 1. Alignments
                text = text.replace(/center\[([\s\S]*?)\]/g, '<div align="center">$1</div>');
                text = text.replace(/right\[([\s\S]*?)\]/g, '<div align="right">$1</div>');
                text = text.replace(/left\[([\s\S]*?)\]/g, '<div align="left">$1</div>');

                // 2. Colors (Recursive replacement to handle slight nesting)
                const colors = ['red', 'blue', 'green', 'orange', 'purple', 'gray'];
                colors.forEach(color => {
                    let prevText;
                    do {
                        prevText = text;
                        const regex = new RegExp(`${color}\\[([^\\]]+)\\]`, 'g');
                        text = text.replace(regex, `<span style="color: ${color};">$1</span>`);
                    } while (text !== prevText);
                });

                // 3. Highlights & Underlines
                text = text.replace(/==([\s\S]*?)==/g, '<mark>$1</mark>');
                text = text.replace(/\+\+([\s\S]*?)\+\+/g, '<u>$1</u>');

                // 4. Color Highlights (e.g., green==text==)
                colors.forEach(color => {
                    const regex = new RegExp(`${color}==([\\s\\S]*?)==`, 'g');
                    text = text.replace(regex, `<mark style="background-color: light${color};">$1</mark>`);
                });

                // 5. Page Breaks & Spaces
                text = text.replace(/^\s*\*\*\*\s*$/gm, '<div style="page-break-before: always;"></div>');
                text = text.replace(/^\s*\/\/(\d+)\s*$/gm, (match, p1) => '<br>'.repeat(parseInt(p1, 10)));

                // 6. Interactive Footnotes -> Standard Markdown Footnotes
                let footnoteCounter = 1;
                let footnotesAppendix = "\n\n---\n\n";
                text = text.replace(/\[\[(.+?)\]\]\(([\s\S]+?)\)/g, (match, word, explanation) => {
                    const marker = `[^${footnoteCounter}]`;
                    footnotesAppendix += `${marker}: **${word}** - ${explanation}\n\n`;
                    footnoteCounter++;
                    return `${word}${marker}`;
                });
                if (footnoteCounter > 1) text += footnotesAppendix;

                return { ...note, content: text };
            });

            setNotes(migratedNotes);
            localStorage.setItem('poring_syntax_migrated_v2', 'true');
            showToast("Successfully upgraded notes to Standard HTML!");
        }
    }, [notes]);

    // We need a ref to access the activeNoteId inside our clipboard listener without re-rendering
    const activeNoteIdRef = useRef(activeNoteId);
    useEffect(() => {
        activeNoteIdRef.current = activeNoteId;
    }, [activeNoteId]);

    const [lastRefinedContent, setLastRefinedContent] = useState(null);
    const [lastRefinedNoteId, setLastRefinedNoteId] = useState(null);
    const [canUndoRefine, setCanUndoRefine] = useState(false);
    const [toast, setToast] = useState({ message: '', visible: false });

    const showToast = (message) => {
        setToast({ message, visible: true });
        setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 3000);
    };

    // Force refresh About note whenever the code changes
    useEffect(() => {
        setNotes(prevNotes => {
            // Remove all About note versions
            const filtered = prevNotes.filter(n =>
                !n.id.startsWith('about-poring-notebook') &&
                n.id !== 'welcome-note-default'
            );
            // Inject fresh About note from code
            return [ABOUT_NOTE, ...filtered];
        });
    }, [ABOUT_NOTE.content]); // Re-run whenever About note content changes

    // Effect to mark welcome as seen simplified (no longer needed for injection but kept for compatibility)
    useEffect(() => {
        localStorage.setItem('poring_welcome_seen', 'true');
    }, []);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [expandedFolders, setExpandedFolders] = useState({});
    const [typography, setTypography] = useState(() => JSON.parse(localStorage.getItem('poring_typography')) || { font: 'Sans', size: 13 });
    const [spacing, setSpacing] = useState(localStorage.getItem('poring_spacing') || 'normal');
    const [imageWidths, setImageWidths] = useState(() => JSON.parse(localStorage.getItem('poring_image_widths')) || { pasted: 300, autoNote: 450 });
    const [theme, setTheme] = useState(localStorage.getItem('poring_theme') || 'dark');
    const [isSharing, setIsSharing] = useState(false);
    const [isInsertMenuOpen, setIsInsertMenuOpen] = useState(false);
    const [isCoverPagePickerOpen, setIsCoverPagePickerOpen] = useState(false);
    const [isRefining, setIsRefining] = useState(false);
    const [isBreakingMath, setIsBreakingMath] = useState(false);
    const imageInputRef = useRef(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [apiKeys, setApiKeys] = useState(() => {
        const saved = localStorage.getItem('groq_api_keys');
        return saved ? JSON.parse(saved) : [''];
    });
    const [activeApiKeyIndex, setActiveApiKeyIndex] = useState(() => {
        const saved = localStorage.getItem('poring_active_api_key_index');
        return saved ? parseInt(saved, 10) : 0;
    });
    const [aiProvider, setAiProvider] = useState(() => localStorage.getItem('poring_ai_provider') || 'gemini');
    const [updateStatus, setUpdateStatus] = useState('');
    useEffect(() => {
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.onUpdateMessage) {
            window.electronAPI.onUpdateMessage((msg) => setUpdateStatus(msg));
        }
    }, []);
    const handleCheckUpdate = () => {
        if (window.electronAPI && window.electronAPI.checkForUpdates) {
            window.electronAPI.checkForUpdates();
        } else {
            setUpdateStatus('Updates not supported in web mode.');
        }
    };
    // New Multi-key Gemini State (with fallback migration for old users)
    const [geminiKeys, setGeminiKeys] = useState(() => {
        const saved = localStorage.getItem('poring_gemini_keys');
        if (saved) return JSON.parse(saved);
        const legacy = localStorage.getItem('poring_gemini_key');
        return legacy ? [legacy] : [''];
    });
    const [activeGeminiIndex, setActiveGeminiIndex] = useState(() => {
        const saved = localStorage.getItem('poring_active_gemini_index');
        return saved ? parseInt(saved, 10) : 0;
    });
    const [geminiModel, setGeminiModel] = useState(() => localStorage.getItem('poring_gemini_model') || 'gemini-2.5-flash-lite');

    // AI Clipboard Filter State
    const [isAiClipboardEnabled, setIsAiClipboardEnabled] = useState(false);
    const isAiClipboardEnabledRef = useRef(false);

    const toggleAiClipboard = () => {
        const newState = !isAiClipboardEnabled;
        setIsAiClipboardEnabled(newState);
        isAiClipboardEnabledRef.current = newState;
        showToast(newState ? "AI Clipboard Fixer: ON" : "AI Clipboard Fixer: OFF");
    };

    const [isCustomRefineOpen, setIsCustomRefineOpen] = useState(false);
    const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
    const [isColorMenuOpen, setIsColorMenuOpen] = useState(false);

    // --- AUTO NOTE STATE ---
    const [isAutoNoteEnabled, setIsAutoNoteEnabled] = useState(false);
    const isAutoNoteEnabledRef = useRef(false);

    const toggleAutoNote = () => {
        const newState = !isAutoNoteEnabled;
        setIsAutoNoteEnabled(newState);
        isAutoNoteEnabledRef.current = newState;

        if (typeof window !== 'undefined' && window.electronAPI) {
            if (newState) {
                window.electronAPI.startClipboardListener();
                showToast("Auto-Note: Listening to clipboard");
            } else {
                window.electronAPI.stopClipboardListener();
                showToast("Auto-Note: Stopped listening");
            }
        }
    };

    const [customRefineText, setCustomRefineText] = useState('');
    const [savedCustomInstructions, setSavedCustomInstructions] = useState(() => {
        const saved = localStorage.getItem('poring_saved_custom_instructions');
        return saved ? JSON.parse(saved) : [];
    });
    const [customTemplates, setCustomTemplates] = useState(() => {
        const saved = localStorage.getItem('poring_custom_templates');
        return saved ? JSON.parse(saved) : [];
    });
    const [deleteConfirm, setDeleteConfirm] = useState(null); // { type: 'note'|'folder', id: string, name: string }
    const [showFolderPicker, setShowFolderPicker] = useState(false);

    const [promptState, setPromptState] = useState({ isOpen: false, message: '', defaultValue: '', resolve: null });

    const requestPrompt = (message, defaultValue = '') => {
        return new Promise((resolve) => {
            setPromptState({ isOpen: true, message, defaultValue, resolve });
        });
    };

    const handlePromptSubmit = (value) => {
        if (promptState.resolve) promptState.resolve(value);
        setPromptState({ isOpen: false, message: '', defaultValue: '', resolve: null });
    };

    const handlePromptCancel = () => {
        if (promptState.resolve) promptState.resolve(null);
        setPromptState({ isOpen: false, message: '', defaultValue: '', resolve: null });
    };

    const editorRef = useRef(null);
    const previewRef = useRef(null);

    const aiConfigRef = useRef({ aiProvider, geminiKeys, activeGeminiIndex, geminiModel, apiKeys, activeApiKeyIndex });
    useEffect(() => {
        aiConfigRef.current = { aiProvider, geminiKeys, activeGeminiIndex, geminiModel, apiKeys, activeApiKeyIndex };
    }, [aiProvider, geminiKeys, activeGeminiIndex, geminiModel, apiKeys, activeApiKeyIndex]);
    useEffect(() => {
        if (!isBooting) {
            if (window.electronAPI && window.electronAPI.syncWorkspace) {
                // --- NATIVE SAVE ---
                // We strip out the internal About Note so it doesn't clutter the disk
                const filteredNotes = notes.filter(n => !n.id.startsWith('about-poring-notebook') && n.id !== 'welcome-note-default');
                window.electronAPI.syncWorkspace({ notes: filteredNotes, folders, activeNoteId });
            } else {
                // --- LEGACY WEB SAVE ---
                localforage.setItem('poring_notes', notes);
                localforage.setItem('poring_folders', folders);
                localforage.setItem('poring_active_note', activeNoteId || '');
            }

            // Keep lightweight settings in localStorage
            localStorage.setItem('poring_typography', JSON.stringify(typography));
            localStorage.setItem('poring_spacing', spacing);
            localStorage.setItem('poring_theme', theme);
            localStorage.setItem('groq_api_keys', JSON.stringify(apiKeys));
            localStorage.setItem('poring_active_api_key_index', activeApiKeyIndex);
            localStorage.setItem('poring_custom_templates', JSON.stringify(customTemplates));
            localStorage.setItem('poring_saved_custom_instructions', JSON.stringify(savedCustomInstructions));
            localStorage.setItem('poring_image_widths', JSON.stringify(imageWidths));
            localStorage.setItem('poring_ai_provider', aiProvider);
            localStorage.setItem('poring_gemini_keys', JSON.stringify(geminiKeys));
            localStorage.setItem('poring_active_gemini_index', activeGeminiIndex);
            localStorage.setItem('poring_gemini_model', geminiModel);
        }
    }, [notes, folders, activeNoteId, typography, spacing, theme, apiKeys, activeApiKeyIndex, customTemplates, savedCustomInstructions, imageWidths, aiProvider, geminiKeys, activeGeminiIndex, geminiModel, isBooting]);

    // Clipboard Listener Receiver
    useEffect(() => {
        if (typeof window !== 'undefined' && window.electronAPI) {
            window.electronAPI.onClipboardUpdate(async (payload) => {
                if (!isAutoNoteEnabledRef.current) return;

                let appendText = '';
                if (payload.type === 'text') {
                    const rawText = payload.text;
                    if (isAiClipboardEnabledRef.current) {
                        showToast("AI is cleaning clipboard text...");
                        const { aiProvider: provider, geminiKeys: gKeys, activeGeminiIndex: gIdx, geminiModel: gModel, apiKeys: groqKeys, activeApiKeyIndex: groqIdx } = aiConfigRef.current;
                        const config = {
                            provider: provider,
                            apiKey: provider === 'gemini' ? gKeys[gIdx] : groqKeys[groqIdx],
                            model: provider === 'gemini' ? gModel : 'llama-3.3-70b-versatile',
                            systemInstruction: CLIPBOARD_FIXER_PROMPT,
                            prompt: rawText,
                            temperature: 0.1
                        };
                        try {
                            const cleanedText = await processAiRequest(config);
                            appendText = `\n${cleanedText}\n`;
                            showToast("Clipboard fixed and added!");
                        } catch (err) {
                            console.error("AI Clipboard Fix failed:", err);
                            showToast("AI Fix failed. Adding raw text.");
                            appendText = `\n${rawText}\n`;
                        }
                    } else {
                        appendText = `\n${rawText}\n`;
                    }
                } else if (payload.type === 'image') {
                    try {
                        const response = await fetch(payload.dataURL);
                        const blob = await response.blob();
                        const key = await saveImageToAssetStore(blob);
                        appendText = `\n![Image | ${imageWidths.autoNote}](${key})\n`;
                    } catch (e) {
                        console.error('Clipboard image error', e);
                        return;
                    }
                }

                if (appendText) {
                    const view = editorRef.current;
                    // If an editor view is active, insert at cursor. Otherwise, append to end.
                    if (view) {
                        const { from } = view.state.selection.main;
                        view.dispatch({
                            changes: { from, insert: appendText },
                            selection: { anchor: from + appendText.length }
                        });
                        view.focus();
                    } else {
                        setLocalContent(prev => prev + appendText);
                    }
                }
            });
        }
    }, [imageWidths.autoNote]); // Listener attached once on mount

    const activeNote = notes.find(n => n.id === activeNoteId) || notes[0];

    // Actions
    const toggleFolder = (id) => {
        setExpandedFolders(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const createFolder = async () => {
        const name = await requestPrompt('Folder Name:');
        if (!name) return;
        setFolders([...folders, { id: Date.now().toString(), name }]);
    };

    const createNote = async (folderId = null) => {
        if (showFolderPicker) {
            setShowFolderPicker(false);
        }
        const name = await requestPrompt('Note name:', 'Untitled');
        if (!name) return;
        const newNote = { id: Date.now().toString(), name, content: '', folderId };
        setNotes([...notes, newNote]);
        setActiveNoteId(newNote.id);
    };

    const renameNote = async (id) => {
        if (id === ABOUT_NOTE.id) return; // Protected
        const note = notes.find(n => n.id === id);
        if (!note) return;
        const newName = await requestPrompt('Rename note:', note.name);
        if (!newName || newName === note.name) return;
        setNotes(notes.map(n => n.id === id ? { ...n, name: newName } : n));
    };

    const renameFolder = async (id) => {
        const folder = folders.find(f => f.id === id);
        if (!folder) return;
        const newName = await requestPrompt('Rename folder:', folder.name);
        if (!newName || newName === folder.name) return;
        setFolders(folders.map(f => f.id === id ? { ...f, name: newName } : f));
    };

    const confirmDelete = (type, id, name) => {
        setDeleteConfirm({ type, id, name });
    };

    const executeDelete = () => {
        if (!deleteConfirm) return;
        if (deleteConfirm.id === ABOUT_NOTE.id) {
            setDeleteConfirm(null);
            return;
        }
        if (deleteConfirm.type === 'note') {
            setNotes(notes.filter(n => n.id !== deleteConfirm.id));
            if (activeNoteId === deleteConfirm.id) setActiveNoteId(ABOUT_NOTE.id);
        } else if (deleteConfirm.type === 'folder') {
            setFolders(folders.filter(f => f.id !== deleteConfirm.id));
            // Optionally orphan or delete notes in this folder
            setNotes(notes.map(n => n.folderId === deleteConfirm.id ? { ...n, folderId: null } : n));
        }
        setDeleteConfirm(null);
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (isInsertMenuOpen && !event.target.closest('.insert-dropdown-container')) {
                setIsInsertMenuOpen(false);
            }
            if (isToolsMenuOpen && !event.target.closest('.format-toolbar-container')) {
                setIsToolsMenuOpen(false);
                setIsColorMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isInsertMenuOpen, isToolsMenuOpen]);

    const updateContent = (content) => {
        setNotes(prevNotes => prevNotes.map(n => n.id === activeNoteId ? { ...n, content } : n));
    };

    const handleInsertPicture = () => {
        imageInputRef.current?.click();
        setIsInsertMenuOpen(false);
    };

    const handleInsertTable = async () => {
        const input = await requestPrompt("Table dimensions (e.g., 3x3):", "3x3");
        if (!input) return;
        const match = input.match(/(\d+)\s*[xX*]\s*(\d+)/);
        if (!match) {
            showToast("Invalid format. Use 3x3 or 3*3");
            return;
        }
        const rows = parseInt(match[1], 10);
        const cols = parseInt(match[2], 10);
        if (rows <= 0 || cols <= 0) {
            showToast("Dimensions must be positive");
            return;
        }
        let tableMd = "\n";
        tableMd += "| " + Array(cols).fill("Header").join(" | ") + " |\n";
        tableMd += "| " + Array(cols).fill("---").join(" | ") + " |\n";
        for (let i = 0; i < rows; i++) {
            tableMd += "| " + Array(cols).fill("Cell").join(" | ") + " |\n";
        }
        tableMd += "\n";

        const view = editorRef.current;
        if (view) {
            const { from, to } = view.state.selection.main;
            view.dispatch({
                changes: { from, to, insert: tableMd },
                selection: { anchor: from + tableMd.length }
            });
            view.focus();
        }

        setIsInsertMenuOpen(false);
        showToast(`Inserted ${rows}x${cols} Table`);
    };

    const onImageFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const key = await saveImageToAssetStore(file);
            const markdown = `![Image | ${imageWidths.pasted}](${key})`;

            const view = editorRef.current;
            if (view) {
                const { from, to } = view.state.selection.main;
                view.dispatch({
                    changes: { from, to, insert: markdown },
                    selection: { anchor: from + markdown.length }
                });
                view.focus();
            }
        } catch (err) {
            console.error("Image insert failed:", err);
            alert("Failed to insert image.");
        } finally {
            e.target.value = ''; // Reset for next time
        }
    };

    const handleInsertCoverPage = (key, isCustom = false) => {
        const template = isCustom
            ? customTemplates.find(t => t.id === key)?.content
            : COVER_TEMPLATES[key];

        if (!template) return;

        const content = localContent;
        const newText = template + content;
        setLocalContent(newText);
        setIsCoverPagePickerOpen(false);
        setIsInsertMenuOpen(false);
    };

    const handleSaveAsTemplate = async () => {
        const name = await requestPrompt('Template Name:');
        if (!name) return;

        const content = activeNote?.content || '';
        const newTemplate = {
            id: Date.now().toString(),
            name,
            content
        };

        setCustomTemplates([...customTemplates, newTemplate]);
        alert('Template saved successfully!');
    };

    const handleDeleteTemplate = (e, id) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to delete this template?')) return;
        setCustomTemplates(customTemplates.filter(t => t.id !== id));
    };

    const handlePaste = async (e) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault(); // ADD THIS LINE to stop default paste behavior
                const blob = items[i].getAsFile();
                try {
                    const key = await saveImageToAssetStore(blob);
                    const markdown = `![Image | ${imageWidths.pasted}](${key})`;

                    const view = editorRef.current;
                    if (view) {
                        const { from, to } = view.state.selection.main;
                        view.dispatch({
                            changes: { from, to, insert: markdown },
                            selection: { anchor: from + markdown.length }
                        });
                        view.focus();
                    }
                } catch (err) {
                    console.error("Paste failed:", err);
                }
            }
        }
    };

    // --- .PORING IMPORT/EXPORT SYSTEM ---
    const importInputRef = useRef(null);

    const handleExportPoring = async () => {
        if (!activeNote) return;
        await exportPoringFile(activeNote.name, activeNote.content);
    };

    const handleImportPoring = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const importedData = await importPoringFile(file);

        if (importedData) {
            const newNote = {
                id: `imported_${Date.now()}`,
                name: importedData.title,
                content: importedData.content,
                folderId: null
            };
            setNotes(prev => [...prev, newNote]);
            setActiveNoteId(newNote.id);
            showToast("Note imported successfully!");
        }

        e.target.value = ''; // Reset file input
    };

    const handleMagicRefine = async () => {
        const view = editorRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const fullText = view.state.doc.toString();
        const selectedText = view.state.sliceDoc(from, to);
        const textToRefine = selectedText || fullText;

        // Configuration based on active provider
        const config = {
            provider: aiProvider,
            apiKey: aiProvider === 'gemini' ? geminiKeys[activeGeminiIndex] : apiKeys[activeApiKeyIndex],
            model: aiProvider === 'gemini' ? geminiModel : 'llama-3.3-70b-versatile',
            systemInstruction: MAGIC_REFINE_PROMPT,
            prompt: `Refine this note. Return only markdown: \n\n${textToRefine}`,
            temperature: 0
        };

        setLastRefinedContent(fullText);
        setLastRefinedNoteId(activeNoteId);
        setCanUndoRefine(true);
        setIsRefining(true);

        try {
            let refinedText = await processAiRequest(config);

            // Sanitizer: Remove markdown code fences if AI added them
            if (refinedText.startsWith('```')) {
                refinedText = refinedText.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');
            }

            if (selectedText) {
                view.dispatch({ changes: { from, to, insert: refinedText } });
            } else {
                view.dispatch({ changes: { from: 0, to: fullText.length, insert: refinedText } });
            }
        } catch (error) {
            alert('AI Refine failed: ' + error.message);
        } finally {
            setIsRefining(false);
        }
    };

    const handleCustomRefine = async () => {
        if (!customRefineText.trim()) {
            alert("Please enter custom instructions for refinement.");
            return;
        }

        const view = editorRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const fullText = view.state.doc.toString();
        const selectedText = view.state.sliceDoc(from, to);
        const textToRefine = selectedText || fullText;

        const config = {
            provider: aiProvider,
            apiKey: aiProvider === 'gemini' ? geminiKeys[activeGeminiIndex] : apiKeys[activeApiKeyIndex],
            model: aiProvider === 'gemini' ? geminiModel : 'llama-3.3-70b-versatile',
            systemInstruction: CUSTOM_REFINE_SYSTEM_PROMPT,
            prompt: `[USER INSTRUCTION]: "${customRefineText}"\n[CONTENT TO REFINE]:\n${textToRefine}\nRefine the content above. Return ONLY the final markdown.`,
            temperature: 0.2
        };

        setLastRefinedContent(fullText);
        setLastRefinedNoteId(activeNoteId);
        setCanUndoRefine(true);
        setIsRefining(true);
        setIsCustomRefineOpen(false);

        try {
            let refinedText = await processAiRequest(config);

            if (refinedText.startsWith('```')) {
                refinedText = refinedText.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');
            }

            if (selectedText) {
                view.dispatch({ changes: { from, to, insert: refinedText } });
            } else {
                view.dispatch({ changes: { from: 0, to: fullText.length, insert: refinedText } });
            }
        } catch (error) {
            alert('Custom Refine failed: ' + error.message);
        } finally {
            setIsRefining(false);
        }
    };

    const handleUndoRefine = () => {
        if (canUndoRefine && lastRefinedContent !== null && lastRefinedNoteId === activeNoteId) {
            updateContent(lastRefinedContent);
            setCanUndoRefine(false);
            setLastRefinedContent(null);
            setLastRefinedNoteId(null);
        }
    };

    const handleSaveCustomInstruction = () => {
        if (!customRefineText.trim()) return;
        if (savedCustomInstructions.includes(customRefineText.trim())) {
            alert("Instruction already saved.");
            return;
        }
        setSavedCustomInstructions([...savedCustomInstructions, customRefineText.trim()]);
    };

    const handleDeleteCustomInstruction = (e, index) => {
        e.stopPropagation();
        const newInstructions = [...savedCustomInstructions];
        newInstructions.splice(index, 1);
        setSavedCustomInstructions(newInstructions);
    };

    // --- TOOLS DROP-DOWN HELPERS ---
    const handleFormatting = (prefix, suffix) => {
        const view = editorRef.current;
        if (!view) return;

        const { from, to } = view.state.selection.main;
        const selectedText = view.state.sliceDoc(from, to);
        const newText = prefix + selectedText + suffix;

        view.dispatch({
            changes: { from, to, insert: newText },
            // This highlights the text inside the brackets/asterisks automatically!
            selection: { anchor: from + prefix.length, head: from + prefix.length + selectedText.length }
        });

        setIsColorMenuOpen(false);
        view.focus();
    };

    const handleVerticalSpacing = async () => {
        const num = await requestPrompt("Enter number of lines for vertical spacing:", "1");
        if (num === null) return;
        const x = parseInt(num, 10);
        if (isNaN(x) || x < 1) return;
        // Insert standard <br> tags instead of //x
        const breaks = "<br>".repeat(x);
        handleFormatting("", `\n${breaks}\n`);
    };

    const handleBreakMathBlock = async () => {
        const view = editorRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const fullText = view.state.doc.toString();
        const selectedText = view.state.sliceDoc(from, to);

        if (!selectedText.trim().startsWith('$$') || !selectedText.trim().endsWith('$$')) {
            alert("Please select an entire math block (including $$ delimiters).");
            return;
        }

        const segmentsPrompt = await requestPrompt("Target number of segments to split this block into?", "2");
        if (segmentsPrompt === null) return;
        const segmentsNum = parseInt(segmentsPrompt, 10);

        const config = {
            provider: aiProvider,
            apiKey: aiProvider === 'gemini' ? geminiKeys[activeGeminiIndex] : apiKeys[activeApiKeyIndex],
            model: aiProvider === 'gemini' ? geminiModel : 'llama-3.3-70b-versatile',
            systemInstruction: BREAK_MATH_PROMPT,
            prompt: `Split this math block into exactly ${segmentsNum} logical separate blocks:\n\n${selectedText}`,
            temperature: 0
        };

        setIsBreakingMath(true);
        setIsToolsMenuOpen(false);
        try {
            const result = await processAiRequest(config);
            if (selectedText) {
                view.dispatch({ changes: { from, to, insert: result } });
            } else {
                view.dispatch({ changes: { from: 0, to: fullText.length, insert: result } });
            }
        } catch (error) {
            alert('Failed to break math block: ' + error.message);
        } finally {
            setIsBreakingMath(false);
        }
    };

    // --- SYNC SCROLL LOGIC ---
    const handlePreviewClick = (e) => {
        // Fix Interaction Conflict: Prevent jump if user is selecting text
        if (window.getSelection().toString().length > 0) return;

        // 1. Find the clicked element
        const target = e.target.closest('[data-source-line]');
        if (!target) return;

        // 2. Get the line number generated by the Markdown parser
        const trueLineNum = parseInt(target.getAttribute('data-source-line'), 10);
        const view = editorRef.current;

        if (isNaN(trueLineNum) || !view) return;

        try {
            // CodeMirror lines are 1-indexed. Clamp it just in case.
            const docLines = view.state.doc.lines;
            const safeLineNum = Math.max(1, Math.min(trueLineNum, docLines));

            // Get the exact Line object from CodeMirror
            const line = view.state.doc.line(safeLineNum);

            // Jump to the exact line, set the cursor, and center it on screen!
            view.dispatch({
                selection: { anchor: line.from },
                effects: [EditorView.scrollIntoView(line.from, { y: 'center' })]
            });

            view.focus();
        } catch (error) {
            console.error("Scroll sync failed", error);
        }
    };

    const handleDownloadPDF = () => {
        const content = previewRef.current;
        if (!content) {
            alert('No content to export!');
            return;
        }

        // Change main document title so the browser's "Save as PDF" uses it as the filename
        const originalTitle = document.title;
        document.title = activeNote?.name || 'Document';

        const spacingMap = {
            'Too narrow': '0px',
            'narrow': '0.1em',
            'normal': '0.3em',
            'wide': '0.8em'
        };

        // ELECTRON NATIVE PDF GENERATION (SAFE IPC)
        if (typeof window !== 'undefined' && window.electronAPI) {

            const printStyle = document.createElement('style');
            printStyle.id = 'temp-print-style';
            printStyle.innerHTML = `
                @media print {
                    @page { size: A4; margin: 20mm; }

                    /* Hide everything except the preview pane */
                    header,
                    aside.sidebar,
                    section.editor-pane,
                    .preview-header,
                    .page-guides-container,
                    .page-footer,
                    .guide-label,
                    .danger-zone,
                    .guide-line,
                    .editor-info-bar,
                    .tools-dropdown-container,
                    .insert-dropdown-container {
                        display: none !important;
                    }

                    html, body, #root, .app-container {
                        background: white !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        overflow: visible !important;
                        height: auto !important;
                        min-height: 0 !important;
                        display: block !important;
                        position: static !important;
                    }

                    main.main-layout {
                        display: block !important;
                        padding: 0 !important;
                        margin: 0 !important;
                        height: auto !important;
                        min-height: 0 !important;
                        overflow: visible !important;
                    }

                    section.preview-pane {
                        display: block !important;
                        width: 100% !important;
                        padding: 0 !important;
                        margin: 0 !important;
                        border: none !important;
                        height: auto !important;
                        min-height: 0 !important;
                        overflow: visible !important;
                    }

                    .pages-stack {
                        display: block !important;
                        padding: 0 !important;
                        margin: 0 !important;
                    }

                    .preview-content,
                    .page-container {
                        width: 100% !important;
                        height: auto !important;
                        overflow: visible !important;
                        margin: 0 !important;
                        display: block !important;
                        border: none !important;
                        box-shadow: none !important;
                    }

                    .page-container {
                        page-break-after: auto;
                        break-after: auto;
                        padding: 0 !important;
                    }

                    .manual-page-break {
                        page-break-before: always !important;
                        break-before: page !important;
                        display: block !important;
                        height: 0 !important;
                        margin: 0 !important;
                        visibility: hidden !important;
                    }

                    img {
                        max-width: 100% !important;
                    }

                    :root {
                        --p-font: ${typography.font === 'Serif' ? "'Computer Modern Serif', serif" : typography.font === 'Mono' ? "'JetBrains Mono', monospace" : "'Inter', sans-serif"};
                        --p-size: ${typography.size}px;
                        --block-spacing: ${spacingMap[spacing] || '1em'};
                    }
                }
            `;
            document.head.appendChild(printStyle);

            const cleanupPrint = () => {
                document.title = originalTitle;
                const styleEl = document.getElementById('temp-print-style');
                if (styleEl) document.head.removeChild(styleEl);
                window.electronAPI.removeAllPrintListeners();
            };

            window.electronAPI.onPrintSuccess(() => cleanupPrint());
            window.electronAPI.onPrintError((err) => {
                alert('PDF generation failed: ' + err);
                cleanupPrint();
            });
            window.electronAPI.onPrintCancelled(() => cleanupPrint());

            // Pass null — Electron will print the LIVE window directly.
            // This is the ONLY way blob: image URLs are preserved in the PDF.
            window.electronAPI.printToPDF(null, activeNote?.name || 'Document');
            return;
        }


        // --- WEB BROWSER FALLBACK (IFRAME) ---
        // If Electron is not available, we fall back to the iframe method
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '1px'; // 1px ensures browser doesn't skip rendering fonts
        iframe.style.height = '1px';
        iframe.style.opacity = '0';
        iframe.style.pointerEvents = 'none';
        iframe.style.border = '0';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow.document;

        let styles = document.head.innerHTML;
        styles = styles.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

        styles += `
            <style>
            @page {
                size: A4;
                margin: 20mm;
            }
            body {
                background: white;
                margin: 0;
                padding: 0;
                overflow: visible!important;
                height: auto!important;
            }
            .preview-content, .page-container {
                width: 100%!important;
                height: auto!important;
                overflow: visible!important;
                margin: 0!important;
                display: block!important;
            }
            .page-container {
                page-break-after: auto;
                break-after: auto;
                padding: 0!important;
            }
            .manual-page-break {
                page-break-before: always!important;
                break-before: page!important;
                display: block!important;
                height: 0!important;
                margin: 0!important;
                visibility: hidden!important;
            }
            .page-guides-container, .page-footer, .guide-label, .danger-zone, .guide-line {
                display: none!important;
            }
            :root {
                --p-font: ${typography.font === 'Serif' ? "'Computer Modern Serif', serif" : typography.font === 'Mono' ? "'JetBrains Mono', monospace" : "'Inter', sans-serif"};
                --p-size: ${typography.size}px;
                --block-spacing: ${spacingMap[spacing] || '1em'};
            }
            </style>
        `;

        const htmlString = `
        <!DOCTYPE html>
            <html>
                <head>${styles}</head>
                <body>
                    ${content.outerHTML}
                </body>
            </html>
        `;


        // WEB BROWSER FALLBACK (IFRAME)
        // 5. Write content to iframe
        // Setup onload BEFORE doc.write to guarantee it fires
        iframe.onload = () => {
            const win = iframe.contentWindow;
            // First wait a brief moment for external CSS (like KaTeX) to parse
            setTimeout(() => {
                let printed = false;
                const executePrint = () => {
                    if (printed) return;
                    printed = true;
                    // Finally, give layout engines 500ms to calculate sizes and positions
                    setTimeout(() => {
                        win.focus();
                        try { win.print(); } catch (e) { }

                        // Cleanup
                        document.title = originalTitle; // Restore original title immediately after print dialog closes
                        setTimeout(() => {
                            if (document.body.contains(iframe)) {
                                document.body.removeChild(iframe);
                            }
                        }, 500);
                    }, 500);
                };

                // Then wait for all fonts to finish loading
                win.document.fonts.ready.then(executePrint);
                // Fallback timeout in case fonts.ready hangs indefinitely (prevents black screen)
                setTimeout(executePrint, 2500);
            }, 500);
        };

        doc.open();
        doc.write(htmlString);
        doc.close();
    };


    const spacingMap = {
        'Too narrow': '0px',
        'narrow': '0.1em',
        'normal': '0.3em',
        'wide': '0.8em'
    };

    // --- PERFORMANCE UPGRADE: MEMOIZED REGEX PARSER ---
    const processedMarkdown = React.useMemo(() => {
        let c = activeNote?.content || '';
        if (!c) return '';

        // We ONLY need to mask Code blocks and Math blocks so markdown doesn't break them.
        // rehype-raw will natively handle ALL our new HTML (colors, aligns, page breaks, underlines)
        const placeholders = [];
        const mask = (text, type) => {
            const lineCount = (text.match(/\n/g) || []).length;
            const key = `@@${type}_${placeholders.length}@@`;
            const padding = '\n'.repeat(lineCount);
            placeholders.push({ key, text, padding });
            return key + padding;
        };

        c = c.replace(/(`{3,})([\s\S]*?)\1/g, (match) => mask(match, 'CODE_BLOCK'));
        c = c.replace(/(`)([\s\S]*?)\1/g, (match) => mask(match, 'INLINE_CODE'));
        c = c.replace(/(\$\$)([\s\S]*?)\1/g, (match) => mask(match, 'BLOCK_MATH'));
        c = c.replace(/(\$)(?!\s)([^$\n]+?)(?<!\s)\1/g, (match) => mask(match, 'INLINE_MATH'));

        // Today string replacement
        const todayStr = new Intl.DateTimeFormat('en-GB', {
            day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka'
        }).format(new Date());
        c = c.replace(/\[today\]/g, todayStr);

        const explanations = new Map();
        let footnoteCounter = 1;

        // 1. Extract explanations and replace with clickable blue anchors
        c = c.replace(/\[\[(.+?)\]\]\(([\s\S]+?)\)/g, (match, word, desc) => {
            const id = `explain_${footnoteCounter}`;
            explanations.set(id, { word, desc, counter: footnoteCounter });
            footnoteCounter++;
            
            return `<a href="#${id}" class="keyword-ref">${word}</a>`;
        });

        // 2. Append the Explanations to the bottom of the document
        if (explanations.size > 0) {
            let appendix = '\n\n<hr>\n\n<div class="explanation-section">';
            explanations.forEach((data, id) => {
                appendix += `\n<div id="${id}" class="explanation">`;
                appendix += `\n\n**${data.word}**\n\n${data.desc}\n\n`;
                appendix += `<a href="#" class="back-link">&larr; Back to top</a>`;
                appendix += `\n</div>`;
            });
            appendix += '\n</div>';
            c += appendix;
        }

        // Restore Math and Code blocks
        placeholders.reverse().forEach(p => {
            let restoredText = p.text;
            if (p.key.startsWith('@@BLOCK_MATH_')) {
                const innerMath = p.text.replace(/^\$\$|\$\$$/g, '');
                restoredText = `<span class="math-center-wrapper">$\\displaystyle ${innerMath}$</span>`;
            }
            c = c.split(p.key + p.padding).join(restoredText);
        });

        return c;
    }, [activeNote?.content]);

    if (isBooting) return <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', background: '#1e1e1e' }}>Loading Poring Notebook...</div>;

    return (
        <div className={`app-container ${theme === 'dark' ? 'dark-theme' : ''}`} style={{
            '--p-font': typography.font === 'Serif' ? "'Computer Modern Serif', serif" : typography.font === 'Mono' ? "'JetBrains Mono', monospace" : "'Inter', sans-serif",
            '--p-size': `${typography.size}px`,
            '--block-spacing': spacingMap[spacing] || '1em'
        }}>
            <header className="header">
                <div className="header-left">
                    <button className="btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
                        {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
                    </button>
                    <div className="logo" style={{ marginLeft: '10px' }}>Poring Notebook</div>
                </div>

                {/* --- NEW VIEW TOGGLES --- */}
                <div className="view-toggles no-drag">
                    <button
                        className={`btn-view ${viewMode === 'editor' ? 'active' : ''}`}
                        onClick={() => setViewMode('editor')} title="Editor Only">
                        <PenTool size={14} /> Write
                    </button>
                    <button
                        className={`btn-view ${viewMode === 'live' ? 'active' : ''}`}
                        onClick={() => setViewMode('live')} title="Live Preview">
                        <Monitor size={14} /> Live
                    </button>
                    <button
                        className={`btn-view ${viewMode === 'split' ? 'active' : ''}`}
                        onClick={() => setViewMode('split')} title="Split View">
                        <Columns size={14} /> Split
                    </button>
                    <button
                        className={`btn-view ${viewMode === 'preview' ? 'active' : ''}`}
                        onClick={() => setViewMode('preview')} title="Preview Only">
                        <Eye size={14} /> Read
                    </button>
                </div>

                <div className="header-right">
                    <button className="btn no-drag" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
                    </button>
                    <button className="btn no-drag" onClick={() => setIsSettingsOpen(true)}>
                        <Settings size={18} />
                    </button>

                    {/* --- WINDOW CONTROLS --- */}
                    {window.electronAPI && window.electronAPI.windowMinimize && (
                        <div className="window-controls no-drag">
                            <button className="window-btn" onClick={() => window.electronAPI.windowMinimize()}>
                                <Minus size={16} />
                            </button>
                            <button className="window-btn" onClick={() => window.electronAPI.windowMaximize()}>
                                <Square size={14} />
                            </button>
                            <button className="window-btn close" onClick={() => window.electronAPI.windowClose()}>
                                <X size={18} />
                            </button>
                        </div>
                    )}
                </div>
            </header>

            <main className="main-layout">
                <aside
                    className={`sidebar ${isSidebarOpen ? '' : 'collapsed'}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDropNote(e, null)} // Drop on empty space to remove from folder
                >
                    <div className="sidebar-header">
                        <div className="sidebar-action-row">
                            <button className="sidebar-icon-btn" onClick={() => createNote()} title="New Note">
                                <Plus size={18} />
                            </button>
                            <button className="sidebar-icon-btn" onClick={() => createFolder()} title="New Folder">
                                <FolderPlus size={18} />
                            </button>
                            <button className="sidebar-icon-btn" onClick={() => importInputRef.current?.click()} title="Import .zip">
                                <Upload size={16} />
                            </button>
                            <input type="file" ref={importInputRef} style={{ display: 'none' }} accept=".zip" onChange={handleImportPoring} />
                        </div>

                        <div className="sidebar-search">
                            <Search size={14} className="search-icon" />
                            <input
                                type="text"
                                placeholder="Search notes..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="sidebar-scroll">
                        {searchQuery.trim() !== '' ? (
                            /* SEARCH RESULTS (Flat List) */
                            notes.filter(n => n.name.toLowerCase().includes(searchQuery.toLowerCase())).map(note => (
                                <div key={note.id} className={`note-item ${activeNoteId === note.id ? 'active' : ''}`} onClick={() => setActiveNoteId(note.id)}>
                                    <FileText size={14} /> <span>{note.name}</span>
                                </div>
                            ))
                        ) : (
                            /* NORMAL FOLDER STRUCTURE */
                            <>
                                {folders.map(folder => {
                                    const isExpanded = expandedFolders[folder.id];
                                    return (
                                        <div
                                            key={folder.id}
                                            className="folder-group"
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => { e.stopPropagation(); handleDropNote(e, folder.id); }}
                                        >
                                            <div className="note-item folder-title" onClick={() => toggleFolder(folder.id)}>
                                                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                <Folder size={14} /> <span>{folder.name}</span>
                                                <div className="item-actions">
                                                    <Plus size={12} className="hover-icon" onClick={(e) => { e.stopPropagation(); createNote(folder.id); }} title="Add note" />
                                                    <Edit3 size={12} className="hover-icon" onClick={(e) => { e.stopPropagation(); renameFolder(folder.id); }} title="Rename" />
                                                    <Trash2 size={12} className="hover-icon" onClick={(e) => { e.stopPropagation(); confirmDelete('folder', folder.id, folder.name); }} title="Delete" />
                                                </div>
                                            </div>
                                            {isExpanded && notes.filter(n => n.folderId === folder.id).map(note => (
                                                <div
                                                    key={note.id}
                                                    draggable
                                                    onDragStart={(e) => e.dataTransfer.setData('noteId', note.id)}
                                                    className={`note-item child-note ${activeNoteId === note.id ? 'active' : ''}`}
                                                    onClick={() => setActiveNoteId(note.id)}
                                                >
                                                    <FileText size={14} /> <span>{note.name}</span>
                                                    {note.id !== ABOUT_NOTE.id && (
                                                        <div className="item-actions">
                                                            <Edit3 size={12} className="hover-icon" onClick={(e) => { e.stopPropagation(); renameNote(note.id); }} title="Rename" />
                                                            <Trash2 size={12} className="hover-icon" onClick={(e) => { e.stopPropagation(); confirmDelete('note', note.id, note.name); }} title="Delete" />
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })}

                                {/* UNCATEGORIZED NOTES */}
                                {notes.filter(n => !n.folderId).map(note => (
                                    <div
                                        key={note.id}
                                        draggable={note.id !== ABOUT_NOTE.id}
                                        onDragStart={(e) => e.dataTransfer.setData('noteId', note.id)}
                                        className={`note-item ${activeNoteId === note.id ? 'active' : ''}`}
                                        onClick={() => setActiveNoteId(note.id)}
                                    >
                                        <FileText size={14} /> <span>{note.name}</span>
                                        {note.id !== ABOUT_NOTE.id && (
                                            <div className="item-actions">
                                                <Edit3 size={12} className="hover-icon" onClick={(e) => { e.stopPropagation(); renameNote(note.id); }} title="Rename" />
                                                <Trash2 size={12} className="hover-icon" onClick={(e) => { e.stopPropagation(); confirmDelete('note', note.id, note.name); }} title="Delete" />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                </aside>

                {/* Editor Pane (Shows in Split, Editor, OR Live mode) */}
                {(viewMode === 'split' || viewMode === 'editor' || viewMode === 'live') && (
                    <section className="editor-pane" style={(viewMode === 'editor' || viewMode === 'live') ? { borderRight: 'none' } : {}}>
                        <div className="editor-info-bar">
                            <span>{activeNote?.name || 'No Note Selected'}</span>
                            {isRefining && <span className="refining-status"><Loader2 className="spin" size={14} /> Refining...</span>}

                            {isCoverPagePickerOpen && (
                                <div className="cover-picker-overlay" onClick={() => setIsCoverPagePickerOpen(false)}>
                                    <div className="cover-picker-modal" onClick={e => e.stopPropagation()}>
                                        <div className="modal-header">
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <h3>Choose a Cover Page</h3>
                                                <p style={{ fontSize: '0.8rem', color: '#666', margin: 0 }}>Presets or your saved templates</p>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <button className="btn-save-tpl" onClick={handleSaveAsTemplate}>
                                                    <Plus size={14} /> Save Current as Template
                                                </button>
                                                <X size={20} className="close-btn" onClick={() => setIsCoverPagePickerOpen(false)} />
                                            </div>
                                        </div>

                                        <div className="template-scroll-area">
                                            <div className="template-section">
                                                <h4>Standard Presets</h4>
                                                <div className="template-grid">
                                                    <div className="template-card" onClick={() => handleInsertCoverPage('sust_eee')}>
                                                        <div className="template-preview academic">
                                                            <div className="line school"></div>
                                                            <div className="line title"></div>
                                                            <div className="line author"></div>
                                                        </div>
                                                        <span>SUST EEE Cover</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {customTemplates.length > 0 && (
                                                <div className="template-section" style={{ marginTop: '24px' }}>
                                                    <h4>My Templates</h4>
                                                    <div className="template-grid">
                                                        {customTemplates.map(tpl => (
                                                            <div key={tpl.id} className="template-card" onClick={() => handleInsertCoverPage(tpl.id, true)}>
                                                                <div className="template-preview custom">
                                                                    <div className="tpl-delete-btn" onClick={(e) => handleDeleteTemplate(e, tpl.id)}>
                                                                        <Trash2 size={12} />
                                                                    </div>
                                                                    <div className="tpl-content-hint">
                                                                        {tpl.content.substring(0, 100)}...
                                                                    </div>
                                                                </div>
                                                                <span>{tpl.name}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="ai-buttons-group">
                                <div className={`format-toolbar-container ${isToolsMenuOpen ? 'expanded' : ''}`} style={{ display: 'flex', alignItems: 'center' }}>
                                    {/* --- NEW 1-CLICK FORMATTING TOOLBAR --- */}
                                    <div className="format-toolbar">
                                        <button className="format-btn" onClick={() => handleFormatting("**", "**")} title="Bold"><Bold size={14} /></button>
                                        <button className="format-btn" onClick={() => handleFormatting("*", "*")} title="Italic"><Italic size={14} /></button>
                                        <button className="format-btn" onClick={() => handleFormatting("<u>", "</u>")} title="Underline"><Underline size={14} /></button>
                                        <button className="format-btn" onClick={() => handleFormatting("~~", "~~")} title="Strikethrough"><Strikethrough size={14} /></button>
                                        <button className="format-btn" onClick={() => handleFormatting("<mark>", "</mark>")} title="Highlight"><Highlighter size={14} /></button>
                                        <div className="toolbar-divider"></div>
                                        <button className="format-btn" onClick={() => handleFormatting('<div align="center">\n', '\n</div>')} title="Center Align"><AlignCenter size={14} /></button>

                                        <div className="toolbar-divider"></div>
                                        <button className="format-btn" onClick={handleOpenDrawMode} title="Draw / Annotate"><Pen size={14} /></button>
                                        <div className="toolbar-divider"></div>
                                        <button 
                                            className="format-btn" 
                                            onClick={handleOpenExplanation} 
                                            title="Add Interactive Explanation/Footnote"
                                        >
                                            <MessageSquareText size={14} />
                                        </button>
                                    </div>

                                    {/* --- ADVANCED TOOLS DROPDOWN --- */}
                                    <div className="tools-dropdown-container" style={{ position: 'relative' }}>
                                        <button
                                            className={`btn-insert ${isToolsMenuOpen ? 'active' : ''}`}
                                            onClick={() => setIsToolsMenuOpen(!isToolsMenuOpen)}
                                            disabled={!activeNote}
                                            title="Advanced Tools"
                                        >
                                            <Wrench size={14} />
                                            <ChevronDown size={14} className={`arrow ${isToolsMenuOpen ? 'up' : ''}`} />
                                        </button>

                                        {isToolsMenuOpen && (
                                            <div className="insert-menu tools-menu">
                                                <div className="insert-option" onClick={() => handleFormatting("", '\n<div style="page-break-before: always;"></div>\n')}>
                                                    <span>Page Break</span>
                                                </div>

                                                <div
                                                    className="insert-option sub-menu-trigger"
                                                    onMouseEnter={() => setIsColorMenuOpen(true)}
                                                    onMouseLeave={() => setIsColorMenuOpen(false)}
                                                >
                                                    <Palette size={14} />
                                                    <span>Color</span>
                                                    <ChevronRight size={14} style={{ marginLeft: 'auto' }} />

                                                    {isColorMenuOpen && (
                                                        <div className="insert-menu color-submenu">
                                                            {['Red', 'Blue', 'Green', 'Orange', 'Purple', 'Gray'].map(clr => (
                                                                <div
                                                                    key={clr}
                                                                    className="insert-option"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleFormatting(`<span style="color: ${clr.toLowerCase()};">`, "</span>");
                                                                    }}
                                                                >
                                                                    <div className={`color-dot bg-${clr.toLowerCase()}`} />
                                                                    <span>{clr}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="insert-option" onClick={handleVerticalSpacing}>
                                                    <span>Vertical Spacing</span>
                                                </div>
                                                <div className="insert-option" onClick={handleBreakMathBlock}>
                                                    {isBreakingMath ? <Loader2 className="spin" size={14} /> : <Scissors size={14} />}
                                                    <span>{isBreakingMath ? 'Breaking...' : 'Break Math Block'}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="insert-dropdown-container">
                                    <button
                                        className={`btn-insert ${isInsertMenuOpen ? 'active' : ''}`}
                                        onClick={() => setIsInsertMenuOpen(!isInsertMenuOpen)}
                                        disabled={!activeNote}
                                    >
                                        <Plus size={14} />
                                        <span>Insert</span>
                                        <ChevronDown size={14} className={`arrow ${isInsertMenuOpen ? 'up' : ''}`} />
                                    </button>

                                    {isInsertMenuOpen && (
                                        <div className="insert-menu">
                                            <div className="insert-option" onClick={handleInsertPicture}>
                                                <span>Picture</span>
                                            </div>
                                            <div className="insert-option" onClick={handleInsertTable}>
                                                <span>Table</span>
                                            </div>
                                            <div className="insert-option" onClick={() => { setIsCoverPagePickerOpen(true); setIsInsertMenuOpen(false); }}>
                                                <span>Cover Page</span>
                                            </div>
                                        </div>
                                    )}
                                    <input
                                        type="file"
                                        ref={imageInputRef}
                                        style={{ display: 'none' }}
                                        accept="image/*"
                                        onChange={onImageFileChange}
                                    />
                                </div>
                                {/* --- MINIMALIST ICON-ONLY CLIPBOARD BUTTON --- */}
                                <button
                                    className={`btn-auto-note ${isAutoNoteEnabled ? 'active' : ''}`}
                                    onClick={toggleAutoNote}
                                    disabled={!activeNote}
                                    title={
                                        !isAutoNoteEnabled
                                            ? "Auto-Note: OFF"
                                            : isAiClipboardEnabled
                                                ? "Auto-Note: ON (AI Format Fixer Active)"
                                                : "Auto-Note: ON (Standard)"
                                    }
                                    style={{
                                        background: isAutoNoteEnabled && isAiClipboardEnabled ? '#8b5cf6' : (isAutoNoteEnabled ? '#10b981' : 'transparent'),
                                        color: isAutoNoteEnabled ? 'white' : 'var(--text-main)',
                                        border: isAutoNoteEnabled ? 'none' : '1px solid var(--border-color)',
                                        width: '34px',
                                        height: '34px',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                        boxShadow: isAutoNoteEnabled && isAiClipboardEnabled ? '0 0 10px rgba(139, 92, 246, 0.5)' : 'none',
                                        flexShrink: 0
                                    }}
                                >
                                    <ClipboardCheck size={18} />
                                </button>
                                {/* Undo button removed as requested */}
                                <button className="btn-custom-refine" onClick={() => setIsCustomRefineOpen(true)} disabled={isRefining || !activeNote} title="Custom Refine">
                                    <Wand2 size={14} />
                                </button>
                                <button className={`btn-magic ${isRefining ? 'loading' : ''}`} onClick={handleMagicRefine} disabled={isRefining || !activeNote} title="Enhance Syntax">
                                    {isRefining ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                                </button>
                            </div>
                        </div>

                        {/* THE NEW CONDITIONAL EDITOR RENDERING */}
                        {viewMode === 'live' ? (
                            <MemoizedLiveEditor
                                key={`live-${activeNoteId}`}
                                value={editorTextRef.current}
                                onChange={handleEditorChange}
                                onPaste={handlePaste}
                                placeholder="Start typing... (Live Mode)"
                                editorViewRef={editorRef}
                            />
                        ) : (
                            <MemoizedColorfulEditor
                                key={`write-${activeNoteId}`}
                                value={editorTextRef.current}
                                onChange={handleEditorChange}
                                onPaste={handlePaste}
                                placeholder="Start typing..."
                                editorViewRef={editorRef}
                            />
                        )}
                    </section>
                )}

                {/* CONDITIONAL PREVIEW PANE */}
                {(viewMode === 'split' || viewMode === 'preview') && (
                    <section className="preview-pane">
                        <div className="preview-header">
                            <span>PDF Preview</span>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                {/* NEW GOOGLE DOCS PIPELINE BUTTON */}
                                <button
                                    className="btn-export"
                                    style={{ color: '#3b82f6', borderColor: 'rgba(59, 130, 246, 0.3)', background: 'rgba(59, 130, 246, 0.05)' }}
                                    onClick={async () => {
                                        if (!window.electronAPI?.exportToDocx) return;
                                        try {
                                            showToast("Generating .docx...");
                                            const result = await window.electronAPI.exportToDocx({
                                                markdown: activeNote.content,
                                                title: activeNote.name
                                            });
                                            if (result.success) {
                                                showToast("Export Successful!");
                                            }
                                        } catch (err) {
                                            alert(err.error);
                                        }
                                    }}
                                    disabled={!activeNote}
                                    title="Export as Word Document"
                                >
                                    <FileText size={14} /> Export .docx
                                </button>

                                <button className="btn-export" onClick={handleExportPoring} disabled={!activeNote} title="Export as .zip file">
                                    <Download size={14} /> .zip
                                </button>
                                <button className="btn-export" onClick={handleDownloadPDF} disabled={!activeNote} title="Export as PDF">
                                    <Download size={14} /> PDF
                                </button>
                            </div>
                        </div>
                        <div className="pages-stack">
                            <PageGuides contentRef={previewRef} />
                            <div className="preview-content" ref={previewRef} onClick={handlePreviewClick}>
                                <div className="page-container markdown-body">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkMath, remarkFootnotes, remarkBreaks]}
                                        rehypePlugins={[rehypeRaw, [rehypeKatex, { strict: false }]]}
                                        components={MarkdownComponents}
                                        urlTransform={(url) => url}
                                    >
                                        {processedMarkdown}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        </div>
                    </section>
                )}
            </main>

            {isSettingsOpen && (
                <div className="modal-overlay" onMouseDown={() => setIsSettingsOpen(false)}>
                    <div className="modal-content settings-modal-container" onMouseDown={e => e.stopPropagation()}>

                        {/* Header */}
                        <div className="settings-header">
                            <h3>Preferences</h3>
                            <X size={20} className="close-btn" style={{ cursor: 'pointer', opacity: 0.6 }} onClick={() => setIsSettingsOpen(false)} />
                        </div>

                        {/* Body */}
                        <div className="settings-body">
                            {/* --- NEW SECTION: Storage & Workspace --- */}
                            <div className="settings-group">
                                <span className="settings-label-main">Storage & Sync</span>
                                <div className="settings-card">
                                    <div className="settings-row" style={{ borderBottom: 'none' }}>
                                        <div className="settings-row-info">
                                            <span className="settings-row-title">Workspace Folder</span>
                                            <span className="settings-row-desc" style={{ wordBreak: 'break-all', paddingRight: '12px' }}>
                                                {workspacePath}
                                            </span>
                                        </div>
                                        <button 
                                            className="btn-primary"
                                            style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '0.85rem', flexShrink: 0 }}
                                            onClick={async () => {
                                                if(window.electronAPI?.changeWorkspace) {
                                                    const newPath = await window.electronAPI.changeWorkspace();
                                                    if(newPath) {
                                                        setWorkspacePath(newPath);
                                                        alert("Workspace changed! The app will now reload to load your notes from the new folder.");
                                                        window.location.reload();
                                                    }
                                                }
                                            }}
                                        >
                                            Change Folder
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Section: AI Provider */}
                            <div className="settings-group">
                                <span className="settings-label-main">AI Provider Settings</span>
                                <div className="settings-card">
                                    <div className="settings-row">
                                        <div className="settings-row-info">
                                            <span className="settings-row-title">Active Provider</span>
                                        </div>
                                        <select
                                            className="elite-select"
                                            value={aiProvider}
                                            onChange={(e) => setAiProvider(e.target.value)}
                                            style={{ width: '180px' }}
                                        >
                                            <option value="gemini">Google Gemini</option>
                                            <option value="groq">Groq (Llama)</option>
                                        </select>
                                    </div>

                                    {aiProvider === 'gemini' ? (
                                        <>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                {geminiKeys.map((key, idx) => (
                                                    <div
                                                        key={idx}
                                                        className={`elite-radio-row ${activeGeminiIndex === idx ? 'active' : ''}`}
                                                        onClick={() => setActiveGeminiIndex(idx)}
                                                    >
                                                        <div className="custom-radio"><div className="custom-radio-inner" /></div>
                                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                <span className="settings-row-title" style={{ fontSize: '0.8rem' }}>Gemini API Key {idx + 1}</span>
                                                                {geminiKeys.length > 1 && (
                                                                    <Trash2 size={14} style={{ cursor: 'pointer', color: '#ff4d4d' }} onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        const newKeys = geminiKeys.filter((_, i) => i !== idx);
                                                                        setGeminiKeys(newKeys);
                                                                        if (activeGeminiIndex >= newKeys.length) setActiveGeminiIndex(newKeys.length - 1);
                                                                    }} />
                                                                )}
                                                            </div>
                                                            <input
                                                                type="password"
                                                                value={key}
                                                                onChange={(e) => {
                                                                    const newKeys = [...geminiKeys];
                                                                    newKeys[idx] = e.target.value;
                                                                    setGeminiKeys(newKeys);
                                                                }}
                                                                onClick={(e) => e.stopPropagation()}
                                                                placeholder="AIzaSy..."
                                                                className="elite-input"
                                                            />
                                                        </div>
                                                    </div>
                                                ))}
                                                {geminiKeys.length < 5 && (
                                                    <div className="settings-row" style={{ justifyContent: 'center', padding: '8px', borderBottom: '1px solid var(--border-color)' }}>
                                                        <button className="btn-secondary" onClick={() => setGeminiKeys([...geminiKeys, ''])}>
                                                            <Plus size={14} /> Add Gemini Key
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                                                <span className="settings-row-title">Select Model</span>
                                                <select value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} className="elite-select">
                                                    {GEMINI_MODELS.map(m => (
                                                        <option key={m.id} value={m.id}>{m.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            {apiKeys.map((key, idx) => (
                                                <div
                                                    key={idx}
                                                    className={`elite-radio-row ${activeApiKeyIndex === idx ? 'active' : ''}`}
                                                    onClick={() => setActiveApiKeyIndex(idx)}
                                                >
                                                    <div className="custom-radio"><div className="custom-radio-inner" /></div>
                                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                            <span className="settings-row-title" style={{ fontSize: '0.8rem' }}>Groq API Key {idx + 1}</span>
                                                            {apiKeys.length > 1 && (
                                                                <Trash2 size={14} style={{ cursor: 'pointer', color: '#ff4d4d' }} onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const newKeys = apiKeys.filter((_, i) => i !== idx);
                                                                    setApiKeys(newKeys);
                                                                    if (activeApiKeyIndex >= newKeys.length) setActiveApiKeyIndex(newKeys.length - 1);
                                                                }} />
                                                            )}
                                                        </div>
                                                        <input
                                                            type="password"
                                                            value={key}
                                                            onChange={(e) => {
                                                                const newKeys = [...apiKeys];
                                                                newKeys[idx] = e.target.value;
                                                                setApiKeys(newKeys);
                                                            }}
                                                            onClick={(e) => e.stopPropagation()}
                                                            placeholder={`gsk_key_0${idx + 1}...`}
                                                            className="elite-input"
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                            {apiKeys.length < 5 && (
                                                <div className="settings-row" style={{ justifyContent: 'center', padding: '8px' }}>
                                                    <button className="btn-secondary" onClick={() => setApiKeys([...apiKeys, ''])}>
                                                        <Plus size={14} /> Add Groq Key
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Section: Workflow & AI */}
                            <div className="settings-group">
                                <span className="settings-label-main">Workflow & AI</span>
                                <div className="settings-card">
                                    <div className="settings-row">
                                        <div className="settings-row-info">
                                            <span className="settings-row-title">Enable AI Format Fixer</span>
                                            <span className="settings-row-desc">Automatically cleans up formatting when you paste text.</span>
                                        </div>
                                        <div
                                            className={`elite-toggle ${isAiClipboardEnabled ? 'active' : ''}`}
                                            onClick={toggleAiClipboard}
                                        >
                                            <div className="elite-toggle-thumb" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Section: Editor & Media */}
                            <div className="settings-group">
                                <span className="settings-label-main">Editor & Media</span>
                                <div className="settings-card">
                                    <div className="settings-row" style={{ gap: '16px' }}>
                                        <div style={{ flex: 1 }}>
                                            <span className="settings-row-title" style={{ display: 'block', marginBottom: '8px' }}>Pasted Image Width (px)</span>
                                            <input
                                                type="number"
                                                value={imageWidths.pasted}
                                                onChange={(e) => setImageWidths({ ...imageWidths, pasted: e.target.value === '' ? '' : parseInt(e.target.value) })}
                                                onBlur={() => setImageWidths({ ...imageWidths, pasted: imageWidths.pasted || 300 })}
                                                className="elite-input"
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <span className="settings-row-title" style={{ display: 'block', marginBottom: '8px' }}>Auto-Note Image Width (px)</span>
                                            <input
                                                type="number"
                                                value={imageWidths.autoNote}
                                                onChange={(e) => setImageWidths({ ...imageWidths, autoNote: e.target.value === '' ? '' : parseInt(e.target.value) })}
                                                onBlur={() => setImageWidths({ ...imageWidths, autoNote: imageWidths.autoNote || 450 })}
                                                className="elite-input"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Section: Typography */}
                            <div className="settings-group">
                                <span className="settings-label-main">Typography & Spacing</span>
                                <div className="settings-card">
                                    <div className="settings-row" style={{ gap: '16px', borderBottom: 'none', paddingBottom: '0' }}>
                                        <div style={{ flex: 1 }}>
                                            <span className="settings-row-title" style={{ display: 'block', marginBottom: '8px' }}>Font Family</span>
                                            <select value={typography.font} onChange={(e) => setTypography({ ...typography, font: e.target.value })} className="elite-select">
                                                <option value="Sans">Modern (Sans)</option>
                                                <option value="Serif">LaTeX (Standard)</option>
                                                <option value="Mono">Code (Mono)</option>
                                            </select>
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <span className="settings-row-title" style={{ display: 'block', marginBottom: '8px' }}>Line Spacing</span>
                                            <select value={spacing} onChange={(e) => setSpacing(e.target.value)} className="elite-select">
                                                <option value="Too narrow">Too narrow</option>
                                                <option value="narrow">Narrow</option>
                                                <option value="normal">Normal</option>
                                                <option value="wide">Wide</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="settings-row">
                                        <div style={{ flex: 1 }}>
                                            <span className="settings-row-title" style={{ display: 'block', marginBottom: '8px' }}>Font Size (px)</span>
                                            <input
                                                type="number"
                                                value={typography.size}
                                                onChange={(e) => setTypography({ ...typography, size: e.target.value === '' ? '' : parseInt(e.target.value) })}
                                                onBlur={() => setTypography({ ...typography, size: typography.size || 13 })}
                                                className="elite-input"
                                                style={{ width: '50%' }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>

                        {/* Footer */}
                        <div className="settings-footer">
                            <div className="settings-footer-left">
                                <a
                                    href="#"
                                    className="btn-get-api"
                                    style={{ padding: 0, background: 'transparent' }}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        const url = aiProvider === 'gemini'
                                            ? 'https://aistudio.google.com/app/apikey'
                                            : 'https://console.groq.com/keys';
                                        if (window.electronAPI && window.electronAPI.openExternal) {
                                            window.electronAPI.openExternal(url);
                                        } else {
                                            window.open(url, '_blank');
                                        }
                                    }}
                                >
                                    <ExternalLink size={14} /> Get {aiProvider === 'gemini' ? 'Gemini' : 'Groq'} Key
                                </a>

                                {/* Visual divider */}
                                <div style={{ width: '1px', height: '16px', background: 'var(--border-color)', margin: '0 8px' }} />

                                <button
                                    className="btn-secondary"
                                    onClick={handleCheckUpdate}
                                    style={{ padding: '6px 12px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-editor)' }}
                                >
                                    Check for Updates
                                </button>
                                {updateStatus && (
                                    <span style={{ fontSize: '0.8rem', color: '#888', fontWeight: '500' }}>
                                        {updateStatus}
                                    </span>
                                )}
                            </div>

                            {/* Save Button explicitly gets padding added back to it */}
                            <button
                                className="btn-primary"
                                style={{ padding: '8px 20px', borderRadius: '8px', fontSize: '0.9rem' }}
                                onClick={() => setIsSettingsOpen(false)}
                            >
                                Save & Close
                            </button>
                        </div>

                    </div>
                </div>
            )}

            {
                deleteConfirm && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <h3>Confirm Delete</h3>
                            <p>Are you sure you want to delete <strong>"{deleteConfirm.name}"</strong>?</p>
                            {deleteConfirm.type === 'folder' && <p style={{ color: '#ff6b6b', fontSize: '0.9rem' }}>Notes in this folder will be moved to Uncategorized.</p>}
                            <div className="modal-btns">
                                <button onClick={() => setDeleteConfirm(null)}>Cancel</button>
                                <button className="btn-danger" onClick={executeDelete}>Delete</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {isCustomRefineOpen && (
                <div className="modal-overlay" onClick={() => setIsCustomRefineOpen(false)}>
                    <div className="modal-content custom-refine-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Custom Refine</h3>
                            <X size={20} className="close-btn" onClick={() => setIsCustomRefineOpen(false)} />
                        </div>

                        <div className="custom-refine-body">
                            <label className="modal-label">Instruction</label>
                            <textarea
                                autoFocus
                                value={customRefineText}
                                onChange={(e) => setCustomRefineText(e.target.value)}
                                onKeyDown={(e) => {
                                    // Submit on Enter, allow multi-line with Shift+Enter
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleCustomRefine();
                                    }
                                }}
                                placeholder="e.g., Break this math block into 2 smaller one, Change tone to academic..."
                                className="custom-refine-textarea"
                            />
                            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '4px', textAlign: 'right' }}>
                                Press <strong>Enter</strong> to refine, <strong>Shift + Enter</strong> for new line
                            </div>
                            <div className="modal-btns" style={{ marginTop: '12px' }}>
                                <button className="btn-secondary" onClick={handleSaveCustomInstruction} title="Save current instruction as a preset">
                                    <Plus size={14} /> Save Preset
                                </button>
                                <div style={{ flex: 1 }} />
                                <button className="btn-primary" onClick={handleCustomRefine}>
                                    <Sparkles size={14} /> Refine
                                </button>
                            </div>

                            {savedCustomInstructions.length > 0 && (
                                <div className="custom-refine-presets">
                                    <label className="modal-label">Presets</label>
                                    <div className="presets-list">
                                        {savedCustomInstructions.map((instr, idx) => (
                                            <div key={idx} className="preset-item" onClick={() => setCustomRefineText(instr)}>
                                                <span className="preset-text">{instr}</span>
                                                <div className="preset-actions">
                                                    <Trash2 size={12} className="preset-delete" onClick={(e) => handleDeleteCustomInstruction(e, idx)} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {promptState.isOpen && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        {/* Removed the word "Prompt" and used the message as the header */}
                        <h3>{promptState.message.replace(':', '')}</h3>
                        <input
                            type="text"
                            autoFocus
                            defaultValue={promptState.defaultValue}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handlePromptSubmit(e.target.value);
                                if (e.key === 'Escape') handlePromptCancel();
                            }}
                            id="custom-prompt-input"
                            style={{ width: '100%', padding: '8px', marginTop: '10px', marginBottom: '15px' }}
                        />
                        <div className="modal-btns">
                            <button onClick={handlePromptCancel}>Cancel</button>
                            <button className="btn-primary" onClick={() => handlePromptSubmit(document.getElementById('custom-prompt-input').value)}>OK</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Explanation Modal */}
            {explanationModal.isOpen && (
                <div className="modal-overlay" onClick={() => setExplanationModal({ isOpen: false, keyword: '', text: '' })}>
                    <div className="modal-content custom-refine-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Add Explanation</h3>
                            <X size={20} className="close-btn" onClick={() => setExplanationModal({ isOpen: false, keyword: '', text: '' })} />
                        </div>
                        <div className="custom-refine-body">
                            <label className="modal-label">Keyword</label>
                            <input 
                                type="text" 
                                value={explanationModal.keyword} 
                                disabled 
                                className="elite-input" 
                                style={{ marginBottom: '15px', background: 'var(--bg-sidebar)', opacity: 0.8 }}
                            />
                            
                            <label className="modal-label">Detailed Explanation</label>
                            <textarea
                                autoFocus
                                value={explanationModal.text}
                                onChange={(e) => setExplanationModal(prev => ({ ...prev, text: e.target.value }))}
                                placeholder="Paste or type your detailed explanation here..."
                                className="custom-refine-textarea"
                                style={{ minHeight: '150px' }}
                            />
                            
                            <div className="modal-btns" style={{ marginTop: '20px' }}>
                                <button onClick={() => setExplanationModal({ isOpen: false, keyword: '', text: '' })}>Cancel</button>
                                <button className="btn-primary" onClick={handleSaveExplanation}>
                                    Insert Explanation
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {toast.visible && (
                <div className="toast-container">
                    <div className="toast-message">
                        {toast.message}
                    </div>
                </div>
            )}

            {drawModeState.isOpen && (
                <DrawMode
                    initialImageKey={drawModeState.editKey}
                    onSave={handleSaveDrawing}
                    onClose={() => setDrawModeState({ isOpen: false, editKey: null })}
                />
            )}
        </div>
    );
}

export default App;

```

### src/components/ColorfulEditor.jsx

```javascript
import React, { useEffect, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView, Decoration, MatchDecorator, ViewPlugin } from '@codemirror/view';

const poringTheme = EditorView.theme({
    "&": { backgroundColor: "transparent", height: "100%", color: "var(--text-main)" },
    ".cm-scroller": { fontFamily: '"JetBrains Mono", "Fira Code", monospace', fontSize: "14px", lineHeight: "1.6", padding: "20px 0" },
    "&.cm-focused": { outline: "none" },
    ".cm-gutters": { backgroundColor: "transparent", borderRight: "1px solid var(--border-color)", color: "#888", minWidth: "45px", paddingRight: "5px" },
    ".cm-content": { paddingLeft: "10px", paddingRight: "25px" },
    ".cm-poring-keyword": { color: "#b91c1c", fontWeight: "bold" },
    ".cm-poring-spacer": { color: "#888", fontStyle: "italic" },
    ".cm-poring-inline-math": { color: "#d32f2f", backgroundColor: "rgba(211,47,47,0.05)", borderRadius: "3px", padding: "0 2px" },
    ".cm-poring-block-math": { color: "#1976d2", backgroundColor: "rgba(25,118,210,0.05)", borderRadius: "4px", fontWeight: "bold" },
    ".cm-poring-explanation": { color: "#3b82f6", textDecoration: "underline" }
});

function createMatchPlugin(regex, className) {
    const decorator = new MatchDecorator({
        regexp: regex,
        decoration: Decoration.mark({ class: className })
    });
    return ViewPlugin.fromClass(
        class {
            constructor(view) { this.decorations = decorator.createDeco(view); }
            update(update) { 
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = decorator.createDeco(update.view); 
                }
            }
        },
        { decorations: v => v.decorations }
    );
}

// 🚀 OPTIMIZATION 1: Instantiate these heavy plugins OUTSIDE the component so they are created only ONCE.
const mdExtension = markdown({ base: markdownLanguage, codeLanguages: languages });
const blockMathPlugin = createMatchPlugin(/\$\$[\s\S]*?\$\$/g, "cm-poring-block-math");
const inlineMathPlugin = createMatchPlugin(/(?<!\$)\$[^$\n]+\$(?!\$)/g, "cm-poring-inline-math");

// 🚀 OPTIMIZATION 2: Make basicSetup a stable reference outside the component
const editorBasicSetup = {
    lineNumbers: true,
    highlightActiveLineGutter: false,
    highlightActiveLine: false,
    foldGutter: false,
    dropCursor: true,
    crosshairCursor: false,
};

const ColorfulEditor = ({ value, onChange, onPaste, placeholder, editorViewRef }) => {
    
    // 🚀 OPTIMIZATION 3: Keep a stable ref to onPaste to avoid re-triggering useMemo below
    const onPasteRef = useRef(onPaste);
    useEffect(() => {
        onPasteRef.current = onPaste;
    }, [onPaste]);

    // 🚀 OPTIMIZATION 4: Memoize the extensions array so CodeMirror doesn't reconfigure on every keystroke
    const extensions = useMemo(() => {
        return [
            mdExtension,
            EditorView.lineWrapping,
            blockMathPlugin,
            inlineMathPlugin,
            EditorView.domEventHandlers({
                paste: (event, view) => {
                    if (onPasteRef.current) {
                        onPasteRef.current(event);
                    }
                }
            })
        ];
    }, []);

    return (
        <div className="colorful-editor-container" style={{ flex: 1, height: '100%', minHeight: 0, display: 'flex' }}>
            <CodeMirror
                value={value}
                height="100%" 
                style={{ flex: 1, overflow: 'auto' }} 
                onChange={(val) => onChange(val)}
                theme={poringTheme}
                extensions={extensions} 
                placeholder={placeholder}
                basicSetup={editorBasicSetup}
                onCreateEditor={(view) => {
                    if (editorViewRef) {
                        editorViewRef.current = view;
                    }
                }}
            />
        </div>
    );
};

export default ColorfulEditor;
```

### src/components/DrawMode.jsx

```javascript
import React, { useRef, useState, useEffect } from 'react';
import { Pen, Square, Circle, MoveUpRight, Save, X, Undo, Trash2, ImageIcon, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import localforage from 'localforage';

export default function DrawMode({ initialImageKey, onSave, onClose }) {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    
    const [baseImage, setBaseImage] = useState(null);
    const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
    const [zoom, setZoom] = useState(1);
    
    // Tools & Properties
    const [currentTool, setCurrentTool] = useState('pen');
    const [color, setColor] = useState('#ef4444');
    const [lineWidth, setLineWidth] = useState(3);
    const [autoLabel, setAutoLabel] = useState(true);
    
    const [annotations, setAnnotations] = useState([]);
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentPath, setCurrentPath] = useState([]);
    const [startPoint, setStartPoint] = useState(null);
    const [currentMouse, setCurrentMouse] = useState(null);

    // Load initial image if editing
    useEffect(() => {
        if (initialImageKey) {
            if (initialImageKey.startsWith('poring-asset://')) {
                const img = new Image();
                img.crossOrigin = "Anonymous"; // Prevent canvas tainting
                img.onload = () => {
                    setBaseImage(img);
                    setCanvasSize({ w: img.width, h: img.height });
                };
                img.src = initialImageKey;
            } else {
                // Legacy
                localforage.getItem(initialImageKey).then(blob => {
                    if (blob) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            const img = new Image();
                            img.onload = () => {
                                setBaseImage(img);
                                setCanvasSize({ w: img.width, h: img.height });
                            };
                            img.src = event.target.result;
                        };
                        reader.readAsDataURL(blob);
                    }
                });
            }
        }
    }, [initialImageKey]);

    // Handle Image Paste (Ctrl+V)
    useEffect(() => {
        const handlePaste = (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const blob = items[i].getAsFile();
                    if (!blob) continue;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const img = new Image();
                        img.onload = () => {
                            setBaseImage(img);
                            setCanvasSize({ w: img.width, h: img.height });
                            setZoom(1); // Reset zoom on new image
                        };
                        img.src = event.target.result;
                    };
                    reader.readAsDataURL(blob);
                    e.preventDefault();
                    break;
                }
            }
        };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, []);

    const getNextLabel = () => {
        let maxLabel = 0;
        annotations.forEach(a => {
            if (a.label !== undefined && typeof a.label === 'number') {
                maxLabel = Math.max(maxLabel, a.label);
            }
        });
        return maxLabel + 1;
    };

    const getCanvasCoords = (e) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        
        let clientX, clientY;
        if ('touches' in e) {
            if (e.touches.length === 0) return null;
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        
        // This math perfectly maps mouse position to the canvas, regardless of zoom level
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const handlePointerDown = (e) => {
        const coords = getCanvasCoords(e);
        if (!coords) return;
        setIsDrawing(true);
        setStartPoint(coords);
        if (currentTool === 'pen') setCurrentPath([coords]);
        else setCurrentMouse(coords);
    };

    const handlePointerMove = (e) => {
        if (!isDrawing) return;
        const coords = getCanvasCoords(e);
        if (!coords) return;
        if (currentTool === 'pen') setCurrentPath(prev => [...prev, coords]);
        else setCurrentMouse(coords);
    };

    const handlePointerUp = () => {
        if (isDrawing && startPoint) {
            if (currentTool === 'pen' && currentPath.length > 1) {
                setAnnotations(prev => [...prev, { type: 'pen', points: [...currentPath], color, width: lineWidth }]);
            } else if (currentMouse && ['rect', 'circle', 'arrow'].includes(currentTool)) {
                const width = currentMouse.x - startPoint.x;
                const height = currentMouse.y - startPoint.y;
                
                if (Math.abs(width) > 5 || Math.abs(height) > 5) {
                    const label = autoLabel ? getNextLabel() : undefined;
                    let newAnn = null;
                    
                    if (currentTool === 'rect') {
                        newAnn = { type: 'rect', x: startPoint.x, y: startPoint.y, w: width, h: height, color, width: lineWidth, label };
                    } else if (currentTool === 'circle') {
                        const r = Math.sqrt(width * width + height * height) / 2;
                        const cx = startPoint.x + width / 2;
                        const cy = startPoint.y + height / 2;
                        newAnn = { type: 'circle', cx, cy, r, color, width: lineWidth, label };
                    } else if (currentTool === 'arrow') {
                        newAnn = { type: 'arrow', x1: startPoint.x, y1: startPoint.y, x2: currentMouse.x, y2: currentMouse.y, color, width: lineWidth, label };
                    }
                    
                    if (newAnn) setAnnotations(prev => [...prev, newAnn]);
                }
            }
        }
        setIsDrawing(false);
        setCurrentPath([]);
        setStartPoint(null);
        setCurrentMouse(null);
    };

    // Render loop
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (baseImage) {
            ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
        } else {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        const drawLabelText = (text, x, y, bgColor) => {
            const padding = 2;
            const fontSize = Math.max(12, canvas.width * 0.015);
            ctx.font = `bold ${fontSize}px sans-serif`;
            const metrics = ctx.measureText(text);
            const bgWidth = metrics.width + padding * 2;
            const bgHeight = fontSize + padding * 2;
            
            ctx.fillStyle = bgColor;
            ctx.fillRect(x, y, bgWidth, bgHeight);
            
            ctx.fillStyle = '#ffffff';
            ctx.textBaseline = 'top';
            ctx.fillText(text, x + padding, y + padding);
        };

        const drawShape = (a) => {
            ctx.strokeStyle = a.color;
            ctx.lineWidth = a.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            if (a.type === 'pen' && a.points && a.points.length > 0) {
                ctx.beginPath();
                ctx.moveTo(a.points[0].x, a.points[0].y);
                for (let i = 1; i < a.points.length; i++) ctx.lineTo(a.points[i].x, a.points[i].y);
                ctx.stroke();
            } else if (a.type === 'rect') {
                ctx.beginPath();
                ctx.rect(a.x, a.y, a.w, a.h);
                ctx.stroke();
                if (a.label !== undefined) {
                    const left = Math.min(a.x, a.x + a.w);
                    const top = Math.min(a.y, a.y + a.h);
                    drawLabelText(a.label.toString(), left, top, a.color);
                }
            } else if (a.type === 'circle') {
                ctx.beginPath();
                ctx.arc(a.cx, a.cy, a.r, 0, 2 * Math.PI);
                ctx.stroke();
                if (a.label !== undefined) {
                    const offset = a.r * 0.7071;
                    drawLabelText(a.label.toString(), a.cx - offset, a.cy - offset, a.color);
                }
            } else if (a.type === 'arrow') {
                const headlen = a.width * 4;
                const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
                ctx.beginPath();
                ctx.moveTo(a.x1, a.y1);
                ctx.lineTo(a.x2, a.y2);
                ctx.lineTo(a.x2 - headlen * Math.cos(angle - Math.PI / 6), a.y2 - headlen * Math.sin(angle - Math.PI / 6));
                ctx.moveTo(a.x2, a.y2);
                ctx.lineTo(a.x2 - headlen * Math.cos(angle + Math.PI / 6), a.y2 - headlen * Math.sin(angle + Math.PI / 6));
                ctx.stroke();
                if (a.label !== undefined) {
                    drawLabelText(a.label.toString(), a.x2, a.y2, a.color);
                }
            }
        };

        annotations.forEach(drawShape);

        // Draw active draft
        if (isDrawing && startPoint) {
            if (currentTool === 'pen') {
                drawShape({ type: 'pen', points: currentPath, color, width: lineWidth });
            } else if (currentMouse) {
                const w = currentMouse.x - startPoint.x;
                const h = currentMouse.y - startPoint.y;
                const tempLabel = autoLabel ? getNextLabel() : undefined;
                
                if (currentTool === 'rect') drawShape({ type: 'rect', x: startPoint.x, y: startPoint.y, w, h, color, width: lineWidth, label: tempLabel });
                else if (currentTool === 'circle') drawShape({ type: 'circle', cx: startPoint.x + w/2, cy: startPoint.y + h/2, r: Math.sqrt(w*w + h*h)/2, color, width: lineWidth, label: tempLabel });
                else if (currentTool === 'arrow') drawShape({ type: 'arrow', x1: startPoint.x, y1: startPoint.y, x2: currentMouse.x, y2: currentMouse.y, color, width: lineWidth, label: tempLabel });
            }
        }
    }, [baseImage, annotations, isDrawing, currentPath, startPoint, currentMouse, currentTool, color, lineWidth, canvasSize, autoLabel]);

    const handleSave = () => {
        const canvas = canvasRef.current;
        canvas.toBlob(async (blob) => {
            let newKey;
            // Native Save
            if (window.electronAPI && window.electronAPI.saveAsset) {
                const arrayBuffer = await blob.arrayBuffer(); // Send raw ArrayBuffer
                const filename = `img_draw_${Date.now()}.png`;
                await window.electronAPI.saveAsset(filename, arrayBuffer);
                newKey = `poring-asset://${filename}`;
            } else {
                // Legacy Save
                newKey = `poring_img_${Date.now()}`;
                await localforage.setItem(newKey, blob);
            }
            onSave(newKey, initialImageKey);
        }, 'image/png');
    };

    return (
        <div className="draw-overlay">
            {/* Sidebar */}
            <div className="draw-sidebar">
                <div className="draw-sidebar-header">
                    <h2>Draw Mode</h2>
                    <p>Annotate your image</p>
                </div>
                
                <div className="draw-sidebar-content">
                    <h3 className="draw-section-title">Tools</h3>
                    <div className="draw-tools-grid">
                        <button className={`draw-tool-card ${currentTool === 'pen' ? 'active' : ''}`} onClick={() => setCurrentTool('pen')}>
                            <Pen size={20} /><span>Pen</span>
                        </button>
                        <button className={`draw-tool-card ${currentTool === 'rect' ? 'active' : ''}`} onClick={() => setCurrentTool('rect')}>
                            <Square size={20} /><span>Box</span>
                        </button>
                        <button className={`draw-tool-card ${currentTool === 'circle' ? 'active' : ''}`} onClick={() => setCurrentTool('circle')}>
                            <Circle size={20} /><span>Circle</span>
                        </button>
                        <button className={`draw-tool-card ${currentTool === 'arrow' ? 'active' : ''}`} onClick={() => setCurrentTool('arrow')}>
                            <MoveUpRight size={20} /><span>Arrow</span>
                        </button>
                    </div>

                    <h3 className="draw-section-title">View / Zoom</h3>
                    <div className="draw-tools-grid">
                        <button className="draw-tool-card" onClick={() => setZoom(z => Math.max(0.2, z - 0.2))}>
                            <ZoomOut size={16} /><span>Zoom Out</span>
                        </button>
                        <button className="draw-tool-card" onClick={() => setZoom(1)}>
                            <Maximize size={16} /><span>Reset</span>
                        </button>
                        <button className="draw-tool-card" style={{ gridColumn: 'span 2' }} onClick={() => setZoom(z => Math.min(5, z + 0.2))}>
                            <ZoomIn size={16} /><span>Zoom In</span>
                        </button>
                    </div>

                    <h3 className="draw-section-title">Properties</h3>
                    <div className="draw-property-row">
                        <span>Auto-Label</span>
                        <label className={`draw-switch ${autoLabel ? 'on' : ''}`}>
                            <input type="checkbox" checked={autoLabel} onChange={(e) => setAutoLabel(e.target.checked)} style={{ display: 'none' }} />
                            <div className="draw-switch-thumb" />
                        </label>
                    </div>

                    <div className="draw-property-row color-row">
                        <span style={{width: '100%', display: 'block', marginBottom: '8px'}}>Color</span>
                        <div className="draw-colors">
                            {['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#000000', '#ffffff'].map(c => (
                                <button key={c} className={`draw-color-swatch ${color === c ? 'active' : ''}`} style={{ backgroundColor: c }} onClick={() => setColor(c)} />
                            ))}
                        </div>
                    </div>

                    <div className="draw-property-row" style={{ flexDirection: 'column', alignItems: 'flex-start', borderBottom: 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '8px' }}>
                            <span>Line Width</span>
                            <span className="draw-line-val">{lineWidth}px</span>
                        </div>
                        <input type="range" min="1" max="20" value={lineWidth} onChange={(e) => setLineWidth(Number(e.target.value))} className="draw-slider" />
                    </div>

                    <h3 className="draw-section-title">Actions</h3>
                    <div className="draw-actions-row">
                        <button className="draw-action-btn" onClick={() => setAnnotations(prev => prev.slice(0, -1))} disabled={annotations.length===0}><Undo size={16} /> Undo</button>
                        <button className="draw-action-btn danger" onClick={() => setAnnotations([])} disabled={annotations.length===0}><Trash2 size={16} /> Clear</button>
                    </div>
                </div>

                <div className="draw-sidebar-footer">
                    <button className="draw-btn-cancel" onClick={onClose}>Cancel</button>
                    <button className="draw-btn-save" onClick={handleSave}><Save size={16} /> Save</button>
                </div>
            </div>

            {/* Canvas Area */}
            <div className="draw-canvas-container" ref={containerRef}>
                {!baseImage && annotations.length === 0 && (
                    <div className="draw-empty-state">
                        <div className="draw-empty-card">
                            <ImageIcon size={40} color="#9ca3af" />
                            <h4>Start Annotating</h4>
                            <p>Paste an image (Ctrl+V) to begin</p>
                        </div>
                    </div>
                )}
                
                {/* 
                    This wrapper receives the scaled dimensions. 
                    The canvas element inside stretches to 100% of this wrapper.
                */}
                <div className="draw-canvas-wrapper" style={{ width: canvasSize.w * zoom, height: canvasSize.h * zoom }}>
                    <canvas
                        ref={canvasRef}
                        width={canvasSize.w}       // True resolution width
                        height={canvasSize.h}      // True resolution height
                        className="draw-canvas"
                        style={{ cursor: 'crosshair', width: '100%', height: '100%' }} // Stretches to wrapper via CSS
                        onMouseDown={handlePointerDown}
                        onMouseMove={handlePointerMove}
                        onMouseUp={handlePointerUp}
                        onMouseLeave={handlePointerUp}
                        onTouchStart={handlePointerDown}
                        onTouchMove={handlePointerMove}
                        onTouchEnd={handlePointerUp}
                        onTouchCancel={handlePointerUp}
                    />
                </div>
            </div>
        </div>
    );
}

```

### src/components/LivePreviewEditor.jsx

```javascript
import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import katex from 'katex';
import localforage from 'localforage';

import SustLogo from '../assets/sust_logo.png';
import BegulaImg from '../assets/Begula.png';
const ASSET_MAP = { SUST_LOGO: SustLogo, BEGULA_IMG: BegulaImg };

const hideDeco = Decoration.mark({ class: "cm-hidden-markup" });

class ImageWidget extends WidgetType {
    constructor(altText, source) { super(); this.altText = altText; this.source = source; }
    // 🛡️ Ensure CodeMirror caches this DOM node
    eq(other) { return this.source === other.source && this.altText === other.altText; }
    ignoreEvent() { return false; }
    toDOM() {
        const parts = this.altText ? this.altText.split('|') : ["Image"];
        const width = parts[1] || '300';
        const wrapper = document.createElement("span");
        wrapper.style.display = "inline-block";
        wrapper.style.width = "100%";
        wrapper.style.textAlign = "center";
        wrapper.style.padding = "10px 0";
        const img = document.createElement("img");
        img.style.maxWidth = "100%";
        img.style.width = `${width}px`;
        img.style.borderRadius = "4px";
        if (this.source.startsWith('poring-asset://')) {
            img.src = this.source;
        } else if (this.source.startsWith('poring_img_')) {
            localforage.getItem(this.source).then(blob => {
                if (blob) img.src = URL.createObjectURL(blob);
            });
        } else {
            img.src = ASSET_MAP[this.source] || this.source;
        }
        wrapper.appendChild(img);
        return wrapper;
    }
}

class VSpaceWidget extends WidgetType {
    // 🛡️ CRITICAL: Prevent infinite layout loops
    eq(other) { return true; }
    toDOM() {
        const span = document.createElement("span");
        span.style.display = "block";
        span.style.width = "100%";
        span.style.height = `24px`;
        span.style.backgroundColor = "rgba(139, 92, 246, 0.03)";
        span.style.borderLeft = "2px dashed rgba(139, 92, 246, 0.2)";
        return span;
    }
}

class PageBreakWidget extends WidgetType {
    // 🛡️ CRITICAL: Prevent infinite layout loops
    eq(other) { return true; }
    toDOM() {
        const wrap = document.createElement("div");
        wrap.style.width = "100%";
        wrap.style.borderBottom = "2px dashed #cbd5e1";
        wrap.style.margin = "20px 0";
        wrap.style.position = "relative";

        const label = document.createElement("span");
        label.innerText = "Page Break";
        label.style.position = "absolute";
        label.style.right = "0";
        label.style.top = "-10px";
        label.style.background = "#f1f5f9";
        label.style.color = "#64748b";
        label.style.padding = "2px 8px";
        label.style.fontSize = "10px";
        label.style.borderRadius = "4px";

        wrap.appendChild(label);
        return wrap;
    }
}

class MathWidget extends WidgetType {
    constructor(math, isBlock) {
        super();
        this.math = math || "";
        this.isBlock = isBlock;
    }
    // 🛡️ Ensure CodeMirror correctly caches Math blocks
    eq(other) { return this.math === other.math && this.isBlock === other.isBlock; }
    ignoreEvent() { return false; }
    toDOM() {
        const container = document.createElement("span");
        if (this.isBlock) {
            container.className = "math-center-wrapper";
            container.style.display = "inline-block";
            container.style.width = "100%";
            container.style.textAlign = "center";
            container.style.cursor = "text";
            container.style.padding = "10px 0";
            container.title = "Click to edit formula";
        } else {
            container.style.cursor = "text";
            container.style.display = "inline-block";
        }

        try {
            // KaTeX can throw if syntax is completely invalid, we catch it gracefully
            katex.render(this.math, container, { displayMode: this.isBlock, throwOnError: false, strict: false });
        } catch (err) {
            container.innerText = this.isBlock ? `$$${this.math}$$` : `$${this.math}$`;
            container.style.color = "red";
        }
        return container;
    }
}

const livePreviewPlugin = ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = this.buildDecorations(view); }
    update(update) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
            this.decorations = this.buildDecorations(update.view);
        }
    }

    buildDecorations(view) {
        // 🛡️ The Ultimate Failsafe: Prevents the "White Screen of Death"
        try {
            const builder = new RangeSetBuilder();
            const selFrom = view.state.selection.main.from;
            const selTo = view.state.selection.main.to;
            const decos = [];

            // Chunk text for performance
            const vpFrom = Math.max(0, view.viewport.from - 2500);
            const vpTo = Math.min(view.state.doc.length, view.viewport.to + 2500);
            const chunkText = view.state.sliceDoc(vpFrom, vpTo);
            const mathRanges = [];

            // --- 1. PARSE IMAGES ---
            syntaxTree(view.state).iterate({
                from: vpFrom,
                to: vpTo,
                enter: (node) => {
                    if (node.name === "Image") {
                        const isSelected = selFrom <= node.to && selTo >= node.from;
                        if (!isSelected) {
                            const safeFrom = Math.max(0, Math.min(node.from, view.state.doc.length));
                            const safeTo = Math.max(0, Math.min(node.to, view.state.doc.length));
                            if (safeFrom >= safeTo) return;

                            const text = view.state.sliceDoc(safeFrom, safeTo);
                            const match = text.match(/!\[(.*?)\]\((.*?)\)/);
                            if (match) {
                                decos.push({
                                    from: safeFrom,
                                    to: safeTo,
                                    deco: Decoration.replace({ widget: new ImageWidget(match[1], match[2]) })
                                });
                            }
                        }
                    }
                }
            });

            // --- 2. PARSE MATH BLOCKS ---
            const blockMathRegex = /\$\$([\s\S]*?)\$\$/g;
            let match;
            while ((match = blockMathRegex.exec(chunkText)) !== null) {
                const start = vpFrom + match.index;
                const end = start + match[0].length;
                mathRanges.push({ from: start, to: end });
                if (!(selFrom <= end && selTo >= start)) {
                    decos.push({ from: start, to: end, deco: Decoration.replace({ widget: new MathWidget(match[1], true) }) });
                }
            }

            const inlineMathRegex = /(?:^|[^$])\$([^$\n]+?)\$(?!\$)/g;
            while ((match = inlineMathRegex.exec(chunkText)) !== null) {
                const offset = match[0].startsWith('$') ? 0 : 1;
                const start = vpFrom + match.index + offset;
                const end = start + match[0].length - offset;

                if (!mathRanges.some(r => start >= r.from && end <= r.to)) {
                    mathRanges.push({ from: start, to: end });
                    if (!(selFrom <= end && selTo >= start)) {
                        decos.push({ from: start, to: end, deco: Decoration.replace({ widget: new MathWidget(match[1], false) }) });
                    }
                }
            }

            const isInsideMath = (offset) => mathRanges.some(r => offset >= r.from && offset < r.to);

            // 🛡️ Safely clamp bounds so CodeMirror lineAt() never throws an error
            const isCursorNear = (start, end) => {
                try {
                    const safeStart = Math.max(0, Math.min(start, view.state.doc.length));
                    const safeEnd = Math.max(0, Math.min(end, view.state.doc.length));
                    const lineStart = view.state.doc.lineAt(safeStart).from;
                    const lineEnd = view.state.doc.lineAt(safeEnd).to;
                    return selFrom <= lineEnd && selTo >= lineStart;
                } catch (e) {
                    return false;
                }
            };

            // --- 3. PARSE HTML STYLES ---
            const htmlFormats = [
                { regex: /<u>([\s\S]*?)<\/u>/g, openLen: 3, closeLen: 4, className: "underline" },
                { regex: /<mark>([\s\S]*?)<\/mark>/g, openLen: 6, closeLen: 7, className: "cm-highlight" }
            ];

            htmlFormats.forEach(({ regex, openLen, closeLen, className }) => {
                while ((match = regex.exec(chunkText)) !== null) {
                    const start = vpFrom + match.index;
                    const end = start + match[0].length;
                    if (isInsideMath(start)) continue;

                    const innerStart = start + openLen;
                    const innerEnd = end - closeLen;

                    if (!isCursorNear(start, end)) {
                        decos.push({ from: start, to: innerStart, deco: hideDeco });
                        decos.push({ from: innerEnd, to: end, deco: hideDeco });
                    }
                    if (innerStart < innerEnd) {
                        decos.push({ from: innerStart, to: innerEnd, deco: Decoration.mark({ class: className }) });
                    }
                }
            });

            const spanRegex = /<span style="color:\s*([a-zA-Z#0-9]+);?">([\s\S]*?)<\/span>/g;
            while ((match = spanRegex.exec(chunkText)) !== null) {
                const start = vpFrom + match.index;
                const end = start + match[0].length;
                if (isInsideMath(start)) continue;

                const color = match[1];
                const openTagLen = match[0].indexOf('>') + 1;
                const innerStart = start + openTagLen;
                const innerEnd = end - 7;

                if (!isCursorNear(start, end)) {
                    decos.push({ from: start, to: innerStart, deco: hideDeco });
                    decos.push({ from: innerEnd, to: end, deco: hideDeco });
                }
                if (innerStart < innerEnd) {
                    decos.push({ from: innerStart, to: innerEnd, deco: Decoration.mark({ attributes: { style: `color: ${color};` } }) });
                }
            }

            const divRegex = /<div align="(center|right|left)">([\s\S]*?)<\/div>/g;
            while ((match = divRegex.exec(chunkText)) !== null) {
                const start = vpFrom + match.index;
                const end = start + match[0].length;
                if (isInsideMath(start)) continue;

                const align = match[1];
                const openTagLen = match[0].indexOf('>') + 1;
                const innerStart = start + openTagLen;
                const innerEnd = end - 6;

                if (!isCursorNear(start, end)) {
                    decos.push({ from: start, to: innerStart, deco: hideDeco });
                    decos.push({ from: innerEnd, to: end, deco: hideDeco });
                }

                let pos = innerStart;
                while (pos <= innerEnd) {
                    if (pos > view.state.doc.length) break;
                    const line = view.state.doc.lineAt(pos);
                    if (!isInsideMath(line.from)) {
                        decos.push({ from: line.from, to: line.from, deco: Decoration.line({ class: `cm-line-${align}` }) });
                    }
                    pos = line.to + 1;
                }
            }

            const brRegex = /<br\s*\/?>/g;
            while ((match = brRegex.exec(chunkText)) !== null) {
                const start = vpFrom + match.index;
                const end = start + match[0].length;
                if (!isInsideMath(start) && !isCursorNear(start, end)) {
                    decos.push({ from: start, to: end, deco: Decoration.replace({ widget: new VSpaceWidget() }) });
                }
            }

            const pbRegex = /<div style="page-break-before:\s*always;?"><\/div>/g;
            while ((match = pbRegex.exec(chunkText)) !== null) {
                const start = vpFrom + match.index;
                const end = start + match[0].length;
                if (!isInsideMath(start) && !isCursorNear(start, end)) {
                    decos.push({ from: start, to: end, deco: Decoration.replace({ widget: new PageBreakWidget() }) });
                }
            }

            // --- 4. PARSE STANDARD MARKDOWN ---
            for (let { from, to } of view.visibleRanges) {
                let pos = from;
                while (pos <= to) {
                    if (pos > view.state.doc.length) break;
                    const line = view.state.doc.lineAt(pos);
                    const text = line.text;
                    const isCursorOnLine = selFrom <= line.to && selTo >= line.from;

                    if (!isCursorOnLine && !isInsideMath(line.from)) {
                        const headMatch = text.match(/^(#+)\s*/);
                        if (headMatch) {
                            const level = headMatch[1].length;
                            decos.push({ from: line.from, to: line.from, deco: Decoration.line({ class: `cm-heading${level}` }) });
                            decos.push({ from: line.from, to: line.from + headMatch[0].length, deco: hideDeco });
                        }

                        const mdFormats = [
                            { regex: /\*\*([^*]+)\*\*/g, markLen: 2, className: "cm-strong" },
                            { regex: /(?:^|[^\*])\*([^*]+)\*(?!\*)/g, markLen: 1, className: "cm-em" },
                            { regex: /\~\~([^~]+)\~\~/g, markLen: 2, className: "cm-strikethrough" },
                            { regex: /`([^`]+)`/g, markLen: 1, className: "cm-inline-code" }
                        ];

                        mdFormats.forEach(({ regex, markLen, className }) => {
                            let matchFormat;
                            while ((matchFormat = regex.exec(text)) !== null) {
                                const offset = matchFormat[0].startsWith('*') ? 0 : 1;
                                const startIdx = matchFormat.index + offset;
                                const endIdx = startIdx + matchFormat[0].length - offset;

                                const absStart = line.from + startIdx;
                                const absEnd = line.from + endIdx;

                                if (isInsideMath(absStart)) continue;

                                const innerStart = absStart + markLen;
                                const innerEnd = absEnd - markLen;

                                // 🛡️ Prevent empty marks from crashing builder
                                if (innerStart <= innerEnd) {
                                    decos.push({ from: absStart, to: innerStart, deco: hideDeco });
                                    decos.push({ from: innerEnd, to: absEnd, deco: hideDeco });
                                    if (innerStart < innerEnd) {
                                        decos.push({ from: innerStart, to: innerEnd, deco: Decoration.mark({ class: className }) });
                                    }
                                }
                            }
                        });
                    }
                    pos = line.to + 1;
                }
            }

            const explanationRegex = /\[\[(.+?)\]\]\(([\s\S]+?)\)/g;
            while ((match = explanationRegex.exec(chunkText)) !== null) {
                const start = vpFrom + match.index;
                const end = start + match[0].length;

                const word = match[1];
                const innerStart = start + 2;
                const innerEnd = innerStart + word.length;

                if (!isCursorNear(start, end)) {
                    decos.push({ from: start, to: innerStart, deco: hideDeco });
                    decos.push({ from: innerEnd, to: end, deco: hideDeco });
                }
                if (innerStart < innerEnd) {
                    decos.push({ from: innerStart, to: innerEnd, deco: Decoration.mark({ class: "cm-poring-blue", attributes: { style: "text-decoration: underline; cursor: pointer;" } }) });
                }
            }

            // 🛡️ Safely sort and build decorations
            decos.sort((a, b) => a.from - b.from || a.to - b.to);
            let lastEnd = -1;
            for (const d of decos) {
                if (d.from >= lastEnd) {
                    try { builder.add(d.from, d.to, d.deco); lastEnd = d.to; } catch (e) { }
                }
            }
            return builder.finish();

        } catch (error) {
            console.error("Critical parsing error averted:", error);
            return Decoration.none; // Will prevent React from crashing
        }
    }
}, { decorations: v => v.decorations });

const liveTheme = EditorView.theme({
    "&": { backgroundColor: "transparent", height: "100%", color: "var(--text-main)" },
    ".cm-scroller": { fontFamily: "var(--p-font)", fontSize: "var(--p-size)", lineHeight: "1.6", padding: "40px 0" },
    ".cm-content": { paddingLeft: "20px", paddingRight: "20px", maxWidth: "850px", margin: "0 auto" },
    ".cm-hidden-markup": { display: "none" },
    ".cm-heading1": { fontSize: "2.2rem", fontWeight: "800", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.2em", paddingTop: "0.5em" },
    ".cm-heading2": { fontSize: "1.8rem", fontWeight: "700", paddingTop: "0.5em" },
    ".cm-heading3": { fontSize: "1.4rem", fontWeight: "600", paddingTop: "0.5em" },
    ".cm-line-center": { textAlign: "center" },
    ".cm-line-right": { textAlign: "right" },
    ".cm-line-left": { textAlign: "left" },
    ".cm-poring-blue": { color: "#3b82f6" },
    ".cm-strong": { fontWeight: "bold" },
    ".cm-em": { fontStyle: "italic" },
    ".cm-strikethrough": { textDecoration: "line-through" },
    ".underline": { textDecoration: "underline" },
    ".cm-highlight": { backgroundColor: "rgba(255, 212, 0, 0.4)", borderRadius: "3px", padding: "0 2px" },
    ".cm-inline-code": { backgroundColor: "rgba(128, 128, 128, 0.15)", color: "#c2185b", padding: "2px 4px", borderRadius: "4px", fontFamily: '"JetBrains Mono", monospace', fontSize: "0.9em" }
});

const liveMdExtension = markdown({ base: markdownLanguage, codeLanguages: languages });
const liveBasicSetup = { lineNumbers: false, foldGutter: false };

const LivePreviewEditor = ({ value, onChange, onPaste, placeholder, editorViewRef }) => {
    const onPasteRef = React.useRef(onPaste);
    React.useEffect(() => { onPasteRef.current = onPaste; }, [onPaste]);

    const extensions = useMemo(() => [
        liveMdExtension,
        EditorView.lineWrapping,
        livePreviewPlugin,
        EditorView.domEventHandlers({
            paste: (event, view) => {
                if (onPasteRef.current) {
                    onPasteRef.current(event);
                }
            }
        })
    ], []);

    return (
        <div className="colorful-editor-container" style={{ flex: 1, height: '100%', display: 'flex' }}>
            <CodeMirror
                value={value}
                height="100%"
                style={{ flex: 1, overflow: 'auto' }}
                onChange={onChange}
                theme={liveTheme}
                extensions={extensions}
                placeholder={placeholder}
                basicSetup={liveBasicSetup}
                onCreateEditor={(view) => { if (editorViewRef) editorViewRef.current = view; }}
            />
        </div>
    );
};

export default LivePreviewEditor;
```

### src/guide.md

```markdown

```

### src/main.jsx

```javascript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './App.css'

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)

```

### src/utils/aiService.js

```javascript
import { GoogleGenAI } from '@google/genai';

export const MAGIC_REFINE_PROMPT = `You are an Elite Academic Typesetter and LaTeX Specialist.
Your function is STRICTLY LIMITED to structural formatting and mathematical typesetting.
You are NOT allowed to rewrite, interpret, infer, complete, fix, or improve the content in any way.

### CRITICAL CORE DIRECTIVE (ABSOLUTE PRIORITY)
Preserve ALL original content EXACTLY, including:
- words, numbers, symbols, spacing, line breaks
- custom wrappers and interactive syntax

### TRANSFORMATION SCOPE (ONLY THESE ARE ALLOWED)
You MAY ONLY:
• Add inline math delimiters: $...$
• Add display math delimiters: $$...$$
• Insert alignment markers &
• Insert line breaks \\\\ inside aligned blocks
• Convert plain-text math into valid LaTeX math syntax

### WRAPPER INTEGRITY RULE (HIGHEST PRIORITY)
The following constructs are STRUCTURAL WRAPPERS used by the editor:
center[...]
right[...]
left[...]
red[...]
blue[...]
green[...]
orange[...]
purple[...]
gray[...]
++underline++
==highlight==
color==highlight==
//1, //2, //3 (Vertical spacing)
*** (Page breaks)
[[clickable keyword]](explanation) (Interactive Footnotes)

These wrappers are NOT LaTeX. They are NOT Markdown. They are EDITOR STRUCTURE and MUST be preserved EXACTLY.
NEVER remove, rename, split, or wrap these wrappers with $ or $$.
If math exists INSIDE a wrapper, convert ONLY the math, NOT the wrapper. (e.g., center[$x = y$]).

### HEADER SYNTAX RULE
NEVER use standard Markdown headers (#, ##, ###) for section titles unless the user uses them. Use bold text (**Text**) for section titles otherwise.

Return ONLY the refined Markdown. DO NOT include explanations, comments, or conversational text.`;

export const CUSTOM_REFINE_SYSTEM_PROMPT = `CRITICAL: You are a specialized Markdown Refinement Engine. 
Your ONLY task is to re-write the user's content according to their specific instruction.

### HEADER SYNTAX RULE:
NEVER use # or ## for headers unless user uses them. ALWAYS wrap section titles in bold **Text** otherwise.

### OUTPUT CONTRACT:
1. Return ONLY the refined markdown.
2. ABSURDLY CRITICAL: Do NOT include any part of these instructions, the ### RULES, or any meta-commentary in the output.
3. Preserve all custom notebook syntax: center[], right[], color[], //x, ***, and [[keyword]](explanation).
4. Preserve all LaTeX math blocks: $...$ and $$...$$.
5. No preamble. Output ONLY the transformed content.`;

export const BREAK_MATH_PROMPT = `You are a Mathematics Typesetting Specialist.
Your task is to take a single large LaTeX math block ($$ ... $$) and split it into multiple smaller, separate math blocks ($$ ... $$).

### CRITICAL RULES:
1. Preserve ALL mathematical logic and symbols exactly.
2. The user will specify a TARGET number of blocks. Aim to split the content into approximately that many blocks based on logical derivation steps.
3. If the content is an "aligned" environment (\\begin{aligned} ... \\end{aligned}), split it at the line breaks (\\\\) while keeping the alignment logic valid for each resulting block.
4. Every output block must be wrapped in $$ ... $$.
5. Add a single newline between the resulting blocks.
6. OUTPUT ONLY THE MARKDOWN MODIFICATION. Do not include explanations.`;

export const CLIPBOARD_FIXER_PROMPT = `You are a Clipboard Formatting Restorer for an academic notes app.
The user copied this text from a document, PDF, or AI output. It might contain broken LaTeX, missing math symbols (like roots, exponents, or fractions being squished), or malformed brackets.

### YOUR DIRECTIVE:
1. Intelligently fix the mathematical and structural formatting so it renders perfectly in KaTeX/Markdown.
2. DO NOT change the meaning of the text. DO NOT rewrite paragraphs.
3. DO NOT add conversational text or preambles.
4. If the text is completely broken (e.g., a square root sign was copied as a weird symbol), fix it using standard LaTeX (e.g., \\sqrt{}).
5. Preserve any custom editor syntax if it exists (e.g., center[], //1, [[keyword]](explanation)).
6. If the text does NOT need fixing, return it EXACTLY as is.

Output ONLY the restored text.`;

/**
 * Unified AI Caller
 */
export const processAiRequest = async ({ provider, apiKey, model, systemInstruction, prompt, temperature = 0 }) => {
    if (!apiKey || apiKey.trim() === '') {
        throw new Error('API Key is missing. Please add it in settings.');
    }

    if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
            model: model || 'gemini-2.5-flash-lite',
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                temperature: temperature,
            }
        });
        return response.text.trim();
    } 
    
    if (provider === 'groq') {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model || 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: systemInstruction },
                    { role: 'user', content: prompt }
                ],
                temperature: temperature
            })
        });
        
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        return data.choices[0].message.content.trim();
    }

    throw new Error('Invalid AI Provider selected.');
};

```

### src/utils/poringFileHandler.js

```javascript
import localforage from 'localforage';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export const exportPoringFile = async (noteTitle, markdownContent) => {
    try {
        const zip = new JSZip();

        // 1. Add metadata and markdown text
        zip.file("metadata.json", JSON.stringify({
            version: "2.0",
            title: noteTitle,
            timestamp: Date.now()
        }));
        zip.file("document.md", markdownContent);

        const assetsFolder = zip.folder("assets");

        // 2. Regex matches BOTH native (poring-asset://...) and legacy (poring_img_...) URLs
        const imageRegex = /!\[.*?\]\((poring-asset:\/\/[^\s)]+|poring_img_[^\s)]+)\)/g;
        let match;
        const keysToFetch = new Set();

        while ((match = imageRegex.exec(markdownContent)) !== null) {
            keysToFetch.add(match[1]);
        }

        // 3. Process each image found in the document
        for (const key of keysToFetch) {
            if (key.startsWith('poring-asset://')) {
                // --- NATIVE EXPORT ---
                const filename = key.replace('poring-asset://', '');
                try {
                    // Because we enabled fetch support in electron.cjs, we can just fetch it!
                    const response = await fetch(key);
                    const blob = await response.blob();
                    assetsFolder.file(filename, blob);
                } catch (err) {
                    console.error("Failed to fetch native asset for export:", key, err);
                }
            } else {
                // --- LEGACY EXPORT (IndexedDB) ---
                const blob = await localforage.getItem(key);
                if (blob) {
                    const ext = blob.type.split('/')[1] || 'png';
                    assetsFolder.file(`${key}.${ext}`, blob);
                }
            }
        }

        // 4. Generate the ZIP file and trigger download
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, `${noteTitle}.zip`);
        return true;

    } catch (error) {
        console.error("Export failed:", error);
        alert("Export failed: " + error.message);
        return false;
    }
};

export const importPoringFile = async (file) => {
    try {
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(file);

        // 1. Read Metadata and Markdown
        const metadataString = await loadedZip.file("metadata.json").async("string");
        const metadata = JSON.parse(metadataString);
        let markdown = await loadedZip.file("document.md").async("string");

        // 2. Extract images
        // FIX: JSZip's .files returns EVERYTHING. We strictly filter for files inside "assets/"
        const allFilePaths = Object.keys(loadedZip.files);
        
        for (const pathKey of allFilePaths) {
            // Only process files that are physically inside the assets/ folder in the zip
            if (pathKey.startsWith('assets/') && !loadedZip.files[pathKey].dir) {
                
                const filename = pathKey.replace('assets/', ''); // extracts "img_123.png"
                const blob = await loadedZip.files[pathKey].async("blob");
                
                if (window.electronAPI && window.electronAPI.saveAsset) {
                    // --- NATIVE IMPORT ---
                    const arrayBuffer = await blob.arrayBuffer();
                    let finalFilename = filename;

                    // AUTO-MODERNIZER: If importing a legacy note, upgrade it to Native automatically
                    if (filename.startsWith('poring_img_')) {
                        finalFilename = filename.replace('poring_img_', 'img_legacy_');
                        const oldMarkdownKey = filename.split('.')[0]; // e.g. "poring_img_123"
                        
                        // Replace the old reference in the markdown string with the new native protocol
                        markdown = markdown.replaceAll(`(${oldMarkdownKey})`, `(poring-asset://${finalFilename})`);
                    }

                    // Save straight to the OS disk via IPC
                    await window.electronAPI.saveAsset(finalFilename, arrayBuffer);
                } else {
                    // --- LEGACY WEB IMPORT ---
                    const originalKey = filename.split('.')[0]; 
                    await localforage.setItem(originalKey, blob);
                }
            }
        }

        return {
            title: metadata.title || "Imported Note",
            content: markdown
        };

    } catch (error) {
        console.error("Import failed:", error);
        alert("Import failed: Invalid or corrupted .zip file.");
        return null;
    }
};
```

### vite.config.js

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    base: './',
})

```

