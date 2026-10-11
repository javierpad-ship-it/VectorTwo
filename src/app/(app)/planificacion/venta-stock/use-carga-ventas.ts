"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { mensajeError } from "@/lib/formato";
import { detectarMapeo, mapeoCompleto as mapeoEstaCompleto, mapeoVacio } from "@/components/importador/mapeo";
import type { Mapeo } from "@/components/importador/tipos";
import { Acumulador } from "@/lib/ventas/acumulador";
import { cargarMeses, type EventoCarga } from "@/lib/ventas/cargar-meses";
import { apiVentas } from "@/lib/ventas/cliente-api";
import { crearPeticionPrevisualizar } from "@/lib/ventas/previsualizar";
import { CAMPOS_ARCHIVO_VENTA } from "@/lib/ventas/columnas";
import { construirInforme, marcasSinId, sustituirMarcasNuevas, type ResultadoInforme } from "@/lib/ventas/informe";
import { interpretarFila } from "@/lib/ventas/interpretar";
import {
  crearProyector,
  detectarCodificacion,
  leerCabecera,
  leerPorBloques,
  type Cabecera,
  type Codificacion,
  type Deteccion,
  type Progreso,
  type Separador,
} from "@/lib/ventas/leer-por-bloques";
import { FILAS_EXCEL_MAX, type CampoVenta, type Consolidado, type MedidaVenta } from "@/lib/ventas/tipos";
import type { PrevisualizarRespuesta } from "@/lib/ventas/tipos-api";
import { ETIQUETA_SALTO, informeConQlik, planificarCarga, tandasDeUnMes, totalesQlikPorMes, type OpcionesPlan, type TextosQlik } from "./plan";

export type EstadoMesAvance = "pendiente" | "cargando" | "publicado" | "saltado" | "error" | "cancelado";

export type AvanceMes = {
  periodo: string;
  estado: EstadoMesAvance;
  detalle: string;
  tandas: number;
  tandasHechas: number;
  filas: number;
};

export type Avance = {
  meses: AvanceMes[];
  /** Cargando ahora (hay un mes en marcha). */
  activo: boolean;
  cancelando: boolean;
  cancelado: boolean;
  inicio: number;
  /** Último instante en que se actualizó (para el tiempo transcurrido). */
  ahora: number;
  /** Mensaje de un fallo que impidió empezar (marcas nuevas). */
  error: string | null;
};

/** Informe más lo que hace falta para cargar y para reproducir el reporte guardado. */
export type Previsualizacion = {
  firma: string;
  resultado: ResultadoInforme;
  respuesta: PrevisualizarRespuesta;
  archivoNombre: string;
  codificacion: Codificacion | null;
  separador: Separador | null;
  /** Hoja `.xls` de exactamente 65 536 filas. */
  posiblementeTruncado: boolean;
  leidoEn: number;
};

type Lectura = { activa: boolean; progreso: Progreso | null; fase: "leyendo" | "resolviendo" | "armando" | null };

const SIN_LECTURA: Lectura = { activa: false, progreso: null, fase: null };

/** Nombres de las marcas que `marcas-nuevas` debe crear (las del informe). */
function nombresMarcasNuevas(r: ResultadoInforme): string[] {
  return r.informe.marcas_nuevas.map((m) => m.nombre);
}

/**
 * Estado y acciones de la pestaña Cargar (ficha M5, "Pantallas"): archivo →
 * mapeo → lectura por bloques → previsualización y reporte → carga mes a mes
 * con avance. El archivo se lee en el navegador; las filas crudas no se
 * conservan (solo el acumulador, que se descarta al terminar el reporte).
 *
 * El estado solo se toca dentro de handlers y promesas (react-hooks/set-state-in-effect).
 */
