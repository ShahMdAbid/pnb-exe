const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, protocol, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

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
    // --- NATIVE ASSET INFRASTRUCTURE ---
    const userDataPath = app.getPath('userData'); // e.g., AppData/Roaming/poring-notebook
    const assetsDir = path.join(userDataPath, 'assets');
    
    // Create assets folder if it doesn't exist
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }

    // Intercept our custom protocol and serve local files natively!
    protocol.handle('poring-asset', async (request) => {
      try {
        // 1. Strip the protocol
        let assetName = request.url.replace(/^poring-asset:\/\//i, '');
        // 2. CRITICAL FIX: Strip trailing slash if Chrome added it
        assetName = assetName.replace(/\/$/, '');
        
        const filePath = path.join(assetsDir, assetName);
        
        // 3. Directly read the file (safest method for local assets)
        const fileData = fs.readFileSync(filePath);
        
        // 4. Return a raw Response to the browser with explicit headers
        return new Response(fileData, {
            status: 200,
            headers: { 
                'Content-Type': assetName.endsWith('.png') ? 'image/png' : 'image/jpeg',
                'Access-Control-Allow-Origin': '*' // Bypass any strict React CORS
            }
        });
      } catch (err) {
        console.error("Failed to load asset:", err);
        return new Response('Not Found', { status: 404 });
      }
    });

    // Handle Saving from the Frontend
    ipcMain.handle('save-asset', async (event, { filename, buffer }) => {
      const filePath = path.join(assetsDir, filename);
      
      // FIX: Node's 'fs' module REQUIRES a Buffer, it rejects raw ArrayBuffers!
      fs.writeFileSync(filePath, Buffer.from(buffer));
      
      return `poring-asset://${filename}`;
    });
    // --- END NATIVE INFRASTRUCTURE ---

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
