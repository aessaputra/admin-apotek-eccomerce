begin;

do $$
declare
  v_signature text;
  v_function_oid oid;
  v_definition text;
begin
  foreach v_signature in array array[
    'private.rotate_integration_config_secret(text, text, uuid, text, text, text)',
    'private.update_integration_config_value(text, jsonb, uuid, text, text, text)'
  ]
  loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature);

    if v_function_oid is null then
      raise exception 'Missing function during integration config timestamptz repair: %', v_signature
        using errcode = '42883';
    end if;

    v_definition := pg_catalog.pg_get_functiondef(v_function_oid);
    v_definition := replace(
      v_definition,
      'pg_catalog.timezone(' || quote_literal('utc') || '::text, pg_catalog.now())',
      'pg_catalog.now()'
    );

    execute v_definition;
  end loop;
end;
$$;

commit;
