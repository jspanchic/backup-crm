-- PRESENTATION: how the quote shows tax and discount (migration 0018). Safe to run again. Dev databases only.
-- EXAMPLE values, not real: tax 6.5 % and the discount on (7 % of the price list). docs/DATOS_REALES.md says where to change them.
-- To switch the discount off:  update core.brands set discount_enabled = false where id = 1;
update core.brands set tax_pct = 6.5, discount_enabled = true where id = 1;