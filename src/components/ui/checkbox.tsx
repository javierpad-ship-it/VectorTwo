/** Casilla con los tokens del kit; `indeterminado` para la cabecera de una selección parcial. */
export function Checkbox({
  checked,
  indeterminado = false,
  disabled,
  onChange,
  label,
  className = "",
}: {
  checked: boolean;
  indeterminado?: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  /** Texto accesible (la casilla no lleva etiqueta visible). */
  label: string;
  className?: string;
}) {
  return (
    <input
      type="checkbox"
      ref={(el) => {
        if (el) el.indeterminate = indeterminado && !checked;
      }}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
      className={`h-4 w-4 rounded border-borde accent-marca disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  );
}
