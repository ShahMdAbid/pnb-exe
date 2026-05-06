const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

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

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // Open DevTools automatically in development mode
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

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
