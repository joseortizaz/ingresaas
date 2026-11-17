import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { today } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/conduces/nueva")({
  component: NuevoConduce,
  validateSearch: (s: Record<string, unknown>) => ({ id: (s.id as string) || undefined }),
});

// Las funciones de conduces se crean con la migración 20261117120000; el cliente
// tipado (types.ts) se regenera después de aplicarla.
const sb = supabase as any;

type Linea = { descripcion: string; cantidad: number; unidad: string; producto_id?: string | null };
const UNIDADES = ["und", "caja", "paquete", "saco", "galón", "libra", "kg", "metro", "par", "docena"];

function NuevoConduce() {
  const navigate = useNavigate();
  const { id: editId } = Route.useSearch();
  const isEdit = !!editId;

  const { data: clientes } = useQuery({
    queryKey: ["clientes-sel-dir"],
    queryFn: async () => (await supabase.from("clientes").select("id, razon_social, documento, direccion").order("razon_social")).data ?? [],
  });
  const { data: productos } = useQuery({
    queryKey: ["productos-sel"],
    queryFn: async () => (await supabase.from("productos").select("id, nombre, codigo").eq("activo", true).order("nombre")).data ?? [],
  });

  const [clienteId, setClienteId] = useState("");
  const [fecha, setFecha] = useState(today());
  const [direccion, setDireccion] = useState("");
  const [transportista, setTransportista] = useState("");
  const [vehiculo, setVehiculo] = useState("");
  const [notas, setNotas] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([{ descripcion: "", cantidad: 1, unidad: "und" }]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      const { data: con } = await sb.from("conduces").select("*").eq("id", editId).maybeSingle();
      if (!con) return;
      if (con.estado !== "borrador") {
        toast.error("Solo se editan conduces en borrador");
        navigate({ to: "/conduces" });
        return;
      }
      setClienteId(con.cliente_id);
      setFecha(con.fecha);
      setDireccion(con.direccion_entrega ?? "");
      setTransportista(con.transportista ?? "");
      setVehiculo(con.vehiculo ?? "");
      setNotas(con.notas ?? "");
      const { data: ls } = await sb.from("conduce_lineas").select("descripcion, cantidad, unidad, producto_id").eq("conduce_id", editId);
      if (ls && ls.length) {
        setLineas(ls.map((l: any) => ({ descripcion: l.descripcion, cantidad: Number(l.cantidad), unidad: l.unidad, producto_id: l.producto_id })));
      }
    })();
  }, [editId, navigate]);

  const elegirCliente = (id: string) => {
    setClienteId(id);
    const c: any = (clientes ?? []).find((x: any) => x.id === id);
    // Sugiere la dirección del cliente si todavía no se escribió una de entrega.
    if (c?.direccion && !direccion.trim()) setDireccion(c.direccion);
  };

  const setLinea = (i: number, p: Partial<Linea>) => setLineas(lineas.map((l, idx) => (idx === i ? { ...l, ...p } : l)));
  const seleccionarProducto = (i: number, productoId: string) => {
    const p: any = (productos ?? []).find((x: any) => x.id === productoId);
    if (!p) return;
    setLinea(i, { producto_id: p.id, descripcion: p.codigo ? `${p.codigo} — ${p.nombre}` : p.nombre });
  };
  const addLinea = () => setLineas([...lineas, { descripcion: "", cantidad: 1, unidad: "und" }]);
  const delLinea = (i: number) => setLineas(lineas.length > 1 ? lineas.filter((_, idx) => idx !== i) : lineas);

  const guardar = async () => {
    if (!clienteId) return toast.error("Selecciona un cliente");
    if (lineas.some((l) => !l.descripcion.trim() || !(l.cantidad > 0))) return toast.error("Revisa las líneas: descripción y cantidad mayor que cero");
    setLoading(true);
    const args = {
      _cliente_id: clienteId, _fecha: fecha, _direccion_entrega: direccion, _transportista: transportista,
      _vehiculo: vehiculo, _notas: notas, _lineas: lineas,
    };
    const { error } = isEdit
      ? await sb.rpc("actualizar_conduce", { _conduce_id: editId, ...args })
      : await sb.rpc("crear_conduce", args);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success(isEdit ? "Conduce actualizado" : "Conduce creado");
    navigate({ to: "/conduces" });
  };

  return (
    <div>
      <PageHeader
        title={isEdit ? "Editar conduce" : "Nuevo conduce"}
        description="Nota de entrega sin precios; no afecta inventario ni contabilidad"
      />
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Cliente</Label>
              <Select value={clienteId} onValueChange={elegirCliente}>
                <SelectTrigger><SelectValue placeholder="Selecciona cliente" /></SelectTrigger>
                <SelectContent>
                  {(clientes ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.razon_social} — {c.documento}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
            <div><Label>Vehículo / placa</Label><Input value={vehiculo} onChange={(e) => setVehiculo(e.target.value)} placeholder="Opcional" /></div>
            <div className="col-span-2"><Label>Dirección de entrega</Label><Input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Lugar donde se entrega la mercancía" /></div>
            <div className="col-span-2"><Label>Transportista / chofer</Label><Input value={transportista} onChange={(e) => setTransportista(e.target.value)} placeholder="Opcional" /></div>
            <div className="col-span-2"><Label>Notas</Label><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Instrucciones de entrega, observaciones…" /></div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Mercancía</Label>
              <Button size="sm" variant="outline" onClick={addLinea}><Plus className="h-4 w-4 mr-1" />Agregar</Button>
            </div>
            <div className="space-y-2">
              {lineas.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-6 space-y-1">
                    <Select onValueChange={(v) => seleccionarProducto(i, v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Elegir producto…" /></SelectTrigger>
                      <SelectContent>
                        {(productos ?? []).map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>{p.codigo ? `${p.codigo} — ` : ""}{p.nombre}</SelectItem>
                        ))}
                        {(!productos || productos.length === 0) && <div className="px-2 py-1 text-xs text-muted-foreground">Sin productos</div>}
                      </SelectContent>
                    </Select>
                    <Input placeholder="Descripción" value={l.descripcion} onChange={(e) => setLinea(i, { descripcion: e.target.value })} />
                  </div>
                  <div className="col-span-2"><Input type="number" step="0.001" min="0" value={l.cantidad} onChange={(e) => setLinea(i, { cantidad: Number(e.target.value) })} /></div>
                  <div className="col-span-3">
                    <Select value={l.unidad} onValueChange={(v) => setLinea(i, { unidad: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {UNIDADES.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-1"><Button variant="ghost" size="icon" onClick={() => delLinea(i)}><Trash2 className="h-4 w-4" /></Button></div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-5 h-fit space-y-3">
          <h3 className="font-semibold">Resumen</h3>
          <div className="flex justify-between text-sm"><span>Líneas</span><span>{lineas.length}</span></div>
          <div className="flex justify-between text-sm"><span>Total de unidades</span><span>{lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0)}</span></div>
          <p className="text-xs text-muted-foreground">El conduce no lleva precios. Se numera automáticamente (CON-000001…).</p>
          <Button className="w-full" onClick={guardar} disabled={loading}>{loading ? "Guardando…" : "Guardar conduce"}</Button>
        </Card>
      </div>
    </div>
  );
}
