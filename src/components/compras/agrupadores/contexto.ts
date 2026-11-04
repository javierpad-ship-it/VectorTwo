import type { Rol } from "@/lib/auth/roles";
import type { OpcionesAgrupadoresApi, RespuestaViajesApi } from "@/lib/compras/agrupadores/tipos-api";
import type { MensajeAgrupador } from "./detalle-embarque";
import type { ParametrosAgrupadores } from "./vista-agrupadores";

/**
 * Lo que el panel principal de `/compras/agrupadores` comparte con cada pestaña: quién es la persona, los parámetros de la URL y cómo
 * cambiarlos, las listas que se leen una sola vez (viajes y opciones), el viaje activo y el aviso de la última acción.
 */
export type ContextoAgrupadores = {
  rol: Rol;
  perfilId: string;
  parametros: ParametrosAgrupadores;
  /** Cambia filtros sin añadir una entrada al historial del navegador. */
  cambiar: (c: Partial<ParametrosAgrupadores>) => void;
  /** Cambia de pestaña o abre un detalle (añade una entrada al historial). */
  navegar: (c: Partial<ParametrosAgrupadores>) => void;
  /** La URL de la pantalla con esos cambios. */
  href: (c: Partial<ParametrosAgrupadores>) => string;
  viajes: RespuestaViajesApi | null;
  opciones: OpcionesAgrupadoresApi | null;
  /** El viaje activo que se aplica: un `uuid`, `todos` o `sin_viaje`. */
  viajeActivo: string;
  viajeActivoListo: boolean;
  usarComoViajeActivo: (viajeId: string) => Promise<void>;
  viajeActivoOcupado: boolean;
  /** Relee los viajes y las opciones (códigos, selectores) tras una escritura. */
  recargarBase: () => Promise<void>;
  setMensaje: (m: MensajeAgrupador | null) => void;
};
