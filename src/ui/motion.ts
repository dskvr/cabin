declare const gsap: any;
declare const ScrollTrigger: any;

type Cleanup = () => void;

const reduceMotion = globalThis.matchMedia("(prefers-reduced-motion: reduce)");

function seeded(index: number, salt: number): number {
  const value = Math.sin(index * 9283.31 + salt * 77.17) * 43758.5453;
  return value - Math.floor(value);
}

function createRelayField(canvas: HTMLCanvasElement, animate: boolean): Cleanup {
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;
  const nodes = Array.from({ length: 22 }, (_, index) => ({
    x: seeded(index, 1), y: seeded(index, 2), depth: .35 + seeded(index, 3) * .65,
    phase: seeded(index, 4) * Math.PI * 2,
  }));
  let width = 0;
  let height = 0;
  let frame = 0;
  let active = true;
  let pointerX = 0;
  let pointerY = 0;
  let targetX = 0;
  let targetY = 0;

  const resize = () => {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  const onPointer = (event: PointerEvent) => {
    targetX = event.clientX / Math.max(width, 1) - .5;
    targetY = event.clientY / Math.max(height, 1) - .5;
  };
  const draw = (time: number) => {
    if (!active) return;
    pointerX += (targetX - pointerX) * .035;
    pointerY += (targetY - pointerY) * .035;
    context.clearRect(0, 0, width, height);
    const points = nodes.map((node) => ({
      x: node.x * width + pointerX * 34 * node.depth + Math.sin(time * .00018 + node.phase) * 8,
      y: node.y * height + pointerY * 24 * node.depth + Math.cos(time * .00014 + node.phase) * 6,
      depth: node.depth,
    }));
    for (let left = 0; left < points.length; left += 1) {
      for (let right = left + 1; right < points.length; right += 1) {
        const a = points[left]!;
        const b = points[right]!;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > Math.min(width, 430) * .34) continue;
        const lightTheme = document.documentElement.dataset.theme === "light";
        context.strokeStyle = lightTheme
          ? `rgba(13, 116, 148, ${Math.max(0, .13 - distance / 2600)})`
          : `rgba(90, 229, 255, ${Math.max(0, .15 - distance / 2400)})`;
        context.lineWidth = .55;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
        const travel = (time * .00012 + seeded(left * 31 + right, 9)) % 1;
        context.fillStyle = lightTheme ? "rgba(100, 62, 180, .42)" : "rgba(182, 126, 255, .72)";
        context.beginPath();
        context.arc(a.x + (b.x - a.x) * travel, a.y + (b.y - a.y) * travel, 1.2, 0, Math.PI * 2);
        context.fill();
      }
    }
    points.forEach((point, index) => {
      const pulse = 2.2 + Math.sin(time * .002 + nodes[index]!.phase) * .7;
      const lightTheme = document.documentElement.dataset.theme === "light";
      context.fillStyle = index < 10
        ? (lightTheme ? "rgba(11, 126, 158, .58)" : "rgba(92, 239, 255, .88)")
        : (lightTheme ? "rgba(102, 65, 177, .42)" : "rgba(151, 105, 255, .66)");
      context.shadowColor = context.fillStyle;
      context.shadowBlur = 12;
      context.beginPath();
      context.arc(point.x, point.y, pulse * point.depth, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
    });
    if (animate) frame = requestAnimationFrame(draw);
  };
  resize();
  globalThis.addEventListener("resize", resize);
  globalThis.addEventListener("pointermove", onPointer, { passive: true });
  if (animate) frame = requestAnimationFrame(draw); else draw(0);
  return () => {
    active = false;
    cancelAnimationFrame(frame);
    globalThis.removeEventListener("resize", resize);
    globalThis.removeEventListener("pointermove", onPointer);
  };
}

export function activateMotion(root: HTMLElement, animateEntrance = true, animateModal = true): Cleanup {
  let motionCleanup: Cleanup | null = null;
  let disposed = false;

  const startMotion = () => {
    if (disposed) return;
    const canvas = root.querySelector<HTMLCanvasElement>(".relay-field");
    const cleanups: Cleanup[] = canvas ? [createRelayField(canvas, !reduceMotion.matches)] : [];
    if (reduceMotion.matches) {
      motionCleanup = () => cleanups.forEach((cleanup) => cleanup());
      return;
    }
    if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
      motionCleanup = () => cleanups.forEach((cleanup) => cleanup());
      return;
    }
    gsap.registerPlugin(ScrollTrigger);
    const context = gsap.context(() => {
      if (animateEntrance) {
        gsap.from(".topbar", { y: -32, opacity: 0, duration: .7, ease: "power3.out" });
        gsap.from(".hero > *, .summary-hero > *, .narrow-page > *, .session-main > *", {
          y: 28, opacity: 0, duration: .7, stagger: .07, ease: "power3.out", clearProps: "transform,opacity",
        });
        gsap.from(".session-card, .project-card, .summary-project, .follow-card", {
          y: 38, rotateX: -7, opacity: 0, duration: .75, stagger: .06, ease: "power3.out", clearProps: "transform,opacity",
        });
      }
    if (animateModal) gsap.from(".modal", { scale: .82, y: 28, opacity: 0, duration: .42, ease: "back.out(1.6)" });
    gsap.to(".relay-status.online i", { scale: 1.7, opacity: .35, duration: 1.1, repeat: -1, yoyo: true, ease: "sine.inOut" });
    gsap.to(".timer [data-timer-value], .display-stage [data-timer-value]", {
      textShadow: "0 0 32px currentColor", duration: 1.25, repeat: -1, yoyo: true, ease: "sine.inOut",
    });
    if (animateEntrance) gsap.utils.toArray(".panel, .current-demo, .ranking-editor, .feedback-form").forEach((element: Element) => {
      gsap.from(element, {
        y: 26, opacity: 0, duration: .65, ease: "power2.out", clearProps: "transform,opacity",
        scrollTrigger: { trigger: element, start: "top 92%", once: true },
      });
    });
    root.querySelectorAll<HTMLElement>(".button, .session-card, .project-card").forEach((element) => {
      const enter = () => gsap.to(element, { y: -4, scale: 1.012, duration: .22, ease: "power2.out" });
      const clearTransform = () => gsap.set(element, { clearProps: "transform" });
      const leave = () => gsap.to(element, { y: 0, scale: 1, duration: .3, ease: "power2.out", onComplete: clearTransform });
      const press = () => {
        gsap.killTweensOf(element);
        clearTransform();
      };
      element.addEventListener("pointerenter", enter);
      element.addEventListener("pointerleave", leave);
      element.addEventListener("pointerdown", press);
      cleanups.push(() => {
        element.removeEventListener("pointerenter", enter);
        element.removeEventListener("pointerleave", leave);
        element.removeEventListener("pointerdown", press);
        gsap.killTweensOf(element);
        clearTransform();
      });
    });
    }, root);
    motionCleanup = () => {
      context.revert();
      cleanups.forEach((cleanup) => cleanup());
    };
  };

  const onMotionPreferenceChanged = () => {
    motionCleanup?.();
    motionCleanup = null;
    startMotion();
  };
  reduceMotion.addEventListener("change", onMotionPreferenceChanged);
  startMotion();
  return () => {
    disposed = true;
    reduceMotion.removeEventListener("change", onMotionPreferenceChanged);
    motionCleanup?.();
    motionCleanup = null;
  };
}
