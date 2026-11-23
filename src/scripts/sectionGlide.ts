// Section glide: scrolling stays fully native. Only after the page has been
// still for a moment, and only if it stopped close to a section, does it ease
// the last few steps onto that section. Stop anywhere else and it stays put.
// Any new input cancels the glide immediately.
//
// A stop is a scroll position. A stop with `bottom` is a section taller than
// the screen: anywhere between `top` and `bottom` is left alone so it can be
// read freely, and its two ends act as stops.

export type Stop = { top: number; bottom?: number };

const IDLE_MS = 450; // quiet time after the last scroll event before gliding
const REACH = 0.3; // only settle onto a stop within this fraction of the screen height

const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

export function sectionGlide(getStops: () => Stop[]) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const root = document.documentElement;
  const maxScroll = () => Math.max(0, root.scrollHeight - window.innerHeight);
  const clampY = (y: number) => Math.min(maxScroll(), Math.max(0, Math.round(y)));

  let rest = window.scrollY; // where the last glide (or load) left the page
  let idleTimer: number | undefined;
  let frame = 0;
  let gliding = false;
  let touching = false;

  function cancelGlide() {
    if (!gliding) return;
    cancelAnimationFrame(frame);
    gliding = false;
    root.style.scrollBehavior = "";
  }

  function glideTo(y: number) {
    const from = window.scrollY;
    const dist = y - from;
    if (Math.abs(dist) < 2) {
      rest = y;
      return;
    }
    const duration = Math.min(1000, Math.max(600, 500 + Math.abs(dist) * 0.8));
    const start = performance.now();
    gliding = true;
    // The site sets `scroll-behavior: smooth`; per-frame scrolling needs it off.
    root.style.scrollBehavior = "auto";
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      window.scrollTo(0, from + dist * easeInOutSine(t));
      if (t < 1) {
        frame = requestAnimationFrame(step);
      } else {
        gliding = false;
        root.style.scrollBehavior = "";
        rest = y;
      }
    };
    frame = requestAnimationFrame(step);
  }

  function settle() {
    if (gliding || touching) return;
    const y = window.scrollY;
    const stops = getStops().map((s) => {
      const top = clampY(s.top);
      return { top, bottom: Math.max(top, clampY(s.bottom ?? s.top)) };
    });

    // Inside a tall section: let it be read at its own pace.
    if (stops.some((s) => s.bottom - s.top > 1 && y > s.top + 1 && y < s.bottom - 1)) {
      rest = y;
      return;
    }

    const points = [...new Set([0, maxScroll(), ...stops.flatMap((s) => [s.top, s.bottom])])];
    // Only ever carry you onward, in the direction you were scrolling; never
    // pull you back against it.
    const reach = window.innerHeight * REACH;
    const ahead = points.filter((p) => (p - y) * lastDir >= 0 && Math.abs(p - y) <= reach);
    if (!ahead.length) {
      rest = y; // stopped between sections: leave it there
      return;
    }
    const target = ahead.reduce((best, p) => (Math.abs(p - y) < Math.abs(best - y) ? p : best));

    glideTo(target);
  }

  const schedule = () => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(settle, IDLE_MS);
  };

  let lastY = window.scrollY;
  let lastDir = 1;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    if (y !== lastY && !gliding) lastDir = y > lastY ? 1 : -1;
    lastY = y;
    if (!gliding) schedule();
  }, { passive: true });

  // Any deliberate input takes over from a glide in progress.
  for (const type of ["wheel", "mousedown", "keydown"] as const) {
    window.addEventListener(type, () => {
      if (gliding) {
        cancelGlide();
        rest = window.scrollY;
      }
    }, { passive: true });
  }
  window.addEventListener("touchstart", () => {
    touching = true;
    if (gliding) {
      cancelGlide();
      rest = window.scrollY;
    }
  }, { passive: true });
  window.addEventListener("touchend", () => {
    touching = false;
    schedule();
  }, { passive: true });

  // In-page links (e.g. #about) jump somewhere new: treat that as the new rest.
  window.addEventListener("hashchange", () => {
    window.setTimeout(() => (rest = window.scrollY), 600);
  });
}
