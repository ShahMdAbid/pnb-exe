const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, protocol, net } = require('electron');
const { autoUpdater } = require('electron-updater');
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { exec } = require('child_process');

// Helper to reliably find Pandoc, especially on Windows where PATH might not inherit correctly
const getPandocPath = (customPath) => {
  if (customPath && fs.existsSync(customPath)) return `"${customPath}"`;
  
  const isWin = process.platform === 'win32';
  const commonPaths = [
    ...(isWin ? [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Pandoc', 'pandoc.exe') : null,
      'C:\\Program Files\\Pandoc\\pandoc.exe',
      'C:\\Program Files (x86)\\Pandoc\\pandoc.exe'
    ] : [
      '/usr/local/bin/pandoc',
      '/opt/homebrew/bin/pandoc',
      '/usr/bin/pandoc'
    ])
  ].filter(Boolean);

  for (const p of commonPaths) {
    if (fs.existsSync(p)) return `"${p}"`;
  }
  return 'pandoc'; // Fallback to system PATH
};

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

    // FIXED: Smart Workspace Switcher - never overwrites existing notes!
    ipcMain.handle('change-workspace', async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Workspace Folder',
        properties: ['openDirectory', 'createDirectory']
      });

      if (result.canceled) return null;

      const newWorkspace = result.filePaths[0];

      // Even if same folder, persist the preference so it survives updates
      if (newWorkspace === currentWorkspace) {
        fs.writeFileSync(prefsPath, JSON.stringify({ workspacePath: currentWorkspace }));
        return currentWorkspace;
      }

      const newAssetsDir = path.join(newWorkspace, 'assets');
      const newNotesDir = path.join(newWorkspace, 'notes');
      const newWorkspaceJson = path.join(newWorkspace, 'workspace.json');

      if (!fs.existsSync(newAssetsDir)) fs.mkdirSync(newAssetsDir, { recursive: true });
      if (!fs.existsSync(newNotesDir)) fs.mkdirSync(newNotesDir, { recursive: true });

      // Ensure target directories exist (starts fresh and empty if new)
      if (!fs.existsSync(newAssetsDir)) fs.mkdirSync(newAssetsDir, { recursive: true });
      if (!fs.existsSync(newNotesDir)) fs.mkdirSync(newNotesDir, { recursive: true });
      if (!fs.existsSync(newWorkspaceJson)) {
          // Initialize empty workspace.json
          fs.writeFileSync(newWorkspaceJson, JSON.stringify({ activeNoteId: null }, null, 2));
      }

      // Update to new workspace
      currentWorkspace = newWorkspace;
      fs.writeFileSync(prefsPath, JSON.stringify({ workspacePath: currentWorkspace }));
      cachedNotesHash = {}; // Reset cache so notes reload fresh
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
    let isInternalSync = false;
    let workspaceWatcher = null;
    let watcherTimeout = null;

    function readWorkspaceData() {
      const activeNotesDir = getNotesDir();
      const workspaceJsonPath = path.join(currentWorkspace, 'workspace.json');
      let activeNoteId = null;
      if (fs.existsSync(workspaceJsonPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf8'));
          activeNoteId = data.activeNoteId;
        } catch (e) {}
      }

      function scanDir(dirPath, relativeDir = '') {
        let results = { notes: [], folders: [] };
        if (!fs.existsSync(dirPath)) return results;
        
        const items = fs.readdirSync(dirPath);
        for (const item of items) {
          const fullPath = path.join(dirPath, item);
          if (item.startsWith('.') || item.startsWith('~$')) continue;
          
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            const folderId = path.posix.join(relativeDir, item);
            results.folders.push({ id: folderId, name: item });
            const sub = scanDir(fullPath, folderId);
            results.notes.push(...sub.notes);
            results.folders.push(...sub.folders);
          } else if (item.endsWith('.md')) {
            const id = path.posix.join(relativeDir, item);
            let name = item.replace(/\.md$/, '');
            
            // Backward compatibility for old `name_id.md` format
            const match = name.match(/^(.*)_(\d+)$/);
            let noteId = id;
            if (match) {
               name = match[1];
               noteId = match[2]; 
            }
            
            const content = fs.readFileSync(fullPath, 'utf8');
            cachedNotesHash[noteId] = content.length + name + id;
            
            results.notes.push({ id: noteId, name, content, folderId: relativeDir || null, relativePath: id });
          }
        }
        return results;
      }

      const { notes, folders } = scanDir(activeNotesDir);
      return { notes, folders, activeNoteId };
    }

    function initWorkspaceWatcher() {
      if (workspaceWatcher) {
        try { workspaceWatcher.close(); } catch (e) {}
      }

      const activeNotesDir = getNotesDir();
      if (!fs.existsSync(activeNotesDir)) return;

      try {
        workspaceWatcher = fs.watch(activeNotesDir, { recursive: true }, (eventType, filename) => {
          if (isInternalSync) return;

          clearTimeout(watcherTimeout);
          watcherTimeout = setTimeout(() => {
            if (isInternalSync) return;
            const updated = readWorkspaceData();
            if (updated && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('workspace-external-update', updated);
            }
          }, 300);
        });
      } catch (err) {
        console.error("Failed to initialize workspace watcher:", err);
      }
    }

    ipcMain.handle('load-workspace', () => {
      const data = readWorkspaceData();
      initWorkspaceWatcher();
      return data;
    });

    ipcMain.handle('sync-workspace', (event, { notes, folders, activeNoteId }) => {
      isInternalSync = true;
      const safeName = (name) => name.replace(/[^a-zA-Z0-9 -]/g, '').trim() || 'Untitled';
      
      // Save activeNoteId
      fs.writeFileSync(path.join(currentWorkspace, 'workspace.json'), JSON.stringify({ activeNoteId }, null, 2));

      const activeNotesDir = getNotesDir();
      const currentFileNames = new Set();
      
      // Build a map of folders to know their intended paths
      const folderPaths = {};
      folders.forEach(f => {
         // If a folder was just created, it might have a timestamp ID, we just use its name
         // If it's an existing folder, its ID is its relative path. 
         // For now, let's assume flat folders (1 level deep) based on their name for safety,
         // since the UI currently doesn't support nested folder creation anyway.
         folderPaths[f.id] = safeName(f.name);
         
         const dir = path.join(activeNotesDir, folderPaths[f.id]);
         if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      });

      notes.forEach(n => {
        if (n.id.startsWith('about-poring-notebook')) return;
        
        const folderName = n.folderId ? (folderPaths[n.folderId] || n.folderId) : '';
        const fileName = `${safeName(n.name)}_${n.id}.md`;
        const relativePath = path.posix.join(folderName, fileName);
        const absolutePath = path.join(activeNotesDir, folderName, fileName);
        
        currentFileNames.add(relativePath);
        
        const dir = path.dirname(absolutePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const hash = n.content.length + n.name + relativePath;
        if (cachedNotesHash[n.id] !== hash || !fs.existsSync(absolutePath)) {
          fs.writeFileSync(absolutePath, n.content || '');
          cachedNotesHash[n.id] = hash;
        }
      });

      // Cleanup files not in current state
      function cleanupDir(dirPath, relativeDir = '') {
         if (!fs.existsSync(dirPath)) return;
         const items = fs.readdirSync(dirPath);
         for (const item of items) {
            if (item.startsWith('.') || item.startsWith('~$')) continue;
            
            const fullPath = path.join(dirPath, item);
            const relPath = path.posix.join(relativeDir, item);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
               cleanupDir(fullPath, relPath);
               // Remove empty directories
               if (fs.readdirSync(fullPath).length === 0) {
                  fs.rmdirSync(fullPath);
               }
            } else if (item.endsWith('.md')) {
               if (!currentFileNames.has(relPath)) {
                  try { fs.unlinkSync(fullPath); } catch(e){}
               }
            }
         }
      }
      
      cleanupDir(activeNotesDir);

      setTimeout(() => {
        isInternalSync = false;
      }, 500);

      return true;
    });

    ipcMain.on('open-notes-folder', () => {
      shell.openPath(currentWorkspace);
    });

    // --- GOOGLE DOCS EXPORT PIPELINE (PANDOC ENGINE) ---
    ipcMain.handle('export-to-docx', async (event, { markdown, title, customPandocPath }) => {
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
            // Trim to satisfy Pandoc's strict inline math rules (no spaces after opening $ or before closing $)
            mathBlocks.push({ placeholder, content: `$${content.trim()}$` });
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
            // Use a function replacer to prevent '$$' in the math content from being evaluated as a single '$' by JS
            processedMd = processedMd.replace(item.placeholder, () => item.content);
          });
          if (footnotes.length > 0) processedMd += '\n\n' + footnotes.join('\n');

          fs.writeFileSync(mdPath, processedMd, 'utf8');
          const command = `${getPandocPath(customPandocPath)} "${mdPath}" -f markdown -t docx -o "${docxPath}"`;

          exec(command, (error) => {
            if (error) {
              console.error("Pandoc Error:", error);
              return reject({ success: false, error: 'Pandoc is not installed or not found in PATH. Please install Pandoc from pandoc.org and restart your computer.' });
            }
            // Auto-open the file in explorer so user can see where it was saved
            shell.showItemInFolder(docxPath);
            resolve({ success: true, docxPath: docxPath });
          });
        } catch (err) {
          reject({ success: false, error: err.message });
        }
      });
    });

    ipcMain.handle('export-to-gdocs', async (event, { markdown, title, customPandocPath }) => {
      // First, generate the docx in a temp directory using existing logic
      const tempDir = app.getPath('temp');
      const safeTitle = title.replace(/[^a-zA-Z0-9 -]/g, '').trim() || 'Document';
      const docxPath = path.join(tempDir, `${safeTitle}_gdocs.docx`);

      try {
        // Re-use the docx generation logic but without showing in folder
        await new Promise((resolve, reject) => {
            // Very simplified copy of the above to just get a docx
            const mdPath = path.join(tempDir, `${safeTitle}_gdocs.md`);
            let processedMd = markdown;
            const mathBlocks = [];
            processedMd = processedMd.replace(/\$\$([\s\S]*?)\$\$/g, (match, content) => {
              const placeholder = `%%BLOCKMATH${mathBlocks.length}%%`;
              mathBlocks.push({ placeholder, content: `$$${content}$$` });
              return placeholder;
            });
            processedMd = processedMd.replace(/\$([^$]+?)\$/g, (match, content) => {
              const placeholder = `%%INLINEMATH${mathBlocks.length}%%`;
              mathBlocks.push({ placeholder, content: `$${content.trim()}$` });
              return placeholder;
            });
            processedMd = processedMd.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, altText, url) => {
              if (url.startsWith('poring-asset://')) {
                const filename = url.replace('poring-asset://', '');
                let absPath = path.join(getAssetsDir(), filename);
                if (!fs.existsSync(absPath)) absPath = path.join(userDataPath, 'assets', filename);
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
            
            // Strip wrappers
            const tags = ['red', 'blue', 'green', 'orange', 'purple', 'gray', 'center', 'right', 'left'];
            const regex = new RegExp(`\\b(?:${tags.join('|')})\\[`, 'g');
            let match;
            while ((match = regex.exec(processedMd)) !== null) {
              const start = match.index;
              const open = start + match[0].length - 1;
              let depth = 1; let j = open + 1;
              while (j < processedMd.length && depth > 0) {
                if (processedMd[j] === '[') depth++;
                else if (processedMd[j] === ']') depth--;
                j++;
              }
              if (depth === 0) {
                const end = j - 1;
                const innerContent = processedMd.substring(open + 1, end);
                processedMd = processedMd.substring(0, start) + innerContent + processedMd.substring(j);
                regex.lastIndex = 0;
              } else { regex.lastIndex = open + 1; }
            }
            
            processedMd = processedMd.replace(/^\s*\/\/(\d+)\s*$/gm, (m) => '\n'.repeat(parseInt(m.replace(/\//g, '').trim(), 10)));
            processedMd = processedMd.replace(/^\s*\*\*\*\s*$/gm, '');
            const footnotes = [];
            processedMd = processedMd.replace(/\[\[(.+?)\]\]\(([\s\S]+?)\)/g, (m, word, desc) => {
              const index = footnotes.length + 1;
              footnotes.push(`[^${index}]: ${desc.trim()}`);
              return `${word}[^${index}]`;
            });
            mathBlocks.forEach(item => {
              processedMd = processedMd.replace(item.placeholder, () => item.content);
            });
            if (footnotes.length > 0) processedMd += '\n\n' + footnotes.join('\n');
            fs.writeFileSync(mdPath, processedMd, 'utf8');
            exec(`${getPandocPath(customPandocPath)} "${mdPath}" -f markdown -t docx -o "${docxPath}"`, (error) => {
              if (error) reject(new Error('Pandoc is not installed or not found in PATH. Please install Pandoc from pandoc.org and restart your computer.'));
              else resolve();
            });
        });

        // OAUTH FLOW
        const clientIdP1 = '500612078642-lm2526ha';
        const clientIdP2 = 'ts6tden87oktd81gam4s0m0t.apps.googleusercontent.com';
        const secretP1 = 'GOCSPX-KPXsC';
        const secretP2 = 'Y_Fu-1N0Scxnr6jl39eyPbb';

        const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || (clientIdP1 + clientIdP2);
        const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || (secretP1 + secretP2);

        if (!CLIENT_ID || !CLIENT_SECRET) {
            return { success: false, error: 'Google Client ID or Secret missing!' };
        }

        const REDIRECT_URI = 'http://localhost:3000/oauth2callback';
        const tokenPath = path.join(userDataPath, 'gdocs_tokens.json');

        let tokens = null;
        if (fs.existsSync(tokenPath)) {
          try { tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8')); } catch(e){}
        }

        let isAuthenticated = false;
        if (tokens && tokens.refresh_token) {
          // Proactively refresh the token
          const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: CLIENT_ID,
              client_secret: CLIENT_SECRET,
              refresh_token: tokens.refresh_token,
              grant_type: 'refresh_token'
            })
          });
          const data = await res.json();
          if (data.access_token) {
             tokens.access_token = data.access_token;
             if (data.refresh_token) tokens.refresh_token = data.refresh_token;
             fs.writeFileSync(tokenPath, JSON.stringify(tokens));
             isAuthenticated = true;
          }
        }

        if (!isAuthenticated) {
          const express = require('express');
          const authServer = express();
          
          if (global.gdocsServer) {
            try { global.gdocsServer.close(); } catch(e){}
          }
          
          let server;
          const codePromise = new Promise((resolve, reject) => {
            authServer.get('/oauth2callback', (req, res) => {
              const code = req.query.code;
              if (code) {
                res.send('<html><body><h2>Authentication successful!</h2><p>You can close this tab and return to Poring Notebook.</p><script>window.close();</script></body></html>');
                resolve(code);
              } else {
                res.send('<html><body><h2>Authentication failed!</h2><p>Please try again.</p></body></html>');
                reject(new Error('No code received'));
              }
              if (server) {
                server.close();
                global.gdocsServer = null;
              }
            });
          });

          server = authServer.listen(3000, '127.0.0.1');
          global.gdocsServer = server;

          const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.file')}&access_type=offline&prompt=consent`;
          shell.openExternal(authUrl);

          // Wait for user to authenticate
          const code = await codePromise;

          // Exchange code for token
          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              client_id: CLIENT_ID,
              client_secret: CLIENT_SECRET,
              redirect_uri: REDIRECT_URI,
              grant_type: 'authorization_code'
            })
          });
          tokens = await tokenRes.json();
          
          if (!tokens.access_token) {
            throw new Error('Failed to get access token');
          }
          fs.writeFileSync(tokenPath, JSON.stringify(tokens));
        }

        // Upload to Google Drive using Multipart
        const metadata = {
          name: title,
          mimeType: 'application/vnd.google-apps.document'
        };
        const boundary = '-------314159265358979323846';
        const delimiter = "\r\n--" + boundary + "\r\n";
        const close_delim = "\r\n--" + boundary + "--";

        const fileContent = fs.readFileSync(docxPath);

        const bodyPieces = [
          Buffer.from(delimiter + 'Content-Type: application/json\r\n\r\n' + JSON.stringify(metadata) + '\r\n'),
          Buffer.from(delimiter + 'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n'),
          fileContent,
          Buffer.from(close_delim)
        ];
        const bodyBuffer = Buffer.concat(bodyPieces);

        const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + tokens.access_token,
            'Content-Type': 'multipart/related; boundary="' + boundary + '"'
          },
          body: bodyBuffer
        });
        const fileInfo = await uploadRes.json();
        
        if (fileInfo.id) {
          shell.openExternal(`https://docs.google.com/document/d/${fileInfo.id}/edit`);
          return { success: true };
        } else {
          throw new Error(JSON.stringify(fileInfo));
        }

      } catch (err) {
        console.error("Google Docs Export Error:", err);
        return { success: false, error: err.message };
      }
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
