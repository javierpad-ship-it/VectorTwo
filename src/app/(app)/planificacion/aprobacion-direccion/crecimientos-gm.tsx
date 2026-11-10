import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { GM_CLAVE_TOTAL, type CrecimientoGMApi, type TableroApi } from "@/lib/direccion/tipos-api";
import { rangoMeses, unidades } from "@/components/direccion/formato";
import { ETIQUETA_ANOMALIA, TEXTO_SIN_DATO, textoDeclarado, textoImplicito, textoSemaforo, textoTendencia, textoVersion, TONO_SEMAFORO } from "./vista-tablero";

const NUM = "text-right font-mono tabular-nums whitespace-nowrap";
const FIJA = "sticky left-0 z-10 bg-superficie";

/**
 * Crecimiento declarado, implícito y tendencia (ficha 14, §4.8): SIEMPRE de la proyección entera (no se recorta). Una fila por género × mundo, el
 * Resto y el Total. El semáforo va en texto y usa la tendencia corregida del Niño; en los GM con corrección se ven las dos cifras. Si el Resto no
 * tiene crecimiento aplicado, dice «sin dato».
 */
export function CrecimientosGm({ tablero }: { tablero: TableroApi }) {
  const y = tablero.proyeccion.anio_en_curso;
  const y1 = tablero.proyeccion.anio_siguiente;
  const ene = rangoMeses(1, tablero.datos.k_prima);
  const anteriorNino = tablero.datos.anios_nino.includes(y - 1);

  const columnas: Columna<CrecimientoGMApi>[] = [
    {
      clave: "gm",
      titulo: "Género × mundo",
      className: `${FIJA} min-w-40`,
      render: (c) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="whitespace-nowrap">{c.nombre}</span>
          {c.con_nino && <Badge tono="marca">Niño</Badge>}
          {c.anomalias.map((a) => (
            <Badge key={a} tono={a === "sin_base" ? "alerta" : "neutro"}>
              {ETIQUETA_ANOMALIA[a]}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      clave: "declarado",
      titulo: "Declarado",
      className: "min-w-44",
      render: (c) => {
        const version = textoVersion(c);
        return (
          <div>
            <p className={c.declarado_pct === null ? "text-tinta-suave" : "font-medium"}>{textoDeclarado(c, y)}</p>
            {version && <p className="text-xs text-tinta-suave">{version}</p>}
            {c.nota && <p className="text-xs text-tinta-suave">Nota: {c.nota}</p>}
          </div>
        );
      },
    },
    { clave: "base", titulo: `Base ${y1} (real)`, className: NUM, render: (c) => unidades(c.base_real) },
    { clave: "corregida", titulo: "Base corregida", className: NUM, render: (c) => (c.con_nino ? unidades(c.base_corregida) : "—") },
    { clave: "siguiente", titulo: `${y1} mismas tiendas`, className: NUM, render: (c) => unidades(c.siguiente_mismas) },
    { clave: "implicito", titulo: "Implícito", className: "min-w-44", render: (c) => <span className={c.implicito_sobre_real_pct === null && c.implicito_sobre_corregida_pct === null ? "text-tinta-suave" : undefined}>{textoImplicito(c)}</span> },
    {
      clave: "tendencia",
      titulo: `Tendencia mismas tiendas (${ene})`,
      className: "min-w-48",
      render: (c) => (c.gm_clave === GM_CLAVE_TOTAL && c.tendencia_mismas_pct === null ? <span className="text-tinta-suave">{TEXTO_SIN_DATO}</span> : textoTendencia(c, anteriorNino)),
    },
    {
      clave: "semaforo",
      titulo: "Lectura",
      className: "min-w-52",
      render: (c) => <Badge tono={TONO_SEMAFORO[c.semaforo]}>{textoSemaforo(c)}</Badge>,
    },
  ];

  return (
    <Card
      titulo="Crecimiento declarado, implícito y tendencia"
      descripcion={`De la proyección entera (no cambia con los filtros). Tendencia: ${ene} de ${y} frente a ${ene} de ${y - 1} en las mismas tiendas de ${y}.`}
    >
      <DataTable columnas={columnas} filas={tablero.crecimientos} claveFila={(c) => c.gm_clave} claseFila={(c) => (c.gm_clave === GM_CLAVE_TOTAL ? "bg-neutro-suave/60 font-semibold" : undefined)} vacio="Sin crecimientos por género × mundo." />
      <p className="mt-2 text-xs leading-relaxed text-tinta-suave">
        «Implícito»: lo proyectado para {y1} en las mismas tiendas frente a su base. La lectura compara declarado e implícito en la base del declarado, y el declarado con la tendencia de venta corregida del
        Niño (en los género × mundo con corrección se muestran las dos cifras).
      </p>
    </Card>
  );
}
