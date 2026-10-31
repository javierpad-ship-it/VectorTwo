/**
 * Tipos de la base de datos.
 *
 * Verificados el 2026-10-31 contra `generate_typescript_types` de `Vector2` (0030 M7 07e, propuesta de la IA, aplicada): 8 tablas
 * nuevas (`ia_evaluaciones`, `ia_configuraciones`, `ia_corridas`, `ia_corrida_gms`, `ia_entradas`, `ia_llamadas`, `ia_propuestas_gm`,
 * `ia_propuestas_filas`), `proyeccion_fila_anios.decision_ia_fila_id` (uuid null, FK a `ia_propuestas_filas`) y las funciones
 * `venta_lineas_ia` y `registrar_propuesta_ia_gm`. Neutral al proveedor: `proveedor` y `modelo` son `string` libres. El generador
 * ademas lista `prueba_conexion` (tabla de pruebas previa, no se usa) y ordena las columnas alfabeticamente: aqui solo cambian lo que
 * toca la 0030.
 *
 * Actualizados a mano el 2026-10-27 con la 0025 (M8 0.13.0: tablas `proveedores`, `compras`, `compra_lineas`, `compra_linea_entregas`,
 * `compra_linea_repartos`, `compra_linea_recepciones`, `compra_eventos` y `flujo_parametros`, y las funciones `stock_flujo`, `flujo_huella_base`,
 * `compra_foto`, `compra_recalcular_estado`, `importar_compra`, `registrar_recepciones`, `quitar_recepcion` y `cancelar_compra`). PENDIENTE: la 0025
 * aun no esta aplicada en `Vector2` (el `execute_sql` espero una confirmacion que no llego); al aplicarla hay que compararlos con
 * `generate_typescript_types`.
 *
 * Verificados el 2026-10-30 (0029 M6 06e: `crecimientos_genero_mundo.sobre_base` (text not null default 'bruta'),
 * `proyeccion_crecimientos.sobre_base` (text null) y seis columnas nuevas de `factores_volumen_atipico`: `formula`, `ratio_volumen`,
 * `ratio_control`, `huella_composicion`, `aplicado_huella` y `diagnostico`; `venta_genero_mundo` conserva firma `(p_desde) -> Json`).
 *
 * Verificados el 2026-10-27 (0027 M6 06d: tabla `crecimientos_genero_mundo`, `proyeccion_crecimientos.crecimiento_id` y
 * `.version`, y la funcion `venta_genero_mundo`; antes, 0024 M12: `repartos_marca_barrido.temporadas_usadas`; y 0023 M7 07c:
 * `proyeccion_crecimientos`, `proyeccion_fila_anios.base_siguiente` y `.base_normalizada`) contra
 * `generate_typescript_types` del proyecto Supabase `Vector2` (ref tzjsxzmsvvhxyiooihyq): mismas tablas, vistas, funciones,
 * columnas, obligatoriedad y claves foráneas. Se actualizan a mano (estilo de este archivo)
 * después de cada migración y se comparan con el generador.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      agrupacion_estacionalidad_genero: {
        Row: {
          agrupacion_estacionalidad_id: string;
          created_at: string;
          genero_id: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          agrupacion_estacionalidad_id: string;
          created_at?: string;
          genero_id: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          agrupacion_estacionalidad_id?: string;
          created_at?: string;
          genero_id?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agrupacion_estacionalidad_genero_agrupacion_id_fkey";
            columns: ["agrupacion_estacionalidad_id"];
            isOneToOne: false;
            referencedRelation: "agrupaciones_estacionalidad";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agrupacion_estacionalidad_genero_genero_id_fkey";
            columns: ["genero_id"];
            isOneToOne: false;
            referencedRelation: "generos";
            referencedColumns: ["id"];
          },
        ];
      };
      agrupaciones_estacionalidad: {
        Row: {
          activo: boolean;
          codigo: string;
          created_at: string;
          descripcion: string | null;
          id: string;
          nombre: string;
          orden: number;
          temporada: string;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          codigo: string;
          created_at?: string;
          descripcion?: string | null;
          id?: string;
          nombre: string;
          orden?: number;
          temporada?: string;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          codigo?: string;
          created_at?: string;
          descripcion?: string | null;
          id?: string;
          nombre?: string;
          orden?: number;
          temporada?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      agrupaciones_marca: {
        Row: {
          activo: boolean;
          codigo: string;
          created_at: string;
          id: string;
          nombre: string;
          orden: number;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          codigo: string;
          created_at?: string;
          id?: string;
          nombre: string;
          orden?: number;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          codigo?: string;
          created_at?: string;
          id?: string;
          nombre?: string;
          orden?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      agrupaciones_talla: {
        Row: {
          activo: boolean;
          codigo: string;
          created_at: string;
          id: string;
          nombre: string;
          orden: number;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          codigo: string;
          created_at?: string;
          id?: string;
          nombre: string;
          orden?: number;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          codigo?: string;
          created_at?: string;
          id?: string;
          nombre?: string;
          orden?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      cargas_venta_stock: {
        Row: {
          archivo_nombre: string | null;
          costo_vendido: number | null;
          created_at: string;
          estado: string;
          filas: number | null;
          id: string;
          limpiada_at: string | null;
          perfil_id: string | null;
          periodo: string;
          publicada_at: string | null;
          reporte: Json;
          stock_unidades: number | null;
          stock_valorizado: number | null;
          unidades: number | null;
          updated_at: string;
          usuario_nombre: string | null;
          venta_soles: number | null;
        };
        Insert: {
          archivo_nombre?: string | null;
          costo_vendido?: number | null;
          created_at?: string;
          estado?: string;
          filas?: number | null;
          id?: string;
          limpiada_at?: string | null;
          perfil_id?: string | null;
          periodo: string;
          publicada_at?: string | null;
          reporte?: Json;
          stock_unidades?: number | null;
          stock_valorizado?: number | null;
          unidades?: number | null;
          updated_at?: string;
          usuario_nombre?: string | null;
          venta_soles?: number | null;
        };
        Update: {
          archivo_nombre?: string | null;
          costo_vendido?: number | null;
          created_at?: string;
          estado?: string;
          filas?: number | null;
          id?: string;
          limpiada_at?: string | null;
          perfil_id?: string | null;
          periodo?: string;
          publicada_at?: string | null;
          reporte?: Json;
          stock_unidades?: number | null;
          stock_valorizado?: number | null;
          unidades?: number | null;
          updated_at?: string;
          usuario_nombre?: string | null;
          venta_soles?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "cargas_venta_stock_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      compra_eventos: {
        Row: {
          accion: string;
          antes: Json | null;
          compra_id: string;
          created_at: string;
          despues: Json | null;
          id: string;
          linea_id: string | null;
          motivo: string | null;
          perfil_id: string | null;
          resumen: string | null;
          usuario_nombre: string | null;
        };
        Insert: {
          accion: string;
          antes?: Json | null;
          compra_id: string;
          created_at?: string;
          despues?: Json | null;
          id?: string;
          linea_id?: string | null;
          motivo?: string | null;
          perfil_id?: string | null;
          resumen?: string | null;
          usuario_nombre?: string | null;
        };
        Update: {
          accion?: string;
          antes?: Json | null;
          compra_id?: string;
          created_at?: string;
          despues?: Json | null;
          id?: string;
          linea_id?: string | null;
          motivo?: string | null;
          perfil_id?: string | null;
          resumen?: string | null;
          usuario_nombre?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "compra_eventos_compra_id_fkey";
            columns: ["compra_id"];
            isOneToOne: false;
            referencedRelation: "compras";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compra_eventos_linea_id_fkey";
            columns: ["linea_id"];
            isOneToOne: false;
            referencedRelation: "compra_lineas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compra_eventos_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      compra_linea_entregas: {
        Row: {
          activo: boolean;
          created_at: string;
          id: string;
          linea_id: string;
          origen: string;
          periodo: string;
          unidades: number;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          id?: string;
          linea_id: string;
          origen?: string;
          periodo: string;
          unidades: number;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          id?: string;
          linea_id?: string;
          origen?: string;
          periodo?: string;
          unidades?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "compra_linea_entregas_linea_id_fkey";
            columns: ["linea_id"];
            isOneToOne: false;
            referencedRelation: "compra_lineas";
            referencedColumns: ["id"];
          },
        ];
      };
      compra_linea_recepciones: {
        Row: {
          activo: boolean;
          created_at: string;
          fecha_recepcion: string;
          id: string;
          linea_id: string;
          nota: string | null;
          origen: string;
          perfil_id: string | null;
          recibida_periodo: string;
          unidades: number;
          updated_at: string;
          usuario_nombre: string | null;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          fecha_recepcion: string;
          id?: string;
          linea_id: string;
          nota?: string | null;
          origen?: string;
          perfil_id?: string | null;
          recibida_periodo: string;
          unidades: number;
          updated_at?: string;
          usuario_nombre?: string | null;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          fecha_recepcion?: string;
          id?: string;
          linea_id?: string;
          nota?: string | null;
          origen?: string;
          perfil_id?: string | null;
          recibida_periodo?: string;
          unidades?: number;
          updated_at?: string;
          usuario_nombre?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "compra_linea_recepciones_linea_id_fkey";
            columns: ["linea_id"];
            isOneToOne: false;
            referencedRelation: "compra_lineas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compra_linea_recepciones_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      compra_linea_repartos: {
        Row: {
          activo: boolean;
          created_at: string;
          entrega_id: string;
          equivalencia_id: string | null;
          error_reparto_pp: number | null;
          genero_mundo_linea_id: string;
          id: string;
          linea_id: string;
          marca_id: string;
          reparto_id: string | null;
          reparto_version: number | null;
          temporada: string | null;
          unidades: number;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          entrega_id: string;
          equivalencia_id?: string | null;
          error_reparto_pp?: number | null;
          genero_mundo_linea_id: string;
          id?: string;
          linea_id: string;
          marca_id: string;
          reparto_id?: string | null;
          reparto_version?: number | null;
          temporada?: string | null;
          unidades: number;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          entrega_id?: string;
          equivalencia_id?: string | null;
          error_reparto_pp?: number | null;
          genero_mundo_linea_id?: string;
          id?: string;
          linea_id?: string;
          marca_id?: string;
          reparto_id?: string | null;
          reparto_version?: number | null;
          temporada?: string | null;
          unidades?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "compra_linea_repartos_entrega_id_fkey";
            columns: ["entrega_id"];
            isOneToOne: false;
            referencedRelation: "compra_linea_entregas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compra_linea_repartos_equivalencia_id_fkey";
            columns: ["equivalencia_id"];
            isOneToOne: false;
            referencedRelation: "equivalencias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compra_linea_repartos_genero_mundo_linea_id_fkey";
            columns: ["genero_mundo_linea_id"];
            isOneToOne: false;
            referencedRelation: "genero_mundo_linea";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compra_linea_repartos_linea_id_fkey";
            columns: ["linea_id"];
            isOneToOne: false;
            referencedRelation: "compra_lineas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compra_linea_repartos_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compra_linea_repartos_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas_unidad";
            referencedColumns: ["marca_id"];
          },
          {
            foreignKeyName: "compra_linea_repartos_reparto_id_fkey";
            columns: ["reparto_id"];
            isOneToOne: false;
            referencedRelation: "repartos_marca_barrido";
            referencedColumns: ["id"];
          },
        ];
      };
      compra_lineas: {
        Row: {
          activo: boolean;
          agrupacion_marca_id: string | null;
          alcance: Json;
          avisos: Json;
          clave_importacion: string | null;
          compra_id: string;
          costo_unitario: number | null;
          created_at: string;
          destino: string;
          equivalencia_id: string | null;
          genero_mundo_linea_id: string | null;
          huella_importacion: string | null;
          id: string;
          llegada_periodo: string;
          marca_id: string | null;
          nota: string | null;
          tallas: string;
          tienda_id: string | null;
          tipo: string;
          unidades: number;
          unidades_canceladas: number;
          unidades_recibidas: number;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          agrupacion_marca_id?: string | null;
          alcance?: Json;
          avisos?: Json;
          clave_importacion?: string | null;
          compra_id: string;
          costo_unitario?: number | null;
          created_at?: string;
          destino?: string;
          equivalencia_id?: string | null;
          genero_mundo_linea_id?: string | null;
          huella_importacion?: string | null;
          id?: string;
          llegada_periodo: string;
          marca_id?: string | null;
          nota?: string | null;
          tallas?: string;
          tienda_id?: string | null;
          tipo?: string;
          unidades: number;
          unidades_canceladas?: number;
          unidades_recibidas?: number;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          agrupacion_marca_id?: string | null;
          alcance?: Json;
          avisos?: Json;
          clave_importacion?: string | null;
          compra_id?: string;
          costo_unitario?: number | null;
          created_at?: string;
          destino?: string;
          equivalencia_id?: string | null;
          genero_mundo_linea_id?: string | null;
          huella_importacion?: string | null;
          id?: string;
          llegada_periodo?: string;
          marca_id?: string | null;
          nota?: string | null;
          tallas?: string;
          tienda_id?: string | null;
          tipo?: string;
          unidades?: number;
          unidades_canceladas?: number;
          unidades_recibidas?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "compra_lineas_agrupacion_marca_id_fkey";
            columns: ["agrupacion_marca_id"];
            isOneToOne: false;
            referencedRelation: "agrupaciones_marca";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compra_lineas_compra_id_fkey";
            columns: ["compra_id"];
            isOneToOne: false;
            referencedRelation: "compras";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compra_lineas_equivalencia_id_fkey";
            columns: ["equivalencia_id"];
            isOneToOne: false;
            referencedRelation: "equivalencias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compra_lineas_genero_mundo_linea_id_fkey";
            columns: ["genero_mundo_linea_id"];
            isOneToOne: false;
            referencedRelation: "genero_mundo_linea";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compra_lineas_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compra_lineas_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas_unidad";
            referencedColumns: ["marca_id"];
          },
          {
            foreignKeyName: "compra_lineas_tienda_id_fkey";
            columns: ["tienda_id"];
            isOneToOne: false;
            referencedRelation: "tiendas";
            referencedColumns: ["id"];
          },
        ];
      };
      compras: {
        Row: {
          activo: boolean;
          cancelada_at: string | null;
          cancelada_por_id: string | null;
          cancelada_por_nombre: string | null;
          confirmada_at: string | null;
          confirmada_por_id: string | null;
          confirmada_por_nombre: string | null;
          created_at: string;
          estado: string;
          excede_tope_al_confirmar: Json;
          fecha_compra: string;
          id: string;
          justificacion_exceso: string | null;
          moneda: string;
          motivo_cancelacion: string | null;
          nota: string | null;
          numero: string;
          origen: string;
          perfil_id: string | null;
          proveedor_id: string;
          referencia: string | null;
          revision: number;
          updated_at: string;
          updated_by_id: string | null;
          updated_by_nombre: string | null;
          usuario_nombre: string | null;
        };
        Insert: {
          activo?: boolean;
          cancelada_at?: string | null;
          cancelada_por_id?: string | null;
          cancelada_por_nombre?: string | null;
          confirmada_at?: string | null;
          confirmada_por_id?: string | null;
          confirmada_por_nombre?: string | null;
          created_at?: string;
          estado?: string;
          excede_tope_al_confirmar?: Json;
          fecha_compra: string;
          id?: string;
          justificacion_exceso?: string | null;
          moneda?: string;
          motivo_cancelacion?: string | null;
          nota?: string | null;
          numero?: string;
          origen?: string;
          perfil_id?: string | null;
          proveedor_id: string;
          referencia?: string | null;
          revision?: number;
          updated_at?: string;
          updated_by_id?: string | null;
          updated_by_nombre?: string | null;
          usuario_nombre?: string | null;
        };
        Update: {
          activo?: boolean;
          cancelada_at?: string | null;
          cancelada_por_id?: string | null;
          cancelada_por_nombre?: string | null;
          confirmada_at?: string | null;
          confirmada_por_id?: string | null;
          confirmada_por_nombre?: string | null;
          created_at?: string;
          estado?: string;
          excede_tope_al_confirmar?: Json;
          fecha_compra?: string;
          id?: string;
          justificacion_exceso?: string | null;
          moneda?: string;
          motivo_cancelacion?: string | null;
          nota?: string | null;
          numero?: string;
          origen?: string;
          perfil_id?: string | null;
          proveedor_id?: string;
          referencia?: string | null;
          revision?: number;
          updated_at?: string;
          updated_by_id?: string | null;
          updated_by_nombre?: string | null;
          usuario_nombre?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "compras_cancelada_por_id_fkey";
            columns: ["cancelada_por_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compras_confirmada_por_id_fkey";
            columns: ["confirmada_por_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compras_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compras_proveedor_id_fkey";
            columns: ["proveedor_id"];
            isOneToOne: false;
            referencedRelation: "proveedores";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "compras_updated_by_id_fkey";
            columns: ["updated_by_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      corridas_estacionalidad: {
        Row: {
          activo: boolean;
          agrupacion_estacionalidad_id: string | null;
          created_at: string;
          efecto_atipico: Json;
          hasta_periodo: string;
          id: string;
          parametros: Json;
          perfil_id: string | null;
          red_comparable: Json;
          referencia: boolean;
          resultado: Json;
          resumen: Json;
          updated_at: string;
          usuario_nombre: string | null;
        };
        Insert: {
          activo?: boolean;
          agrupacion_estacionalidad_id?: string | null;
          created_at?: string;
          efecto_atipico?: Json;
          hasta_periodo: string;
          id?: string;
          parametros: Json;
          perfil_id?: string | null;
          red_comparable?: Json;
          referencia?: boolean;
          resultado: Json;
          resumen: Json;
          updated_at?: string;
          usuario_nombre?: string | null;
        };
        Update: {
          activo?: boolean;
          agrupacion_estacionalidad_id?: string | null;
          created_at?: string;
          efecto_atipico?: Json;
          hasta_periodo?: string;
          id?: string;
          parametros?: Json;
          perfil_id?: string | null;
          red_comparable?: Json;
          referencia?: boolean;
          resultado?: Json;
          resumen?: Json;
          updated_at?: string;
          usuario_nombre?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "corridas_estacionalidad_agrupacion_fkey";
            columns: ["agrupacion_estacionalidad_id"];
            isOneToOne: false;
            referencedRelation: "agrupaciones_estacionalidad";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "corridas_estacionalidad_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      crecimientos_genero_mundo: {
        Row: {
          activo: boolean;
          alcance: string;
          anio_aplicacion: number;
          aprobada_at: string;
          base_tipo: string;
          base_valor: number | null;
          created_at: string;
          estado: string;
          genero_id: string | null;
          id: string;
          mundo_id: string | null;
          nota: string | null;
          pct: number;
          perfil_id: string | null;
          proyeccion_referencia_id: string | null;
          referencia: Json;
          sobre_base: string;
          updated_at: string;
          usuario_nombre: string | null;
          version: number;
        };
        Insert: {
          activo?: boolean;
          alcance: string;
          anio_aplicacion: number;
          aprobada_at?: string;
          base_tipo: string;
          base_valor?: number | null;
          created_at?: string;
          estado?: string;
          genero_id?: string | null;
          id?: string;
          mundo_id?: string | null;
          nota?: string | null;
          pct: number;
          perfil_id?: string | null;
          proyeccion_referencia_id?: string | null;
          referencia: Json;
          sobre_base?: string;
          updated_at?: string;
          usuario_nombre?: string | null;
          version: number;
        };
        Update: {
          activo?: boolean;
          alcance?: string;
          anio_aplicacion?: number;
          aprobada_at?: string;
          base_tipo?: string;
          base_valor?: number | null;
          created_at?: string;
          estado?: string;
          genero_id?: string | null;
          id?: string;
          mundo_id?: string | null;
          nota?: string | null;
          pct?: number;
          perfil_id?: string | null;
          proyeccion_referencia_id?: string | null;
          referencia?: Json;
          sobre_base?: string;
          updated_at?: string;
          usuario_nombre?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "crecimientos_genero_mundo_genero_id_fkey";
            columns: ["genero_id"];
            isOneToOne: false;
            referencedRelation: "generos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crecimientos_genero_mundo_mundo_id_fkey";
            columns: ["mundo_id"];
            isOneToOne: false;
            referencedRelation: "mundos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crecimientos_genero_mundo_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crecimientos_genero_mundo_proyeccion_referencia_id_fkey";
            columns: ["proyeccion_referencia_id"];
            isOneToOne: false;
            referencedRelation: "proyecciones";
            referencedColumns: ["id"];
          },
        ];
      };
      curvas_estacionalidad: {
        Row: {
          activo: boolean;
          agrupacion_estacionalidad_id: string;
          anios_utilizados: Json;
          aprobada_at: string;
          corrida_id: string;
          created_at: string;
          curva_manual: Json | null;
          eat: number | null;
          error_max: number | null;
          estado: string;
          id: string;
          medida: string;
          modelo: string;
          nota: string | null;
          origen: string;
          origen_curva: string;
          p01: number;
          p02: number;
          p03: number;
          p04: number;
          p05: number;
          p06: number;
          p07: number;
          p08: number;
          p09: number;
          p10: number;
          p11: number;
          p12: number;
          perfil_id: string | null;
          recomendada: boolean;
          updated_at: string;
          usuario_nombre: string | null;
          version: number;
        };
        Insert: {
          activo?: boolean;
          agrupacion_estacionalidad_id: string;
          anios_utilizados: Json;
          aprobada_at?: string;
          corrida_id: string;
          created_at?: string;
          curva_manual?: Json | null;
          eat?: number | null;
          error_max?: number | null;
          estado?: string;
          id?: string;
          medida: string;
          modelo: string;
          nota?: string | null;
          origen: string;
          origen_curva?: string;
          p01: number;
          p02: number;
          p03: number;
          p04: number;
          p05: number;
          p06: number;
          p07: number;
          p08: number;
          p09: number;
          p10: number;
          p11: number;
          p12: number;
          perfil_id?: string | null;
          recomendada: boolean;
          updated_at?: string;
          usuario_nombre?: string | null;
          version: number;
        };
        Update: {
          activo?: boolean;
          agrupacion_estacionalidad_id?: string;
          anios_utilizados?: Json;
          aprobada_at?: string;
          corrida_id?: string;
          created_at?: string;
          curva_manual?: Json | null;
          eat?: number | null;
          error_max?: number | null;
          estado?: string;
          id?: string;
          medida?: string;
          modelo?: string;
          nota?: string | null;
          origen?: string;
          origen_curva?: string;
          p01?: number;
          p02?: number;
          p03?: number;
          p04?: number;
          p05?: number;
          p06?: number;
          p07?: number;
          p08?: number;
          p09?: number;
          p10?: number;
          p11?: number;
          p12?: number;
          perfil_id?: string | null;
          recomendada?: boolean;
          updated_at?: string;
          usuario_nombre?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "curvas_estacionalidad_agrupacion_fkey";
            columns: ["agrupacion_estacionalidad_id"];
            isOneToOne: false;
            referencedRelation: "agrupaciones_estacionalidad";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "curvas_estacionalidad_corrida_id_fkey";
            columns: ["corrida_id"];
            isOneToOne: false;
            referencedRelation: "corridas_estacionalidad";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "curvas_estacionalidad_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      equivalencias: {
        Row: {
          activo: boolean;
          agrupacion_estacionalidad_id: string | null;
          codigo: string;
          created_at: string;
          es_generica: boolean;
          genero_mundo_linea_id: string;
          id: string;
          nombre: string;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          agrupacion_estacionalidad_id?: string | null;
          codigo: string;
          created_at?: string;
          es_generica?: boolean;
          genero_mundo_linea_id: string;
          id?: string;
          nombre: string;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          agrupacion_estacionalidad_id?: string | null;
          codigo?: string;
          created_at?: string;
          es_generica?: boolean;
          genero_mundo_linea_id?: string;
          id?: string;
          nombre?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "equivalencias_agrupacion_estacionalidad_id_fkey";
            columns: ["agrupacion_estacionalidad_id"];
            isOneToOne: false;
            referencedRelation: "agrupaciones_estacionalidad";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "equivalencias_genero_mundo_linea_id_fkey";
            columns: ["genero_mundo_linea_id"];
            isOneToOne: false;
            referencedRelation: "genero_mundo_linea";
            referencedColumns: ["id"];
          },
        ];
      };
      factores_volumen_atipico: {
        Row: {
          activo: boolean;
          anio: number;
          aplicado_huella: string | null;
          calculado_at: string | null;
          created_at: string;
          diagnostico: Json | null;
          formula: string | null;
          huella_cargas: string | null;
          huella_composicion: string | null;
          id: string;
          meses_comparados: number | null;
          nota: string | null;
          parcial: boolean;
          perfil_id: string | null;
          ratio_aplicado: number | null;
          ratio_calculado: number | null;
          ratio_control: number | null;
          ratio_volumen: number | null;
          temporada: string;
          tiendas_comunes: number | null;
          updated_at: string;
          usuario_nombre: string | null;
        };
        Insert: {
          activo?: boolean;
          anio: number;
          aplicado_huella?: string | null;
          calculado_at?: string | null;
          created_at?: string;
          diagnostico?: Json | null;
          formula?: string | null;
          huella_cargas?: string | null;
          huella_composicion?: string | null;
          id?: string;
          meses_comparados?: number | null;
          nota?: string | null;
          parcial?: boolean;
          perfil_id?: string | null;
          ratio_aplicado?: number | null;
          ratio_calculado?: number | null;
          ratio_control?: number | null;
          ratio_volumen?: number | null;
          temporada: string;
          tiendas_comunes?: number | null;
          updated_at?: string;
          usuario_nombre?: string | null;
        };
        Update: {
          activo?: boolean;
          anio?: number;
          aplicado_huella?: string | null;
          calculado_at?: string | null;
          created_at?: string;
          diagnostico?: Json | null;
          formula?: string | null;
          huella_cargas?: string | null;
          huella_composicion?: string | null;
          id?: string;
          meses_comparados?: number | null;
          nota?: string | null;
          parcial?: boolean;
          perfil_id?: string | null;
          ratio_aplicado?: number | null;
          ratio_calculado?: number | null;
          ratio_control?: number | null;
          ratio_volumen?: number | null;
          temporada?: string;
          tiendas_comunes?: number | null;
          updated_at?: string;
          usuario_nombre?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "factores_volumen_atipico_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      flujo_parametros: {
        Row: {
          activo: boolean;
          clave: string;
          created_at: string;
          extender_horizonte: boolean;
          id: string;
          imi_max: number;
          imi_min: number;
          meses_tarjeta: number;
          perfil_id: string | null;
          temporadas: Json;
          umbral_conciliacion_pct: number;
          umbral_conciliacion_u: number;
          updated_at: string;
          usuario_nombre: string | null;
        };
        Insert: {
          activo?: boolean;
          clave?: string;
          created_at?: string;
          extender_horizonte?: boolean;
          id?: string;
          imi_max?: number;
          imi_min?: number;
          meses_tarjeta?: number;
          perfil_id?: string | null;
          temporadas?: Json;
          umbral_conciliacion_pct?: number;
          umbral_conciliacion_u?: number;
          updated_at?: string;
          usuario_nombre?: string | null;
        };
        Update: {
          activo?: boolean;
          clave?: string;
          created_at?: string;
          extender_horizonte?: boolean;
          id?: string;
          imi_max?: number;
          imi_min?: number;
          meses_tarjeta?: number;
          perfil_id?: string | null;
          temporadas?: Json;
          umbral_conciliacion_pct?: number;
          umbral_conciliacion_u?: number;
          updated_at?: string;
          usuario_nombre?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "flujo_parametros_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      genero_mundo_linea: {
        Row: {
          activo: boolean;
          created_at: string;
          genero_id: string;
          id: string;
          linea_id: string;
          mundo_id: string;
          nivel_planificacion: string;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          genero_id: string;
          id?: string;
          linea_id: string;
          mundo_id: string;
          nivel_planificacion?: string;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          genero_id?: string;
          id?: string;
          linea_id?: string;
          mundo_id?: string;
          nivel_planificacion?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "genero_mundo_linea_genero_id_fkey";
            columns: ["genero_id"];
            isOneToOne: false;
            referencedRelation: "generos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "genero_mundo_linea_linea_id_fkey";
            columns: ["linea_id"];
            isOneToOne: false;
            referencedRelation: "lineas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "genero_mundo_linea_mundo_id_fkey";
            columns: ["mundo_id"];
            isOneToOne: false;
            referencedRelation: "mundos";
            referencedColumns: ["id"];
          },
        ];
      };
      generos: {
        Row: {
          activo: boolean;
          codigo: string;
          created_at: string;
          id: string;
          nombre: string;
          orden: number;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          codigo: string;
          created_at?: string;
          id?: string;
          nombre: string;
          orden?: number;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          codigo?: string;
          created_at?: string;
          id?: string;
          nombre?: string;
          orden?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      ia_configuraciones: {
        Row: {
          activo: boolean;
          aprobada_at: string;
          capacidades: string[];
          created_at: string;
          estado: string;
          evaluacion_id: string | null;
          id: string;
          incluir_cola_larga: boolean;
          max_filas_llamada: number;
          modelo: string;
          nota: string | null;
          perfil_id: string | null;
          precios: Json;
          presupuesto_razonamiento: number;
          proveedor: string;
          terminos_extra: string[];
          tope_usd_corrida: number;
          tope_usd_dia_usuario: number;
          tope_usd_mes: number;
          updated_at: string;
          usuario_nombre: string | null;
          version: number;
          version_prompt: string;
        };
        Insert: {
          activo?: boolean;
          aprobada_at?: string;
          capacidades?: string[];
          created_at?: string;
          estado?: string;
          evaluacion_id?: string | null;
          id?: string;
          incluir_cola_larga?: boolean;
          max_filas_llamada?: number;
          modelo: string;
          nota?: string | null;
          perfil_id?: string | null;
          precios: Json;
          presupuesto_razonamiento?: number;
          proveedor: string;
          terminos_extra?: string[];
          tope_usd_corrida?: number;
          tope_usd_dia_usuario?: number;
          tope_usd_mes?: number;
          updated_at?: string;
          usuario_nombre?: string | null;
          version: number;
          version_prompt: string;
        };
        Update: {
          activo?: boolean;
          aprobada_at?: string;
          capacidades?: string[];
          created_at?: string;
          estado?: string;
          evaluacion_id?: string | null;
          id?: string;
          incluir_cola_larga?: boolean;
          max_filas_llamada?: number;
          modelo?: string;
          nota?: string | null;
          perfil_id?: string | null;
          precios?: Json;
          presupuesto_razonamiento?: number;
          proveedor?: string;
          terminos_extra?: string[];
          tope_usd_corrida?: number;
          tope_usd_dia_usuario?: number;
          tope_usd_mes?: number;
          updated_at?: string;
          usuario_nombre?: string | null;
          version?: number;
          version_prompt?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ia_configuraciones_evaluacion_id_fkey";
            columns: ["evaluacion_id"];
            isOneToOne: false;
            referencedRelation: "ia_evaluaciones";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ia_configuraciones_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      ia_corrida_gms: {
        Row: {
          bloque_ids: string[];
          candado_desde: string | null;
          candado_token: string | null;
          corrida_id: string;
          created_at: string;
          error_codigo: string | null;
          estado: string;
          gm_clave: string;
          huella_gm: string | null;
          id: string;
          modo: string | null;
          parcial: Json;
          plan: Json | null;
          pliegue: string;
          propuesta_gm_id: string | null;
          referencia: Json | null;
          updated_at: string;
        };
        Insert: {
          bloque_ids?: string[];
          candado_desde?: string | null;
          candado_token?: string | null;
          corrida_id: string;
          created_at?: string;
          error_codigo?: string | null;
          estado?: string;
          gm_clave: string;
          huella_gm?: string | null;
          id?: string;
          modo?: string | null;
          parcial?: Json;
          plan?: Json | null;
          pliegue?: string;
          propuesta_gm_id?: string | null;
          referencia?: Json | null;
          updated_at?: string;
        };
        Update: {
          bloque_ids?: string[];
          candado_desde?: string | null;
          candado_token?: string | null;
          corrida_id?: string;
          created_at?: string;
          error_codigo?: string | null;
          estado?: string;
          gm_clave?: string;
          huella_gm?: string | null;
          id?: string;
          modo?: string | null;
          parcial?: Json;
          plan?: Json | null;
          pliegue?: string;
          propuesta_gm_id?: string | null;
          referencia?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ia_corrida_gms_corrida_id_fkey";
            columns: ["corrida_id"];
            isOneToOne: false;
            referencedRelation: "ia_corridas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ia_corrida_gms_propuesta_gm_id_fkey";
            columns: ["propuesta_gm_id"];
            isOneToOne: false;
            referencedRelation: "ia_propuestas_gm";
            referencedColumns: ["id"];
          },
        ];
      };
      ia_corridas: {
        Row: {
          activo: boolean;
          alcance: Json;
          anio_en_curso: number | null;
          calculado_at_proyeccion: string | null;
          configuracion_id: string | null;
          costo_estimado_usd: number;
          created_at: string;
          estado: string;
          evaluacion_id: string | null;
          id: string;
          iniciada_at: string;
          k: number | null;
          modelo: string;
          motivo_fin: string | null;
          perfil_id: string | null;
          proveedor: string;
          proyeccion_id: string | null;
          terminada_at: string | null;
          tipo: string;
          ultima_actividad_at: string;
          updated_at: string;
          usuario_nombre: string | null;
          version_prompt: string;
        };
        Insert: {
          activo?: boolean;
          alcance: Json;
          anio_en_curso?: number | null;
          calculado_at_proyeccion?: string | null;
          configuracion_id?: string | null;
          costo_estimado_usd: number;
          created_at?: string;
          estado?: string;
          evaluacion_id?: string | null;
          id?: string;
          iniciada_at?: string;
          k?: number | null;
          modelo: string;
          motivo_fin?: string | null;
          perfil_id?: string | null;
          proveedor: string;
          proyeccion_id?: string | null;
          terminada_at?: string | null;
          tipo: string;
          ultima_actividad_at?: string;
          updated_at?: string;
          usuario_nombre?: string | null;
          version_prompt: string;
        };
        Update: {
          activo?: boolean;
          alcance?: Json;
          anio_en_curso?: number | null;
          calculado_at_proyeccion?: string | null;
          configuracion_id?: string | null;
          costo_estimado_usd?: number;
          created_at?: string;
          estado?: string;
          evaluacion_id?: string | null;
          id?: string;
          iniciada_at?: string;
          k?: number | null;
          modelo?: string;
          motivo_fin?: string | null;
          perfil_id?: string | null;
          proveedor?: string;
          proyeccion_id?: string | null;
          terminada_at?: string | null;
          tipo?: string;
          ultima_actividad_at?: string;
          updated_at?: string;
          usuario_nombre?: string | null;
          version_prompt?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ia_corridas_configuracion_id_fkey";
            columns: ["configuracion_id"];
            isOneToOne: false;
            referencedRelation: "ia_configuraciones";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ia_corridas_evaluacion_id_fkey";
            columns: ["evaluacion_id"];
            isOneToOne: false;
            referencedRelation: "ia_evaluaciones";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ia_corridas_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ia_corridas_proyeccion_id_fkey";
            columns: ["proyeccion_id"];
            isOneToOne: false;
            referencedRelation: "proyecciones";
            referencedColumns: ["id"];
          },
        ];
      };
      ia_entradas: {
        Row: {
          bytes: number;
          contenido_gz: string;
          corrida_id: string;
          created_at: string;
          diccionario: Json;
          huella: string;
          id: string;
          tipo: string;
        };
        Insert: {
          bytes: number;
          contenido_gz: string;
          corrida_id: string;
          created_at?: string;
          diccionario: Json;
          huella: string;
          id?: string;
          tipo: string;
        };
        Update: {
          bytes?: number;
          contenido_gz?: string;
          corrida_id?: string;
          created_at?: string;
          diccionario?: Json;
          huella?: string;
          id?: string;
          tipo?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ia_entradas_corrida_id_fkey";
            columns: ["corrida_id"];
            isOneToOne: false;
            referencedRelation: "ia_corridas";
            referencedColumns: ["id"];
          },
        ];
      };
      ia_evaluaciones: {
        Row: {
          activo: boolean;
          created_at: string;
          estado: string;
          id: string;
          iniciada_at: string;
          modelo: string;
          parametros: Json;
          perfil_id: string | null;
          proveedor: string;
          resultados: Json | null;
          terminada_at: string | null;
          tope_usd: number;
          updated_at: string;
          usuario_nombre: string | null;
          veredicto: Json | null;
          version_prompt: string;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          estado?: string;
          id?: string;
          iniciada_at?: string;
          modelo: string;
          parametros: Json;
          perfil_id?: string | null;
          proveedor: string;
          resultados?: Json | null;
          terminada_at?: string | null;
          tope_usd?: number;
          updated_at?: string;
          usuario_nombre?: string | null;
          veredicto?: Json | null;
          version_prompt: string;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          estado?: string;
          id?: string;
          iniciada_at?: string;
          modelo?: string;
          parametros?: Json;
          perfil_id?: string | null;
          proveedor?: string;
          resultados?: Json | null;
          terminada_at?: string | null;
          tope_usd?: number;
          updated_at?: string;
          usuario_nombre?: string | null;
          veredicto?: Json | null;
          version_prompt?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ia_evaluaciones_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      ia_llamadas: {
        Row: {
          bytes_entrada: number;
          corrida_gm_id: string;
          corrida_id: string;
          costo_usd: number;
          created_at: string;
          duracion_ms: number;
          entrada_bloque_id: string | null;
          entrada_sufijo_id: string | null;
          error_codigo: string | null;
          error_detalle: string | null;
          esperar_ms: number | null;
          estado: string;
          filas_enviadas: number;
          huella_llamada: string;
          id: string;
          id_solicitud: string | null;
          intento: number;
          modelo_respuesta: string | null;
          paso: string;
          perfil_id: string | null;
          tipo_llamada: string;
          tokens_entrada: number;
          tokens_entrada_cache: number;
          tokens_salida: number;
        };
        Insert: {
          bytes_entrada: number;
          corrida_gm_id: string;
          corrida_id: string;
          costo_usd?: number;
          created_at?: string;
          duracion_ms: number;
          entrada_bloque_id?: string | null;
          entrada_sufijo_id?: string | null;
          error_codigo?: string | null;
          error_detalle?: string | null;
          esperar_ms?: number | null;
          estado: string;
          filas_enviadas: number;
          huella_llamada: string;
          id?: string;
          id_solicitud?: string | null;
          intento: number;
          modelo_respuesta?: string | null;
          paso: string;
          perfil_id?: string | null;
          tipo_llamada: string;
          tokens_entrada?: number;
          tokens_entrada_cache?: number;
          tokens_salida?: number;
        };
        Update: {
          bytes_entrada?: number;
          corrida_gm_id?: string;
          corrida_id?: string;
          costo_usd?: number;
          created_at?: string;
          duracion_ms?: number;
          entrada_bloque_id?: string | null;
          entrada_sufijo_id?: string | null;
          error_codigo?: string | null;
          error_detalle?: string | null;
          esperar_ms?: number | null;
          estado?: string;
          filas_enviadas?: number;
          huella_llamada?: string;
          id?: string;
          id_solicitud?: string | null;
          intento?: number;
          modelo_respuesta?: string | null;
          paso?: string;
          perfil_id?: string | null;
          tipo_llamada?: string;
          tokens_entrada?: number;
          tokens_entrada_cache?: number;
          tokens_salida?: number;
        };
        Relationships: [
          {
            foreignKeyName: "ia_llamadas_corrida_gm_id_fkey";
            columns: ["corrida_gm_id"];
            isOneToOne: false;
            referencedRelation: "ia_corrida_gms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ia_llamadas_corrida_id_fkey";
            columns: ["corrida_id"];
            isOneToOne: false;
            referencedRelation: "ia_corridas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ia_llamadas_entrada_bloque_id_fkey";
            columns: ["entrada_bloque_id"];
            isOneToOne: false;
            referencedRelation: "ia_entradas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ia_llamadas_entrada_sufijo_id_fkey";
            columns: ["entrada_sufijo_id"];
            isOneToOne: false;
            referencedRelation: "ia_entradas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ia_llamadas_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      ia_propuestas_filas: {
        Row: {
          aporte_fijo_al_generar: number | null;
          avisos: string[];
          banderas: string[];
          base_al_generar: number | null;
          base_corregida_al_generar: number | null;
          confianza: string | null;
          created_at: string;
          estado_meta: string;
          fila_clave: string;
          fila_id: string | null;
          id: string;
          meta_y1_al_generar: number | null;
          meta_y1_modelo: number | null;
          natural_y1: number | null;
          p_gm_al_generar: number | null;
          propuesta_gm_id: string;
          razon: string | null;
          razon_natural: string | null;
          senales: string[];
        };
        Insert: {
          aporte_fijo_al_generar?: number | null;
          avisos?: string[];
          banderas?: string[];
          base_al_generar?: number | null;
          base_corregida_al_generar?: number | null;
          confianza?: string | null;
          created_at?: string;
          estado_meta: string;
          fila_clave: string;
          fila_id?: string | null;
          id?: string;
          meta_y1_al_generar?: number | null;
          meta_y1_modelo?: number | null;
          natural_y1?: number | null;
          p_gm_al_generar?: number | null;
          propuesta_gm_id: string;
          razon?: string | null;
          razon_natural?: string | null;
          senales?: string[];
        };
        Update: {
          aporte_fijo_al_generar?: number | null;
          avisos?: string[];
          banderas?: string[];
          base_al_generar?: number | null;
          base_corregida_al_generar?: number | null;
          confianza?: string | null;
          created_at?: string;
          estado_meta?: string;
          fila_clave?: string;
          fila_id?: string | null;
          id?: string;
          meta_y1_al_generar?: number | null;
          meta_y1_modelo?: number | null;
          natural_y1?: number | null;
          p_gm_al_generar?: number | null;
          propuesta_gm_id?: string;
          razon?: string | null;
          razon_natural?: string | null;
          senales?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "ia_propuestas_filas_fila_id_fkey";
            columns: ["fila_id"];
            isOneToOne: false;
            referencedRelation: "proyeccion_filas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ia_propuestas_filas_propuesta_gm_id_fkey";
            columns: ["propuesta_gm_id"];
            isOneToOne: false;
            referencedRelation: "ia_propuestas_gm";
            referencedColumns: ["id"];
          },
        ];
      };
      ia_propuestas_gm: {
        Row: {
          avisos: string[];
          banderas_gm: string[];
          capacidades: string[];
          corrida_gm_id: string;
          corrida_id: string;
          created_at: string;
          desvio_suma_modelo: number | null;
          es_resto: boolean;
          filas_pedidas: number;
          filas_validas: number;
          genero_id: string;
          gm_clave: string;
          huella_gm: string;
          huella_historia: string;
          id: string;
          meta: Json | null;
          modelo: string;
          modo: string;
          mundo_id: string;
          perfil_id: string | null;
          pliegue: string;
          proveedor: string;
          proyeccion_id: string | null;
          razon_gm: string | null;
          usuario_nombre: string | null;
          version_metodo: number;
          version_prompt: string;
        };
        Insert: {
          avisos?: string[];
          banderas_gm?: string[];
          capacidades: string[];
          corrida_gm_id: string;
          corrida_id: string;
          created_at?: string;
          desvio_suma_modelo?: number | null;
          es_resto: boolean;
          filas_pedidas: number;
          filas_validas: number;
          genero_id: string;
          gm_clave: string;
          huella_gm: string;
          huella_historia: string;
          id?: string;
          meta?: Json | null;
          modelo: string;
          modo: string;
          mundo_id: string;
          perfil_id?: string | null;
          pliegue?: string;
          proveedor: string;
          proyeccion_id?: string | null;
          razon_gm?: string | null;
          usuario_nombre?: string | null;
          version_metodo: number;
          version_prompt: string;
        };
        Update: {
          avisos?: string[];
          banderas_gm?: string[];
          capacidades?: string[];
          corrida_gm_id?: string;
          corrida_id?: string;
          created_at?: string;
          desvio_suma_modelo?: number | null;
          es_resto?: boolean;
          filas_pedidas?: number;
          filas_validas?: number;
          genero_id?: string;
          gm_clave?: string;
          huella_gm?: string;
          huella_historia?: string;
          id?: string;
          meta?: Json | null;
          modelo?: string;
          modo?: string;
          mundo_id?: string;
          perfil_id?: string | null;
          pliegue?: string;
          proveedor?: string;
          proyeccion_id?: string | null;
          razon_gm?: string | null;
          usuario_nombre?: string | null;
          version_metodo?: number;
          version_prompt?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ia_propuestas_gm_corrida_gm_id_fkey";
            columns: ["corrida_gm_id"];
            isOneToOne: false;
            referencedRelation: "ia_corrida_gms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ia_propuestas_gm_corrida_id_fkey";
            columns: ["corrida_id"];
            isOneToOne: false;
            referencedRelation: "ia_corridas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ia_propuestas_gm_genero_id_fkey";
            columns: ["genero_id"];
            isOneToOne: false;
            referencedRelation: "generos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ia_propuestas_gm_mundo_id_fkey";
            columns: ["mundo_id"];
            isOneToOne: false;
            referencedRelation: "mundos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ia_propuestas_gm_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ia_propuestas_gm_proyeccion_id_fkey";
            columns: ["proyeccion_id"];
            isOneToOne: false;
            referencedRelation: "proyecciones";
            referencedColumns: ["id"];
          },
        ];
      };
      intercompany_reglas: {
        Row: {
          activo: boolean;
          cobertura_max_meses: number;
          cobertura_min_meses: number;
          created_at: string;
          equivalencia_id: string | null;
          genero_mundo_linea_id: string;
          id: string;
          marca_id: string;
          nota: string | null;
          pct_directo: number;
          perfil_id: string | null;
          updated_at: string;
          usuario_nombre: string | null;
          vigente_desde: string;
        };
        Insert: {
          activo?: boolean;
          cobertura_max_meses: number;
          cobertura_min_meses: number;
          created_at?: string;
          equivalencia_id?: string | null;
          genero_mundo_linea_id: string;
          id?: string;
          marca_id: string;
          nota?: string | null;
          pct_directo?: number;
          perfil_id?: string | null;
          updated_at?: string;
          usuario_nombre?: string | null;
          vigente_desde: string;
        };
        Update: {
          activo?: boolean;
          cobertura_max_meses?: number;
          cobertura_min_meses?: number;
          created_at?: string;
          equivalencia_id?: string | null;
          genero_mundo_linea_id?: string;
          id?: string;
          marca_id?: string;
          nota?: string | null;
          pct_directo?: number;
          perfil_id?: string | null;
          updated_at?: string;
          usuario_nombre?: string | null;
          vigente_desde?: string;
        };
        Relationships: [
          {
            foreignKeyName: "intercompany_reglas_equivalencia_id_fkey";
            columns: ["equivalencia_id"];
            isOneToOne: false;
            referencedRelation: "equivalencias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "intercompany_reglas_gml_id_fkey";
            columns: ["genero_mundo_linea_id"];
            isOneToOne: false;
            referencedRelation: "genero_mundo_linea";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "intercompany_reglas_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "intercompany_reglas_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas_unidad";
            referencedColumns: ["marca_id"];
          },
          {
            foreignKeyName: "intercompany_reglas_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      lineas: {
        Row: {
          activo: boolean;
          codigo: string;
          created_at: string;
          id: string;
          nombre: string;
          temporada: string;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          codigo: string;
          created_at?: string;
          id?: string;
          nombre: string;
          temporada?: string;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          codigo?: string;
          created_at?: string;
          id?: string;
          nombre?: string;
          temporada?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      mapeos_combinacion: {
        Row: {
          activo: boolean;
          created_at: string;
          equivalencia_id: string;
          id: string;
          motivo_origen: string | null;
          nota: string | null;
          origen_equivalencia: string;
          origen_genero: string;
          origen_linea: string;
          origen_mundo: string;
          perfil_id: string | null;
          updated_at: string;
          usuario_nombre: string | null;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          equivalencia_id: string;
          id?: string;
          motivo_origen?: string | null;
          nota?: string | null;
          origen_equivalencia: string;
          origen_genero: string;
          origen_linea: string;
          origen_mundo: string;
          perfil_id?: string | null;
          updated_at?: string;
          usuario_nombre?: string | null;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          equivalencia_id?: string;
          id?: string;
          motivo_origen?: string | null;
          nota?: string | null;
          origen_equivalencia?: string;
          origen_genero?: string;
          origen_linea?: string;
          origen_mundo?: string;
          perfil_id?: string | null;
          updated_at?: string;
          usuario_nombre?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "mapeos_combinacion_equivalencia_id_fkey";
            columns: ["equivalencia_id"];
            isOneToOne: false;
            referencedRelation: "equivalencias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mapeos_combinacion_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      marca_gml_especial: {
        Row: {
          activo: boolean;
          created_at: string;
          genero_mundo_linea_id: string;
          id: string;
          marca_id: string;
          nota: string | null;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          genero_mundo_linea_id: string;
          id?: string;
          marca_id: string;
          nota?: string | null;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          genero_mundo_linea_id?: string;
          id?: string;
          marca_id?: string;
          nota?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "marca_gml_especial_gml_id_fkey";
            columns: ["genero_mundo_linea_id"];
            isOneToOne: false;
            referencedRelation: "genero_mundo_linea";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "marca_gml_especial_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "marca_gml_especial_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas_unidad";
            referencedColumns: ["marca_id"];
          },
        ];
      };
      marcas: {
        Row: {
          activo: boolean;
          agrupacion_marca_id: string;
          codigo: string;
          conjunto_marca_id: string | null;
          created_at: string;
          id: string;
          modalidad_tratamiento: string | null;
          nombre: string;
          nota_tratamiento: string | null;
          resto_al_barrer: boolean;
          tratamiento_especial: boolean;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          agrupacion_marca_id: string;
          codigo: string;
          conjunto_marca_id?: string | null;
          created_at?: string;
          id?: string;
          modalidad_tratamiento?: string | null;
          nombre: string;
          nota_tratamiento?: string | null;
          resto_al_barrer?: boolean;
          tratamiento_especial?: boolean;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          agrupacion_marca_id?: string;
          codigo?: string;
          conjunto_marca_id?: string | null;
          created_at?: string;
          id?: string;
          modalidad_tratamiento?: string | null;
          nombre?: string;
          nota_tratamiento?: string | null;
          resto_al_barrer?: boolean;
          tratamiento_especial?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "marcas_agrupacion_marca_id_fkey";
            columns: ["agrupacion_marca_id"];
            isOneToOne: false;
            referencedRelation: "agrupaciones_marca";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "marcas_conjunto_marca_id_fkey";
            columns: ["conjunto_marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "marcas_conjunto_marca_id_fkey";
            columns: ["conjunto_marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas_unidad";
            referencedColumns: ["marca_id"];
          },
        ];
      };
      mundos: {
        Row: {
          activo: boolean;
          codigo: string;
          created_at: string;
          id: string;
          nombre: string;
          orden: number;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          codigo: string;
          created_at?: string;
          id?: string;
          nombre: string;
          orden?: number;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          codigo?: string;
          created_at?: string;
          id?: string;
          nombre?: string;
          orden?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      perfiles: {
        Row: {
          id: string;
          email: string;
          nombre: string | null;
          rol: string;
          activo: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          nombre?: string | null;
          rol?: string;
          activo?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          nombre?: string | null;
          rol?: string;
          activo?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      periodos_atipicos: {
        Row: {
          activo: boolean;
          alcance: string;
          created_at: string;
          descripcion: string | null;
          desde: string;
          hasta: string;
          id: string;
          motivo: string;
          temporadas: string[] | null;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          alcance?: string;
          created_at?: string;
          descripcion?: string | null;
          desde: string;
          hasta: string;
          id?: string;
          motivo: string;
          temporadas?: string[] | null;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          alcance?: string;
          created_at?: string;
          descripcion?: string | null;
          desde?: string;
          hasta?: string;
          id?: string;
          motivo?: string;
          temporadas?: string[] | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      proveedores: {
        Row: {
          activo: boolean;
          ciudad: string | null;
          codigo: string | null;
          created_at: string;
          es_intercompany: boolean;
          id: string;
          identificacion: string | null;
          nombre: string;
          nota: string | null;
          pais: string | null;
          perfil_id: string | null;
          updated_at: string;
          usuario_nombre: string | null;
        };
        Insert: {
          activo?: boolean;
          ciudad?: string | null;
          codigo?: string | null;
          created_at?: string;
          es_intercompany?: boolean;
          id?: string;
          identificacion?: string | null;
          nombre: string;
          nota?: string | null;
          pais?: string | null;
          perfil_id?: string | null;
          updated_at?: string;
          usuario_nombre?: string | null;
        };
        Update: {
          activo?: boolean;
          ciudad?: string | null;
          codigo?: string | null;
          created_at?: string;
          es_intercompany?: boolean;
          id?: string;
          identificacion?: string | null;
          nombre?: string;
          nota?: string | null;
          pais?: string | null;
          perfil_id?: string | null;
          updated_at?: string;
          usuario_nombre?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "proveedores_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      proyeccion_crecimientos: {
        Row: {
          activo: boolean;
          created_at: string;
          crecimiento_id: string | null;
          genero_id: string;
          id: string;
          mundo_id: string;
          nota: string | null;
          pct: number;
          perfil_id: string | null;
          proyeccion_id: string;
          sobre_base: string | null;
          updated_at: string;
          usuario_nombre: string | null;
          version: number | null;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          crecimiento_id?: string | null;
          genero_id: string;
          id?: string;
          mundo_id: string;
          nota?: string | null;
          pct: number;
          perfil_id?: string | null;
          proyeccion_id: string;
          sobre_base?: string | null;
          updated_at?: string;
          usuario_nombre?: string | null;
          version?: number | null;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          crecimiento_id?: string | null;
          genero_id?: string;
          id?: string;
          mundo_id?: string;
          nota?: string | null;
          pct?: number;
          perfil_id?: string | null;
          proyeccion_id?: string;
          sobre_base?: string | null;
          updated_at?: string;
          usuario_nombre?: string | null;
          version?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "proyeccion_crecimientos_crecimiento_id_fkey";
            columns: ["crecimiento_id"];
            isOneToOne: false;
            referencedRelation: "crecimientos_genero_mundo";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proyeccion_crecimientos_genero_id_fkey";
            columns: ["genero_id"];
            isOneToOne: false;
            referencedRelation: "generos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proyeccion_crecimientos_mundo_id_fkey";
            columns: ["mundo_id"];
            isOneToOne: false;
            referencedRelation: "mundos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proyeccion_crecimientos_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proyeccion_crecimientos_proyeccion_id_fkey";
            columns: ["proyeccion_id"];
            isOneToOne: false;
            referencedRelation: "proyecciones";
            referencedColumns: ["id"];
          },
        ];
      };
      proyeccion_fila_anios: {
        Row: {
          activo: boolean;
          anio: number;
          avisos: Json;
          base_normalizada: number | null;
          base_siguiente: number | null;
          bloque: string;
          created_at: string;
          crecimiento_pct: number | null;
          curva_origen_propuesta: Json | null;
          curva_origen_usada: Json;
          decidido: number | null;
          decidido_at: string | null;
          decidido_por_id: string | null;
          decidido_por_nombre: string | null;
          decision_ia_fila_id: string | null;
          explicacion: string;
          fila_id: string;
          id: string;
          meses: number[] | null;
          meses_propuestos: number[] | null;
          metodo: string;
          nota: string | null;
          origen: string | null;
          origen_meses: string[] | null;
          propuesta_al_decidir: number | null;
          propuesto: number | null;
          referencia_alternativa: number | null;
          referencia_tres_meses: number | null;
          subbloque: string | null;
          updated_at: string;
          vendido: number;
        };
        Insert: {
          activo?: boolean;
          anio: number;
          avisos?: Json;
          base_normalizada?: number | null;
          base_siguiente?: number | null;
          bloque: string;
          created_at?: string;
          crecimiento_pct?: number | null;
          curva_origen_propuesta?: Json | null;
          curva_origen_usada?: Json;
          decidido?: number | null;
          decidido_at?: string | null;
          decidido_por_id?: string | null;
          decidido_por_nombre?: string | null;
          decision_ia_fila_id?: string | null;
          explicacion?: string;
          fila_id: string;
          id?: string;
          meses?: number[] | null;
          meses_propuestos?: number[] | null;
          metodo?: string;
          nota?: string | null;
          origen?: string | null;
          origen_meses?: string[] | null;
          propuesta_al_decidir?: number | null;
          propuesto?: number | null;
          referencia_alternativa?: number | null;
          referencia_tres_meses?: number | null;
          subbloque?: string | null;
          updated_at?: string;
          vendido?: number;
        };
        Update: {
          activo?: boolean;
          anio?: number;
          avisos?: Json;
          base_normalizada?: number | null;
          base_siguiente?: number | null;
          bloque?: string;
          created_at?: string;
          crecimiento_pct?: number | null;
          curva_origen_propuesta?: Json | null;
          curva_origen_usada?: Json;
          decidido?: number | null;
          decidido_at?: string | null;
          decidido_por_id?: string | null;
          decidido_por_nombre?: string | null;
          decision_ia_fila_id?: string | null;
          explicacion?: string;
          fila_id?: string;
          id?: string;
          meses?: number[] | null;
          meses_propuestos?: number[] | null;
          metodo?: string;
          nota?: string | null;
          origen?: string | null;
          origen_meses?: string[] | null;
          propuesta_al_decidir?: number | null;
          propuesto?: number | null;
          referencia_alternativa?: number | null;
          referencia_tres_meses?: number | null;
          subbloque?: string | null;
          updated_at?: string;
          vendido?: number;
        };
        Relationships: [
          {
            foreignKeyName: "proyeccion_fila_anios_decidido_por_id_fkey";
            columns: ["decidido_por_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proyeccion_fila_anios_decision_ia_fila_id_fkey";
            columns: ["decision_ia_fila_id"];
            isOneToOne: false;
            referencedRelation: "ia_propuestas_filas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proyeccion_fila_anios_fila_id_fkey";
            columns: ["fila_id"];
            isOneToOne: false;
            referencedRelation: "proyeccion_filas";
            referencedColumns: ["id"];
          },
        ];
      };
      proyeccion_filas: {
        Row: {
          activo: boolean;
          agrupacion_estacionalidad_id: string | null;
          agrupacion_marca_id: string;
          avisos: Json;
          clave: string;
          composicion: Json | null;
          created_at: string;
          curva: Json | null;
          curva_origen: Json;
          equivalencia_id: string | null;
          factores_mes: Json | null;
          gml_id: string;
          historico: Json;
          id: string;
          nivel_proyectado: string;
          participaciones: Json | null;
          proyeccion_id: string;
          temporada: string | null;
          tienda_id: string | null;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          agrupacion_estacionalidad_id?: string | null;
          agrupacion_marca_id: string;
          avisos?: Json;
          clave: string;
          composicion?: Json | null;
          created_at?: string;
          curva?: Json | null;
          curva_origen?: Json;
          equivalencia_id?: string | null;
          factores_mes?: Json | null;
          gml_id: string;
          historico: Json;
          id?: string;
          nivel_proyectado: string;
          participaciones?: Json | null;
          proyeccion_id: string;
          temporada?: string | null;
          tienda_id?: string | null;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          agrupacion_estacionalidad_id?: string | null;
          agrupacion_marca_id?: string;
          avisos?: Json;
          clave?: string;
          composicion?: Json | null;
          created_at?: string;
          curva?: Json | null;
          curva_origen?: Json;
          equivalencia_id?: string | null;
          factores_mes?: Json | null;
          gml_id?: string;
          historico?: Json;
          id?: string;
          nivel_proyectado?: string;
          participaciones?: Json | null;
          proyeccion_id?: string;
          temporada?: string | null;
          tienda_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "proyeccion_filas_agrupacion_estacionalidad_id_fkey";
            columns: ["agrupacion_estacionalidad_id"];
            isOneToOne: false;
            referencedRelation: "agrupaciones_estacionalidad";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proyeccion_filas_agrupacion_marca_id_fkey";
            columns: ["agrupacion_marca_id"];
            isOneToOne: false;
            referencedRelation: "agrupaciones_marca";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proyeccion_filas_equivalencia_id_fkey";
            columns: ["equivalencia_id"];
            isOneToOne: false;
            referencedRelation: "equivalencias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proyeccion_filas_gml_id_fkey";
            columns: ["gml_id"];
            isOneToOne: false;
            referencedRelation: "genero_mundo_linea";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proyeccion_filas_proyeccion_id_fkey";
            columns: ["proyeccion_id"];
            isOneToOne: false;
            referencedRelation: "proyecciones";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proyeccion_filas_tienda_id_fkey";
            columns: ["tienda_id"];
            isOneToOne: false;
            referencedRelation: "tiendas";
            referencedColumns: ["id"];
          },
        ];
      };
      proyeccion_tiendas: {
        Row: {
          activo: boolean;
          anio: number;
          avisos: Json;
          bloque: string;
          created_at: string;
          decidido: number | null;
          decidido_at: string | null;
          decidido_por_id: string | null;
          decidido_por_nombre: string | null;
          explicacion: string;
          fecha_usada: string;
          id: string;
          metodo: string;
          nota: string | null;
          origen: string | null;
          origen_composicion: string | null;
          propuesta_al_decidir: number | null;
          propuesto: number | null;
          proyeccion_id: string;
          rampa: Json;
          referencia_alternativa: number | null;
          referencia_tres_meses: number | null;
          referente_id_usado: string | null;
          subbloque: string | null;
          tienda_id: string;
          unidades_maduras: number | null;
          updated_at: string;
          vendido: number;
          venta_esperada_usada: number | null;
        };
        Insert: {
          activo?: boolean;
          anio: number;
          avisos?: Json;
          bloque: string;
          created_at?: string;
          decidido?: number | null;
          decidido_at?: string | null;
          decidido_por_id?: string | null;
          decidido_por_nombre?: string | null;
          explicacion?: string;
          fecha_usada: string;
          id?: string;
          metodo?: string;
          nota?: string | null;
          origen?: string | null;
          origen_composicion?: string | null;
          propuesta_al_decidir?: number | null;
          propuesto?: number | null;
          proyeccion_id: string;
          rampa?: Json;
          referencia_alternativa?: number | null;
          referencia_tres_meses?: number | null;
          referente_id_usado?: string | null;
          subbloque?: string | null;
          tienda_id: string;
          unidades_maduras?: number | null;
          updated_at?: string;
          vendido?: number;
          venta_esperada_usada?: number | null;
        };
        Update: {
          activo?: boolean;
          anio?: number;
          avisos?: Json;
          bloque?: string;
          created_at?: string;
          decidido?: number | null;
          decidido_at?: string | null;
          decidido_por_id?: string | null;
          decidido_por_nombre?: string | null;
          explicacion?: string;
          fecha_usada?: string;
          id?: string;
          metodo?: string;
          nota?: string | null;
          origen?: string | null;
          origen_composicion?: string | null;
          propuesta_al_decidir?: number | null;
          propuesto?: number | null;
          proyeccion_id?: string;
          rampa?: Json;
          referencia_alternativa?: number | null;
          referencia_tres_meses?: number | null;
          referente_id_usado?: string | null;
          subbloque?: string | null;
          tienda_id?: string;
          unidades_maduras?: number | null;
          updated_at?: string;
          vendido?: number;
          venta_esperada_usada?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "proyeccion_tiendas_decidido_por_id_fkey";
            columns: ["decidido_por_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proyeccion_tiendas_proyeccion_id_fkey";
            columns: ["proyeccion_id"];
            isOneToOne: false;
            referencedRelation: "proyecciones";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proyeccion_tiendas_tienda_id_fkey";
            columns: ["tienda_id"];
            isOneToOne: false;
            referencedRelation: "tiendas";
            referencedColumns: ["id"];
          },
        ];
      };
      proyecciones: {
        Row: {
          activo: boolean;
          anio_en_curso: number;
          calculado_at: string | null;
          calculando_desde: string | null;
          cerrada_at: string | null;
          cerrada_por_id: string | null;
          cerrada_por_nombre: string | null;
          created_at: string;
          estado: string;
          hasta_periodo: string;
          huella_flujo: string | null;
          id: string;
          nombre: string;
          nota: string | null;
          parametros: Json;
          perfil_id: string | null;
          resumen: Json | null;
          updated_at: string;
          usuario_nombre: string | null;
        };
        Insert: {
          activo?: boolean;
          anio_en_curso: number;
          calculado_at?: string | null;
          calculando_desde?: string | null;
          cerrada_at?: string | null;
          cerrada_por_id?: string | null;
          cerrada_por_nombre?: string | null;
          created_at?: string;
          estado?: string;
          hasta_periodo: string;
          huella_flujo?: string | null;
          id?: string;
          nombre: string;
          nota?: string | null;
          parametros: Json;
          perfil_id?: string | null;
          resumen?: Json | null;
          updated_at?: string;
          usuario_nombre?: string | null;
        };
        Update: {
          activo?: boolean;
          anio_en_curso?: number;
          calculado_at?: string | null;
          calculando_desde?: string | null;
          cerrada_at?: string | null;
          cerrada_por_id?: string | null;
          cerrada_por_nombre?: string | null;
          created_at?: string;
          estado?: string;
          hasta_periodo?: string;
          huella_flujo?: string | null;
          id?: string;
          nombre?: string;
          nota?: string | null;
          parametros?: Json;
          perfil_id?: string | null;
          resumen?: Json | null;
          updated_at?: string;
          usuario_nombre?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "proyecciones_cerrada_por_id_fkey";
            columns: ["cerrada_por_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proyecciones_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      reparto_marca_barrido_gml: {
        Row: {
          activo: boolean;
          created_at: string;
          equivalencia_id: string | null;
          genero_mundo_linea_id: string;
          grupo_resto: string | null;
          id: string;
          mes: number | null;
          participacion_ajustada: number | null;
          participacion_calculada: number;
          participacion_vigente: number;
          reparto_id: string;
          temporada: string | null;
          unidades_ventana: number;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          equivalencia_id?: string | null;
          genero_mundo_linea_id: string;
          grupo_resto?: string | null;
          id?: string;
          mes?: number | null;
          participacion_ajustada?: number | null;
          participacion_calculada: number;
          participacion_vigente: number;
          reparto_id: string;
          temporada?: string | null;
          unidades_ventana?: number;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          equivalencia_id?: string | null;
          genero_mundo_linea_id?: string;
          grupo_resto?: string | null;
          id?: string;
          mes?: number | null;
          participacion_ajustada?: number | null;
          participacion_calculada?: number;
          participacion_vigente?: number;
          reparto_id?: string;
          temporada?: string | null;
          unidades_ventana?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reparto_marca_barrido_gml_equivalencia_id_fkey";
            columns: ["equivalencia_id"];
            isOneToOne: false;
            referencedRelation: "equivalencias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reparto_marca_barrido_gml_gml_id_fkey";
            columns: ["genero_mundo_linea_id"];
            isOneToOne: false;
            referencedRelation: "genero_mundo_linea";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reparto_marca_barrido_gml_reparto_id_fkey";
            columns: ["reparto_id"];
            isOneToOne: false;
            referencedRelation: "repartos_marca_barrido";
            referencedColumns: ["id"];
          },
        ];
      };
      repartos_marca_barrido: {
        Row: {
          activo: boolean;
          alcance: Json;
          aprobada_at: string;
          aprobada_por_id: string | null;
          aprobada_por_nombre: string | null;
          created_at: string;
          eat_pp: number | null;
          error_reparto_pp: number | null;
          factores_usados: Json;
          fuente: string;
          hasta_periodo: string;
          huella_cargas: string;
          huella_config: string;
          id: string;
          marca_id: string;
          modo: string;
          normaliza_nino: boolean;
          nota: string | null;
          share_barrido: number | null;
          temporadas_usadas: Json;
          updated_at: string;
          ventana_meses: number;
          version: number;
          vigente: boolean;
        };
        Insert: {
          activo?: boolean;
          alcance?: Json;
          aprobada_at?: string;
          aprobada_por_id?: string | null;
          aprobada_por_nombre?: string | null;
          created_at?: string;
          eat_pp?: number | null;
          error_reparto_pp?: number | null;
          factores_usados?: Json;
          fuente?: string;
          hasta_periodo: string;
          huella_cargas: string;
          huella_config: string;
          id?: string;
          marca_id: string;
          modo: string;
          normaliza_nino?: boolean;
          nota?: string | null;
          share_barrido?: number | null;
          temporadas_usadas?: Json;
          updated_at?: string;
          ventana_meses: number;
          version: number;
          vigente?: boolean;
        };
        Update: {
          activo?: boolean;
          alcance?: Json;
          aprobada_at?: string;
          aprobada_por_id?: string | null;
          aprobada_por_nombre?: string | null;
          created_at?: string;
          eat_pp?: number | null;
          error_reparto_pp?: number | null;
          factores_usados?: Json;
          fuente?: string;
          hasta_periodo?: string;
          huella_cargas?: string;
          huella_config?: string;
          id?: string;
          marca_id?: string;
          modo?: string;
          normaliza_nino?: boolean;
          nota?: string | null;
          share_barrido?: number | null;
          temporadas_usadas?: Json;
          updated_at?: string;
          ventana_meses?: number;
          version?: number;
          vigente?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "repartos_marca_barrido_aprobada_por_id_fkey";
            columns: ["aprobada_por_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repartos_marca_barrido_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "repartos_marca_barrido_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas_unidad";
            referencedColumns: ["marca_id"];
          },
        ];
      };
      responsables_genero_mundo: {
        Row: {
          activo: boolean;
          created_at: string;
          genero_id: string;
          id: string;
          mundo_id: string;
          perfil_id: string;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          genero_id: string;
          id?: string;
          mundo_id: string;
          perfil_id: string;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          genero_id?: string;
          id?: string;
          mundo_id?: string;
          perfil_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "responsables_genero_mundo_genero_id_fkey";
            columns: ["genero_id"];
            isOneToOne: false;
            referencedRelation: "generos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "responsables_genero_mundo_mundo_id_fkey";
            columns: ["mundo_id"];
            isOneToOne: false;
            referencedRelation: "mundos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "responsables_genero_mundo_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tiendas: {
        Row: {
          activo: boolean;
          codigo: string;
          created_at: string;
          fecha_apertura: string | null;
          fecha_cierre: string | null;
          id: string;
          nombre: string;
          razon_social: string | null;
          tienda_referencia_id: string | null;
          tipo: string;
          updated_at: string;
          venta_esperada_promedio: number | null;
          zona: string | null;
        };
        Insert: {
          activo?: boolean;
          codigo: string;
          created_at?: string;
          fecha_apertura?: string | null;
          fecha_cierre?: string | null;
          id?: string;
          nombre: string;
          razon_social?: string | null;
          tienda_referencia_id?: string | null;
          tipo?: string;
          updated_at?: string;
          venta_esperada_promedio?: number | null;
          zona?: string | null;
        };
        Update: {
          activo?: boolean;
          codigo?: string;
          created_at?: string;
          fecha_apertura?: string | null;
          fecha_cierre?: string | null;
          id?: string;
          nombre?: string;
          razon_social?: string | null;
          tienda_referencia_id?: string | null;
          tipo?: string;
          updated_at?: string;
          venta_esperada_promedio?: number | null;
          zona?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tiendas_tienda_referencia_id_fkey";
            columns: ["tienda_referencia_id"];
            isOneToOne: false;
            referencedRelation: "tiendas";
            referencedColumns: ["id"];
          },
        ];
      };
      ubicaciones_ignoradas: {
        Row: {
          activo: boolean;
          created_at: string;
          id: string;
          nombre: string;
          nota: string | null;
          updated_at: string;
        };
        Insert: {
          activo?: boolean;
          created_at?: string;
          id?: string;
          nombre: string;
          nota?: string | null;
          updated_at?: string;
        };
        Update: {
          activo?: boolean;
          created_at?: string;
          id?: string;
          nombre?: string;
          nota?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      venta_stock_mensual: {
        Row: {
          agrupacion_talla_id: string;
          carga_id: string;
          costo_vendido: number;
          equivalencia_id: string;
          marca_id: string;
          stock_unidades: number;
          stock_valorizado: number;
          tienda_id: string;
          unidades: number;
          venta_soles: number;
        };
        Insert: {
          agrupacion_talla_id: string;
          carga_id: string;
          costo_vendido?: number;
          equivalencia_id: string;
          marca_id: string;
          stock_unidades?: number;
          stock_valorizado?: number;
          tienda_id: string;
          unidades?: number;
          venta_soles?: number;
        };
        Update: {
          agrupacion_talla_id?: string;
          carga_id?: string;
          costo_vendido?: number;
          equivalencia_id?: string;
          marca_id?: string;
          stock_unidades?: number;
          stock_valorizado?: number;
          tienda_id?: string;
          unidades?: number;
          venta_soles?: number;
        };
        Relationships: [
          {
            foreignKeyName: "venta_stock_mensual_agrupacion_talla_id_fkey";
            columns: ["agrupacion_talla_id"];
            isOneToOne: false;
            referencedRelation: "agrupaciones_talla";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "venta_stock_mensual_carga_id_fkey";
            columns: ["carga_id"];
            isOneToOne: false;
            referencedRelation: "cargas_venta_stock";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "venta_stock_mensual_equivalencia_id_fkey";
            columns: ["equivalencia_id"];
            isOneToOne: false;
            referencedRelation: "equivalencias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "venta_stock_mensual_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "venta_stock_mensual_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas_unidad";
            referencedColumns: ["marca_id"];
          },
          {
            foreignKeyName: "venta_stock_mensual_tienda_id_fkey";
            columns: ["tienda_id"];
            isOneToOne: false;
            referencedRelation: "tiendas";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      // Las vistas no entran en `Tables<...>`: consultas.ts declara sus alias.
      intercompany_vigente: {
        Row: {
          cobertura_max_meses: number | null;
          cobertura_min_meses: number | null;
          created_at: string | null;
          equivalencia_id: string | null;
          equivalencia_nombre: string | null;
          genero_id: string | null;
          genero_mundo_linea_id: string | null;
          genero_nombre: string | null;
          hasta_derivado: string | null;
          id: string | null;
          linea_id: string | null;
          linea_nombre: string | null;
          marca_id: string | null;
          marca_nombre: string | null;
          mundo_id: string | null;
          mundo_nombre: string | null;
          nivel_planificacion: string | null;
          nota: string | null;
          pct_directo: number | null;
          perfil_id: string | null;
          updated_at: string | null;
          usuario_nombre: string | null;
          vigente_desde: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "genero_mundo_linea_genero_id_fkey";
            columns: ["genero_id"];
            isOneToOne: false;
            referencedRelation: "generos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "genero_mundo_linea_linea_id_fkey";
            columns: ["linea_id"];
            isOneToOne: false;
            referencedRelation: "lineas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "genero_mundo_linea_mundo_id_fkey";
            columns: ["mundo_id"];
            isOneToOne: false;
            referencedRelation: "mundos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "intercompany_reglas_equivalencia_id_fkey";
            columns: ["equivalencia_id"];
            isOneToOne: false;
            referencedRelation: "equivalencias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "intercompany_reglas_gml_id_fkey";
            columns: ["genero_mundo_linea_id"];
            isOneToOne: false;
            referencedRelation: "genero_mundo_linea";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "intercompany_reglas_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "intercompany_reglas_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas_unidad";
            referencedColumns: ["marca_id"];
          },
          {
            foreignKeyName: "intercompany_reglas_perfil_id_fkey";
            columns: ["perfil_id"];
            isOneToOne: false;
            referencedRelation: "perfiles";
            referencedColumns: ["id"];
          },
        ];
      };
      marca_gml_especial_vigente: {
        Row: {
          agrupacion_marca_id: string | null;
          genero_mundo_linea_id: string | null;
          marca_id: string | null;
          modalidad: string | null;
        };
        Relationships: [];
      };
      marcas_unidad: {
        Row: {
          cabeza_inactiva: boolean | null;
          en_conjunto: boolean | null;
          marca_id: string | null;
          unidad_marca_id: string | null;
        };
        Relationships: [];
      };
      venta_mensual_estacionalidad: {
        Row: {
          agrupacion_estacionalidad_id: string | null;
          costo_vendido: number | null;
          genero_id: string | null;
          linea_id: string | null;
          periodo: string | null;
          tienda_id: string | null;
          unidades: number | null;
          venta_soles: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "equivalencias_agrupacion_estacionalidad_id_fkey";
            columns: ["agrupacion_estacionalidad_id"];
            isOneToOne: false;
            referencedRelation: "agrupaciones_estacionalidad";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "genero_mundo_linea_genero_id_fkey";
            columns: ["genero_id"];
            isOneToOne: false;
            referencedRelation: "generos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "genero_mundo_linea_linea_id_fkey";
            columns: ["linea_id"];
            isOneToOne: false;
            referencedRelation: "lineas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "venta_stock_mensual_tienda_id_fkey";
            columns: ["tienda_id"];
            isOneToOne: false;
            referencedRelation: "tiendas";
            referencedColumns: ["id"];
          },
        ];
      };
      venta_stock_vigente: {
        Row: {
          agrupacion_talla_id: string | null;
          carga_id: string | null;
          costo_vendido: number | null;
          equivalencia_id: string | null;
          marca_id: string | null;
          periodo: string | null;
          stock_unidades: number | null;
          stock_valorizado: number | null;
          tienda_id: string | null;
          unidades: number | null;
          venta_soles: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "venta_stock_mensual_agrupacion_talla_id_fkey";
            columns: ["agrupacion_talla_id"];
            isOneToOne: false;
            referencedRelation: "agrupaciones_talla";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "venta_stock_mensual_carga_id_fkey";
            columns: ["carga_id"];
            isOneToOne: false;
            referencedRelation: "cargas_venta_stock";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "venta_stock_mensual_equivalencia_id_fkey";
            columns: ["equivalencia_id"];
            isOneToOne: false;
            referencedRelation: "equivalencias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "venta_stock_mensual_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "venta_stock_mensual_marca_id_fkey";
            columns: ["marca_id"];
            isOneToOne: false;
            referencedRelation: "marcas_unidad";
            referencedColumns: ["marca_id"];
          },
          {
            foreignKeyName: "venta_stock_mensual_tienda_id_fkey";
            columns: ["tienda_id"];
            isOneToOne: false;
            referencedRelation: "tiendas";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      cargas_pendientes_limpieza: {
        Args: Record<PropertyKey, never>;
        Returns: {
          carga_id: string;
          estado: string;
          filas: number;
        }[];
      };
      publicar_carga_venta_stock: {
        Args: {
          p_carga: string;
          p_costo: number;
          p_filas: number;
          p_stock_unidades: number;
          p_stock_valorizado: number;
          p_unidades: number;
          p_venta: number;
        };
        Returns: Json;
      };
      sugerir_marcas_relevantes: {
        Args: {
          p_desde: string;
          p_excluir: string[];
          p_hasta: string;
          p_top: number;
        };
        Returns: {
          agrupacion_marca_id: string;
          genero_mundo_linea_id: string;
          marca_id: string;
          participacion: number;
          rango: number;
          unidades: number;
          venta_soles: number;
        }[];
      };
      sugerir_marcas_relevantes_v2: {
        Args: {
          p_desde: string;
          p_excluir?: string[];
          p_hasta: string;
          p_medida?: string;
          p_min_participacion?: number;
          p_top?: number;
        };
        Returns: {
          agrupacion_marca_id: string;
          genero_mundo_linea_id: string;
          marca_id: string;
          participacion: number;
          rango: number;
          unidades: number;
          venta_soles: number;
        }[];
      };
      totales_cargas_publicadas: {
        Args: Record<PropertyKey, never>;
        Returns: {
          carga_id: string;
          costo_vendido: number;
          filas: number;
          periodo: string;
          stock_unidades: number;
          stock_valorizado: number;
          unidades: number;
          venta_soles: number;
        }[];
      };
      unidades_mensuales: {
        Args: {
          p_equivalencias?: string[];
        };
        Returns: {
          periodo: string;
          unidades: number;
          venta_soles: number;
        }[];
      };
      refrescar_venta_mensual_estacionalidad: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      refrescar_y_leer_agregado_estacionalidad: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      venta_mensual_tienda: {
        Args: Record<PropertyKey, never>;
        Returns: {
          periodo: string;
          tienda_id: string;
          unidades: number;
          venta_soles: number;
        }[];
      };
      venta_estacionalidad_agrupacion: {
        Args: {
          p_agrupacion_id?: string;
        };
        Returns: Json;
      };
      venta_composicion_agrupacion: {
        Args: {
          p_agrupacion_id: string;
          p_hasta: string;
          p_red: Json;
        };
        Returns: Json;
      };
      venta_genero_mundo: {
        Args: {
          p_desde: string;
        };
        Returns: Json;
      };
      venta_proyeccion: {
        Args: {
          p_desde: string;
          p_desde_w12: string;
          p_gml_ids: string[];
          p_grupos: Json;
          p_tiendas_detalle: string[];
        };
        Returns: Json;
      };
      venta_marca_gml: {
        Args: {
          p_desde: string;
          p_hasta: string;
          p_marca_ids: string[];
        };
        Returns: Json;
      };
      venta_marca_gml_resumen: {
        Args: {
          p_desde: string;
          p_hasta: string;
          p_umbral_pequeno?: number;
        };
        Returns: Json;
      };
      stock_flujo: {
        Args: {
          p_carga_id: string;
        };
        Returns: Json;
      };
      flujo_huella_base: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      compra_foto: {
        Args: {
          p_compra: string;
        };
        Returns: Json;
      };
      compra_recalcular_estado: {
        Args: {
          p_compra: string;
        };
        Returns: string;
      };
      importar_compra: {
        Args: {
          p_actor: Json;
          p_compra: Json;
        };
        Returns: Json;
      };
      registrar_recepciones: {
        Args: {
          p_actor: Json;
          p_compra: string;
          p_motivo: string;
          p_recepciones: Json;
          p_revision: number;
        };
        Returns: Json;
      };
      quitar_recepcion: {
        Args: {
          p_actor: Json;
          p_compra: string;
          p_recepcion: string;
          p_revision: number;
        };
        Returns: Json;
      };
      cancelar_compra: {
        Args: {
          p_actor: Json;
          p_compra: string;
          p_motivo: string;
          p_revision: number;
        };
        Returns: Json;
      };
      registrar_propuesta_ia_gm: {
        Args: {
          p: Json;
        };
        Returns: string;
      };
      venta_lineas_ia: {
        Args: {
          p_desde: string;
          p_gml_ids: string[];
          p_grupos: Json;
          p_hasta: string;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
