import { useState } from "react";
import type { SettingDef } from "@/lib/settings-schema";
import { useNativeFontPanel } from "./use-native-font-panel";

interface FontControlProps {
  def: SettingDef;
  value: string;
  onChange: (value: string) => void | Promise<void>;
}

/** Editable CSS font stack with a macOS-native Font panel for replacing the
 * primary family. Other platforms retain the full free-text control without a
 * custom imitation of their system picker. */
export function FontControl({ def, value, onChange }: FontControlProps) {
  const { supported, ready, activeRequestId, error, clearError, open } = useNativeFontPanel({
    value,
    onChange,
  });
  const [directEditError, setDirectEditError] = useState<string | null>(null);
  const visibleError = directEditError ?? error;

  function changeDirectly(nextValue: string) {
    clearError();
    setDirectEditError(null);
    void Promise.resolve(onChange(nextValue)).catch((changeError: unknown) => {
      setDirectEditError(changeError instanceof Error ? changeError.message : String(changeError));
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="inline-flex h-9 w-64 items-center rounded-lg border border-transparent bg-[var(--surface-input)] focus-within:border-[var(--focus-border)]">
        <input
          type="text"
          value={value}
          aria-label={`${def.label} stack`}
          onChange={(event) => changeDirectly(event.target.value)}
          className="h-full min-w-0 flex-1 rounded-lg bg-transparent pl-3 pr-1 text-[13px] text-[var(--text-secondary)] font-[inherit] outline-none focus-visible:outline-none"
        />
        {supported && (
          <button
            type="button"
            onClick={() => {
              setDirectEditError(null);
              void open();
            }}
            disabled={!ready}
            aria-label={`Show Fonts for ${def.label}`}
            data-native-font-request-id={activeRequestId ?? undefined}
            className="h-full w-8 shrink-0 rounded-r-lg bg-[image:var(--select-chevron)] bg-[length:12px_12px] bg-center bg-no-repeat hover:bg-[var(--surface-subtle-strong)] disabled:opacity-50"
          />
        )}
      </div>
      {visibleError && (
        <span
          role="alert"
          className="max-w-64 text-right text-[11px] text-[var(--text-error,#ff6b6b)]"
        >
          Couldn't apply the font change: {visibleError}
        </span>
      )}
    </div>
  );
}
