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
  help = "",
  autocomplete = "off",
}: {
  label: string;
  name: string;
  value?: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  maxlength?: number;
  help?: string;
  autocomplete?: string;
}): string {
  return `<label class="field"><span>${escapeHtml(label)}</span><input name="${escapeAttr(name)}" type="${escapeAttr(type)}" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" ${required ? "required" : ""} ${maxlength ? `maxlength="${maxlength}"` : ""} autocomplete="${escapeAttr(autocomplete)}" />${help ? `<small>${escapeHtml(help)}</small>` : ""}</label>`;
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
