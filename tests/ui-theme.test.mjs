import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const app = await readFile(new URL("../src/app/App.ts", import.meta.url), "utf8");
const motion = await readFile(new URL("../src/ui/motion.ts", import.meta.url), "utf8");
const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("cybernetic semantic states override inherited light-theme surfaces", () => {
  for (const selector of [
    ".timer-presentation",
    ".timer-questions",
    ".timer-overtime",
    ".ready-label",
    ".relay-fallback",
    ".secret-backup",
    ".zap-success-card",
    ".notice-error",
    ".current-demo .project-description",
  ]) {
    assert.match(css.slice(css.indexOf("/* Cybernetic relay control room */")), new RegExp(selector.replaceAll(".", "\\.")));
  }
  assert.match(app, /<p class="project-description">\$\{escapeHtml\(current\.content\.demo\.description\)\}<\/p>/);
});

test("motion integration keeps background renders and accessibility preferences stable", () => {
  assert.doesNotMatch(index, /id="app"[^>]*aria-live/);
  assert.match(motion, /typeof gsap === "undefined" \|\| typeof ScrollTrigger === "undefined"/);
  assert.match(motion, /reduceMotion\.addEventListener\("change", onMotionPreferenceChanged\)/);
  assert.match(motion, /motionCleanup = null;\s+startMotion\(\);/);
  assert.match(motion, /createRelayField\(canvas, !reduceMotion\.matches\)/);
  assert.match(motion, /if \(animateEntrance\)/);
  assert.match(motion, /if \(animateModal\)/);
  assert.match(motion, /clearProps: "transform"/);
  assert.match(app, /const animateEntrance = motionRouteKey !== this\.#motionRouteKey/);
  assert.match(app, /const animateModal = Boolean\(motionModalKey\)/);
  assert.match(app, /announceNotice \? 'role="alert"' : ""/);
  assert.match(app, /profileSearchAnnouncement !== this\.#announcedProfileSearch/);
});

test("light theme is selectable, persistent, and limited to color overrides", () => {
  assert.match(css, /:root\[data-theme="light"\]\s*\{/);
  assert.match(css, /\.theme-switcher\s*\{/);
  assert.match(app, /const THEME_STORAGE_KEY = "sedd-color-theme"/);
  assert.match(app, /data-action="toggle-theme"/);
  assert.match(app, /documentElement\.dataset\.theme = this\.#theme/);
  assert.match(app, /aria-label="\$\{label\}"/);
  assert.match(index, /name="theme-color"/);
});
