"use client";

import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Input } from "@/components/ui/form";
import { descargarCsv } from "@/components/importador/csv";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { formatearNumero, mensajeError, plural } from "@/lib/formato";
import { ETIQUETAS_MOTIVO } from "@/lib/ventas/tipos";
import { COMODIN_EQUIVALENCIA, type EstadoMapeo, type MapeoApi } from "@/lib/ventas/tipos-mapeo";
import { apiMapeos } from "./api-mapeos";
import { formatearFechaHora } from "./comunes";
import { EditarMapeo, NuevoMapeo } from "./formularios-mapeo";
import { ImportarMapeos } from "./importar-mapeos";
import { textoOrigen } from "./origenes-mapeo";
import type { useMapeos } from "./use-mapeos";

type Filtro = "todos" | EstadoMapeo;

const ETIQUETA_ESTADO: Record<EstadoMapeo, string> = {
  vigente: "Vigente",
  inactivo: "Inactivo",
  obsoleto: "Obsoleto: ya existe en el árbol",
  destino_inactivo: "Destino desactivado",
};

const EXPLICACION_ESTADO: Record<EstadoMapeo, string> = {
  vigente: "Se aplica cuando el árbol no resuelve el origen.",
  inactivo: "Pausado: no se aplica, pero se conserva.",
  obsoleto: "El origen ya resuelve en el árbol, así que el mapeo no se aplica. Puedes eliminarlo.",
  destino_inactivo: "El destino está desactivado en el árbol: no se aplica y las filas vuelven a su error. Cambia el destino o reactívalo en el árbol.",
};

function BadgeEstado({ estado }: { estado: EstadoMapeo }) {
  const tono = estado === "vigente" ? "exito" : estado === "destino_inactivo" ? "alerta" : "neutro";
  return (
    <span title={EXPLICACION_ESTADO[estado]}>
      <Badge tono={tono}>{ETIQUETA_ESTADO[estado]}</Badge>
    </span>
  );
}

/** El destino es "GML" cuando la equivalencia es la genérica o se llama como la línea; si no, "GMLE". */
function esDestinoGml(m: MapeoApi): boolean {
  return m.destino.es_generica || normalizarNombre(m.destino.equivalencia) === normalizarNombre(m.destino.linea);
}

const textoDestinoMapeo = (m: MapeoApi) => `${m.destino.genero} / ${m.destino.mundo} / ${m.destino.linea} / ${m.destino.equivalencia}`;

function descargarMapeos(mapeos: MapeoApi[]) {
  const campos = [
    "ORIGEN_GENERO",
    "ORIGEN_MUNDO",
    "ORIGEN_LINEA",
    "ORIGEN_EQUIVALENCIA",
    "DESTINO_GENERO",
    "DESTINO_MUNDO",
    "DESTINO_LINEA",
    "DESTINO_EQUIVALENCIA",
    "NOTA",
    "ESTADO",
  ];
  const datos = mapeos.map((m) => [
    m.origen.genero,
    m.origen.mundo,
    m.origen.linea,
    m.origen.equivalencia,
    m.destino.genero,
    m.destino.mundo,
    m.destino.linea,
    m.destino.equivalencia,
    m.nota ?? "",
    m.estado,
  ]);
  descargarCsv(campos, datos, "mapeos-combinaciones.csv");
}

/**
 * Pestaña Mapeos (ficha M5b): lista con búsqueda y estado, edición (destino,
 * nota, activo), borrado, importador de mapeos desde archivo, descarga en CSV y
 * alta a mano. Cambiar o borrar un mapeo NO modifica los meses ya publicados:
 * hay que recargar el mes.
 */
