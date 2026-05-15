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
