-- The percentage in the tool response must come from the list used for this quote.
-- Before this change, deal facts could report the list of the previous quote.
create or replace function api.create_quote(p_conversation_id bigint, p_inputs jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  facts jsonb := core.deal_facts(p_conversation_id);
  v_deal_id bigint := (facts ->> 'deal_id')::bigint;
  v_price_list_id bigint;
  v_discount_pct numeric;
  area record;
  v_quote core.quotes;
begin
  if v_deal_id is null then
    raise exception 'no open opportunity' using errcode = 'CX002';
  end if;
  v_price_list_id := core.active_price_list((facts ->> 'brand_id')::bigint);
  if v_price_list_id is null then
    raise exception 'no price list in force' using errcode = 'CX004';
  end if;

  select * into area from core.quote_area(v_price_list_id, p_inputs);

  update core.quotes set status = 'superseded' where deal_id = v_deal_id and status = 'sent';
  insert into core.quotes (deal_id, price_list_id, covered_sqft, uncovered_sqft, inputs)
  values (v_deal_id, v_price_list_id, area.covered_sqft, area.uncovered_sqft, p_inputs)
  returning * into v_quote;

  update public.deals
  set amount = v_quote.total,
      client_type = coalesce(client_type, p_inputs ->> 'client_type'),
      stage = case when stage in ('opportunity', 'contacted', 'assessment') then 'proposal-sent' else stage end,
      updated_at = now()
  where id = v_deal_id;

  select discount_pct into v_discount_pct from core.price_lists where id = v_quote.price_list_id;
  return core.deal_facts(p_conversation_id) -> 'quote'
    || jsonb_build_object('currency', v_quote.currency, 'discount_pct', v_discount_pct);
end;
$$;
