-- SAMPLE DATA for development and the demo. Everything here is "por confirmar" with JM.
-- Prices: example values from the Javier prompt. Margin, notice and horizon: made up for tests.
-- Never load this in production. Safe to re-run.

insert into core.price_lists (
  brand_id, version, valid_from, is_confirmed, currency,
  covered_rate, uncovered_rate, discount_pct, min_total,
  home_base_sqft, home_bedroom_sqft, parking_first_car_sqft, parking_extra_car_sqft,
  sqm_to_sqft, pace_to_ft, notes
)
values (
  1, 1, '2026-01-01T00:00:00Z', false, 'USD',
  0.12, 0.06, 7, 150,
  1000, 140, 240, 200,
  10.76, 2.5, 'Example values from the Javier prompt; to be confirmed by JM'
)
on conflict (brand_id, version) do nothing;

insert into core.scheduling_settings (
  brand_id, slot_minutes, buffer_minutes, hold_minutes, min_notice_minutes, horizon_days, reverify_after_days, is_confirmed
)
values (1, 60, 30, 15, 120, 14, 90, false)
on conflict (brand_id) do nothing;

insert into core.technicians (id, brand_id, name)
values (1, 1, 'Sample Technician')
on conflict (id) do nothing;
select setval(pg_get_serial_sequence('core.technicians', 'id'), greatest(1, (select max(id) from core.technicians)));

insert into core.technician_availability (technician_id, weekday, start_time, end_time)
select 1, weekday, '09:00', '17:00'
from generate_series(1, 5) as weekday
where not exists (select 1 from core.technician_availability where technician_id = 1);
