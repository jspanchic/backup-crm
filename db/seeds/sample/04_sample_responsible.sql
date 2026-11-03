-- SAMPLE responsible person for what the bot creates (contacts, opportunities, tasks from "escalar").
-- For the demo it is Sebastian; in production JM decides, by changing core.brands.default_sales_id.
-- The address is a placeholder: the real account is created in the panel.
do $$
declare
  v_user uuid;
  v_sales bigint;
begin
  select id into v_user from auth.users where email = 'sebastian@example.test';
  if v_user is null and not exists (select 1 from public.sales) then
    -- The first user of the system becomes the administrator (handle_new_user).
    insert into auth.users (id, email, raw_user_meta_data)
    values ('00000000-0000-4000-8000-000000000001', 'sebastian@example.test', '{"first_name":"Sebastián","last_name":"(demo)"}')
    returning id into v_user;
  end if;
  select id into v_sales from public.sales where user_id = v_user;
  update core.brands set default_sales_id = v_sales where id = 1 and default_sales_id is null and v_sales is not null;
end
$$;
