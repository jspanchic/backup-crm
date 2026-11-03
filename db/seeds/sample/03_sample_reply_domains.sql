-- SAMPLE: domains the bot may mention. Taken from the project documents; to be confirmed by JM.
update core.brands
set allowed_reply_domains = array['salvionix.com', 'bioseguridad.bytogam.com']
where id = 1 and allowed_reply_domains = '{}';
