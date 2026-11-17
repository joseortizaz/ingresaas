-- Conduces (notas de entrega): documento de despacho de mercancía al cliente.
-- Mismo patrón que cotizaciones (numeración CON-000001, borrador → despachado →
-- entregado). No mueve inventario ni genera asientos contables. Puede crearse en
-- blanco o a partir de una factura (copia cliente y líneas).
-- Las funciones usan current_tenant_id(), así que respetan la exigencia de 2FA.

CREATE TYPE public.estado_conduce AS ENUM ('borrador', 'despachado', 'entregado', 'anulado');

CREATE TABLE public.conduces (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  numero           text NOT NULL,
  cliente_id       uuid NOT NULL REFERENCES public.clientes(id),
  factura_id       uuid REFERENCES public.facturas(id) ON DELETE SET NULL,
  fecha            date NOT NULL DEFAULT CURRENT_DATE,
  direccion_entrega text,
  transportista    text,
  vehiculo         text,
  notas            text,
  estado           public.estado_conduce NOT NULL DEFAULT 'borrador',
  recibido_por     text,
  fecha_entrega    date,
  motivo_anulacion text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, numero)
);

CREATE TABLE public.conduce_lineas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conduce_id  uuid NOT NULL REFERENCES public.conduces(id) ON DELETE CASCADE,
  descripcion text NOT NULL,
  cantidad    numeric(14,3) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  unidad      text NOT NULL DEFAULT 'und',
  producto_id uuid REFERENCES public.productos(id) ON DELETE SET NULL
);

CREATE INDEX conduces_tenant_fecha_idx ON public.conduces (tenant_id, fecha DESC);
CREATE INDEX conduces_factura_idx ON public.conduces (factura_id);
CREATE INDEX conduce_lineas_conduce_idx ON public.conduce_lineas (conduce_id);

ALTER TABLE public.conduces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conduce_lineas ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conduces, public.conduce_lineas TO authenticated;
GRANT ALL ON public.conduces, public.conduce_lineas TO service_role;

CREATE POLICY con_select ON public.conduces FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY con_insert ON public.conduces FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND (
    public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'contador') OR public.has_role(auth.uid(), 'agente_facturacion')));
CREATE POLICY con_update ON public.conduces FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (
    public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'contador') OR public.has_role(auth.uid(), 'agente_facturacion')))
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY con_delete ON public.conduces FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (
    public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'contador')));

CREATE POLICY conl_select ON public.conduce_lineas FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY conl_insert ON public.conduce_lineas FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND (
    public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'contador') OR public.has_role(auth.uid(), 'agente_facturacion')));
CREATE POLICY conl_update ON public.conduce_lineas FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (
    public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'contador') OR public.has_role(auth.uid(), 'agente_facturacion')))
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY conl_delete ON public.conduce_lineas FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (
    public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'contador')));

