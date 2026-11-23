// Section glide: scrolling stays native, but once the page comes to rest it
// eases onto the next section in the direction you were scrolling (or back to
// the one you barely left). Any new input cancels the glide immediately.
//
// A stop is a scroll position. A stop with `bottom` is a section taller than
// the screen: anywhere between `top` and `bottom` is left alone so it can be
// read freely, and its two ends act as stops.

export type Stop = { top: number; bottom?: number };

const IDLE_MS = 140; // quiet time after the last scroll event before gliding
const NUDGE = 4; // px of movement that counts as "you scrolled"

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

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
    const duration = Math.min(1100, Math.max(550, 450 + Math.abs(dist) * 0.3));
    const start = performance.now();
    gliding = true;
    // The site sets `scroll-behavior: smooth`; per-frame scrolling needs it off.
    root.style.scrollBehavior = "auto";
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      window.scrollTo(0, from + dist * easeInOutCubic(t));
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

    const points = [...new Set([0, maxScroll(), ...stops.flatMap((s) => [s.top, s.bottom])])].sort((a, b) => a - b);
    const moved = y - rest;
    let target: number;

    if (Math.abs(moved) < NUDGE) {
      // No real movement since the last rest: just settle on the nearest stop.
      target = points.reduce((best, p) => (Math.abs(p - y) < Math.abs(best - y) ? p : best), points[0]);
    } else if (moved > 0) {
      const ahead = points.find((p) => p >= y) ?? maxScroll();
      const behind = [...points].reverse().find((p) => p < y);
      // If momentum already carried you past a stop, take whichever is closer.
      target = behind !== undefined && behind > rest + NUDGE && y - behind < ahead - y ? behind : ahead;
    } else {
      const ahead = [...points].reverse().find((p) => p <= y) ?? 0;
      const behind = points.find((p) => p > y);
      target = behind !== undefined && behind < rest - NUDGE && behind - y < y - ahead ? behind : ahead;
    }

    glideTo(target);
  }

  const schedule = () => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(settle, IDLE_MS);
  };

  window.addEventListener("scroll", () => {
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
