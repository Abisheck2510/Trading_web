import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Where the Android APK lives. Drop the file from PWABuilder at public/download/trade-signal-desk.apk
export const APK_URL = '/download/trade-signal-desk.apk';

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
  || document.referrer.startsWith('android-app://');

// Checks the APK is really there (the dev server answers missing files with index.html).
async function apkAvailable() {
  try {
    const res = await fetch(APK_URL, { method: 'HEAD', cache: 'no-store' });
    return res.ok && !(res.headers.get('content-type') || '').includes('text/html');
  } catch {
    return false;
  }
}

export default function GetApp() {
  const [open, setOpen] = useState(false);
  const [apk, setApk] = useState(null); // null = checking
  const [prompt, setPrompt] = useState(null);
  const [hidden] = useState(isStandalone);
  const android = /android/i.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setPrompt(e); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  useEffect(() => {
    if (open && apk === null) apkAvailable().then(setApk);
  }, [open, apk]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (hidden) return null; // already running as the app

  const installPwa = async () => {
    prompt.prompt();
    await prompt.userChoice.catch(() => {});
    setPrompt(null);
  };

  return (
    <>
      <button type="button" className="theme-btn getapp-btn" onClick={() => setOpen(true)} title="Get the Android app" aria-label="Get the Android app">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="6" y="2" width="12" height="20" rx="2" /><path d="M12 7v7M9 11l3 3 3-3M10 18h4" />
        </svg>
        <span className="getapp-label">Get app</span>
      </button>

      {open && createPortal(
        <div className="getapp-backdrop" onClick={() => setOpen(false)}>
          <div className="getapp-modal" role="dialog" aria-modal="true" aria-labelledby="getapp-title" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="getapp-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
            <div className="getapp-head">
              <img src="/icon-192.png" alt="" width="56" height="56" />
              <div>
                <h2 id="getapp-title">Trade Signal Desk for Android</h2>
                <p className="muted small">Same app, full screen, opens from your home screen. Prices stay live.</p>
              </div>
            </div>

            {apk === null && <p className="muted small">Checking download…</p>}

            {apk === true && (
              <>
                <a className="btn getapp-dl" href={APK_URL} download="trade-signal-desk.apk">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
                  Download APK
                </a>
                <ol className="getapp-steps">
                  <li>Tap <b>Download APK</b>{android ? '' : ' on your Android phone (open this site there)'}.</li>
                  <li>Open the downloaded file. If Android asks, allow <b>Install unknown apps</b> for your browser.</li>
                  <li>Tap <b>Install</b>, then open <b>Signal Desk</b> from your home screen.</li>
                </ol>
                <p className="muted small">Play Protect may warn because the app isn't from the Play Store. That's expected for a direct download.</p>
              </>
            )}

            {apk === false && (
              <p className="muted small">The APK download isn't available yet. You can still install the app straight from your browser below.</p>
            )}

            {apk !== null && (
              <div className="getapp-alt">
                {prompt
                  ? <button type="button" className="btn ghost" onClick={installPwa}>Install from browser instead</button>
                  : <p className="muted small"><b>No download needed:</b> in Chrome, tap <b>⋮ → Add to Home screen / Install app</b>.</p>}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
