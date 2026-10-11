-- Perfis de usuário: 'admin' (acesso total, como até aqui) ou 'expedicao' (só Expedição e Estoque).
-- Quem já tinha acesso continua administrador.
ALTER TABLE admins ADD COLUMN perfil text NOT NULL DEFAULT 'admin' CHECK (perfil IN ('admin', 'expedicao'));
