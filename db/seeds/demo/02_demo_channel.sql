-- DEMO channel: a session that is NOT a test one, so "Prueba X" has an effect that can be seen.
-- It reuses the HMAC key of the BYTOGAM test session. Dev databases only.
insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref, is_test)
values (1, 'waha', 'demo', 'javier', 'WAHA_HMAC_BYTOGAM_PRUEBAS', false)
on conflict (provider, identifier) do nothing;
