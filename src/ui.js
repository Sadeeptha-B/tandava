// Minimal, self-hiding controls.
const ICON = {
  pause: '<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5zM16 9.5l5 5M21 9.5l-5 5"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5zM15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/></svg>',
  orbit: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="3.6"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3v3M12 18v3"/></svg>',
  cine: '<svg viewBox="0 0 24 24"><rect x="3.5" y="7" width="12" height="10" rx="1.5"/><path d="M15.5 11l5-3v8l-5-3"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
};

export function createUI({ onPause, onAudio, onCamera, onElement, onFullscreen, state }) {
  const ui = document.getElementById('ui');
  const mk = (cls, label, tip, html, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.setAttribute('aria-label', label); b.dataset.tip = tip; b.innerHTML = html;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); poke(); });
    ui.appendChild(b);
    return b;
  };
  const sep = () => { const s = document.createElement('span'); s.className = 'sep'; ui.appendChild(s); };

  const bPause = mk('pause', 'Pause or resume the dance', 'Pause · Space', ICON.pause, () => onPause());
  const bAudio = mk('audio', 'Toggle sound', 'Sound · M', ICON.mute, () => onAudio());
  const bCam = mk('camera', 'Toggle interactive camera', 'Camera · C', ICON.orbit, () => onCamera());
  const bFull = mk('full', 'Toggle fullscreen', 'Fullscreen · F', ICON.full, () => onFullscreen());
  if (!document.documentElement.requestFullscreen) bFull.hidden = true;
  sep();
  const els = [['fire', 'Fire'], ['both', 'Both'], ['water', 'Water']].map(([id, label]) => {
    const b = mk('el', `${label} element`, '', label, () => onElement(id));
    b.dataset.el = id; delete b.dataset.tip;
    return b;
  });

  let timer = 0;
  const poke = () => {
    ui.classList.add('visible');
    document.body.classList.remove('idle');
    clearTimeout(timer);
    timer = setTimeout(() => { if (!ui.matches(':hover') && !ui.contains(document.activeElement) && !state.paused) { ui.classList.remove('visible'); document.body.classList.add('idle'); } }, 2800);
  };
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, poke, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); onPause(); }
    else if (k === 'm') onAudio();
    else if (k === 'c') onCamera();
    else if (k === 'f') onFullscreen();
    else if (k === '1') onElement('fire');
    else if (k === '2') onElement('both');
    else if (k === '3') onElement('water');
  });

  const sync = () => {
    bPause.innerHTML = state.paused ? ICON.play : ICON.pause;
    bPause.setAttribute('aria-pressed', String(state.paused));
    bAudio.innerHTML = state.audio ? ICON.sound : ICON.mute;
    bAudio.setAttribute('aria-pressed', String(state.audio));
    bCam.innerHTML = state.camera === 'interactive' ? ICON.cine : ICON.orbit;
    bCam.setAttribute('aria-pressed', String(state.camera === 'interactive'));
    for (const b of els) b.setAttribute('aria-pressed', String(b.dataset.el === state.element));
  };
  sync();
  return { sync, poke };
}