-- ───────────────────────── Crear ─────────────────────────
CREATE OR REPLACE FUNCTION public.crear_conduce(
  _cliente_id uuid, _fecha date, _direccion_entrega text, _transportista text,
  _vehiculo text, _notas text, _lineas jsonb, _factura_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _user uuid := auth.uid();
  _id uuid; _next bigint; _numero text; _line jsonb;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Sin empresa'; END IF;
  IF NOT (public.has_role(_user, 'administrador') OR public.has_role(_user, 'contador') OR public.has_role(_user, 'agente_facturacion')) THEN
    RAISE EXCEPTION 'Sin permiso para crear conduces';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = _cliente_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;
  IF _factura_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.facturas WHERE id = _factura_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;
  IF _lineas IS NULL OR jsonb_typeof(_lineas) <> 'array' OR jsonb_array_length(_lineas) = 0 THEN
    RAISE EXCEPTION 'El conduce necesita al menos una línea';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('conduce:' || _tenant::text));
  SELECT COALESCE(MAX(SUBSTRING(numero FROM 'CON-(\d+)')::bigint), 0) + 1
    INTO _next FROM public.conduces WHERE tenant_id = _tenant;
  _numero := 'CON-' || lpad(_next::text, 6, '0');

  INSERT INTO public.conduces(tenant_id, numero, cliente_id, factura_id, fecha, direccion_entrega,
                              transportista, vehiculo, notas, created_by)
  VALUES (_tenant, _numero, _cliente_id, _factura_id, COALESCE(_fecha, CURRENT_DATE),
          NULLIF(btrim(_direccion_entrega), ''), NULLIF(btrim(_transportista), ''),
          NULLIF(btrim(_vehiculo), ''), NULLIF(btrim(_notas), ''), _user)
  RETURNING id INTO _id;

  FOR _line IN SELECT * FROM jsonb_array_elements(_lineas) LOOP
    IF COALESCE(btrim(_line->>'descripcion'), '') = '' OR COALESCE((_line->>'cantidad')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Cada línea necesita descripción y cantidad mayor que cero';
    END IF;
    INSERT INTO public.conduce_lineas(tenant_id, conduce_id, descripcion, cantidad, unidad, producto_id)
    VALUES (_tenant, _id, btrim(_line->>'descripcion'), (_line->>'cantidad')::numeric,
            COALESCE(NULLIF(btrim(_line->>'unidad'), ''), 'und'),
            NULLIF(_line->>'producto_id', '')::uuid);
  END LOOP;

  RETURN _id;
END $$;

-- ───────────────────────── Actualizar (solo borrador) ─────────────────────────
CREATE OR REPLACE FUNCTION public.actualizar_conduce(
  _conduce_id uuid, _cliente_id uuid, _fecha date, _direccion_entrega text, _transportista text,
  _vehiculo text, _notas text, _lineas jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _user uuid := auth.uid();
  _con RECORD; _line jsonb;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Sin empresa'; END IF;
  IF NOT (public.has_role(_user, 'administrador') OR public.has_role(_user, 'contador') OR public.has_role(_user, 'agente_facturacion')) THEN
    RAISE EXCEPTION 'Sin permiso para editar conduces';
  END IF;
  SELECT * INTO _con FROM public.conduces WHERE id = _conduce_id AND tenant_id = _tenant;
  IF _con IS NULL THEN RAISE EXCEPTION 'Conduce no encontrado'; END IF;
  IF _con.estado <> 'borrador' THEN RAISE EXCEPTION 'Solo se pueden editar conduces en borrador'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = _cliente_id AND tenant_id = _tenant) THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;
  IF _lineas IS NULL OR jsonb_typeof(_lineas) <> 'array' OR jsonb_array_length(_lineas) = 0 THEN
    RAISE EXCEPTION 'El conduce necesita al menos una línea';
  END IF;

  UPDATE public.conduces SET
    cliente_id = _cliente_id, fecha = COALESCE(_fecha, fecha),
    direccion_entrega = NULLIF(btrim(_direccion_entrega), ''),
    transportista = NULLIF(btrim(_transportista), ''),
    vehiculo = NULLIF(btrim(_vehiculo), ''),
    notas = NULLIF(btrim(_notas), '')
  WHERE id = _conduce_id;

  DELETE FROM public.conduce_lineas WHERE conduce_id = _conduce_id;
  FOR _line IN SELECT * FROM jsonb_array_elements(_lineas) LOOP
    IF COALESCE(btrim(_line->>'descripcion'), '') = '' OR COALESCE((_line->>'cantidad')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Cada línea necesita descripción y cantidad mayor que cero';
    END IF;
    INSERT INTO public.conduce_lineas(tenant_id, conduce_id, descripcion, cantidad, unidad, producto_id)
    VALUES (_tenant, _conduce_id, btrim(_line->>'descripcion'), (_line->>'cantidad')::numeric,
            COALESCE(NULLIF(btrim(_line->>'unidad'), ''), 'und'),
            NULLIF(_line->>'producto_id', '')::uuid);
  END LOOP;

  RETURN _conduce_id;
END $$;

-- ───────────────────────── Desde una factura ─────────────────────────
CREATE OR REPLACE FUNCTION public.crear_conduce_desde_factura(_factura_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _f RECORD; _lineas jsonb;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Sin empresa'; END IF;
  SELECT * INTO _f FROM public.facturas WHERE id = _factura_id AND tenant_id = _tenant;
  IF _f IS NULL THEN RAISE EXCEPTION 'Factura no encontrada'; END IF;
  IF _f.estado = 'anulada' THEN RAISE EXCEPTION 'No se puede crear un conduce de una factura anulada'; END IF;

  SELECT jsonb_agg(jsonb_build_object('descripcion', descripcion, 'cantidad', cantidad,
                                      'unidad', 'und', 'producto_id', producto_id))
    INTO _lineas FROM public.factura_lineas WHERE factura_id = _factura_id AND tenant_id = _tenant;
  IF _lineas IS NULL THEN RAISE EXCEPTION 'La factura no tiene líneas'; END IF;

  RETURN public.crear_conduce(
    _f.cliente_id, CURRENT_DATE,
    (SELECT direccion FROM public.clientes WHERE id = _f.cliente_id),
    NULL, NULL, NULL, _lineas, _factura_id);
END $$;

-- ───────────────────────── Cambiar estado ─────────────────────────
-- borrador → despachado → entregado ; anular desde borrador o despachado.
CREATE OR REPLACE FUNCTION public.cambiar_estado_conduce(
  _conduce_id uuid, _estado public.estado_conduce,
  _recibido_por text DEFAULT NULL, _fecha_entrega date DEFAULT NULL, _motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _user uuid := auth.uid();
  _con RECORD;
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Sin empresa'; END IF;
  IF NOT (public.has_role(_user, 'administrador') OR public.has_role(_user, 'contador') OR public.has_role(_user, 'agente_facturacion')) THEN
    RAISE EXCEPTION 'Sin permiso';
  END IF;
  SELECT * INTO _con FROM public.conduces WHERE id = _conduce_id AND tenant_id = _tenant;
  IF _con IS NULL THEN RAISE EXCEPTION 'Conduce no encontrado'; END IF;

  IF _estado = 'despachado' AND _con.estado = 'borrador' THEN
    UPDATE public.conduces SET estado = 'despachado' WHERE id = _conduce_id;
  ELSIF _estado = 'entregado' AND _con.estado IN ('borrador', 'despachado') THEN
    UPDATE public.conduces SET estado = 'entregado',
      recibido_por = NULLIF(btrim(_recibido_por), ''),
      fecha_entrega = COALESCE(_fecha_entrega, CURRENT_DATE)
    WHERE id = _conduce_id;
  ELSIF _estado = 'anulado' AND _con.estado IN ('borrador', 'despachado') THEN
    IF COALESCE(btrim(_motivo), '') = '' THEN RAISE EXCEPTION 'Indica el motivo de la anulación'; END IF;
    UPDATE public.conduces SET estado = 'anulado', motivo_anulacion = btrim(_motivo) WHERE id = _conduce_id;
  ELSIF _estado = 'borrador' AND _con.estado = 'despachado' THEN
    UPDATE public.conduces SET estado = 'borrador' WHERE id = _conduce_id;
  ELSE
    RAISE EXCEPTION 'Cambio de estado no permitido (% → %)', _con.estado, _estado;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.crear_conduce(uuid, date, text, text, text, text, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.actualizar_conduce(uuid, uuid, date, text, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crear_conduce_desde_factura(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cambiar_estado_conduce(uuid, public.estado_conduce, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_conduce(uuid, date, text, text, text, text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_conduce(uuid, uuid, date, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_conduce_desde_factura(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_conduce(uuid, public.estado_conduce, text, date, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
