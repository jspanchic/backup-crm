-- The production list selects the approved calculation. Existing lists keep the presentation calculation.
alter table core.price_lists
  add column rounding text not null default 'legacy_nearest_dollar'
    check (rounding in ('legacy_nearest_dollar', 'salvionix_v4')),
  add column area_factors_provisional boolean not null default false;

create function core.quote_totals(
  p_price_list_id bigint,
  p_covered_sqft numeric,
  p_uncovered_sqft numeric,
  p_discount_enabled boolean,
  out subtotal numeric,
  out discount numeric,
  out total numeric,
  out min_applied boolean
)
  language plpgsql stable
  set search_path = ''
  as $$
declare
  pl core.price_lists;
  discount_pct numeric;
  raw_subtotal numeric;
  raw_discount numeric;
begin
  select * into pl from core.price_lists where id = p_price_list_id;
  if not found then
    raise exception 'unknown price list %', p_price_list_id using errcode = 'CX004';
  end if;
  if p_covered_sqft < 0 or p_uncovered_sqft < 0 then
    raise exception 'area cannot be negative' using errcode = 'CX004';
  end if;

  discount_pct := case when p_discount_enabled then pl.discount_pct else 0 end;
  if pl.rounding = 'salvionix_v4' then
    subtotal := round(floor(p_covered_sqft) * pl.covered_rate + floor(p_uncovered_sqft) * pl.uncovered_rate, 0);
    discount := round(subtotal * discount_pct / 100, 0);
    total := subtotal - discount;
  else
    raw_subtotal := p_covered_sqft * pl.covered_rate + p_uncovered_sqft * pl.uncovered_rate;
    raw_discount := raw_subtotal * discount_pct / 100;
    subtotal := round(raw_subtotal, 2);
    discount := round(raw_discount, 2);
    total := round(raw_subtotal - raw_discount, 0);
  end if;

  min_applied := total < pl.min_total;
  if min_applied then
    total := pl.min_total;
  end if;
end;
$$;

create or replace function core.quote_totals(
  p_price_list_id bigint,
  p_covered_sqft numeric,
  p_uncovered_sqft numeric,
  out subtotal numeric,
  out discount numeric,
  out total numeric,
  out min_applied boolean
)
  language sql stable
  set search_path = ''
  as $$
    select * from core.quote_totals(p_price_list_id, p_covered_sqft, p_uncovered_sqft, true)
  $$;

-- Floor each category after summing all its measured or estimated areas. Do it before inserting
-- the quote so the numeric scale of its columns cannot round an input up before it is floored.
create or replace function core.quote_area(
  p_price_list_id bigint,
  p_inputs jsonb,
  out covered_sqft numeric,
  out uncovered_sqft numeric
)
  language plpgsql stable
  set search_path = ''
  as $$
declare
  pl core.price_lists;
  area jsonb;
  area_sqft numeric;
  client_type text := p_inputs ->> 'client_type';
  covered_cars integer := coalesce((p_inputs ->> 'covered_parking_cars')::integer, 0);
  uncovered_cars integer := coalesce((p_inputs ->> 'uncovered_parking_cars')::integer, 0);
