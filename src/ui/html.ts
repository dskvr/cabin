export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function escapeAttr(value: unknown): string {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

export function identiconDataUri(pubkey: string): string {
  const bytes = pubkey.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? [31, 91, 127];
  const hue = ((bytes[0] ?? 0) * 3 + (bytes[1] ?? 0)) % 360;
  const cells: string[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const on = ((bytes[(row * 3 + column + 2) % bytes.length] ?? 0) & 1) === 1;
      if (!on) continue;
      for (const x of column === 2 ? [column] : [column, 4 - column]) {
        cells.push(`<rect x="${x * 10 + 7}" y="${row * 10 + 7}" width="9" height="9" rx="2"/>`);
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="hsl(${hue} 38% 88%)"/><g fill="hsl(${hue} 55% 28%)">${cells.join("")}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function avatar({
  picture,
  pubkey,
  name,
  size = "md",
}: {
  picture: string | null;
  pubkey: string;
  name: string;
  size?: "sm" | "md" | "lg";
}): string {
  const fallback = identiconDataUri(pubkey);
  const src = picture ?? fallback;
  return `<img class="avatar avatar-${size}" src="${escapeAttr(src)}" alt="${escapeAttr(name)}" data-fallback-avatar="${escapeAttr(fallback)}" loading="lazy" referrerpolicy="no-referrer" />`;
}

export function profileComponent({
  picture,
  pubkey,
  name,
  size = "md",
  className = "",
}: {
  picture: string | null;
  pubkey: string;
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}): string {
  const classes = ["profile", className].filter(Boolean).join(" ");
  return `<span class="${escapeAttr(classes)}">${avatar({ picture, pubkey, name, size })}<strong class="profile-name">${escapeHtml(name)}</strong></span>`;
}

export function captainCard({
  picture,
  pubkey,
  name,
}: {
  picture: string | null;
  pubkey: string;
  name: string;
}): string {
  return `<section class="panel captain-profile-card"><span class="eyebrow">This week's captain</span>${profileComponent({ picture, pubkey, name, size: "sm" })}</section>`;
}

export function button(label: string, action: string, options: {
  className?: string;
  disabled?: boolean;
  attrs?: string;
  type?: "button" | "submit";
} = {}): string {
  return `<button type="${options.type ?? "button"}" class="${escapeAttr(options.className ?? "button")}" data-action="${escapeAttr(action)}" ${options.disabled ? "disabled" : ""} ${options.attrs ?? ""}>${label}</button>`;
}

export function field({
  label,
  name,
  value = "",
  type = "text",
  placeholder = "",
  required = false,
  maxlength,
  min,
  step,
  help = "",
  error = "",
  id,
  autocomplete = "off",
}: {
  label: string;
  name: string;
  value?: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  maxlength?: number;
  min?: number;
  step?: number;
  help?: string;
  error?: string;
  id?: string;
  autocomplete?: string;
}): string {
  const inputId = id ?? `field-${name}`;
  const helpId = help ? `${inputId}-help` : "";
  const errorId = error ? `${inputId}-error` : "";
  const describedBy = [helpId, errorId].filter(Boolean).join(" ");
  return `<label class="field"><span>${escapeHtml(label)}</span><input id="${escapeAttr(inputId)}" name="${escapeAttr(name)}" type="${escapeAttr(type)}" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" ${required ? "required" : ""} ${maxlength ? `maxlength="${maxlength}"` : ""} ${min != null ? `min="${min}"` : ""} ${step != null ? `step="${step}"` : ""} ${describedBy ? `aria-describedby="${escapeAttr(describedBy)}"` : ""} ${error ? 'aria-invalid="true"' : ""} autocomplete="${escapeAttr(autocomplete)}" />${help ? `<small id="${escapeAttr(helpId)}">${escapeHtml(help)}</small>` : ""}${error ? `<small id="${escapeAttr(errorId)}" class="field-error">${escapeHtml(error)}</small>` : ""}</label>`;
}

export function textarea({
  label,
  name,
  value = "",
  placeholder = "",
  required = false,
  maxlength,
  rows = 4,
}: {
  label: string;
  name: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
  maxlength?: number;
  rows?: number;
}): string {
  return `<label class="field"><span>${escapeHtml(label)}</span><textarea name="${escapeAttr(name)}" placeholder="${escapeAttr(placeholder)}" ${required ? "required" : ""} ${maxlength ? `maxlength="${maxlength}"` : ""} rows="${rows}">${escapeHtml(value)}</textarea></label>`;
}

export function publicWeekPreview(projection: PublicWeekProjection): string {
  const agenda = projection.activities.map((activity) => {
    const time = activity.starts_at && activity.ends_at ? `${activity.starts_at}–${activity.ends_at}` : activity.starts_at ? `Starts ${activity.starts_at}` : activity.ends_at ? `Ends ${activity.ends_at}` : "";
    const details = [activity.date, time, activity.location].filter(Boolean).join(" · ");
    return `<li><strong>${escapeHtml(activity.name)}</strong>${details ? `<span>${escapeHtml(details)}</span>` : ""}${activity.link ? `<a href="${escapeAttr(activity.link)}" target="_blank" rel="noreferrer">Open link</a>` : ""}</li>`;
  }).join("");
  const fields = projection.proposal_fields.map((proposalField) => `<li>${escapeHtml(proposalField.label)}${proposalField.required ? " <strong>Required</strong>" : ""}</li>`).join("");
  return `<section class="week-preview" aria-labelledby="week-preview-heading"><span class="eyebrow">Public week preview</span><h1 id="week-preview-heading">${escapeHtml(projection.theme)}</h1><p>${escapeHtml(projection.public_description)}</p><section><h2>Agenda</h2><ol class="week-preview-list">${agenda}</ol></section><section><h2>Demo Day timing</h2><p>${projection.presentation_minutes}:00 presentation + ${projection.question_minutes}:00 questions.</p></section><section><h2>Proposal fields</h2><ul class="week-preview-list">${fields}</ul></section></section>`;
}
import type { PublicWeekProjection } from "../domain/week.js";
