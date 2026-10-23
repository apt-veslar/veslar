// Swipe/drag left-right on the calendar grid to change month.
// Works with touch, mouse drag and trackpad horizontal scroll.
// onStep(dir): dir = 1 next month, -1 previous month.

const DRAG_THRESHOLD = 50;   // px of horizontal movement to change month
const WHEEL_THRESHOLD = 80;  // accumulated deltaX for a trackpad swipe
const WHEEL_IDLE = 250;      // ms of no wheel events that ends a trackpad gesture

export function attachMonthSwipe(el, onStep){
  let startX = 0, startY = 0, dx = 0, pointerId = null, horizontal = false;
  let suppressClick = false;

  const reset = () => {
    pointerId = null; horizontal = false; dx = 0;
    el.style.transition = 'transform .15s ease';
    el.style.transform = '';
  };

  el.addEventListener('pointerdown', e => {
    if(e.pointerType === 'mouse' && e.button !== 0) return;
    pointerId = e.pointerId; startX = e.clientX; startY = e.clientY; dx = 0; horizontal = false;
    el.style.transition = '';
  });

  el.addEventListener('pointermove', e => {
    if(e.pointerId !== pointerId) return;
    dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if(!horizontal && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5){
      horizontal = true;
      try { el.setPointerCapture(e.pointerId); } catch(_) {}
    }
    if(horizontal){
      e.preventDefault();
      el.style.transform = `translateX(${Math.max(-80, Math.min(80, dx * 0.4))}px)`;
    }
  });

  el.addEventListener('pointerup', e => {
    if(e.pointerId !== pointerId) return;
    const step = horizontal && Math.abs(dx) >= DRAG_THRESHOLD ? (dx < 0 ? 1 : -1) : 0;
    // A drag must not also count as a tap on a booking/day
    if(horizontal) suppressClick = true;
    reset();
    if(step) onStep(step);
    setTimeout(() => { suppressClick = false; }, 0);
  });
  el.addEventListener('pointercancel', reset);

  el.addEventListener('click', e => {
    if(suppressClick){ e.stopPropagation(); e.preventDefault(); suppressClick = false; }
  }, true);

  // Stop the browser starting a native drag (e.g. of text) with the mouse
  el.addEventListener('dragstart', e => e.preventDefault());

  // Trackpad: one gesture = one month. After a step, ignore the rest of the
  // gesture (including inertia) until the wheel events stop for a moment.
  let wheelAcc = 0, wheelLocked = false, wheelIdleTimer = null;
  el.addEventListener('wheel', e => {
    if(Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault(); // keep the browser's back/forward gesture out of it
    clearTimeout(wheelIdleTimer);
    wheelIdleTimer = setTimeout(() => { wheelAcc = 0; wheelLocked = false; }, WHEEL_IDLE);
    if(wheelLocked) return;
    wheelAcc += e.deltaX;
    if(Math.abs(wheelAcc) >= WHEEL_THRESHOLD){
      onStep(wheelAcc > 0 ? 1 : -1);
      wheelAcc = 0;
      wheelLocked = true;
    }
  }, { passive: false });
}
