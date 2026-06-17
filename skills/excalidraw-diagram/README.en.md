# excalidraw-diagram Skill

A Claude Code / Claude Desktop skill that turns natural language, Mermaid source, code/docs, or screenshots into **hand-drawn-style Excalidraw diagrams**.

📖 [中文版](./README.md)

---

### Diagram types

| Type | Best for | Example prompt |
|---|---|---|
| **Flowchart** | Business processes, user journeys, decision trees | "Draw a user registration flow" |
| **Architecture** | System design, microservices, cloud infra | "Show the backend architecture of this system" |
| **Sequence** | API call chains, service interactions, auth flows | "Draw the OAuth 2.0 authorization code flow" |
| **Mindmap** | Brainstorming, concept breakdown, knowledge mapping | "Expand this topic into a mindmap" |
| **State diagram** | State machines, order lifecycle, approval workflows | "Draw the state transitions for an order" |
| **Fishbone** | Root cause analysis, issue investigation | "Draw a fishbone diagram for a production incident" |

### Installation

**claude.ai**:

1. Download the zip → upload to claude.ai to install
2. Claude Settings → Connectors → search Excalidraw → Connect

> The skill provides diagram instructions; the connector provides the `create_view` rendering tool. Both are required.
> The claude.ai path only supports the compact spec (≤ 6 nodes) and does not run local Mermaid conversion tools.

**Claude Code / Cursor** (local file output, recommended):

```bash
git clone https://github.com/yijingjia/excalidraw-diagram-skill \
  ~/.claude/skills/excalidraw-diagram-skill

cd ~/.claude/skills/excalidraw-diagram-skill/tools
npm install   # downloads ~170 MB Chromium on first run, reused after
```

Offline / restricted network, use system Chrome instead:

```bash
PUPPETEER_SKIP_DOWNLOAD=1 npm install
export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

### Usage

Just talk to Claude:

> "Draw a user login flowchart"
> "Convert this Mermaid to Excalidraw"
> "Visualize the call graph for this code"
> "Digitize my hand-drawn architecture sketch"

Output goes to a timestamped folder in the current directory:

```
oauth-flow-20260423/
├── diagram.excalidraw   # editable source
└── diagram.png          # preview
```

### Opening / editing the output

| Tool | Notes |
|---|---|
| [excalidraw.com](https://excalidraw.com) | Menu → Open → pick `.excalidraw` |
| [VS Code / Cursor extension `pomdtr.excalidraw-editor`](https://marketplace.visualstudio.com/items?itemName=pomdtr.excalidraw-editor) | Double-click the file after installing |
| [Obsidian Excalidraw plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin) | Open inside a vault; embeds in notes |

### Credits

`tools/vendor/svg-to-excalidraw-src/` contains source code from
[excalidraw/svg-to-excalidraw](https://github.com/excalidraw/svg-to-excalidraw)
(MIT). See [NOTICE](./NOTICE) for details.

### License

MIT
