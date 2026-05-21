begin;

do $$
declare
  v_signature text;
  v_function_oid oid;
  v_definition text;
  v_ambiguous_signatures text[] := array[
    'private.rotate_integration_config_secret(text, text, uuid, text, text, text)',
    'private.update_integration_config_value(text, jsonb, uuid, text, text, text)',
    'private.bind_midtrans_payment_config_versions(uuid, text, text, uuid, uuid, integer, uuid, integer, boolean)',
    'private.create_biteship_order_config_snapshot(uuid, uuid, text, text, numeric, numeric, text[], text, text, text, text, text, text, jsonb, text, uuid)'
  ];
begin
  foreach v_signature in array array[
    'private.mask_integration_config_secret(text)',
    'private.rotate_integration_config_secret(text, text, uuid, text, text, text)',
    'private.update_integration_config_value(text, jsonb, uuid, text, text, text)',
    'private.list_integration_config_audit(text, integer)',
    'private.bind_midtrans_payment_config_versions(uuid, text, text, uuid, uuid, integer, uuid, integer, boolean)',
    'private.create_biteship_order_config_snapshot(uuid, uuid, text, text, numeric, numeric, text[], text, text, text, text, text, text, jsonb, text, uuid)'
  ]
  loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature);

    if v_function_oid is null then
      raise exception 'Missing function during integration config lint repair: %', v_signature
        using errcode = '42883';
    end if;

    v_definition := pg_catalog.pg_get_functiondef(v_function_oid);
    v_definition := replace(v_definition, 'pg_catalog.' || 'coalesce', 'coalesce');
    v_definition := replace(v_definition, 'pg_catalog.' || 'nullif', 'nullif');
    v_definition := replace(v_definition, 'pg_catalog.' || 'greatest', 'greatest');
    v_definition := replace(v_definition, 'pg_catalog.' || 'least', 'least');

    if v_signature = any (v_ambiguous_signatures)
       and v_definition not like '%#variable_conflict use_column%' then
      v_definition := replace(
        v_definition,
        'AS $function$' || chr(10),
        'AS $function$' || chr(10) || '#variable_conflict use_column' || chr(10)
      );
    end if;

    execute v_definition;
  end loop;
end;
$$;

commit;
