"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { descargarCsv } from "@/components/importador/csv";
import { formatearNumero, mensajeError, plural } from "@/lib/formato";
import { useArbol } from "@/lib/arbol/use-arbol";
import type { AgrupacionMarcaFila } from "@/lib/marcas/tipos-api";
import { useGmlEspecial } from "@/components/marcas/use-gml-especial";
import { aplanarNodos, cambioMarcaDe, ETIQUETA_DESTINO, marcasQueRequierenDestino, textoCambioMarca } from "@/components/marcas/comunes-m2b";
import {
  ETIQUETA_MOTIVO_IGNORADA,
  ETIQUETA_MOTIVO_NO_PERMITIDO_GML,
  type ArbolConNivel,
  type AsignarGmlCuerpo,
  type AsignarGmlRespuesta,
  type EstadoGmlEspecial,
  type MarcaConGml,
  type ModalidadDestino,
} from "@/components/marcas/tipos-m2b";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { GmlPorMarca } from "./gml-por-marca";
import { GmlPorGml } from "./gml-por-gml";
import { GmlSugerencias } from "./gml-sugerencias";
import { DestinoModalidadDialogo } from "./destino-modalidad-dialogo";

type Vista = "marca" | "gml" | "sugerencias";

export type FocoGml = { marcaId: string | null; nodoId: string | null };

/** Lo que las tres vistas necesitan para escribir: una sola puerta, un solo `Alert` de resultado. */
export type OperacionesGml = {
  /** Confirma (si hace falta), manda el bloque y recarga. Devuelve `true` si se aplicó. */
  asignar: (cuerpo: AsignarGmlCuerpo, marcasObjetivo: MarcaConGml[], opciones?: { siempreConfirmar?: boolean }) => Promise<boolean>;
  /** Cualquier otra escritura (nota, quitar una, modalidad): bloquea, muestra el error y recarga. */
  mutar: (accion: () => Promise<unknown>) => Promise<boolean>;
  ocupado: boolean;
  /** Resultado de una operación que no pasa por `asignar`. */
  avisar: (mensaje: string) => void;
};

function textoEstado(g: EstadoGmlEspecial["marcas"][number]["gml"][number]): string {
  if (g.vigente) return "Vigente";
  if (g.motivo_ignorada === "gml_no_vigente") return `Ignorada: ${g.detalle ?? ETIQUETA_MOTIVO_IGNORADA.gml_no_vigente}`;
  return `Ignorada: ${g.motivo_ignorada ? ETIQUETA_MOTIVO_IGNORADA[g.motivo_ignorada] : "sin motivo"}`;
}

/**
 * Pestaña "Marcas relevantes por GML" (admin y planner): las 3 o 4 marcas que
 * se ven aparte dentro de cada GML. Tres vistas (Por marca · Por GML ·
 * Sugerencias) sobre `GET /api/marcas/gml-especial` y el árbol; toda escritura
 * pasa por `POST /api/marcas/gml-especial/asignar` (o el PATCH/DELETE de una
 * asignación) y se recarga entera. Nada se aplica sin que el planner lo elija.
 */
