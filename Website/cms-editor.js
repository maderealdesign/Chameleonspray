/**
 * Chameleon Spray CMS Editor
 * Injected on staging branch only.
 * Requires Netlify Identity to be initialised on the page.
 *
 * Features:
 *  - Activates when a logged-in Netlify Identity user is detected
 *  - Makes .cms-text elements contenteditable
 *  - Makes .cms-image elements clickable to swap via file picker
 *  - Floating toolbar: Push Live + Save Draft + Logout
 *  - Sends payload to /.netlify/functions/save-site
 */

(function () {
  'use strict';

  // ─────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────
  const modifiedText   = {};   // { id: innerHTML }
  const modifiedImages = {};   // { id: { base64, mimeType, originalSrc } }
  let   editorActive   = false;

  // ─────────────────────────────────────────────
  // Wait for Netlify Identity widget to boot
  // ─────────────────────────────────────────────
  function waitForIdentity(cb) {
    if (window.netlifyIdentity) {
      cb(window.netlifyIdentity);
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        if (window.netlifyIdentity) {
          cb(window.netlifyIdentity);
        } else {
          // Poll briefly in case script loads late
          var attempts = 0;
          var poll = setInterval(function () {
            attempts++;
            if (window.netlifyIdentity) {
              clearInterval(poll);
              cb(window.netlifyIdentity);
            } else if (attempts > 40) {
              clearInterval(poll);
              console.warn('[CMS] Netlify Identity not found after 4s.');
            }
          }, 100);
        }
      });
    }
  }

  // ─────────────────────────────────────────────
  // Activate the editor for a logged-in user
  // ─────────────────────────────────────────────
  function activateEditor(user) {
    if (editorActive) return;
    editorActive = true;

    console.log('[CMS] Editor active for:', user.email);
    showNotification('Editor mode ON — click text to edit, click images to swap.');

    enableTextEditing();
    enableImageSwapping();
    injectToolbar(user);
  }

  // ─────────────────────────────────────────────
  // Text editing
  // ─────────────────────────────────────────────
  function enableTextEditing() {
    var els = document.querySelectorAll('.cms-text');
    els.forEach(function (el) {
      if (!el.id) {
        el.id = 'cms-text-' + Math.random().toString(36).substr(2, 6);
      }

      el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'true');

      // Visual cue
      el.style.outline         = '2px dashed #00AEEF';
      el.style.outlineOffset   = '3px';
      el.style.borderRadius    = '3px';
      el.style.cursor          = 'text';
      el.style.minHeight       = '1em';

      var originalContent = el.innerHTML;

      el.addEventListener('focus', function () {
        el.style.outline = '2px solid #00AEEF';
        el.style.background = 'rgba(0,174,239,0.06)';
      });

      el.addEventListener('blur', function () {
        el.style.outline = '2px dashed #00AEEF';
        el.style.background = '';

        if (el.innerHTML !== originalContent) {
          modifiedText[el.id] = el.innerHTML;
          originalContent = el.innerHTML;
          markDirty();
        }
      });

      // Also catch paste events — strip to plain text to avoid injecting spans
      el.addEventListener('paste', function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
      });
    });

    console.log('[CMS] Text editing enabled on', els.length, 'elements.');
  }

  // ─────────────────────────────────────────────
  // Image swapping
  // ─────────────────────────────────────────────
  function enableImageSwapping() {
    var imgs = document.querySelectorAll('.cms-image');

    // Hidden file input shared across all images
    var fileInput = document.createElement('input');
    fileInput.type   = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    var activeImg = null;

    imgs.forEach(function (img) {
      if (!img.id) {
        img.id = 'cms-img-' + Math.random().toString(36).substr(2, 6);
      }

      // Wrap with a relative container to show the swap badge
      img.style.cursor  = 'pointer';
      img.style.outline = '2px dashed #00AEEF';
      img.style.outlineOffset = '3px';

      // Swap badge overlay
      var badge = document.createElement('div');
      badge.innerHTML   = '📷 Swap Image';
      badge.style.cssText = [
        'position:absolute',
        'top:8px',
        'left:8px',
        'background:rgba(0,174,239,0.9)',
        'color:#fff',
        'font-size:11px',
        'font-weight:700',
        'padding:4px 8px',
        'border-radius:4px',
        'pointer-events:none',
        'z-index:9999',
        'letter-spacing:0.5px',
        'opacity:0',
        'transition:opacity 0.2s',
        'font-family:sans-serif'
      ].join(';');

      var wrapper = img.parentElement;
      if (wrapper && (getComputedStyle(wrapper).position === 'absolute' || getComputedStyle(wrapper).position === 'relative')) {
        wrapper.appendChild(badge);
        img.addEventListener('mouseenter', function () { badge.style.opacity = '1'; });
        img.addEventListener('mouseleave', function () { badge.style.opacity = '0'; });
      }

      img.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        activeImg = img;
        fileInput.value = '';
        fileInput.click();
      });
    });

    fileInput.addEventListener('change', function () {
      if (!fileInput.files || !fileInput.files[0] || !activeImg) return;
      var file = fileInput.files[0];
      var reader = new FileReader();

      reader.onload = function (e) {
        var dataUrl  = e.target.result;
        var mimeType = file.type;
        var base64   = dataUrl.split(',')[1];

        // Live preview
        activeImg.src = dataUrl;
        activeImg.style.outline = '2px solid #00AEEF';

        modifiedImages[activeImg.id] = {
          base64:      base64,
          mimeType:    mimeType,
          originalSrc: activeImg.dataset.originalSrc || activeImg.getAttribute('src')
        };

        if (!activeImg.dataset.originalSrc) {
          activeImg.dataset.originalSrc = activeImg.getAttribute('src');
        }

        markDirty();
        showNotification('Image updated — click Push Live to save.');
      };

      reader.readAsDataURL(file);
    });

    console.log('[CMS] Image swapping enabled on', imgs.length, 'elements.');
  }

  // ─────────────────────────────────────────────
  // Floating Toolbar
  // ─────────────────────────────────────────────
  function injectToolbar(user) {
    var toolbar = document.createElement('div');
    toolbar.id  = 'cms-toolbar';
    toolbar.style.cssText = [
      'position:fixed',
      'bottom:24px',
      'right:24px',
      'z-index:99999',
      'display:flex',
      'flex-direction:column',
      'gap:10px',
      'align-items:flex-end',
      'font-family:sans-serif'
    ].join(';');

    // User badge
    var badge = document.createElement('div');
    badge.style.cssText = [
      'background:rgba(30,41,59,0.95)',
      'color:#94a3b8',
      'font-size:11px',
      'padding:6px 12px',
      'border-radius:6px',
      'border:1px solid #334155',
      'backdrop-filter:blur(8px)'
    ].join(';');
    badge.innerHTML = '✏️ CMS — <strong style="color:#fff">' + user.email + '</strong>';

    // Push Live button
    var pushBtn = document.createElement('button');
    pushBtn.id  = 'cms-push-btn';
    pushBtn.textContent = '🚀 Push Live';
    pushBtn.style.cssText = btnStyle('#00AEEF', '#1e293b');
    pushBtn.addEventListener('click', pushLive);

    // Discard button
    var discardBtn = document.createElement('button');
    discardBtn.textContent = '↩ Discard';
    discardBtn.style.cssText = btnStyle('#334155', '#f8fafc');
    discardBtn.addEventListener('click', discardChanges);

    // Logout
    var logoutBtn = document.createElement('button');
    logoutBtn.textContent = 'Logout';
    logoutBtn.style.cssText = btnStyle('#475569', '#f8fafc', true);
    logoutBtn.addEventListener('click', function () {
      window.netlifyIdentity.logout();
    });

    toolbar.appendChild(badge);
    toolbar.appendChild(pushBtn);
    toolbar.appendChild(discardBtn);
    toolbar.appendChild(logoutBtn);
    document.body.appendChild(toolbar);
  }

  function btnStyle(bg, color, small) {
    return [
      'background:' + bg,
      'color:' + color,
      'border:none',
      'border-radius:8px',
      'cursor:pointer',
      'font-weight:700',
      'letter-spacing:0.5px',
      small ? 'font-size:11px' : 'font-size:14px',
      small ? 'padding:6px 14px' : 'padding:12px 24px',
      'box-shadow:0 4px 16px rgba(0,0,0,0.3)',
      'transition:transform 0.15s,opacity 0.15s',
      'outline:none',
      'white-space:nowrap',
      'font-family:sans-serif'
    ].join(';');
  }

  // ─────────────────────────────────────────────
  // Dirty state tracking
  // ─────────────────────────────────────────────
  function markDirty() {
    var btn = document.getElementById('cms-push-btn');
    if (btn) {
      btn.textContent = '🚀 Push Live *';
      btn.style.background = '#f97316';
    }
  }

  function clearDirty() {
    var btn = document.getElementById('cms-push-btn');
    if (btn) {
      btn.textContent = '🚀 Push Live';
      btn.style.background = '#00AEEF';
    }
  }

  // ─────────────────────────────────────────────
  // Discard Changes
  // ─────────────────────────────────────────────
  function discardChanges() {
    if (!Object.keys(modifiedText).length && !Object.keys(modifiedImages).length) {
      showNotification('No changes to discard.');
      return;
    }
    if (!confirm('Discard all unsaved changes and reload?')) return;
    window.location.reload();
  }

  // ─────────────────────────────────────────────
  // Push Live
  // ─────────────────────────────────────────────
  function pushLive() {
    var textCount  = Object.keys(modifiedText).length;
    var imageCount = Object.keys(modifiedImages).length;

    if (!textCount && !imageCount) {
      showNotification('Nothing has been changed yet.');
      return;
    }

    var btn = document.getElementById('cms-push-btn');
    btn.textContent = '⏳ Pushing...';
    btn.disabled    = true;
    btn.style.opacity = '0.7';

    // Collect current text state (in case edits were not blurred)
    document.querySelectorAll('.cms-text').forEach(function (el) {
      if (el.id) modifiedText[el.id] = el.innerHTML;
    });

    var payload = {
      textChanges:  Object.keys(modifiedText).map(function (id) {
        return { id: id, html: modifiedText[id] };
      }),
      imageChanges: Object.keys(modifiedImages).map(function (id) {
        return {
          id:       id,
          base64:   modifiedImages[id].base64,
          mimeType: modifiedImages[id].mimeType
        };
      })
    };

    // Get Netlify Identity JWT token for the request
    var identity = window.netlifyIdentity;
    var token    = identity && identity.currentUser() ? identity.currentUser().token.access_token : null;

    fetch('/.netlify/functions/save-site', {
      method:  'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        token ? { 'Authorization': 'Bearer ' + token } : {}
      ),
      body: JSON.stringify(payload)
    })
    .then(function (res) {
      return res.json().then(function (data) {
        return { status: res.status, data: data };
      });
    })
    .then(function (result) {
      if (result.status === 200 && result.data.success) {
        clearDirty();
        btn.textContent  = '✅ Live!';
        btn.disabled     = false;
        btn.style.opacity = '1';
        showNotification('Changes pushed to main branch. Netlify is rebuilding the live site!', 6000);

        // Reset state
        Object.keys(modifiedText).forEach(function (k) { delete modifiedText[k]; });
        Object.keys(modifiedImages).forEach(function (k) { delete modifiedImages[k]; });

        setTimeout(function () {
          btn.textContent = '🚀 Push Live';
        }, 4000);
      } else {
        throw new Error(result.data.error || 'Unknown error from function');
      }
    })
    .catch(function (err) {
      console.error('[CMS] Push failed:', err);
      btn.textContent   = '❌ Failed — retry';
      btn.disabled      = false;
      btn.style.opacity = '1';
      showNotification('Error: ' + err.message, 8000);
    });
  }

  // ─────────────────────────────────────────────
  // Notification Toast
  // ─────────────────────────────────────────────
  function showNotification(msg, duration) {
    duration = duration || 3500;
    var existing = document.getElementById('cms-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id  = 'cms-toast';
    toast.textContent = msg;
    toast.style.cssText = [
      'position:fixed',
      'top:20px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:rgba(30,41,59,0.97)',
      'color:#f8fafc',
      'font-size:13px',
      'font-weight:600',
      'padding:12px 24px',
      'border-radius:8px',
      'border:1px solid #00AEEF',
      'box-shadow:0 8px 32px rgba(0,0,0,0.4)',
      'z-index:999999',
      'backdrop-filter:blur(8px)',
      'max-width:90vw',
      'text-align:center',
      'font-family:sans-serif',
      'transition:opacity 0.3s'
    ].join(';');

    document.body.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () { toast.remove(); }, 400);
    }, duration);
  }

  // ─────────────────────────────────────────────
  // Boot
  // ─────────────────────────────────────────────
  waitForIdentity(function (identity) {
    // Check if already logged in on page load
    var user = identity.currentUser();
    if (user) {
      activateEditor(user);
    }

    // Listen for login event
    identity.on('login', function (user) {
      identity.close();
      activateEditor(user);
    });

    // Listen for logout
    identity.on('logout', function () {
      // Disable editor
      document.querySelectorAll('.cms-text').forEach(function (el) {
        el.removeAttribute('contenteditable');
        el.style.outline = '';
        el.style.background = '';
        el.style.cursor = '';
      });
      var toolbar = document.getElementById('cms-toolbar');
      if (toolbar) toolbar.remove();
      editorActive = false;
      showNotification('Logged out. Editor disabled.');
    });
  });

})();
