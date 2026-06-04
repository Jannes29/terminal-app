// ============================================================
// Macro Snapshot Collector — Version für den öffentlichen terminal-app Repo
// Läuft headless in GitHub Actions, lädt index.html, lässt die echte
// Macro-Engine rechnen, nimmt EINEN echten Snapshot (synth:false) und
// hängt ihn an history.json an (im selben Repo → per Pages fetchbar).
// ============================================================
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TERMINAL = path.resolve(__dirname, 'index.html');   // <-- öffentliche Terminal-Datei
const HISTORY  = path.resolve(__dirname, 'history.json');
const MAX_RECORDS = 6000;          // ~ genug für 90T-Auswertung + Puffer
const ENGINE_WAIT_MS = 50000;      // Zeit, bis Faktoren/Preise gefetcht sind

(async () => {
  if (!fs.existsSync(TERMINAL)) {
    console.error('FEHLER: index.html nicht im Repo gefunden.');
    process.exit(1);
  }
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  if (process.env.DEBUG) page.on('console', m => console.log('[page]', m.text()));

  await page.goto('file://' + TERMINAL, { waitUntil: 'load', timeout: 120000 });

  // Warten bis die Engine Class-Scores hat
  await page.waitForFunction(
    () => window.MACRO && window.MACRO.classScores && Object.keys(window.MACRO.classScores).length >= 5,
    { timeout: 120000 }
  ).catch(() => console.warn('classScores nicht voll geladen — fahre trotzdem fort.'));

  // Den Daten-Fetches Zeit geben (Preise, Faktoren, Bias-Karten)
  await page.waitForTimeout(ENGINE_WAIT_MS);

  // Snapshot über die EIGENE Logik des Terminals erzeugen (frischer Kontext → 1 Record)
  const snap = await page.evaluate(() => {
    try {
      localStorage.removeItem('macro_history_v2');
      if (window.MACRO_HISTORY && window.MACRO_HISTORY.snapshot) {
        window.MACRO_HISTORY.snapshot();
        const h = JSON.parse(localStorage.getItem('macro_history_v2') || '[]');
        return h[h.length - 1] || null;
      }
    } catch (e) { return null; }
    return null;
  });

  await browser.close();

  if (!snap || !snap.cs || Object.keys(snap.cs).length === 0) {
    console.error('Kein gültiger Snapshot — Engine evtl. nicht geladen (Proxy-/Netz-Problem). Kein Commit.');
    process.exit(1);
  }
  snap.synth = false;   // echter Live-Snapshot

  // history.json laden (importierbares Format: { history: [...] })
  let data = { history: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY, 'utf8'));
    if (parsed && Array.isArray(parsed.history)) data = parsed;
  } catch (e) { /* erste Ausführung: leer */ }

  data.history.push(snap);
  if (data.history.length > MAX_RECORDS) data.history = data.history.slice(-MAX_RECORDS);
  data.updated = new Date().toISOString();
  data.count = data.history.length;

  fs.writeFileSync(HISTORY, JSON.stringify(data));
  console.log(`✓ Snapshot gespeichert (${Object.keys(snap.cs).length} Assets). Historie: ${data.history.length} Records.`);
})().catch(err => { console.error('Collector-Fehler:', err); process.exit(1); });
