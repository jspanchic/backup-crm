-- DEMO data for looking at the panel. Fictitious people, no real customers. Never load in production.
-- Safe to run again: it does nothing if the demo contacts exist.
do $$
declare
  v_brand core.brands;
  v_technician bigint;
  v_contact bigint;
  v_deal bigint;
  v_start timestamptz;
  v_appointment bigint;
  v_day timestamptz := date_trunc('day', now());
  r record;
begin
  if exists (select 1 from public.contacts where last_name = '(demo)' and first_name = 'Carlos') then
    return;
  end if;
  select * into v_brand from core.brands where id = 1;
  select id into v_technician from core.technicians where brand_id = 1 order by id limit 1;

  for r in
    select * from (values
      ('Carlos', 'cold',  'opportunity',    'home',     0, 'Nueva consulta'),
      ('Ana',    'warm',  'proposal-sent',  'home',     1, 'Servicio hogar 3 dormitorios'),
      ('Luis',   'hot',   'won',            'business', 2, 'Oficina 8.000 pies'),
      ('Rosa',   'warm',  'contacted',      'home',     3, 'Casa con garaje'),
      ('Prueba', 'cold',  'opportunity',    'home',     4, 'Servicio de prueba')
    ) as t(first_name, status, stage, client_type, n, deal_name)
  loop
    insert into public.contacts (first_name, last_name, status, brand_id, sales_id, first_seen, last_seen, email_jsonb, phone_jsonb, preferred_language)
    values (
      r.first_name, case when r.first_name = 'Prueba' then 'Sebas' else '(demo)' end, r.status, 1, v_brand.default_sales_id,
      now() - make_interval(days => r.n + 1), now() - make_interval(hours => r.n),
      jsonb_build_array(jsonb_build_object('email', lower(r.first_name) || '@example.test', 'type', 'Work')),
      jsonb_build_array(jsonb_build_object('number', '+1202555010' || r.n, 'type', 'Mobile')), 'es'
    )
    returning id into v_contact;

    insert into public.deals (name, stage, contact_ids, primary_contact_id, brand_id, sales_id, index, client_type, zip, service_address, amount)
    values (r.deal_name, r.stage, array[v_contact], v_contact, 1, v_brand.default_sales_id, 0, r.client_type, '3280' || r.n,
            case when r.stage in ('won', 'proposal-sent') then (100 + r.n) || ' Demo St, Orlando' end,
            case when r.stage in ('won', 'proposal-sent') then 200 + r.n * 100 end)
    returning id into v_deal;

    -- Two appointments: Ana holds one, Luis has a confirmed one. The test lead holds another.
    if r.first_name in ('Ana', 'Luis', 'Prueba') and v_technician is not null then
      v_start := v_day + make_interval(days => 3 + r.n, hours => 14);
      insert into core.appointments (deal_id, contact_id, technician_id, start_at, end_at, address)
      values (v_deal, v_contact, v_technician, v_start, v_start + interval '1 hour', (100 + r.n) || ' Demo St, Orlando')
      returning id into v_appointment;
      if r.first_name = 'Luis' then
        update core.appointments set status = 'confirmed' where id = v_appointment;
      end if;
    end if;
  end loop;
end
$$;