export function GmlTab({
  marcas,
  agrupaciones,
  mostrarInactivos,
  foco,
  onCambio,
  onIrAConjuntos,
}: {
  marcas: MarcaConGml[];
  agrupaciones: AgrupacionMarcaFila[];
  mostrarInactivos: boolean;
  foco: FocoGml;
  /** Recarga marcas y agrupaciones del panel (la casilla y la modalidad pueden haber cambiado). */
  onCambio: () => Promise<void>;
  onIrAConjuntos: (cabezaId: string) => void;
}) {
  const gml = useGmlEspecial(mostrarInactivos);
  const arbolHook = useArbol(false);
  const arbol = arbolHook.arbol as ArbolConNivel | null;
  const nodos = useMemo(() => aplanarNodos(arbol), [arbol]);

  const [vista, setVista] = useState<Vista>(foco.nodoId && !foco.marcaId ? "gml" : "marca");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ tono: "exito" | "info"; contenido: React.ReactNode } | null>(null);
  /** M12: la pregunta «¿Por GML o Mixta?» pendiente; `resolver(null)` la cancela. */
  const [pregunta, setPregunta] = useState<{ marcas: MarcaConGml[]; resolver: (destino: ModalidadDestino | null) => void } | null>(null);

  const estado = gml.datos;
  const resumen = estado?.resumen;

  async function recargar() {
    await Promise.all([gml.recargar(), onCambio()]);
  }

  async function mutar(accion: () => Promise<unknown>): Promise<boolean> {
    setOcupado(true);
    setError(null);
    setResultado(null);
    try {
      await accion();
      await recargar();
      return true;
    } catch (e) {
      setError(mensajeError(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  /** Pregunta a qué modalidad pasan las marcas al barrer al recibir su primer GML (I3); `null` si se cancela. */
  function pedirDestino(marcasPreguntar: MarcaConGml[]): Promise<ModalidadDestino | null> {
    return new Promise((resolver) => setPregunta({ marcas: marcasPreguntar, resolver }));
  }

  async function asignar(cuerpoInicial: AsignarGmlCuerpo, marcasObjetivo: MarcaConGml[], opciones?: { siempreConfirmar?: boolean }): Promise<boolean> {
    let cuerpo = cuerpoInicial;
    // M12 (I3): una marca al barrer no pasa a Por GML sin preguntar; la API lo exige con `modalidad_destino`.
    const preguntar = cuerpo.accion === "asignar" ? marcasQueRequierenDestino(marcasObjetivo) : [];
    if (preguntar.length > 0) {
      const destino = await pedirDestino(preguntar);
      if (destino === null) return false;
      cuerpo = { ...cuerpo, modalidad_destino: destino };
    }
    const idsPreguntadas = new Set(preguntar.map((m) => m.id));
    const pares = cuerpo.forma === "cartesiano" ? cuerpo.marca_ids.length * cuerpo.nodo_ids.length : cuerpo.pares.length;
    const marcasPares = marcasObjetivo.length;
    if (cuerpo.accion === "asignar") {
      // Las que ya se preguntaron (al barrer) no vuelven a pedir confirmación por el cambio de modalidad.
      const cambios = marcasObjetivo.flatMap((m) => {
        const de = cambioMarcaDe(m);
        return de && !idsPreguntadas.has(m.id) ? [textoCambioMarca(m.nombre, de)] : [];
      });
      if (pares > 1 || cambios.length > 0 || opciones?.siempreConfirmar) {
        const partes = [
          `¿Hacer relevantes ${plural(pares, "par marca-GML", "pares marca-GML")}` +
            (cuerpo.forma === "cartesiano" ? ` (${cuerpo.marca_ids.length} marcas × ${cuerpo.nodo_ids.length} GML)` : marcasPares > 0 ? ` (${plural(marcasPares, "marca", "marcas")})` : "") +
            "?",
        ];
        if (cambios.length > 0) partes.push(...cambios.map((c) => `· ${c}`));
        if (!confirm(partes.join("\n"))) return false;
      }
    } else if (!confirm(`¿Quitar ${plural(pares, "par marca-GML", "pares marca-GML")}? Las marcas conservan su modalidad (si se quedan sin GML quedan pendientes).`)) {
      return false;
    }
    let respuesta: AsignarGmlRespuesta | null = null;
    const ok = await mutar(async () => {
      respuesta = await api.post<AsignarGmlRespuesta>("/api/marcas/gml-especial/asignar", cuerpo);
    });
    const r = respuesta as AsignarGmlRespuesta | null;
    if (ok && r) {
      const partes = [
        r.accion === "asignar"
          ? `${plural(r.asignadas, "asignación creada", "asignaciones creadas")}`
          : `${plural(r.quitadas, "asignación quitada", "asignaciones quitadas")}`,
        `${formatearNumero(r.sin_cambio)} sin cambio`,
      ];
      setResultado({
        tono: r.no_permitidas.length > 0 ? "info" : "exito",
        contenido: (
          <>
            <span>{partes.join(" · ")} (de {formatearNumero(r.pares)} pares).</span>
            {r.cambios_marca.length > 0 && (
              <span className="mt-1 block">
                Cambios de marca: {r.cambios_marca.map((c) => `${c.marca} (${c.de === "sin_tratamiento" ? "se marcó" : c.de === "barrido" ? "de Al barrer" : "sin modalidad"} → ${ETIQUETA_DESTINO[c.a]})`).join("; ")}.
              </span>
            )}
            {r.no_permitidas.length > 0 && (
              <span className="mt-1 block">
                No permitidas ({r.no_permitidas.length}):{" "}
                {r.no_permitidas
                  .slice(0, 12)
                  .map((n) => `${n.marca} en ${n.ruta} (${ETIQUETA_MOTIVO_NO_PERMITIDO_GML[n.motivo as keyof typeof ETIQUETA_MOTIVO_NO_PERMITIDO_GML] ?? n.motivo})`)
                  .join("; ")}
                {r.no_permitidas.length > 12 ? `; y ${r.no_permitidas.length - 12} más` : ""}.
              </span>
            )}
          </>
        ),
      });
    }
    return ok;
  }

  const ops: OperacionesGml = {
    asignar,
    mutar,
    ocupado,
    avisar: (mensaje) => setResultado({ tono: "exito", contenido: mensaje }),
  };

  function descargarRelevantes() {
    if (!estado) return;
    const filas: string[][] = [];
    for (const m of estado.marcas) {
      for (const g of m.gml) filas.push([m.nombre, g.genero, g.mundo, g.linea, g.nota ?? "", textoEstado(g)]);
    }
    descargarCsv(["MARCA", "GENERO", "MUNDO", "LINEA", "NOTA", "ESTADO"], filas, "marcas-relevantes-por-gml.csv");
  }

  const chipsVista: ChipItem<Vista>[] = [
    { id: "marca", label: "Por marca", conteo: estado?.marcas.length },
    { id: "gml", label: "Por GML", conteo: estado?.por_nodo.length },
    { id: "sugerencias", label: "Sugerencias" },
  ];

  return (
    <div className="space-y-4">
      {gml.error && (
        <Alert onCerrar={() => gml.setError(null)}>
          No se pudieron cargar las marcas relevantes: {gml.error}{" "}
          <button type="button" onClick={() => void gml.recargar()} className="font-medium underline underline-offset-2">
            Reintentar
          </button>
        </Alert>
      )}
      {arbolHook.error && (
        <Alert onCerrar={() => arbolHook.setError(null)}>
          No se pudo cargar el árbol de producto: {arbolHook.error}{" "}
          <button type="button" onClick={() => void arbolHook.recargar()} className="font-medium underline underline-offset-2">
            Reintentar
          </button>
        </Alert>
      )}
      {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
      {resultado && (
        <Alert tono={resultado.tono} onCerrar={() => setResultado(null)}>
          {resultado.contenido}
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips items={chipsVista} activo={vista} onCambiar={setVista} etiqueta="Vista de marcas relevantes" />
        <Button variante="secundario" tamano="sm" onClick={descargarRelevantes} disabled={!estado || estado.resumen.asignaciones === 0}>
          Descargar relevantes (CSV)
        </Button>
      </div>

      {resumen && (
        <p className="text-sm text-tinta-suave">
          {plural(resumen.marcadas, "marca", "marcas")} con tratamiento ({resumen.por_gml} por GML · {resumen.mixta} mixtas · {resumen.barrido} al barrer
          {resumen.sin_modalidad > 0 ? ` · ${resumen.sin_modalidad} sin modalidad` : ""}) · {formatearNumero(resumen.asignaciones_vigentes)} GML relevantes vigentes
          {resumen.asignaciones_ignoradas > 0 ? ` y ${formatearNumero(resumen.asignaciones_ignoradas)} ignorados` : ""} en{" "}
          {plural(resumen.nodos_con_relevantes, "GML", "GML")}
          {resumen.pendientes_sin_gml > 0 && <span className="text-alerta"> · {plural(resumen.pendientes_sin_gml, "pendiente", "pendientes")} sin GML</span>}
          {resumen.nodos_con_mas_de_4_por_agrupacion > 0 && (
            <span className="text-alerta">
              {" "}
              · {plural(resumen.nodos_con_mas_de_4_por_agrupacion, "GML tiene", "GML tienen")} más de 4 relevantes en una agrupación (aviso, no bloquea)
            </span>
          )}
          {(gml.cargando || arbolHook.cargando) && <span className="ml-2 italic">Actualizando…</span>}
        </p>
      )}
      {!estado && gml.cargando && <p className="text-sm text-tinta-suave">Cargando…</p>}

      {vista === "marca" && (
        <GmlPorMarca
          estado={estado}
          marcas={marcas}
          nodos={nodos}
          ops={ops}
          marcaInicial={foco.marcaId}
          onIrAConjuntos={onIrAConjuntos}
        />
      )}
      {vista === "gml" && <GmlPorGml estado={estado} marcas={marcas} nodos={nodos} agrupaciones={agrupaciones} ops={ops} nodoInicial={foco.nodoId} />}
      {vista === "sugerencias" && <GmlSugerencias marcas={marcas} agrupaciones={agrupaciones} ops={ops} />}
      {pregunta && (
        <DestinoModalidadDialogo
          marcas={pregunta.marcas}
          onElegir={(destino) => {
            pregunta.resolver(destino);
            setPregunta(null);
          }}
        />
      )}
    </div>
  );
}
