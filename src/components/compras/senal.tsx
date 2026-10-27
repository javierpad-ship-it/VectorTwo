import { ETIQUETA_SENAL, type Senal } from "@/lib/flujo/tipos-api";
import { AYUDA_SENAL, imi as textoImi, TONO_SENAL, type TonoSenal } from "./formato";

/**
 * Piezas visuales compartidas por Huecos y Flujo mensual. La tarjeta de la referencia (COTBV2) usa un sello de inspección y un
 * medidor de código de barras; aquí se reproducen con el kit y los tokens de Vector2 (sin importar su CSS).
 */

const CLASES_SELLO: Record<TonoSenal, string> = {
  alerta: "border-alerta text-alerta",
  exito: "border-exito text-exito",
  marca: "border-marca text-marca-oscura",
  neutro: "border-borde text-tinta-suave",
};

/** Sello de estado de una fila: Falta / Al día / Exceso / Quiebre / Sin curva / Sin demanda. */
export function SelloSenal({ senal, className = "" }: { senal: Senal; className?: string }) {
  return (
    <span
      title={AYUDA_SENAL[senal]}
      className={`inline-block shrink-0 -rotate-2 rounded-sm border-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${CLASES_SELLO[TONO_SENAL[senal]]} ${className}`}
    >
      {ETIQUETA_SENAL[senal]}
    </span>
  );
}

/**
 * Medidor de IMI (meses de inventario) con las marcas del rango objetivo. La escala llega a una vez y media el máximo para que las
 * marcas queden siempre en el mismo sitio entre tarjetas; el valor real se escribe al lado. Verde dentro del rango, rojo por debajo
 * del mínimo y azul por encima del máximo. Sin IMI (sin demanda o sin curva) muestra la pista vacía.
 */
export function MedidorImi({ valor, min, max, etiqueta, pequeno = false }: { valor: number | null; min: number; max: number; etiqueta: string; pequeno?: boolean }) {
  const escala = Math.max(max * 1.5, 1);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / escala) * 100))}%`;
  const color = valor === null ? "" : valor < min ? "bg-alerta" : valor > max ? "bg-marca" : "bg-exito";
  const alto = pequeno ? "h-1.5" : "h-2.5";
  return (
    <div
      role="meter"
      aria-label={etiqueta}
      aria-valuemin={0}
      aria-valuemax={escala}
      aria-valuenow={valor ?? undefined}
      aria-valuetext={valor === null ? "sin IMI" : `${textoImi(valor)} meses; rango ${min} a ${max}`}
      className="relative min-w-0 flex-1 py-1"
    >
      <div className={`relative ${alto} overflow-hidden rounded-full bg-neutro-suave`}>
        <div className="absolute inset-y-0 bg-exito-suave" style={{ left: pct(min), width: `calc(${pct(max)} - ${pct(min)})` }} />
        {valor !== null && <div className={`absolute inset-y-0 left-0 rounded-full ${color}`} style={{ width: pct(valor) }} />}
      </div>
      <span aria-hidden className="absolute top-0 h-full w-px bg-tinta/60" style={{ left: pct(min) }} />
      <span aria-hidden className="absolute top-0 h-full w-px bg-tinta/60" style={{ left: pct(max) }} />
    </div>
  );
}
