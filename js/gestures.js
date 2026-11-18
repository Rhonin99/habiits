// Touch gestures on habit cards (Today screen):
//   • long-press (~0.45s) then drag  → reorder among siblings
//   • swipe left                     → skip / unskip for the day
// Works with touch (iPhone) and mouse (desktop testing).

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE = 8;
const SWIPE_TRIGGER = 90;

export function initCardGestures(root, { onReorder, onSwipe, onDragStart }) {
  let g = null; // active gesture
  let lastTouch = 0;
  let suppressClick = false;

  const cardAt = (target) => {
    const card = target.closest?.('.hcard');
    return card && root.contains(card) ? card : null;
  };

  function start(x, y, target) {
    const card = cardAt(target);
    if (!card) return;
    g = { card, x0: x, y0: y, mode: 'pending', timer: null };
    g.timer = setTimeout(() => beginDrag(), LONG_PRESS_MS);
  }

  function beginDrag() {
    if (!g || g.mode !== 'pending') return;
    g.mode = 'drag';
    const { card } = g;
    g.container = card.parentElement;
    g.startTop = card.offsetTop;
    g.pageY0 = g.y0 + window.scrollY;
    card.classList.add('lifted');
    document.body.classList.add('dragging');
    if (navigator.vibrate) navigator.vibrate(15);
    onDragStart?.();
  }

  function siblings() {
    return [...g.container.children].filter((el) => el.classList.contains('hcard'));
  }

  function move(x, y, e) {
    if (!g) return;
    const dx = x - g.x0;
    const dy = y - g.y0;
    if (g.mode === 'pending') {
      if (Math.abs(dx) > MOVE_TOLERANCE && Math.abs(dx) > Math.abs(dy) * 1.4 && !g.card.dataset.noswipe) {
        clearTimeout(g.timer);
        g.mode = 'swipe';
        g.face = g.card.querySelector(':scope > .hslide > .hface');
        g.card.classList.add('swiping');
      } else if (Math.abs(dx) > MOVE_TOLERANCE || Math.abs(dy) > MOVE_TOLERANCE) {
        // it's a scroll — let the browser handle it
        cancel();
        return;
      } else return;
    }
    e?.preventDefault?.();
    if (g.mode === 'swipe') {
      const off = dx < 0 ? dx : dx / 6; // resist swiping right
      g.face.style.transform = `translateX(${Math.max(off, -180)}px)`;
      g.card.classList.toggle('swipe-armed', dx <= -SWIPE_TRIGGER);
    } else if (g.mode === 'drag') {
      dragMove(y);
    }
  }

  function dragMove(clientY) {
    const { card } = g;
    // auto-scroll near the screen edges
    if (clientY < 70) window.scrollBy(0, -10);
    else if (clientY > window.innerHeight - 130) window.scrollBy(0, 10);
    const pageY = clientY + window.scrollY;
    let offset = pageY - g.pageY0 - (card.offsetTop - g.startTop);
    const sibs = siblings();
    const i = sibs.indexOf(card);
    const myMid = card.offsetTop + offset + card.offsetHeight / 2;
    const prev = sibs[i - 1];
    const next = sibs[i + 1];
    const before = card.offsetTop;
    if (prev && myMid < prev.offsetTop + prev.offsetHeight / 2) g.container.insertBefore(card, prev);
    else if (next && myMid > next.offsetTop + next.offsetHeight / 2) g.container.insertBefore(card, next.nextSibling);
    if (card.offsetTop !== before) offset = pageY - g.pageY0 - (card.offsetTop - g.startTop);
    card.style.transform = `translateY(${offset}px) scale(1.02)`;
  }

  function end() {
    if (!g) return;
    clearTimeout(g.timer);
    const cur = g;
    g = null;
    if (cur.mode === 'swipe') {
      suppressClick = true;
      const armed = cur.card.classList.contains('swipe-armed');
      cur.face.style.transition = 'transform .2s';
      cur.face.style.transform = '';
      cur.card.classList.remove('swiping', 'swipe-armed');
      if (armed) setTimeout(() => onSwipe(cur.card.dataset.hid), 120);
    } else if (cur.mode === 'drag') {
      suppressClick = true;
      cur.card.classList.remove('lifted');
      cur.card.style.transform = '';
      document.body.classList.remove('dragging');
      const ids = [...cur.container.children].filter((el) => el.classList.contains('hcard')).map((el) => el.dataset.hid);
      onReorder(ids);
    }
    if (suppressClick) setTimeout(() => { suppressClick = false; }, 350);
  }

  function cancel() {
    if (!g) return;
    clearTimeout(g.timer);
    if (g.mode === 'drag' || g.mode === 'swipe') { end(); return; }
    g = null;
  }

  // touch
  root.addEventListener('touchstart', (e) => {
    lastTouch = Date.now();
    if (e.touches.length !== 1) { cancel(); return; }
    start(e.touches[0].clientX, e.touches[0].clientY, e.target);
  }, { passive: true });
  // non-passive so we can stop the page scrolling while dragging/swiping
  root.addEventListener('touchmove', (e) => {
    lastTouch = Date.now();
    if (g) move(e.touches[0].clientX, e.touches[0].clientY, e);
  }, { passive: false });
  root.addEventListener('touchend', () => { lastTouch = Date.now(); end(); });
  root.addEventListener('touchcancel', () => { lastTouch = Date.now(); cancel(); });

  // mouse (ignored right after touches — browsers emulate mouse events)
  root.addEventListener('mousedown', (e) => {
    if (Date.now() - lastTouch < 800 || e.button !== 0) return;
    start(e.clientX, e.clientY, e.target);
  });
  window.addEventListener('mousemove', (e) => { if (g && Date.now() - lastTouch > 800) move(e.clientX, e.clientY, e); });
  window.addEventListener('mouseup', () => { if (Date.now() - lastTouch > 800) end(); });

  // stop the click that follows a drag/swipe, and the iOS long-press menu
  document.addEventListener('click', (e) => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
  }, true);
  root.addEventListener('contextmenu', (e) => { if (cardAt(e.target)) e.preventDefault(); });
}
