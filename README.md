# Pure Data Playing Cards - companion web app

The companion web app for **Pure Data Playing Cards**, a physical 52-card deck by
Dan Berg where every card is syntax-highlighted JSON on black (orange keys, green
values, monospace). Point your camera at a physical card and the app reads the
JSON and renders a traditional playing card on an HTML5 canvas. The concept: *the
code is the card.*

This is a self-hostable copy, shared so the app can live on independently of any
one website. It is a single static page - no build step, no framework.

Deck and site: <https://danberg.art>

## What's in here

- `index.html`, `style.css` - the page and all styling.
- `app.js` - everything else: canvas card rendering, camera capture, OCR wiring,
  the hidden game mode, the leaderboard, synthesised arcade sound, and overlays.
- `faces/` - the court-card artwork (SVG) plus the two joker images.
- `vision-ocr-fn/` - source for the Google Cloud Vision function used to read
  cards (see below). Deployed separately from the page.

## Run it

It's a static site. Serve the folder with any static file server, for example:

```bash
python3 -m http.server 8000
```

then open <http://localhost:8000>.

The app runs straight away, but to get the *point* of it - photographing a real
card and watching it come to life - you'll want to wire up card scanning below.
You can also type or paste card JSON directly into the manual-input box, which
needs no backend at all and is handy for testing:

```json
{ "rank": "7", "suit": "spades", "type": "number" }
```

Ranks: `ace`, `2`-`10`, `jack`, `queen`, `king`. Suits: `clubs`, `spades`,
`hearts`, `diamonds`. Face cards use `"type": "face"`.

## Card scanning (Google Cloud Vision)

Scanning a physical card is the heart of the project - point your camera at a
card, its JSON is read by OCR, and the rendered card appears. The "Scan Card
Code" button photographs a card and sends it to a small HTTP Cloud Function that
runs Google Cloud Vision OCR.

That function needs a paid Google Cloud account, so it can't be shared as a
public service - you deploy your own (it's quick, and there are no keys in the
code):

1. Create a Google Cloud project and enable the **Cloud Vision API**.
2. Deploy the function in `vision-ocr-fn/` as an HTTP Cloud Function (entry point
   `ocrHttp`, Node 18+). It authenticates via the function's own service account.
3. Put its URL into `VISION_FN_URL` at the top of `app.js`.

Until then the camera button has nowhere to send its photos; the manual-input
box above lets you try everything else in the meantime.

## Optional: leaderboard and bug-report form (Supabase)

The global leaderboard and the bug-report form talk to a
[Supabase](https://supabase.com) project using its public *publishable* key
(safe to ship; row-level security guards the data). These are optional. To enable
them, create your own Supabase project, add the tables the code expects
(`pure_data_scores` and `bug_reports`), and set `SUPABASE_URL` + `SUPABASE_KEY`
near the top of the leaderboard section in `app.js`. Left as placeholders, these
features simply do nothing and the rest of the app is unaffected.

## License and credits

- **Code** (`app.js`, `index.html`, `style.css`, `vision-ocr-fn/`) - MIT, see
  [LICENSE](LICENSE).
- **Court-card artwork** (`faces/*.svg`) - based on 19th-century Goodall & Son
  designs, CC0 / public domain, via Adrian Kennard (RevK), <https://me.uk/cards>.
- **Joker images** (`faces/joker1.jpg`, `faces/joker2.jpg`) and the **Pure Data
  Playing Cards** name, deck design, and card data are © Dan Berg. They're
  included here so the app renders as intended; please don't reuse them for other
  products without permission.
