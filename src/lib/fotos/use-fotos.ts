"use client";

import { useCallback, useRef, useState } from "react";
import { api, codigoDeError } from "@/lib/api-client";
import { ErrorFoto, prepararFoto } from "@/components/fotos/comprimir";
import { avisoSobrantes, cupoDeFotos, seleccionarArchivos } from "./cliente";
import type { FotoLineaApi, RespuestaTraerFotosApi } from "./tipos-api";

/**
 * Las fotos de UNA línea de compra en la pantalla (08c, §4.3 y §11.P1): reduce en el navegador, sube de una en una al route handler
 * (`POST …/lineas/[lineaId]/fotos`, multipart), quita y trae las de la versión cancelada. Sin cola local ni escritura sin conexión
 * (10-pwa): una foto que falla queda a la vista con su mensaje y [Reintentar] mientras la pantalla siga abierta. Nunca habla con Supabase:
 * todo pasa por `api`. El estado de las fotos se inicializa de `fotosServidor` y se vuelve a alinear cuando la compra se relee.
 */

export type SubidaEnCurso = {
  clave: string;
  nombre: string;
  archivo: File;
  estado: "preparando" | "subiendo" | "error";
  mensaje: string | null;
};

const urlFotos = (compraId: string, lineaId: string) => `/api/compras/${compraId}/lineas/${lineaId}/fotos`;

let contador = 0;
const nuevaClave = () => `subida-${Date.now()}-${(contador += 1)}`;

function mensajeDe(e: unknown): string {
  if (e instanceof ErrorFoto) return e.message;
  if (e instanceof Error) return e.message;
  return "No pudimos subir la foto. Inténtalo de nuevo.";
}

export function useFotosLinea({ compraId, lineaId, fotosServidor }: { compraId: string; lineaId: string; fotosServidor: readonly FotoLineaApi[] }) {
  const [fotos, setFotos] = useState<FotoLineaApi[]>([...fotosServidor]);
  const [subidas, setSubidas] = useState<SubidaEnCurso[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const cola = useRef<Promise<void>>(Promise.resolve());

  // Alinea con lo que trajo el servidor cuando la compra se relee (ajuste de estado durante el render, el patrón de React para esto).
  const firmaServidor = fotosServidor.map((f) => f.id).join(",");
  const [firmaVista, setFirmaVista] = useState(firmaServidor);
  if (firmaVista !== firmaServidor) {
    setFirmaVista(firmaServidor);
    setFotos([...fotosServidor]);
  }

  const marcar = useCallback((clave: string, cambio: Partial<SubidaEnCurso>) => {
    setSubidas((previas) => previas.map((s) => (s.clave === clave ? { ...s, ...cambio } : s)));
  }, []);

  const subirUna = useCallback(
    async (entrada: SubidaEnCurso) => {
      marcar(entrada.clave, { estado: "preparando", mensaje: null });
      try {
        const preparada = await prepararFoto(entrada.archivo);
        marcar(entrada.clave, { estado: "subiendo" });
        const cuerpo = new FormData();
        cuerpo.append("foto", preparada.foto, "foto.jpg");
        cuerpo.append("miniatura", preparada.miniatura, "miniatura.jpg");
        const creada = await api.subir<FotoLineaApi>(urlFotos(compraId, lineaId), cuerpo);
        setFotos((previas) => (previas.some((f) => f.id === creada.id) ? previas : [...previas, creada]));
        setSubidas((previas) => previas.filter((s) => s.clave !== entrada.clave));
      } catch (e) {
        marcar(entrada.clave, { estado: "error", mensaje: mensajeDe(e) });
      }
    },
    [compraId, lineaId, marcar],
  );

  const encolar = useCallback(
    (entrada: SubidaEnCurso) => {
      cola.current = cola.current.then(() => subirUna(entrada));
    },
    [subirUna],
  );

  /** Las que ya están elegidas y siguen en la cola o subiéndose (las fallidas no ocupan cupo: se pueden descartar). */
  const pendientes = subidas.filter((s) => s.estado !== "error").length;
  const cupo = cupoDeFotos(fotos.length, pendientes);

  const agregar = useCallback(
    (elegidos: File[]) => {
      setError(null);
      setAviso(null);
      const { aceptados, sobrantes, rechazados } = seleccionarArchivos(elegidos, cupo);
      const mensajes = [...rechazados.map((r) => `${r.archivo.name || "Archivo"}: ${r.motivo}`), avisoSobrantes(sobrantes, cupo)].filter((m): m is string => Boolean(m));
      if (mensajes.length > 0) setError(mensajes.join(" "));
      const entradas = aceptados.map<SubidaEnCurso>((archivo) => ({ clave: nuevaClave(), nombre: archivo.name || "foto", archivo, estado: "preparando", mensaje: null }));
      if (entradas.length === 0) return;
      setSubidas((previas) => [...previas, ...entradas]);
      for (const e of entradas) encolar(e);
    },
    [cupo, encolar],
  );

  const reintentar = useCallback(
    (clave: string) => {
      const entrada = subidas.find((s) => s.clave === clave);
      if (!entrada || entrada.estado !== "error") return;
      setError(null);
      encolar({ ...entrada, estado: "preparando", mensaje: null });
    },
    [subidas, encolar],
  );

  const descartar = useCallback((clave: string) => setSubidas((previas) => previas.filter((s) => s.clave !== clave)), []);

  const quitar = useCallback(
    async (fotoId: string): Promise<boolean> => {
      setError(null);
      setAviso(null);
      setTrabajando(true);
      try {
        await api.delete<{ id: string }>(`${urlFotos(compraId, lineaId)}/${fotoId}`);
        setFotos((previas) => previas.filter((f) => f.id !== fotoId));
        return true;
      } catch (e) {
        // `ya_quitada`: alguien más la quitó; para esta pantalla da igual, ya no está.
        if (codigoDeError(e) === "ya_quitada") {
          setFotos((previas) => previas.filter((f) => f.id !== fotoId));
          setAviso("Esa foto ya estaba quitada.");
        } else {
          setError(mensajeDe(e));
        }
        return false;
      } finally {
        setTrabajando(false);
      }
    },
    [compraId, lineaId],
  );

  const traer = useCallback(async (): Promise<void> => {
    setError(null);
    setAviso(null);
    setTrabajando(true);
    try {
      const r = await api.post<RespuestaTraerFotosApi>(`${urlFotos(compraId, lineaId)}/traer`, {});
      setFotos((previas) => [...previas, ...r.traidas.filter((t) => !previas.some((f) => f.id === t.id))]);
      setAviso(
        r.traidas.length > 0
          ? `Se ${r.traidas.length === 1 ? "trajo 1 foto" : `trajeron ${r.traidas.length} fotos`} de la versión cancelada.`
          : "No había fotos nuevas por traer: las de la versión cancelada ya estaban en esta línea.",
      );
    } catch (e) {
      // Sin versión cancelada con fotos no es una falla: se explica en tono informativo.
      if (codigoDeError(e) === "sin_origen") setAviso("Esta línea no tiene fotos en una versión cancelada para traer.");
      else setError(mensajeDe(e));
    } finally {
      setTrabajando(false);
    }
  }, [compraId, lineaId]);

  return {
    fotos,
    subidas,
    cupo,
    ocupado: trabajando || pendientes > 0,
    error,
    aviso,
    limpiarError: () => setError(null),
    limpiarAviso: () => setAviso(null),
    agregar,
    reintentar,
    descartar,
    quitar,
    traer,
  };
}
