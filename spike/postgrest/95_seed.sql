-- CRM-T1 spike seed: 100% fake data (no real customers).
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'spike.admin@example.test', '{"first_name":"Spike","last_name":"Admin"}');
-- the on_auth_user_created trigger creates the matching public.sales row (first user = administrator)
insert into public.configuration (id, config) values (1, '{}'::jsonb) on conflict do nothing;
insert into public.companies (name, city, state_abbr, sales_id)
  select 'Empresa ' || g, (array['Orlando','Kissimmee','Winter Park'])[1 + g % 3], 'FL', 1 from generate_series(1, 12) g;
insert into public.contacts (first_name, last_name, status, company_id, sales_id, first_seen, last_seen, email_jsonb, phone_jsonb)
  select 'Cliente' || g, 'Prueba' || (g % 7), (array['cold','warm','hot'])[1 + g % 3], 1 + g % 12, 1,
         now() - (g || ' days')::interval, now() - (g || ' hours')::interval,
         jsonb_build_array(jsonb_build_object('email','cliente'||g||'@example.test','type','Work')),
         jsonb_build_array(jsonb_build_object('number_e164','+1555000'||lpad(g::text,4,'0'),'type','Mobile'))
  from generate_series(1, 60) g;
insert into public.deals (name, company_id, contact_ids, stage, amount, categories, sales_id, index, expected_closing_date)
  select 'Servicio ' || g, 1 + g % 12, array[g], (array['opportunity','contacted','assessment','proposal-sent','in-negociation','lost','delayed'])[1 + g % 7],
         100 + g * 10, array['virus-bacteria'], 1, g, current_date + g
  from generate_series(1, 40) g;
insert into public.tasks (contact_id, type, text, due_date, sales_id)
  select g, 'call', 'Llamar a cliente ' || g, now() + (g || ' days')::interval, 1 from generate_series(1, 20) g;