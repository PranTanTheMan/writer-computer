import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { firstFamily, stackWithFamily } from "@/lib/font-stack";
import type { SettingDef } from "@/lib/settings-schema";
import { usePopoverDismiss } from "./use-popover-dismiss";
import { useSystemFonts } from "./use-system-fonts";

interface FontControlProps {
  def: SettingDef;
  value: string;
  onChange: (value: string) => void;
}

/** Where the picker popover renders. The settings cards clip overflow, so
 *  the popover is portaled to the body with fixed positioning measured from
 *  the trigger at open time; `usePopoverDismiss` closes it on outside scroll
 *  instead of letting it drift from its anchor. */
interface PickerPosition {
  top: number;
  right: number;
}

/** Font-stack control: a free-text stack input and an installed-font picker
 *  presented as one select-style pill (matching `EnumControl`'s chevron).
 *  Picking a family swaps the stack's primary family and keeps the schema
 *  default as the fallback tail. */
export function FontControl({ def, value, onChange }: FontControlProps) {
  const [pickerPos, setPickerPos] = useState<PickerPosition | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  function togglePicker(event: React.MouseEvent<HTMLButtonElement>) {
    if (pickerPos) {
      setPickerPos(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setPickerPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }

  return (
    <div
      ref={anchorRef}
      className="inline-flex h-9 w-64 items-center rounded-lg border border-transparent bg-[var(--surface-input)] focus-within:border-[var(--focus-border)]"
    >
      <input
        type="text"
        value={value}
        aria-label="Font stack"
        onChange={(e) => onChange(e.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent pl-3 pr-1 text-[13px] text-[var(--text-secondary)] font-[inherit] outline-none focus-visible:outline-none"
      />
      <button
        type="button"
        onClick={togglePicker}
        aria-label="Choose installed font"
        aria-expanded={pickerPos !== null}
        className="h-full w-8 shrink-0 rounded-r-lg bg-[image:var(--select-chevron)] bg-[length:12px_12px] bg-center bg-no-repeat hover:bg-[var(--surface-subtle-strong)]"
      />
      {pickerPos &&
        createPortal(
          <FontPickerPopover
            position={pickerPos}
            anchorRef={anchorRef}
            currentFamily={firstFamily(value)}
            onPick={(family) => {
              onChange(stackWithFamily(family, String(def.default)));
              setPickerPos(null);
            }}
            onClose={() => setPickerPos(null)}
          />,
          document.body,
        )}
    </div>
  );
}

function FontPickerPopover({
  position,
  anchorRef,
  currentFamily,
  onPick,
  onClose,
}: {
  position: PickerPosition;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  currentFamily: string;
  onPick: (family: string) => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const { fonts, error } = useSystemFonts();
  usePopoverDismiss(popoverRef, anchorRef, onClose);

  const q = query.trim().toLowerCase();
  const filtered = fonts?.filter((family) => family.toLowerCase().includes(q)) ?? [];

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Installed fonts"
      style={{
        top: position.top,
        right: position.right,
        maxHeight: `calc(100vh - ${position.top}px - 16px)`,
      }}
      className="fixed z-50 flex w-72 flex-col overflow-hidden rounded-xl border border-[var(--line-subtle)] bg-[var(--surface-palette)] shadow-2xl backdrop-blur-xl"
    >
      <input
        ref={(el) => el?.focus()}
        type="text"
        value={query}
        placeholder="Search fonts…"
        aria-label="Search installed fonts"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && filtered.length > 0) onPick(filtered[0]);
        }}
        className="m-2 h-8 shrink-0 rounded-lg border border-transparent bg-[var(--surface-input)] px-3 text-[13px] text-[var(--text-secondary)] outline-none focus:border-[var(--focus-border)] focus-visible:outline-none"
      />
      <div role="listbox" aria-label="Installed fonts" className="min-h-0 overflow-y-auto pb-1">
        {error ? (
          <div className="px-3 py-2 text-[13px] text-[var(--text-error,#ff6b6b)]">
            Couldn't load system fonts.
          </div>
        ) : fonts === null ? (
          <div className="px-3 py-2 text-[13px] text-[var(--text-muted)]">Loading fonts…</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-2 text-[13px] text-[var(--text-muted)]">No matching fonts.</div>
        ) : (
          filtered.map((family) => (
            <button
              key={family}
              type="button"
              role="option"
              aria-selected={family === currentFamily}
              onClick={() => onPick(family)}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--item-hover-bg)] hover:text-[var(--text-primary)]"
              style={{ fontFamily: `"${family.replace(/"/g, '\\"')}"` }}
            >
              <span className="truncate">{family}</span>
              {family === currentFamily && <span aria-hidden="true">✓</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
