-- PRESENTATION calendar: one applicator in Orlando. 60 minutes of service plus 30 minutes of travel
-- (scheduling_settings: slot_minutes and buffer_minutes). Safe to run again. Dev databases only.
--
-- Weekends: 10:00 to 19:00. Weekdays: 09:00 to 22:00, ONLY on the days he is free.
-- PROVISIONAL: the list of free weekdays was not given with the request. The two weekdays below (Wednesday and
-- Thursday) are a placeholder so the calendar has something to show; they are NOT his real days off.
-- The real list goes in as data, not code: the "Disponibilidad" button of the agenda, api.set_availability, or this file.
-- (weekday 0 = Sunday ... 6 = Saturday; one-off days off go in core.technician_time_off.)
insert into core.technicians (id, brand_id, name)
values (1, 1, 'Aplicador Orlando')
on conflict (id) do update set name = excluded.name;
select setval(pg_get_serial_sequence('core.technicians', 'id'), greatest(1, (select max(id) from core.technicians)));

update core.scheduling_settings set slot_minutes = 60, buffer_minutes = 30 where brand_id = 1;

delete from core.technician_availability where technician_id = 1;
insert into core.technician_availability (technician_id, weekday, start_time, end_time)
select 1, v.weekday, v.start_time, v.end_time
from (values
  (0, time '10:00', time '19:00'),  -- Sunday
  (6, time '10:00', time '19:00'),  -- Saturday
  (3, time '09:00', time '22:00'),  -- Wednesday  (PROVISIONAL free weekday)
  (4, time '09:00', time '22:00')   -- Thursday   (PROVISIONAL free weekday)
) as v(weekday, start_time, end_time);