begin
  select * into pl from core.price_lists where id = p_price_list_id;
  if not found then
    raise exception 'unknown price list %', p_price_list_id using errcode = 'CX004';
  end if;
  if covered_cars < 0 or uncovered_cars < 0 then
    raise exception 'cars cannot be negative' using errcode = 'CX004';
  end if;

  covered_sqft := 0;
  uncovered_sqft := 0;

  if client_type = 'home' then
    if coalesce((p_inputs ->> 'bedrooms')::integer, -1) < 0 then
      raise exception 'bedrooms is required for a home' using errcode = 'CX004';
    end if;
    covered_sqft := pl.home_base_sqft + (p_inputs ->> 'bedrooms')::integer * pl.home_bedroom_sqft;
  elsif client_type = 'business' then
    if coalesce((p_inputs ->> 'covered_sqft')::numeric, -1) < 0 then
      raise exception 'covered_sqft is required for a business' using errcode = 'CX004';
    end if;
    covered_sqft := (p_inputs ->> 'covered_sqft')::numeric;
  else
    raise exception 'client_type must be home or business' using errcode = 'CX004';
  end if;

  if covered_cars > 0 then
    covered_sqft := covered_sqft + pl.parking_first_car_sqft + (covered_cars - 1) * pl.parking_extra_car_sqft;
  end if;
  if uncovered_cars > 0 then
    uncovered_sqft := uncovered_sqft + pl.parking_first_car_sqft + (uncovered_cars - 1) * pl.parking_extra_car_sqft;
  end if;

  for area in select jsonb_array_elements(coalesce(p_inputs -> 'extra_areas', '[]'::jsonb))
  loop
    if area ? 'sqft' then
      area_sqft := (area ->> 'sqft')::numeric;
    elsif area ? 'sqm' then
      area_sqft := (area ->> 'sqm')::numeric * pl.sqm_to_sqft;
    elsif area ? 'paces_long' and area ? 'paces_wide' then
      area_sqft := ((area ->> 'paces_long')::numeric * pl.pace_to_ft) * ((area ->> 'paces_wide')::numeric * pl.pace_to_ft);
    else
      raise exception 'extra area needs sqft, sqm or paces' using errcode = 'CX004';
    end if;
    if area_sqft < 0 then
      raise exception 'area cannot be negative' using errcode = 'CX004';
    end if;
    if jsonb_typeof(area -> 'covered') is distinct from 'boolean' then
      raise exception 'extra area must say whether it is covered' using errcode = 'CX004';
    end if;
    if (area ->> 'covered')::boolean then
      covered_sqft := covered_sqft + area_sqft;
    else
      uncovered_sqft := uncovered_sqft + area_sqft;
    end if;
  end loop;

  if pl.rounding = 'salvionix_v4' then
    covered_sqft := floor(covered_sqft);
    uncovered_sqft := floor(uncovered_sqft);
  end if;
end;
$$;

create or replace function core.quotes_before_insert() returns trigger
  language plpgsql
  set search_path = ''
  as $$
declare
  deal_brand_id bigint;
  pl core.price_lists;
  totals record;
  v_brand core.brands;
begin
  select brand_id into deal_brand_id from public.deals where id = new.deal_id for update;
  if not found then
    raise exception 'unknown deal %', new.deal_id using errcode = 'CX004';
  end if;
  new.brand_id := deal_brand_id;

  new.price_list_id := coalesce(new.price_list_id, core.active_price_list(new.brand_id));
  select * into pl from core.price_lists where id = new.price_list_id and brand_id = new.brand_id;
  if not found then
    raise exception 'no price list for this brand' using errcode = 'CX004';
  end if;

  select * into v_brand from core.brands where id = new.brand_id;
  select * into totals from core.quote_totals(pl.id, new.covered_sqft, new.uncovered_sqft, v_brand.discount_enabled);
  if pl.rounding = 'salvionix_v4' then
    new.covered_sqft := floor(new.covered_sqft);
    new.uncovered_sqft := floor(new.uncovered_sqft);
  end if;

  new.subtotal := totals.subtotal;
  new.discount := totals.discount;
  new.min_applied := totals.min_applied;
  new.discount_applied := v_brand.discount_enabled;
  new.tax_pct := v_brand.tax_pct;
  new.tax := round(totals.total * v_brand.tax_pct / 100, 2);
  new.total := totals.total + new.tax;
  new.currency := pl.currency;
  new.price_confirmed := pl.is_confirmed;

  -- The row lock on the deal above serializes this count.
  select coalesce(max(version), 0) + 1 into new.version from core.quotes where deal_id = new.deal_id;
  return new;
end;
$$;
