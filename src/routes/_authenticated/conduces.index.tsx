import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, FileDown, Truck, PackageCheck, Ban, Undo2 } from "lucide-react";
import { fmtDate, today } from "@/lib/format";
import { toast } from "sonner";
import { generateConducePdf } from "@/lib/conduce-pdf";

export const Route = createFileRoute("/_authenticated/conduces/")({ component: Conduces });

// Las tablas y funciones de conduces se crean con la migración 20261117120000;
// el cliente tipado (types.ts) se regenera después de aplicarla.
const sb = supabase as any;

type Estado = "borrador" | "despachado" | "entregado" | "anulado";

function Conduces() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, error: errLista } = useQuery({
    queryKey: ["conduces"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("conduces")
        .select("*, clientes(razon_social), facturas(ncf)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Diálogo de entrega (quién recibió) y de anulación (motivo)
  const [entrega, setEntrega] = useState<any | null>(null);
  const [recibidoPor, setRecibidoPor] = useState("");
  const [fechaEntrega, setFechaEntrega] = useState(today());
  const [anular, setAnular] = useState<any | null>(null);
  const [motivo, setMotivo] = useState("");

  const cambiarEstado = useMutation({
    mutationFn: async (a: { id: string; estado: Estado; recibido_por?: string; fecha_entrega?: string; motivo?: string }) => {
      const { error } = await sb.rpc("cambiar_estado_conduce", {
        _conduce_id: a.id,
        _estado: a.estado,
        _recibido_por: a.recibido_por ?? null,
        _fecha_entrega: a.fecha_entrega ?? null,
        _motivo: a.motivo ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conduces"] });
      toast.success("Estado actualizado");
      setEntrega(null);
      setAnular(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const descargarPdf = async (id: string) => {
    try {
      const [{ data: con }, { data: lineas }, { data: tenantRows }] = await Promise.all([
        sb.from("conduces").select("*, clientes(razon_social, documento, email, telefono, direccion), facturas(ncf)").eq("id", id).maybeSingle(),
        sb.from("conduce_lineas").select("descripcion, cantidad, unidad").eq("conduce_id", id),
        supabase.from("tenants").select("razon_social, nombre_comercial, rnc, direccion, telefono, logo_url").limit(1),
      ]);
      if (!con) return toast.error("Conduce no encontrado");
      const t: any = (tenantRows ?? [])[0] ?? {};
      let logoUrl: string | null = null;
      if (t.logo_url) {
        const { data: sig } = await supabase.storage.from("tenant-assets").createSignedUrl(t.logo_url, 3600);
        logoUrl = sig?.signedUrl ?? null;
      }
      const doc = await generateConducePdf({
        conduce: con,
        lineas: lineas ?? [],
        empresa: { ...t, logoUrl },
      });
      doc.save(`${con.numero}.pdf`);
    } catch (e: any) {
      toast.error(e?.message ?? "Error al generar PDF");
    }
  };

  const colorEstado = (e: string) =>
    ({
      borrador: "text-muted-foreground",
      despachado: "text-blue-600",
      entregado: "text-green-600",
      anulado: "text-destructive",
    } as Record<string, string>)[e] ?? "";

  return (
    <div>
      <PageHeader
        title="Conduces"
        description="Notas de entrega de mercancía a clientes (no afectan inventario ni contabilidad)"
        action={
          <Link to="/conduces/nueva" search={{ id: undefined }}>
            <Button><Plus className="h-4 w-4 mr-2" />Nuevo conduce</Button>
          </Link>
        }
      />
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary"><tr>
            <th className="text-left p-3">Número</th>
            <th className="text-left p-3">Fecha</th>
            <th className="text-left p-3">Cliente</th>
            <th className="text-left p-3">Factura</th>
            <th className="text-left p-3">Estado</th>
            <th className="text-right p-3">Acciones</th>
          </tr></thead>
          <tbody>
            {(data ?? []).map((c: any) => (
              <tr key={c.id} className="border-t border-border">
                <td className="p-3 font-mono">{c.numero}</td>
                <td className="p-3">{fmtDate(c.fecha)}</td>
                <td className="p-3">{c.clientes?.razon_social}</td>
                <td className="p-3 font-mono text-xs">{c.facturas?.ncf ?? "—"}</td>
                <td className="p-3">
                  <span className={colorEstado(c.estado)}>{c.estado}</span>
                  {c.estado === "entregado" && c.recibido_por && (
                    <div className="text-xs text-muted-foreground">Recibió: {c.recibido_por}</div>
                  )}
                  {c.estado === "anulado" && c.motivo_anulacion && (
                    <div className="text-xs text-muted-foreground">{c.motivo_anulacion}</div>
                  )}
                </td>
                <td className="p-3 text-right space-x-1 whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => descargarPdf(c.id)}>
                    <FileDown className="h-3 w-3 mr-1" />PDF
                  </Button>
                  {c.estado === "borrador" && (
                    <Link to="/conduces/nueva" search={{ id: c.id }}>
                      <Button size="sm" variant="ghost"><Pencil className="h-3 w-3 mr-1" />Editar</Button>
                    </Link>
                  )}
                  {c.estado === "borrador" && (
                    <Button size="sm" variant="outline" onClick={() => cambiarEstado.mutate({ id: c.id, estado: "despachado" })}>
                      <Truck className="h-3 w-3 mr-1" />Despachar
                    </Button>
                  )}
                  {(c.estado === "borrador" || c.estado === "despachado") && (
                    <Button size="sm" onClick={() => { setEntrega(c); setRecibidoPor(""); setFechaEntrega(today()); }}>
                      <PackageCheck className="h-3 w-3 mr-1" />Entregado
                    </Button>
                  )}
                  {c.estado === "despachado" && (
                    <Button size="sm" variant="ghost" onClick={() => cambiarEstado.mutate({ id: c.id, estado: "borrador" })}>
                      <Undo2 className="h-3 w-3 mr-1" />Borrador
                    </Button>
                  )}
                  {(c.estado === "borrador" || c.estado === "despachado") && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setAnular(c); setMotivo(""); }}>
                      <Ban className="h-3 w-3 mr-1" />Anular
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {errLista && <tr><td colSpan={6} className="p-6 text-center text-destructive">No se pudieron cargar los conduces: {(errLista as any).message}</td></tr>}
            {!errLista && (!data || data.length === 0) && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Sin conduces</td></tr>}
          </tbody>
        </table>
      </Card>

      <Dialog open={!!entrega} onOpenChange={(o) => !o && setEntrega(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar entrega — {entrega?.numero}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Recibido por</Label>
              <Input value={recibidoPor} onChange={(e) => setRecibidoPor(e.target.value)} placeholder="Nombre de quien recibe (opcional)" />
            </div>
            <div>
              <Label>Fecha de entrega</Label>
              <Input type="date" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEntrega(null)}>Cancelar</Button>
            <Button
              disabled={cambiarEstado.isPending}
              onClick={() => cambiarEstado.mutate({ id: entrega.id, estado: "entregado", recibido_por: recibidoPor, fecha_entrega: fechaEntrega })}
            >Marcar como entregado</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!anular} onOpenChange={(o) => !o && setAnular(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Anular conduce — {anular?.numero}</DialogTitle></DialogHeader>
          <div>
            <Label>Motivo</Label>
            <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Obligatorio" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAnular(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={!motivo.trim() || cambiarEstado.isPending}
              onClick={() => cambiarEstado.mutate({ id: anular.id, estado: "anulado", motivo })}
            >Anular conduce</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
