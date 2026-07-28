# Manga AutoScroll 📖

A tiny Chrome extension that scrolls the page for you — made for reading manga,
webtoons, and long PDFs without wearing out your mouse wheel (or your finger).

**[▶ Watch a short demo](https://github.com/user-attachments/assets/93b9ba54-0386-4e5f-817f-b1e253ba2f71)**

## Why it works where other extensions don't

Most auto-scrollers move the web page itself, which does nothing when your manga
is a PDF — Chrome's PDF viewer swallows the scroll. This one has two engines:

1. **Page mode** — buttery-smooth scrolling of the page or the reader panel.
   Works on manga sites, webtoons, Google Drive previews, pdf.js readers, etc.
2. **PDF mode** — if the page itself can't be scrolled, it automatically sends
   real mouse-wheel input to the tab instead. Works in Chrome's built-in PDF
   viewer, PDFs inside iframes, and canvas-based readers. Chrome shows a small
   *"Manga AutoScroll started debugging this browser"* bar while it's active —
   that's normal, and it disappears when you stop.

## Install (2 minutes)

1. Get the code — either clone it:

   ```bash
   git clone https://github.com/granotguy/manga-autoscroll.git
   ```

   or click **Code → Download ZIP** on this page and unzip it somewhere permanent
   (don't delete the folder later — Chrome loads the extension from there).
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (toggle, top-right).
4. Click **Load unpacked** and pick the `manga-autoscroll` folder.
5. Optional: pin it — puzzle-piece icon in the toolbar → 📌 next to Manga AutoScroll.

Also works in Edge (`edge://extensions`) and other Chromium browsers.

## How to use

- Click the icon → **Start scrolling**.
- Adjust speed with the slider or the Slow / Normal / Fast presets; flip direction to Up if needed.
- In page mode a small floating pill appears on the page with pause, −, +, and ✕.
- It auto-stops a few seconds after reaching the end of the chapter.
- Speed is remembered between sessions.

### **For a better experience while reading a PDF:**
- Click this [link](https://mozilla.github.io/pdf.js/web/viewer.html) to open a web pdf viewer.
- Click the >> sign at the top right/left of the site.
- Click the first option labled "Open"
- Upload your PDF file.
- Preferably, Click F11 for a full screen mode.
- Start scrolling using alt+s or the popup page extension.
Doing the steps above make it so the extenstion registers
the page as a normal page and not a PDF,
This allows for smoother and better scrolling.

### Keyboard shortcuts (work even in the PDF viewer)

| Keys | Action |
|------|--------|
| `Alt+S` | Start / pause |
| `Alt+↑` | Faster |
| `Alt+↓` | Slower |

Change them anytime at `chrome://extensions/shortcuts`.

## Project layout

| File | What it does |
|------|--------------|
| `manifest.json` | Extension manifest (MV3) — permissions, shortcuts, entry points |
| `content.js` | Page-mode engine: smooth scrolling + the floating control pill |
| `background.js` | Service worker: PDF mode (debugger wheel events), keyboard commands, state |
| `popup.html` / `popup.js` / `popup.css` | The toolbar popup UI |
| `icons/` | Extension icons |

## Troubleshooting

- **Local PDF files** (`file:///...`): enable *Allow access to file URLs* on the
  extension's card in `chrome://extensions`.
- **"Could not start PDF mode"**: close DevTools on that tab and retry — only
  one debugger can be attached at a time.
- **Scrolls the wrong way?** Flip the Down/Up direction toggle in the popup.
- Tabs opened before installing work too (it injects itself on demand), but if
  anything acts weird, refresh the tab once.
