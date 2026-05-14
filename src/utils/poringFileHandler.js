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