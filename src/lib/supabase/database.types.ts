/**
 * Tipos de la base de datos.
 *
 * Verificados el 2026-10-13 (0011, M6 paso 1) contra `generate_typescript_types` del proyecto
 * Supabase `Vector2` (ref tzjsxzmsvvhxyiooihyq): mismas tablas, columnas,
 * obligatoriedad y claves foráneas. Se regeneran después de cada migración.
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
          updated_at?: string;
        };
        Relationships: [];
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
          tipo?: string;
          updated_at?: string;
          venta_esperada_promedio?: number | null;
          zona?: string | null;
        };
        Relationships: [];
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
