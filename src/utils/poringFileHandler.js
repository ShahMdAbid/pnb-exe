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

        // 2. Create an assets folder in the zip
        const assetsFolder = zip.folder("assets");
        
        // 3. Find all images in markdown and add them to the zip as raw Blobs (super fast!)
        const imageRegex = /!\[.*?\]\((poring_img_.*?)\)/g;
        let match;
        const keysToFetch = new Set();
        
        while ((match = imageRegex.exec(markdownContent)) !== null) {
            keysToFetch.add(match[1]);
        }

        for (const key of keysToFetch) {
            const blob = await localforage.getItem(key);
            if (blob) {
                // Determine extension from blob type (e.g., image/png -> .png)
                const ext = blob.type.split('/')[1] || 'png';
                assetsFolder.file(`${key}.${ext}`, blob);
            }
        }

        // 4. Generate the ZIP file and trigger download
        const content = await zip.generateAsync({ type: "blob" });
        // Change from .poring to .zip
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
        const markdown = await loadedZip.file("document.md").async("string");

        // 2. Extract images back into localforage
        const assetsFolder = loadedZip.folder("assets");
        if (assetsFolder) {
            const files = Object.keys(assetsFolder.files);
            for (const filename of files) {
                if (!assetsFolder.files[filename].dir) {
                    const blob = await assetsFolder.files[filename].async("blob");
                    // Extract the original 'poring_img_12345' key without the extension
                    const originalKey = filename.split('/').pop().split('.')[0]; 
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
