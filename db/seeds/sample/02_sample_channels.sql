-- SAMPLE channel: the BYTOGAM test session. secret_ref is the NAME of an environment variable.
-- Real sessions are loaded with Joel after the WAHA inventory; nothing here is a real session.
insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref, is_test)
values (1, 'waha', 'bytogam-pruebas', 'javier', 'WAHA_HMAC_BYTOGAM_PRUEBAS', true)
on conflict (provider, identifier) do nothing;
