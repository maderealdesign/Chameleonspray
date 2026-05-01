/**
 * Netlify Function: save-site
 * 
 * Receives JSON payload from cms-editor.js:
 *   { textChanges: [{id, html}], imageChanges: [{id, base64, mimeType}] }
 *
 * 1. Validates Netlify Identity JWT
 * 2. Uploads any new images to GitHub (Website/images/uploads/)
 * 3. Fetches current Website/index.html from main branch
 * 4. Patches text and image src values using cheerio
 * 5. Commits updated index.html to main branch -> triggers live deploy
 *
 * Dependencies (netlify/functions/package.json):
 *   @octokit/rest, cheerio
 */

const { Octokit }  = require('@octokit/rest');
const cheerio      = require('cheerio');
const https        = require('https');

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER   = process.env.REPO_OWNER   || 'maderealdesign';
const REPO_NAME    = process.env.REPO_NAME    || 'Chameleonspray';
const BRANCH       = process.env.TARGET_BRANCH || 'main';
const HTML_PATH    = 'Website/index.html';
const IMAGES_DIR   = 'Website/images/uploads';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// Verify Netlify Identity JWT (lightweight check)
function verifyIdentityToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.split(' ')[1];
  // Basic JWT structure check — production should verify with JWKS
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    // Token must not be expired
    if (payload.exp && Date.now() / 1000 > payload.exp) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function mimeToExt(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg':  'jpg',
    'image/png':  'png',
    'image/webp': 'webp',
    'image/gif':  'gif',
    'image/avif': 'avif'
  };
  return map[mimeType] || 'jpg';
}

function buildJsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  };
}

// ──────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────
exports.handler = async function (event) {

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return buildJsonResponse(405, { error: 'Method not allowed' });
  }

  // Auth check
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  if (!verifyIdentityToken(authHeader)) {
    return buildJsonResponse(401, { error: 'Unauthorized — please log in via Netlify Identity.' });
  }

  // Parse payload
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return buildJsonResponse(400, { error: 'Invalid JSON payload' });
  }

  const { textChanges = [], imageChanges = [] } = payload;

  if (!textChanges.length && !imageChanges.length) {
    return buildJsonResponse(400, { error: 'No changes provided' });
  }

  if (!GITHUB_TOKEN) {
    return buildJsonResponse(500, { error: 'GITHUB_TOKEN not configured in environment' });
  }

  const octokit = new Octokit({ auth: GITHUB_TOKEN });

  // ── Step 1: Upload images to GitHub ──────────
  const imagePathMap = {};  // { elementId: 'Website/images/uploads/upload-xxx.jpg' }

  for (const img of imageChanges) {
    const ext      = mimeToExt(img.mimeType);
    const filename = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 5)}.${ext}`;
    const filePath = `${IMAGES_DIR}/${filename}`;

    try {
      await octokit.repos.createOrUpdateFileContents({
        owner:   REPO_OWNER,
        repo:    REPO_NAME,
        path:    filePath,
        message: `cms: upload image ${filename}`,
        content: img.base64,
        branch:  BRANCH
      });

      // Path relative to Website/ root (for use in src attribute)
      imagePathMap[img.id] = `images/uploads/${filename}`;
      console.log('[save-site] Uploaded image:', filePath);

    } catch (err) {
      console.error('[save-site] Image upload failed:', err.message);
      return buildJsonResponse(500, { error: `Image upload failed: ${err.message}` });
    }
  }

  // ── Step 2: Fetch current index.html from main ──
  let currentSha, currentHtml;
  try {
    const { data } = await octokit.repos.getContent({
      owner:  REPO_OWNER,
      repo:   REPO_NAME,
      path:   HTML_PATH,
      ref:    BRANCH
    });
    currentSha  = data.sha;
    currentHtml = Buffer.from(data.content, 'base64').toString('utf8');
  } catch (err) {
    console.error('[save-site] Failed to fetch index.html:', err.message);
    return buildJsonResponse(500, { error: `Could not fetch index.html: ${err.message}` });
  }

  // ── Step 3: Patch HTML with cheerio ──────────
  const $ = cheerio.load(currentHtml, {
    decodeEntities: false,
    xmlMode:        false
  });

  // Patch text changes
  for (const change of textChanges) {
    const el = $('#' + CSS.escape(change.id));
    if (el.length) {
      el.html(change.html);
      console.log('[save-site] Patched text:', change.id);
    } else {
      console.warn('[save-site] Element not found in HTML:', change.id);
    }
  }

  // Patch image src changes
  for (const [elementId, newPath] of Object.entries(imagePathMap)) {
    const el = $('#' + CSS.escape(elementId));
    if (el.length) {
      el.attr('src', newPath);
      console.log('[save-site] Patched image src:', elementId, '->', newPath);
    } else {
      console.warn('[save-site] Image element not found in HTML:', elementId);
    }
  }

  const updatedHtml = $.html();

  // ── Step 4: Commit updated HTML to main ──────
  try {
    const changesSummary = [];
    if (textChanges.length)   changesSummary.push(`${textChanges.length} text element(s)`);
    if (imageChanges.length)  changesSummary.push(`${imageChanges.length} image(s)`);

    await octokit.repos.createOrUpdateFileContents({
      owner:   REPO_OWNER,
      repo:    REPO_NAME,
      path:    HTML_PATH,
      message: `cms: update ${changesSummary.join(' and ')} via visual editor`,
      content: Buffer.from(updatedHtml).toString('base64'),
      sha:     currentSha,
      branch:  BRANCH
    });

    console.log('[save-site] Committed updated index.html to', BRANCH);

  } catch (err) {
    console.error('[save-site] Commit failed:', err.message);
    return buildJsonResponse(500, { error: `Commit failed: ${err.message}` });
  }

  return buildJsonResponse(200, {
    success:       true,
    textPatched:   textChanges.length,
    imagesUploaded: imageChanges.length,
    branch:        BRANCH,
    message:       'Changes committed. Netlify will redeploy automatically.'
  });
};
