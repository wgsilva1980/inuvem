-- audit_log continua somente de inserção (UPDATE e DELETE diretos são bloqueados), mas precisa
-- permitir a remoção em cascata quando a loja é apagada (LGPD store/redact).
-- Em DELETE direto, pg_trigger_depth() = 1; no ON DELETE CASCADE vindo de `stores`, é > 1.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log é somente de inserção';
END $$;
