/** Interruptor accesible (role="switch") con etiqueta a la derecha. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  className = "",
}: {
  checked: boolean;
  onChange: (valor: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={`inline-flex cursor-pointer select-none items-center gap-2 text-sm text-tinta ${className}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? "bg-marca" : "bg-borde"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-superficie shadow-sm transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
      <span>{label}</span>
    </label>
  );
}
