

center[gray[# Poring Notebook]]


###*Poring Notebook bridges the gap between traditional word processors that handle mathematical notation poorly and professional tools like Overleaf, which come with a steep learning curve and often require paid features for AI-assisted workflows. By combining Markdown simplicity with KaTeX rendering, it lets you write naturally—without rigid formatting or friction.*

//1

center[###  Getting Started & Basic Controls]
*   **Zooming:** Use `Ctrl` + `+` or `Ctrl` + `-` to zoom in and out.`Ctrl` + `0` for default zoom .
*   **Customization:** Use the top Navigation Bar to change the font type, spacing, font size, and toggle Dark Mode.
*   **Creating Notes:** Create a folder, hover over it, and click the **+** icon, or simply click **+Note**.

//1

center[###  Setting Up & Using AI Tools]


**Setup Instructions:**
1. Click the **Settings ⚙️** icon in the header.
2. Select **"Get API Key"** or visit the [Groq Console](https://console.groq.com/keys).
3. Create a key, paste it into the settings menu, and click **Save**.

**Using AI Refine:**
⚠️ *Important:* Always **select a specific area of text** before using AI tools. Refining your entire document at once may lead to data loss due to AI token limitations.

*   **Custom Refine:** Apply specific instructions to the selected text (e.g., *"Change tone to academic"*).
*   **Enhance Syntax:** Automatically fix broken math syntax or formatting issues in your selection.

//1

center[###  Auto-Note (Clipboard Listener) ]
*Note: Available on the PC version only (not supported on the Web App).*

When activated, Poring Notebook  listens to your system clipboard in the background, making note-taking effortless.

*   **How to Activate:** Click the **Clipboard** icon in the editor toolbar. It is active when it turns green and says **LISTENING**.
*   **Text Capture:** Any text you copy from a browser, PDF, or document is automatically appended to your current note with clean spacing.
*   **Image Capture:** Right-click and "Copy Image" anywhere on your PC. It will be saved to your local database and auto-inserted into your note at a clean 450px width.
*   **Privacy First:** All clipboard listening happens locally on your machine. Nothing is ever sent to a server.

---

center[### Formatting & Syntax Guide]
Poring Notebook uses a mix of standard Markdown and custom shortcuts optimized for academic writing. 



#### Text Styling


***

| Element | Syntax | Example |
| :--- | :--- | :--- |
| **Headers** | `# Header 1`, `## Header 2`, `### Header 3` | *Size decreases with each `#`* |
| **Code Block** | ` ``` ` content ` ``` ` | Keeps text exactly as typed |
| **Bold** | `**text**` | **text** |
| **Italic** | `*text*` | *text* |
| **Underline** | `++text++` | ++text++ |
| **Strikethrough** | `~~text~~` | ~~text~~ |
| **Highlight** | `==text==` | Yellow highlight |
| **Color Highlight** | `color==text==` | e.g., `green==text==` |
| **Text Color** | `color[text]` | e.g., `red[]`, `blue[]`, `green[]`, `purple[]`, `orange[]`, `gray[]` |

#### Alignment & Layout
| Element | Syntax | Description |
| :--- | :--- | :--- |
| **Align Center** | `center[text]` | Centers content |
| **Align Right/Left**| `right[text]` / `left[text]` | Aligns content to right or left |
| **Page Break** | `***` | Forces a new page. *(Standard markdown uses `---`, but AI often generates too many dashes, breaking the document flow. Use `***` instead).* |


| Element | Syntax | Description |
| :--- | :--- | :--- |
| **Blank Spaces** | `//x` (e.g., `//2` for 2 blank lines)| Injects **X** lines of blank space . **Note:** Press "Enter" *twice* after using this to prevent breaking subsequent code. |
| **Table Line Break**| `<br>` | Forces a new line inside a table cell. |

#### Math & Equations
| Element | Syntax |
| :--- | :--- |
| **Inline Math** | `$ equation $` |
| **Block Math** | `$$ equation $$` |
| **Math Line Break**| `\\` (Use inside math blocks to start a new line) |

center[#### More tools ]

**1. Interactive Appendix / Footnotes**
*   **Syntax:** `[[clickable keyword]](explanation of that keyword)`
*   **Usage:** Use this to add extra information without cluttering your main text. It creates a clickable link in the exported PDF that takes the reader to the appendix. A "back" button returns them to the main content.

* **Example:** [[Begula]](A car)


**2. Image Blocks**
*   **Syntax:** `![Image|Width|Caption](Source)`
*   **Example:** ![Image|300|Begula](BEGULA_IMG)
*   **Usage:** You can paste images directly. `Width` controls display size. `Caption` appears under the image. 
*   *Note: Do not modify the system file reference inside the parentheses `(...)`.*
//2

center[###  PDF Preview, Export, & File Management]

*   **Reverse Sync:** Click anywhere in the PDF Preview pane to instantly jump to that exact section in your text editor.
*   **The Red Line:** You will see a red line in the PDF preview. This indicates exactly where a physical page ends.
*   **Break Math Block Tool:** If a long `$$` math block crosses the red page-break line, it will push the entire document down, creating an ugly blank space. Use the **Break math block** tool (found in the tools section) to cleanly split the equation across pages.
*   **Cover Pages:** A demo cover page is included. You can edit it or design your own in a blank note, then save it as a preset for future documents.
*   **Sharing Files (.poring):** A `.poring` file is an encoded version of your note that includes all text and images. Share these files with colleagues! They can import them by clicking the **Upload** icon on the left sidebar.

---

###  Feedback & Updates
Poring Notebook is actively in development, so you may occasionally encounter bugs. 

*   **Report Bugs / Contact:** [shahmdabid01@gmail.com](mailto:shahmdabid01@gmail.com)
*   **Webapp version available on:** 
    *   [notekhata.netlify.app](https://notekhata.netlify.app/)
    *   [notekhata.smabid.me](https://notekhata.smabid.me/)