# Poring Notebook

> A modern, distraction-free desktop notebook designed for STEM, Academic, and KaTeX math note-taking with seamless Google Docs / MS Word export pipelines.

[![Download Latest Release](https://img.shields.io/github/v/release/ShahMdAbid/pnb-exe?label=Download%20Poring%20Notebook%20(.exe)&style=for-the-badge&color=2563eb)](https://github.com/ShahMdAbid/pnb-exe/releases/latest)

---


###  In-App AI Features are Deprecated
In-app AI API setups often create friction for new users and clutter the interface.So built-in AI tools are deprecated to keep Poring Notebook **minimal, focused** on writing and reading.

> **💡 You can still use AI seamlessly!**  
> Because Poring Notebook saves all your notes as standard `.md` files in your native local OS workspace, you can open your workspace folder in **Antigravity, Codex or Claude code**. Any changes made by external AI tools will update **live in real time** inside Poring Notebook!

---

## 📖 User Guide & Feature Walkthrough

### 1. 🚀 Download & Installation
1. Click the **[Download Poring Notebook (.exe)](https://github.com/ShahMdAbid/pnb-exe/releases/latest)** button above.
2. Run the downloaded installer file (`Poring-Notebook-Setup-1.3.1.exe`).
3. To export notes containing math equations properly into `.docx` or Google Docs format, you **must install Pandoc**.
  - Go to the [Pandoc Releases Page](https://github.com/jgm/pandoc/releases/latest).
  - Download and install the **Windows Installer (`.msi`)** (e.g., `pandoc-3.x-windows-x86_64.msi`).
4. Open **Poring Notebook** from your Desktop or Start Menu.

---

### 2. ⚙️ Workspace Setup (Optional)
By default, Poring Notebook creates a local notes directory. 
- Click the **Gear Icon** ⚙️ (bottom left) to open **Preferences**.
- Change your **Workspace Folder** to any custom directory on your hard drive. All your `.md` files and images will be stored locally .

---

### 3. 📂 Sidebar & Note Organization
- **Open Sidebar**: Click the **Book Icon** 📖 next to the *"Poring Notebook"* header in the top titlebar to expand or collapse the left sidebar.
- **Create Note & Folder**: Click **`+ Note`** or **`+ Folder`** to organize your documents.
- **Drag & Drop**: Easily drag any note and drop it inside a folder to reorganize your structure.

---

### 4. ✍️ Writing Notes & External AI Workflow
- **Manual Writing**: Write your notes using standard Markdown and KaTeX math syntax:
  - Inline Math: `$E = mc^2$`
  - Block Math: `$$ \int_{a}^{b} f(x) \, dx = F(b) - F(a) $$`
- **External AI Workflow**:
  1. Click on the note title button in the top toolbar and select **Copy Path**.
  2. Open the file path in **Antigravity** or your preferred IDE/AI assistant.
  3. Prompt the AI to reformat, edit, or generate content.
  4. Save the file in your IDE and watch Poring Notebook update **instantly in real time**!

---

### 5. 🖼️ Images, Drawing Canvas & Cover Pages
- **Paste / Insert Images**: Paste images directly from your clipboard or use the toolbar insert button. Images are saved locally using native protocols:
  ```markdown
  ![img | 350| caption ](poring-asset://img_xxxxxxxx.png)
  ```
  *(Default image widths can be customized inside Settings).*
- **Interactive Drawing Canvas**: Click **`+ Insert`** -> **`Drawing`** to open the built-in sketchpad. Sketch figures, equations, or diagrams and save them straight into your note.
- **Edit Drawings Anytime**: Double-click on any embedded drawing or image in Live/Preview mode to re-open the canvas and edit it!
- **Preset Cover Pages**: Insert a preset Cover Page template from the toolbar to give your academic documents a professional cover.

---

### 6. 👁️ Workspace View Modes
Switch between four view modes using the top-right mode toggles:
- 🖋️ **Write**: Minimalist, editor-only environment for typing.
- 🖥️ **Live**: Instant rendered document preview as you type.
- ◫ **Split**: Side-by-side Markdown editor and rendered preview.
- 👁️ **Read**: Distraction-free full-screen reading mode.

---

### 7. 📄 Page Break Line (`***`) for PDF Printing
- Typing `***` inserts a visual red page-break line into your document.
- When exporting to PDF, this line specifies exact page divisions. 
- **Alignment note**: Tables or images sitting directly on a page break line will automatically be pushed down to the next page, preventing awkward document cuts! However, please double-check if any, cause subsequent note will shift position downward in actual pdf.

---

### 8. 📋 Automated Clipboard Listener
When researching or batch-copying information from websites and documents:
- Click the **Clipboard Icon** 📋 in the top toolbar to enable **Auto-Note (Clipboard Listener)**.
- Every piece of text you copy to your clipboard will automatically be saved into a new timestamped note, saving you from tedious manual copy-pasting!

---

### 9. 💡 Interactive Tooltips & Short Notes
Add two-way interactive tooltips or explanations to terms without cluttering your main document:
```markdown
Syntax: [[keyword]](explanation text)

Example: [[Begula]](A car.)
```

---

### 10. 📤 Exporting & Sharing
Click the **`Export`** dropdown menu in the top-right toolbar:
- **PDF Export**: Generate professional PDFs with clean page divisions and rendered KaTeX formulas.
- **Microsoft Word (`.docx`)**: Export markdown and math directly into native Word equations via Pandoc.
- **Google Docs**: Direct export pipeline for Google Workspace. *(Note: Google may show a security warning during login. Click continue and give permission).*
- **Share Archive (`.zip`)**: Export your notes and embedded images as a single `.zip`. Friends can import it directly from their left sidebar!

---

### 11. 🔍 UI Zooming (For Smaller Screens)
If you are using a laptop with a smaller screen and the toolbar or editor feels cramped, you can easily adjust the UI scale:
- Press **`Ctrl` + `+`** (or `Cmd` + `+`) to **Zoom In** (Make UI larger).
- Press **`Ctrl` + `-`** (or `Cmd` + `-`) to **Zoom Out** (Make UI smaller).
- Press **`Ctrl` + `0`** (or `Cmd` + `0`) to **Reset** the zoom to default.

---

## 📜 License
This project is open-source under the [MIT License](LICENSE).
