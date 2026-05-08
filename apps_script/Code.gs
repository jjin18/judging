/**
 * Hackathon Judging — Google Sheets backup webhook.
 *
 * Receives JSON POSTs from the judging backend and appends each row to a tab
 * named after the payload's "kind" (scores | submissions | tests). Headers
 * are inferred from the first payload of each kind.
 *
 * Setup (5 minutes, one-time):
 *
 *   1. Create a fresh Google Sheet.
 *   2. Extensions → Apps Script. Replace the default "function myFunction()…"
 *      with this entire file's contents.
 *   3. Click "Deploy" (top right) → "New deployment" → gear icon → "Web app".
 *   4. Set:
 *        Description:   judging-platform
 *        Execute as:    Me
 *        Who has access: Anyone
 *      Click "Deploy". Authorize when prompted ("Advanced" → "Go to … (unsafe)"
 *      if Google warns about an unverified app — it's your own script).
 *   5. Copy the Web app URL.
 *   6. On Railway → web service → Variables → New variable:
 *        Name:  GOOGLE_SHEETS_WEBHOOK_URL
 *        Value: <the URL from step 5>
 *      Save (Railway redeploys automatically).
 *   7. Reload /admin in the judging app. Banner turns green. Click "Test"
 *      to confirm round-trip — should see ✓ + a row in the "tests" tab.
 */

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

function doPost(e) {
  const p = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tab =
    p.kind === 'score' ? 'scores' :
    p.kind === 'submission' ? 'submissions' :
    'tests';
  const sh = ss.getSheetByName(tab) || ss.insertSheet(tab);

  // First write to this tab? Lay down headers from the payload's keys.
  if (sh.getLastRow() === 0) sh.appendRow(Object.keys(p));

  // Append values in the order the headers expect, dropping any unknown keys.
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(headers.map((h) => (p[h] === undefined || p[h] === null) ? '' : p[h]));

  return ContentService.createTextOutput('ok');
}

// Optional: Apps Script requires a doGet for some Web app deployment modes;
// this lets you sanity-check the URL by visiting it in a browser.
function doGet() {
  return ContentService.createTextOutput('judging-platform sheets webhook is up');
}
