-- PRESENTATION data: fictitious people and businesses in Orlando and Chicago, every row marked is_test.
-- Phones are in the 555-01xx range reserved for fiction. No appointments, documents or conversations.
-- Safe to run again: it does nothing if the presentation contacts exist. Dev databases only.
do $$
declare
  v_brand core.brands;
  v_company bigint;
  v_contact bigint;
  v_deal bigint;
  r record;
begin
  if exists (select 1 from public.contacts where is_test and phone_jsonb @> '[{"number": "+14075550111"}]'::jsonb) then
    return;
  end if;
  select * into v_brand from core.brands where id = 1;

  for r in
    select * from (values
      -- first, last, city, state, phone, company, sector, status, stage, client_type, space, deal name, amount, days ago, size, address
      ('María',   'Fernández', 'Orlando', 'FL', '+14075550111', 'Café Aroma Orlando',      'food',   'warm', 'proposal-sent', 'business', 'restaurant_kitchen', 'Café Aroma Orlando – Cocina y comedor, 1.800 pies',     780,  4, '1.800 pies cuadrados', '215 Orange Ave, Orlando, FL 32801', '32801'),
      ('Daniel',  'Ortiz',     'Orlando', 'FL', '+14075550112', null,                      null,     'cold', 'opportunity',   'home',     'home',               'Daniel Ortiz – Casa de 4 dormitorios, 2.600 pies',     null, 1, '2.600 pies cuadrados', null,                                '32819'),
      ('Laura',   'Bennett',   'Chicago', 'IL', '+13125550113', 'Lakeview Dental Group',   'health', 'hot',  'assessment',    'business', 'clinic',             'Lakeview Dental Group – Clínica, 3.200 pies',          1450,  6, '3.200 pies cuadrados', '3150 N Broadway, Chicago, IL 60657', '60657'),
      ('Marcus',  'Johnson',   'Chicago', 'IL', '+13125550114', 'Windy City Fitness',      'fitness','hot',  'won',           'business', 'gym',                'Windy City Fitness – Gimnasio, 6.500 pies',            2100, 12, '6.500 pies cuadrados', '910 W Randolph St, Chicago, IL 60607', '60607'),
      ('Sofía',   'Ramírez',   'Orlando', 'FL', '+14075550115', null,                      null,     'cold', 'opportunity',   'home',     'home',               'Sofía Ramírez – Departamento de 2 dormitorios, 1.100 pies', null, 0, '1.100 pies cuadrados', null,                           '32806'),
      ('Kevin',   'O''Brien',  'Chicago', 'IL', '+13125550116', 'O''Brien & Hale Offices', 'office', 'cold', 'lost',          'business', 'office_warehouse',   'O''Brien & Hale Offices – Oficinas, 4.000 pies',        950, 13, '4.000 pies cuadrados', '233 S Wacker Dr, Chicago, IL 60606', '60606'),
      ('Patricia','Nguyen',    'Orlando', 'FL', '+14075550117', 'Little Stars Daycare',    'school', 'warm', 'proposal-sent', 'business', 'school_daycare',     'Little Stars Daycare – Guardería, 2.400 pies',         1200,  3, '2.400 pies cuadrados', '4800 S Kirkman Rd, Orlando, FL 32811', '32811'),
      ('Andrés',  'Salazar',   'Chicago', 'IL', '+13125550118', null,                      null,     'warm', 'assessment',    'home',     'home',               'Andrés Salazar – Casa de 3 dormitorios, 1.900 pies',    380,  9, '1.900 pies cuadrados', '1420 W Fullerton Ave, Chicago, IL 60614', '60614'),
      ('Carla',   'Mendoza',   'Orlando', 'FL', '+14075550119', null,                      null,     'cold', 'opportunity',   'home',     'home',               'Carla Mendoza – Departamento de 3 dormitorios, 1.400 pies', null, 2, '1.400 pies cuadrados', null,                           '32804'),
      ('Jason',   'Reed',      'Chicago', 'IL', '+13125550120', null,                      null,     'warm', 'proposal-sent', 'home',     'home',               'Jason Reed – Casa de 2 dormitorios, 1.500 pies',        320,  7, '1.500 pies cuadrados', '2210 N Clark St, Chicago, IL 60614', '60614'),
      ('Elena',   'Torres',    'Orlando', 'FL', '+14075550121', null,                      null,     'hot',  'won',           'home',     'home',               'Elena Torres – Casa de 3 dormitorios, 2.000 pies',      400, 10, '2.000 pies cuadrados', '640 Lake Ave, Orlando, FL 32801', '32801'),
      ('Tom',     'Alvarez',   'Chicago', 'IL', '+13125550122', null,                      null,     'cold', 'opportunity',   'home',     'home',               'Tom Alvarez – Casa de 4 dormitorios, 2.800 pies',      null,  5, '2.800 pies cuadrados', null,                                '60618')
    ) as t(first_name, last_name, city, state, phone, company_name, sector, status, stage, client_type, space, deal_name, amount, days_ago, size, address, zip)
  loop
    v_company := null;
    if r.company_name is not null then
      insert into public.companies (name, sector, city, state_abbr, country, address, zipcode, phone_number, sales_id, created_at)
      values (r.company_name, r.sector, r.city, r.state, 'EE. UU.', r.address, r.zip, r.phone, v_brand.default_sales_id, now() - make_interval(days => r.days_ago))
      returning id into v_company;
    end if;

    insert into public.contacts (first_name, last_name, status, brand_id, is_test, sales_id, company_id, first_seen, last_seen, email_jsonb, phone_jsonb, preferred_language, background)
    values (
      r.first_name, r.last_name, r.status, 1, true, v_brand.default_sales_id, v_company,
      now() - make_interval(days => r.days_ago), now() - make_interval(hours => 2 + r.days_ago * 3),
      jsonb_build_array(jsonb_build_object('email', lower(regexp_replace(translate(r.first_name || '.' || r.last_name, 'áéíóúñÁÉÍÓÚ''', 'aeiounAEIOU'), '[^A-Za-z.]', '', 'g')) || '@example.test', 'type', 'Work')),
      jsonb_build_array(jsonb_build_object('number', r.phone, 'type', 'Mobile')),
      'es',
      r.city || ', ' || r.state
    )
    returning id into v_contact;

    insert into public.deals (name, stage, company_id, contact_ids, primary_contact_id, brand_id, is_test, sales_id, index, client_type, service_space_type, service_space_size, service_address, zip, amount, created_at, updated_at)
    values (
      r.deal_name, r.stage, v_company, array[v_contact], v_contact, 1, true, v_brand.default_sales_id, 0, r.client_type, r.space, r.size, r.address, r.zip, r.amount,
      now() - make_interval(days => r.days_ago), now() - make_interval(hours => 3 + r.days_ago * 2)
    )
    returning id into v_deal;

    -- Notes and tasks
    if r.first_name = 'María' then
      insert into public.contact_notes (contact_id, text, date, sales_id, status, is_test)
      values (v_contact, 'Prefiere que la aplicación sea un lunes, cuando el café cierra. Pidió que no se use nada con olor fuerte en el comedor.', now() - interval '3 days', v_brand.default_sales_id, 'warm', true);
      insert into public.deal_notes (deal_id, type, text, date, sales_id, is_test)
      values (v_deal, 'Nota', 'Cotización enviada: cocina y comedor, 1.800 pies cuadrados. Espera aprobación del dueño.', now() - interval '2 days', v_brand.default_sales_id, true);
      insert into public.tasks (contact_id, type, text, due_date, sales_id, is_test)
      values (v_contact, 'follow-up', 'Llamar a María para confirmar si aprueban la propuesta', now() + interval '1 day', v_brand.default_sales_id, true);
    elsif r.first_name = 'Laura' then
      insert into public.contact_notes (contact_id, text, date, sales_id, status, is_test)
      values (v_contact, 'La clínica atiende de lunes a sábado. La visita de evaluación debe ser después de las 6 p. m.', now() - interval '5 days', v_brand.default_sales_id, 'hot', true);
      insert into public.deal_notes (deal_id, type, text, date, sales_id, is_test)
      values (v_deal, 'Nota', 'Visita de evaluación coordinada. Llevar medidor de humedad para la sala de esterilización.', now() - interval '4 days', v_brand.default_sales_id, true);
      insert into public.tasks (contact_id, type, text, due_date, sales_id, is_test)
      values (v_contact, 'assessment', 'Confirmar la visita de evaluación con Laura', now() + interval '2 days', v_brand.default_sales_id, true);
    elsif r.first_name = 'Marcus' then
      insert into public.contact_notes (contact_id, text, date, sales_id, status, is_test)
      values (v_contact, 'Cliente contratado. Quiere repetir el servicio cada seis meses.', now() - interval '1 day', v_brand.default_sales_id, 'in-contract', true);
      insert into public.tasks (contact_id, type, text, due_date, sales_id, is_test)
      values (v_contact, 'thank-you', 'Enviar mensaje de agradecimiento a Marcus', now() + interval '3 days', v_brand.default_sales_id, true);
    elsif r.first_name = 'Kevin' then
      insert into public.deal_notes (deal_id, type, text, date, sales_id, is_test)
      values (v_deal, 'Nota', 'Eligió a otro proveedor por precio. Volver a escribirle en tres meses.', now() - interval '1 day', v_brand.default_sales_id, true);
    elsif r.first_name = 'Patricia' then
      insert into public.contact_notes (contact_id, text, date, sales_id, status, is_test)
      values (v_contact, 'Pidió información sobre los productos que se usan alrededor de niños.', now() - interval '2 days', v_brand.default_sales_id, 'warm', true);
      insert into public.tasks (contact_id, type, text, due_date, sales_id, is_test)
      values (v_contact, 'quotation', 'Enviar a Patricia la ficha del producto aprobado', now() + interval '1 day', v_brand.default_sales_id, true);
    elsif r.first_name = 'Andrés' then
      insert into public.tasks (contact_id, type, text, due_date, sales_id, is_test)
      values (v_contact, 'call', 'Llamar a Andrés antes de la evaluación', now() + interval '4 days', v_brand.default_sales_id, true);
    elsif r.first_name = 'Carla' then
      insert into public.tasks (contact_id, type, text, due_date, sales_id, is_test)
      values (v_contact, 'call', 'Llamar a Carla para confirmar el tamaño del departamento', now() + interval '1 day', v_brand.default_sales_id, true);
    elsif r.first_name = 'Tom' then
      insert into public.tasks (contact_id, type, text, due_date, sales_id, is_test)
      values (v_contact, 'whatsapp', 'Escribir a Tom para agendar la evaluación', now() - interval '1 day', v_brand.default_sales_id, true);
    elsif r.first_name = 'Jason' then
      insert into public.tasks (contact_id, type, text, due_date, sales_id, is_test)
      values (v_contact, 'follow-up', 'Dar seguimiento a la cotización de Jason', now() + interval '2 days', v_brand.default_sales_id, true);
    elsif r.first_name = 'Sofía' then
      insert into public.tasks (contact_id, type, text, due_date, sales_id, is_test)
      values (v_contact, 'whatsapp', 'Pedir a Sofía una foto de las áreas a tratar', now() + interval '3 hours', v_brand.default_sales_id, true);
    elsif r.first_name = 'Daniel' then
      insert into public.tasks (contact_id, type, text, due_date, sales_id, is_test)
      values (v_contact, 'whatsapp', 'Pedir a Daniel los metros de la casa', now() - interval '2 hours', v_brand.default_sales_id, true);
    end if;
  end loop;

  -- Column order: the board shows the oldest first.
  update public.deals d set index = o.n
  from (select id, (row_number() over (partition by stage order by created_at) - 1)::smallint as n from public.deals) o
  where d.id = o.id;
end
$$;