export function useCargaVentas({ onPublicado }: { onPublicado: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [cabecera, setCabecera] = useState<Cabecera | null>(null);
  const [deteccion, setDeteccion] = useState<Deteccion | null>(null);
  const [codificacion, setCodificacion] = useState<Codificacion | null>(null);
  const [separador, setSeparador] = useState<Separador | null>(null);
  const [hoja, setHoja] = useState<string | null>(null);
  const [mapeo, setMapeo] = useState<Mapeo<CampoVenta>>(() => mapeoVacio(CAMPOS_ARCHIVO_VENTA));
  const [leyendoCabecera, setLeyendoCabecera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lectura, setLectura] = useState<Lectura>(SIN_LECTURA);
  const [prev, setPrev] = useState<Previsualizacion | null>(null);
  const [textosQlik, setTextosQlik] = useState<TextosQlik>({});
  const [opciones, setOpciones] = useState<OpcionesPlan>({ saltarIdenticos: true, forzarBloqueados: false });
  const [agrupacionMarcaId, setAgrupacionMarcaId] = useState<string>("");
  const [avance, setAvance] = useState<Avance | null>(null);

  const abortar = useRef<AbortController | null>(null);
  const abortarCarga = useRef<AbortController | null>(null);
  /** Consolidado ya con los ids de las marcas nuevas (sirve para reintentar sin volver a crearlas). */
  const consolidadoListo = useRef<Consolidado | null>(null);
  const secuenciaCabecera = useRef(0);
  /** Totales de QlikView vigentes (los handlers de carga leen el último valor, no el de su cierre). */
  const textosQlikRef = useRef<TextosQlik>({});

  const completo = mapeoEstaCompleto(mapeo, CAMPOS_ARCHIVO_VENTA);
  const firmaActual = archivo
    ? `${archivo.name}|${archivo.size}|${archivo.lastModified}|${hoja ?? ""}|${separador ?? ""}|${codificacion ?? ""}|${JSON.stringify(mapeo)}`
    : "";
  /** La previsualización solo sirve para cargar si corresponde al archivo, hoja, separador, codificación y mapeo actuales. */
  const prevVigente = prev !== null && prev.firma === firmaActual ? prev : null;
  const leyendo = lectura.activa;
  const cargando = avance?.activo === true;

  const totalesQlik = useMemo(() => totalesQlikPorMes(textosQlik), [textosQlik]);
  const informe = useMemo(() => (prevVigente ? informeConQlik(prevVigente.resultado.informe, totalesQlik) : null), [prevVigente, totalesQlik]);

  useEffect(() => {
    textosQlikRef.current = textosQlik;
  }, [textosQlik]);

  /** Aviso del navegador si se intenta cerrar la pestaña con una carga en marcha. */
  useEffect(() => {
    if (!cargando) return;
    const alSalir = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [cargando]);

  // ─── Archivo y cabecera ───

  /** Lee la cabecera con la codificación, el separador y la hoja pedidos (o los detectados) y autodetecta el mapeo. */
  async function leerLaCabecera(f: File, o: { codificacion?: Codificacion; separador?: Separador; hoja?: string }, nuevoArchivo: boolean) {
    const numero = ++secuenciaCabecera.current;
    setLeyendoCabecera(true);
    setError(null);
    try {
      let cod = o.codificacion;
      if (!/\.xlsx?$/i.test(f.name) && nuevoArchivo) {
        const det = await detectarCodificacion(f);
        if (numero !== secuenciaCabecera.current) return;
        setDeteccion(det);
        cod = det.codificacion;
      }
      const cab = await leerCabecera(f, { codificacion: cod, separador: o.separador, hoja: o.hoja });
      if (numero !== secuenciaCabecera.current) return;
      if (cab.columnas.length === 0) {
        setCabecera(null);
        setError(cab.hojas.length > 1 ? `La hoja «${cab.hoja}» no tiene cabecera o está vacía. Prueba con otra hoja.` : "El archivo no tiene cabecera o está vacío.");
        return;
      }
      setCabecera(cab);
      setCodificacion(cab.codificacion);
      setSeparador(cab.separador);
      setHoja(cab.hoja);
      setMapeo(detectarMapeo(cab.columnas, CAMPOS_ARCHIVO_VENTA));
    } catch (e) {
      if (numero !== secuenciaCabecera.current) return;
      setCabecera(null);
      setError(`No se pudo leer el archivo: ${mensajeError(e)}`);
    } finally {
      if (numero === secuenciaCabecera.current) setLeyendoCabecera(false);
    }
  }

  function reiniciarResultados() {
    setPrev(null);
    setTextosQlik({});
    setAvance(null);
    consolidadoListo.current = null;
  }

  function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || leyendo || cargando) return;
    setArchivo(f);
    setCabecera(null);
    setDeteccion(null);
    setCodificacion(null);
    setSeparador(null);
    setHoja(null);
    setMapeo(mapeoVacio(CAMPOS_ARCHIVO_VENTA));
    reiniciarResultados();
    void leerLaCabecera(f, {}, true);
  }

  function cambiarCodificacion(c: Codificacion) {
    if (!archivo || leyendo) return;
    setCodificacion(c);
    reiniciarResultados();
    void leerLaCabecera(archivo, { codificacion: c, separador: separador ?? undefined }, false);
  }

  function cambiarSeparador(s: Separador) {
    if (!archivo || leyendo) return;
    setSeparador(s);
    reiniciarResultados();
    void leerLaCabecera(archivo, { codificacion: codificacion ?? undefined, separador: s }, false);
  }

  function cambiarHoja(h: string) {
    if (!archivo || leyendo) return;
    setHoja(h);
    reiniciarResultados();
    void leerLaCabecera(archivo, { hoja: h }, false);
  }

  const excelDemasiadoGrande = cabecera?.filasHoja != null && cabecera.filasHoja > FILAS_EXCEL_MAX;

  // ─── Lectura y previsualización ───

  async function leerYPrevisualizar() {
    if (!archivo || !cabecera || !completo || leyendo || cargando || excelDemasiadoGrande) return;
    setError(null);
    reiniciarResultados();
    const controlador = new AbortController();
    abortar.current = controlador;
    setLectura({ activa: true, progreso: null, fase: "leyendo" });
    const firma = firmaActual;
    const acum = new Acumulador();
    let proyectar: ReturnType<typeof crearProyector> | null = null;
    try {
      const res = await leerPorBloques(archivo, {
        separador: separador ?? undefined,
        codificacion: codificacion ?? undefined,
        hoja: hoja ?? undefined,
        signal: controlador.signal,
        alProgreso: (p) => setLectura({ activa: true, progreso: p, fase: "leyendo" }),
        alBloque: (b) => {
          proyectar ??= crearProyector(b.columnas, mapeo);
          for (let i = 0; i < b.filas.length; i++) acum.agregar(interpretarFila(proyectar(b.filas[i])), b.primeraFila + i);
        },
      });
      if (res.cancelado) {
        setLectura(SIN_LECTURA);
        return;
      }
      setLectura({ activa: true, progreso: { fraccion: 1, bytesLeidos: archivo.size, bytesTotales: archivo.size, filas: res.filas }, fase: "resolviendo" });
      const respuesta = await apiVentas.previsualizar(crearPeticionPrevisualizar(acum));
      setLectura((l) => ({ ...l, fase: "armando" }));
      await new Promise<void>((r) => setTimeout(r, 0)); // deja pintar el estado antes del cálculo (síncrono)
      const resultado = construirInforme({ acumulador: acum, resoluciones: respuesta, posiblementeTruncado: res.posiblementeTruncado });
      setPrev({
        firma,
        resultado,
        respuesta,
        archivoNombre: archivo.name,
        codificacion: res.codificacion,
        separador: res.separador,
        posiblementeTruncado: res.posiblementeTruncado,
        leidoEn: Date.now(),
      });
      setAgrupacionMarcaId(respuesta.agrupacion_defecto_id ?? "");
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      abortar.current = null;
      setLectura(SIN_LECTURA);
    }
  }

  function cancelarLectura() {
    abortar.current?.abort();
  }

  function setTotalQlik(periodo: string, medida: MedidaVenta, texto: string) {
    setTextosQlik((t) => ({ ...t, [periodo]: { ...t[periodo], [medida]: texto } }));
  }

  // ─── Carga mes a mes ───

  /** Traduce un evento de `cargarMeses` al estado de la tabla de avance. */
  function aplicarEvento(e: EventoCarga, p: Previsualizacion) {
    const mes = p.resultado.informe.meses.find((m) => m.periodo === e.periodo);
    setAvance((a) => {
      if (!a) return a;
      const meses = a.meses.map((m): AvanceMes => {
        if (m.periodo !== e.periodo) return m;
        switch (e.estado) {
          case "cargando": {
            const tandas = e.tandas ?? m.tandas;
            const tanda = e.tanda ?? 0;
            return {
              ...m,
              estado: "cargando",
              tandas,
              tandasHechas: Math.max(0, tanda - 1),
              detalle: tanda === 0 ? "Abriendo la carga…" : `Enviando la tanda ${tanda} de ${tandas}…`,
            };
          }
          case "publicado":
            return {
              ...m,
              estado: "publicado",
              tandasHechas: m.tandas,
              detalle: mes?.bloqueado
                ? "Publicado como Incompleto (errores forzados)."
                : mes && mes.estado !== "nuevo"
                  ? "Publicado: reemplazó la carga anterior."
                  : "Publicado.",
            };
          case "cancelado":
            return { ...m, estado: "cancelado", detalle: "Cancelado: la carga en curso se descartó y el mes anterior sigue intacto." };
          case "error":
            return { ...m, estado: "error", detalle: e.mensaje ?? "Error al cargar el mes." };
          case "saltado":
            return { ...m, estado: "saltado", detalle: e.mensaje ?? "Saltado." };
          default:
            return m;
        }
      });
      return { ...a, meses, ahora: Date.now() };
    });
  }

  /** Carga los meses pedidos de uno en uno (publica cada uno al terminar) y refresca "Cargas por mes". */
  async function ejecutar(periodos: string[], p: Previsualizacion) {
    const consolidado = consolidadoListo.current;
    if (!consolidado) return;
    const controlador = new AbortController();
    abortarCarga.current = controlador;
    setAvance((a) =>
      a
        ? {
            ...a,
            activo: true,
            cancelando: false,
            cancelado: false,
            error: null,
            ahora: Date.now(),
            meses: a.meses.map((m) => (periodos.includes(m.periodo) ? { ...m, estado: "pendiente", detalle: "En espera.", tandasHechas: 0 } : m)),
          }
        : a
    );
    try {
      await cargarMeses({
        api: apiVentas,
        informe: p.resultado.informe,
        consolidado,
        periodos,
        archivoNombre: p.archivoNombre,
        codificacion: p.codificacion ?? undefined,
        separador: p.separador ?? undefined,
        totalesQlik: totalesQlikPorMes(textosQlikRef.current),
        alEvento: (e) => aplicarEvento(e, p),
        signal: controlador.signal,
        // El plan ya decidió qué meses van; aquí solo se levanta el bloqueo si el usuario lo pidió.
        opciones: { forzarIncompleto: opciones.forzarBloqueados, saltarIdenticos: false },
      });
    } finally {
      abortarCarga.current = null;
      setAvance((a) => (a ? { ...a, activo: false, cancelando: false, cancelado: controlador.signal.aborted, ahora: Date.now() } : a));
      onPublicado();
    }
  }

  /** Marcas nuevas → `marcas-nuevas` (una vez) y consolidado con ids; después carga cada mes. */
  async function cargar(confirmarTexto: (plan: ReturnType<typeof planificarCarga>) => string) {
    const p = prevVigente;
    if (!p || cargando || leyendo) return;
    const plan = planificarCarga(p.resultado.informe, opciones);
    if (plan.cargar.length === 0) return;
    if (!confirm(confirmarTexto(plan))) return;
    setError(null);

    const meses: AvanceMes[] = p.resultado.informe.meses.map((m) => {
      const salto = plan.saltados.find((s) => s.mes.periodo === m.periodo);
      const tandas = salto ? 0 : tandasDeUnMes(m);
      return {
        periodo: m.periodo,
        estado: salto ? "saltado" : "pendiente",
        detalle: salto ? ETIQUETA_SALTO[salto.motivo] + "." : "En espera.",
        tandas,
        tandasHechas: 0,
        filas: m.cargado.filas,
      };
    });
    setAvance({ meses, activo: true, cancelando: false, cancelado: false, inicio: Date.now(), ahora: Date.now(), error: null });

    try {
      let consolidado = p.resultado.consolidado;
      const nuevas = nombresMarcasNuevas(p.resultado);
      if (nuevas.length > 0 && marcasSinId(consolidado).length > 0) {
        if (!agrupacionMarcaId) throw new Error("Elige la agrupación en la que se crearán las marcas nuevas.");
        const r = await apiVentas.marcasNuevas({ nombres: nuevas, agrupacion_marca_id: agrupacionMarcaId });
        consolidado = sustituirMarcasNuevas(consolidado, r.ids);
        const faltan = marcasSinId(consolidado);
        if (faltan.length > 0) throw new Error(`No se pudieron crear ${faltan.length} marcas nuevas (por ejemplo ${faltan[0]}). Nada se cargó.`);
      }
      consolidadoListo.current = consolidado;
    } catch (e) {
      setAvance((a) => (a ? { ...a, activo: false, error: mensajeError(e) } : a));
      return;
    }
    await ejecutar(
      plan.cargar.map((m) => m.periodo),
      p
    );
  }

  function cancelarLaCarga() {
    abortarCarga.current?.abort();
    setAvance((a) => (a ? { ...a, cancelando: true } : a));
  }

  async function reintentarConError() {
    const p = prev;
    if (!p || !avance || avance.activo) return;
    const periodos = avance.meses.filter((m) => m.estado === "error").map((m) => m.periodo);
    if (periodos.length === 0) return;
    await ejecutar(periodos, p);
  }

  return {
    archivo,
    cabecera,
    deteccion,
    codificacion,
    separador,
    hoja,
    mapeo,
    setMapeo,
    mapeoCompleto: completo,
    leyendoCabecera,
    excelDemasiadoGrande,
    error,
    setError,
    lectura,
    leyendo,
    prev,
    prevVigente,
    informe,
    textosQlik,
    totalesQlik,
    opciones,
    setOpciones,
    agrupacionMarcaId,
    setAgrupacionMarcaId,
    avance,
    cargando,
    elegirArchivo,
    cambiarCodificacion,
    cambiarSeparador,
    cambiarHoja,
    leerYPrevisualizar,
    cancelarLectura,
    setTotalQlik,
    cargar,
    cancelarLaCarga,
    reintentarConError,
  };
}