export function MapeosTab({ mapeos: m }: { mapeos: ReturnType<typeof useMapeos> }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [consulta, setConsulta] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ mapeo: MapeoApi; modo: "destino" | "nota" } | null>(null);
  const [creando, setCreando] = useState(false);
  const [importando, setImportando] = useState(false);

  const lista = useMemo(() => m.datos?.mapeos ?? [], [m.datos]);
  const resumen = m.datos?.resumen;
  const total = lista.length;

  const visibles = useMemo(() => {
    const palabras = consulta.split(/\s+/).map(aCodigo).filter(Boolean);
    return lista.filter((x) => {
      if (filtro !== "todos" && x.estado !== filtro) return false;
      if (palabras.length === 0) return true;
      const pajar = aCodigo(`${textoOrigen(x.origen)} ${x.origen.equivalencia === COMODIN_EQUIVALENCIA ? "comodin" : ""} ${textoDestinoMapeo(x)} ${x.nota ?? ""}`);
      return palabras.every((p) => pajar.includes(p));
    });
  }, [lista, filtro, consulta]);

  const chips: ChipItem<Filtro>[] = [
    { id: "todos", label: "Todos", conteo: total },
    { id: "vigente", label: "Vigentes", conteo: resumen?.vigente ?? 0 },
    { id: "inactivo", label: "Inactivos", conteo: resumen?.inactivo ?? 0 },
    { id: "obsoleto", label: "Obsoletos", conteo: resumen?.obsoleto ?? 0 },
    { id: "destino_inactivo", label: "Destino desactivado", conteo: resumen?.destino_inactivo ?? 0 },
  ];

  async function accion(clave: string, fn: () => Promise<string>) {
    setOcupado(clave);
    setError(null);
    setAviso(null);
    try {
      setAviso(await fn());
      await m.recargar();
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupado(null);
    }
  }

  function alternarActivo(x: MapeoApi) {
    const activar = !x.activo;
    void accion(`activo-${x.id}`, async () => {
      await apiMapeos.editar(x.id, { activo: activar });
      return activar
        ? "Mapeo reactivado. Se aplicará en las próximas lecturas; los meses ya publicados no cambian hasta recargarlos."
        : "Mapeo desactivado. Deja de aplicarse en las próximas lecturas; los meses ya publicados no cambian hasta recargarlos.";
    });
  }

  function eliminar(x: MapeoApi) {
    const ok = confirm(
      `¿Eliminar el mapeo ${textoOrigen(x.origen)} → ${textoDestinoMapeo(x)}?\n\nNo cambia los meses ya cargados; para que deje de aplicarse en ellos, recarga el mes.`
    );
    if (!ok) return;
    void accion(`eliminar-${x.id}`, async () => {
      await apiMapeos.eliminar(x.id);
      return "Mapeo eliminado. Los meses ya cargados no cambian: para que dejen de aplicarlo, recarga el mes.";
    });
  }

  function terminarEdicion(texto: string) {
    setEditando(null);
    setCreando(false);
    setAviso(texto);
    setError(null);
    void m.recargar();
  }

  const columnas: Columna<MapeoApi>[] = [
    {
      clave: "origen",
      titulo: "Origen (del archivo)",
      render: (x) => (
        <div>
          <span className="break-words font-medium">{textoOrigen(x.origen)}</span>
          {x.origen.equivalencia === COMODIN_EQUIVALENCIA && (
            <div className="mt-0.5">
              <Badge tono="marca">Comodín de terna</Badge>
            </div>
          )}
        </div>
      ),
    },
    {
      clave: "destino",
      titulo: "Destino",
      render: (x) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="break-words">{textoDestinoMapeo(x)}</span>
          <Badge tono={esDestinoGml(x) ? "marca" : "neutro"}>{esDestinoGml(x) ? "GML" : "GMLE"}</Badge>
        </div>
      ),
    },
    {
      clave: "motivo",
      titulo: "Motivo de origen",
      render: (x) => <span className="text-xs text-tinta-suave">{x.motivo_origen ? ETIQUETAS_MOTIVO[x.motivo_origen] : "—"}</span>,
    },
    { clave: "nota", titulo: "Nota", render: (x) => (x.nota ? <span className="break-words text-xs">{x.nota}</span> : <span className="text-tinta-suave">—</span>) },
    { clave: "estado", titulo: "Estado", render: (x) => <BadgeEstado estado={x.estado} /> },
    {
      clave: "quien",
      titulo: "Quién y cuándo",
      render: (x) => (
        <div className="text-xs">
          {x.usuario_nombre ?? "—"}
          <div className="whitespace-nowrap text-tinta-suave">{formatearFechaHora(x.updated_at)}</div>
        </div>
      ),
    },
    {
      clave: "acciones",
      titulo: "",
      render: (x) => {
        const quieto = ocupado !== null;
        const nombre = textoOrigen(x.origen);
        return (
          <span className="flex flex-wrap gap-1">
            <Button variante="secundario" tamano="sm" disabled={quieto} onClick={() => setEditando({ mapeo: x, modo: "destino" })} aria-label={`Cambiar el destino de ${nombre}`}>
              Cambiar destino
            </Button>
            <Button variante="fantasma" tamano="sm" disabled={quieto} onClick={() => setEditando({ mapeo: x, modo: "nota" })} aria-label={`Editar la nota de ${nombre}`}>
              Editar nota
            </Button>
            <Button variante="fantasma" tamano="sm" disabled={quieto} onClick={() => alternarActivo(x)} aria-label={`${x.activo ? "Desactivar" : "Reactivar"} el mapeo de ${nombre}`}>
              {ocupado === `activo-${x.id}` ? "Guardando…" : x.activo ? "Desactivar" : "Reactivar"}
            </Button>
            <Button variante="peligro" tamano="sm" disabled={quieto} onClick={() => eliminar(x)} aria-label={`Eliminar el mapeo de ${nombre}`}>
              {ocupado === `eliminar-${x.id}` ? "Eliminando…" : "Eliminar"}
            </Button>
          </span>
        );
      },
    },
  ];

  const cabecera = resumen
    ? `${plural(total, "mapeo", "mapeos")} · ${resumen.vigente} vigentes · ${resumen.obsoleto} obsoletos · ${resumen.destino_inactivo} con destino desactivado · ${resumen.inactivo} inactivos`
    : "Mapeos de combinaciones";

  return (
    <div className="space-y-4">
      {(m.error || error) && (
        <Alert
          onCerrar={() => {
            m.setError(null);
            setError(null);
          }}
        >
          {error ?? `No se pudieron cargar los mapeos: ${m.error}`}
        </Alert>
      )}
      {aviso && (
        <Alert tono="exito" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}

      <Alert tono="info">
        Un mapeo manda una combinación del histórico (género / mundo / línea / equivalencia) que ya no existe en el árbol a una equivalencia vigente, solo cuando el árbol no la resuelve.{" "}
        <strong>Cambiar o borrar un mapeo no modifica los meses ya publicados:</strong> para que un mes lo refleje hay que recargarlo.
      </Alert>

      <Card
        titulo={cabecera}
        acciones={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variante="secundario" tamano="sm" onClick={() => descargarMapeos(lista)} disabled={total === 0}>
              Descargar CSV
            </Button>
            <Button variante="secundario" tamano="sm" onClick={() => setImportando((v) => !v)} aria-expanded={importando}>
              {importando ? "Cerrar el importador" : "Importar"}
            </Button>
            <Button tamano="sm" onClick={() => setCreando(true)}>
              Nuevo mapeo
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Chips items={chips} activo={filtro} onCambiar={setFiltro} etiqueta="Filtrar mapeos por estado" />
          <Field label="Buscar" className="max-w-md">
            <Input type="search" value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder="Origen, destino o nota (sin tildes está bien)" />
          </Field>
          <DataTable
            columnas={columnas}
            filas={visibles}
            claveFila={(x) => x.id}
            cargando={m.cargando && lista.length === 0}
            vacio={total === 0 ? "Todavía no hay mapeos. Se crean desde el reporte previo (botón Asignar), importando un archivo o con «Nuevo mapeo»." : "Ningún mapeo coincide con el filtro o la búsqueda."}
            claseFila={(x) => (x.estado === "destino_inactivo" ? "bg-alerta-suave/40" : x.estado === "vigente" ? "hover:bg-fondo/60" : "bg-neutro-suave/50")}
          />
          {visibles.length !== total && total > 0 && (
            <p className="text-xs text-tinta-suave">
              Se muestran {formatearNumero(visibles.length)} de {formatearNumero(total)} mapeos. «Descargar CSV» baja todos.
            </p>
          )}
          <p className="text-xs text-tinta-suave">
            Obsoleto: el origen ya existe en el árbol y el mapeo no se aplica. Destino desactivado: la equivalencia de destino (o su línea, mundo o género) se desactivó. Desactivar pausa el mapeo sin borrarlo.
          </p>
        </div>
      </Card>

      {importando && <ImportarMapeos onAplicado={() => { setImportando(false); void m.recargar(); }} />}

      {editando && (
        <EditarMapeo
          key={`${editando.mapeo.id}-${editando.modo}`}
          mapeo={editando.mapeo}
          modo={editando.modo}
          onCerrar={() => setEditando(null)}
          onGuardado={() => terminarEdicion(editando.modo === "destino" ? "Destino cambiado. Los meses ya publicados no cambian hasta recargarlos." : "Nota guardada.")}
        />
      )}
      {creando && <NuevoMapeo onCerrar={() => setCreando(false)} onGuardado={() => terminarEdicion("Mapeo creado. Se aplicará en las próximas lecturas; los meses ya publicados no cambian hasta recargarlos.")} />}
    </div>
  );
}
