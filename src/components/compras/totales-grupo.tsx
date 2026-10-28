"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { imi, unidades } from "./formato";
import { ETIQUETA_NIVEL_GRUPO, NIVELES_GRUPO, totalesPorGrupo, type FilaDeLista, type GrupoTotales, type NivelGrupo } from "./vista-flujo";

/** Grupos que se pintan de una vez en «Por línea», que puede tener un centenar. */
const PAGINA = 12;

/**
 * Totales por género, mundo o línea (ficha 08 §4.3) de las filas que la lista trae con los filtros del servidor. No pide nada más a la
 * API: suma el resumen de cada fila. Dentro de `DataTable`, que desplaza en horizontal en el celular.
 */
export function TotalesGrupo({ filas, rango, meses }: { filas: readonly FilaDeLista[]; rango: { imi_min: number; imi_max: number }; meses: number }) {
  const [nivel, setNivel] = useState<NivelGrupo>("genero");
  const [limite, setLimite] = useState<{ nivel: NivelGrupo; n: number }>({ nivel: "genero", n: PAGINA });
  const grupos = totalesPorGrupo(filas, nivel);
  const n = limite.nivel === nivel ? limite.n : PAGINA;
  const items: ChipItem<NivelGrupo>[] = NIVELES_GRUPO.map((id) => ({ id, label: ETIQUETA_NIVEL_GRUPO[id] }));

  const columnas: Columna<GrupoTotales>[] = [
    { clave: "grupo", titulo: "Grupo", render: (g) => <span className="block min-w-40 font-medium">{g.nombre}</span> },
    { clave: "filas", titulo: "Filas", className: "text-right", render: (g) => <span className="font-mono tabular-nums">{unidades(g.filas)}</span> },
    {
      clave: "stock",
      titulo: "Stock cadena",
      className: "text-right",
      render: (g) => (
        <span className="inline-flex flex-col items-end leading-tight">
          <span className="font-mono tabular-nums">{unidades(g.stock)}</span>
          <span className="text-[11px] text-tinta-suave">CD {unidades(g.stockCd)}</span>
        </span>
      ),
    },
    {
      clave: "imi",
      titulo: "IMI",
      className: "text-right",
      render: (g) => {
        const fuera = g.imi !== null && (g.imi < rango.imi_min || g.imi > rango.imi_max);
        return <span className={`font-mono tabular-nums ${fuera ? "font-semibold text-alerta" : ""}`}>{imi(g.imi)}</span>;
      },
    },
    { clave: "saldo", titulo: `Saldo ${meses} m`, className: "text-right", render: (g) => <span className="font-mono tabular-nums">{unidades(g.saldo)}</span> },
    { clave: "camino", titulo: "En camino", className: "text-right", render: (g) => <span className="font-mono tabular-nums">{unidades(g.enCamino)}</span> },
    { clave: "falta", titulo: "En falta", className: "text-right", render: (g) => <span className={`font-mono tabular-nums ${g.enFalta > 0 ? "text-alerta" : "text-tinta-suave"}`}>{g.enFalta}</span> },
    { clave: "exceso", titulo: "En exceso", className: "text-right", render: (g) => <span className={`font-mono tabular-nums ${g.enExceso > 0 ? "text-marca-oscura" : "text-tinta-suave"}`}>{g.enExceso}</span> },
    {
      clave: "confirmar",
      titulo: "Por confirmar",
      className: "text-right",
      render: (g) => (g.porConfirmar > 0 ? <span className="font-mono tabular-nums text-alerta">{unidades(g.porConfirmar)}</span> : <span className="text-tinta-suave">—</span>),
    },
  ];

  return (
    <Card
      titulo="Totales por género, mundo y línea"
      descripcion="Suma las filas que trae la lista con los filtros de arriba (no la búsqueda por texto). El IMI deja fuera las filas sin curva y se calcula con la venta promedio de cada fila: puede diferir en décimas del total general."
    >
      <div className="space-y-3">
        <Chips etiqueta="Agrupar totales" items={items} activo={nivel} onCambiar={setNivel} />
        <DataTable columnas={columnas} filas={grupos.slice(0, n)} claveFila={(g) => g.clave} vacio="No hay filas para totalizar." />
        {grupos.length > n && (
          <div className="flex justify-center">
            <Button variante="secundario" tamano="sm" onClick={() => setLimite({ nivel, n: n + PAGINA * 4 })}>
              Mostrar más ({grupos.length - n} restantes)
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
