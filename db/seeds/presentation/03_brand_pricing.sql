-- PRESENTATION: how the quote shows tax and discount (migration 0018). Safe to run again. Dev databases only.
-- PROVISIONAL: the tax rate is a placeholder until it is confirmed; the discount stays on (7% of the price list).
-- To switch the discount off:  update core.brands set discount_enabled = false where id = 1;
update core.brands set tax_pct = 6.5, discount_enabled = true where id = 1;