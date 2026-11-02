-- Each opportunity can create its automatic follow-up only once, even if the
-- task is later completed/deleted or the opportunity leaves and re-enters won.
create table public.deal_followup_events (
    deal_id bigint primary key references public.deals(id) on delete cascade,
    created_at timestamp with time zone not null default now()
);

alter table public.deal_followup_events enable row level security;
revoke all on table public.deal_followup_events from public, anon, authenticated;
grant select, insert on table public.deal_followup_events to authenticated;
grant select, insert on table public.deal_followup_events to service_role;
create policy "Read follow-up events" on public.deal_followup_events
    for select to authenticated using (true);
create policy "Create follow-up events from trigger" on public.deal_followup_events
    for insert to authenticated with check (pg_trigger_depth() > 0);

create or replace function public.create_deal_followup_on_win() returns trigger
    language plpgsql
    set search_path to ''
as $$
declare
    selected_contact_id bigint;
    inserted_deal_id bigint;
    entering_won boolean;
begin
    if new.stage is distinct from 'won' then
        return new;
    end if;

    entering_won := tg_op = 'INSERT';
    if tg_op = 'UPDATE' then
        entering_won := old.stage is distinct from 'won';
        if not entering_won and old.contact_ids is not distinct from new.contact_ids then
            return new;
        end if;
    end if;

    -- Arrays are not foreign keys, so use the first contact which still exists.
    select c.id into selected_contact_id
    from unnest(coalesce(new.contact_ids, '{}'::bigint[])) with ordinality as ids(id, position)
    join public.contacts c on c.id = ids.id
    order by ids.position
    limit 1;

    if selected_contact_id is null then
        if entering_won then
            raise exception 'Añade un contacto válido para marcar la oportunidad como ganada y crear la tarea de seguimiento.'
                using errcode = '23514';
        end if;
        return new;
    end if;

    insert into public.deal_followup_events (deal_id)
    values (new.id)
    on conflict (deal_id) do nothing
    returning deal_id into inserted_deal_id;

    if inserted_deal_id is not null then
        insert into public.tasks (contact_id, type, text, due_date, sales_id)
        values (
            selected_contact_id,
            'follow-up',
            'Dar seguimiento al servicio contratado: ' || new.name,
            now(),
            new.sales_id
        );
    end if;
    return new;
end;
$$;

create trigger create_deal_followup_on_win
    after insert or update of stage, contact_ids on public.deals
    for each row execute function public.create_deal_followup_on_win();
