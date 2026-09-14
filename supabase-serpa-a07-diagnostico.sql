-- ============================================================================
-- SÓ SERPA PINTO — diagnóstico antes de criar os sub-espaços do apartamento 7
-- ============================================================================
-- Só leitura. Não altera nada.
-- Uma única consulta, porque o editor do Supabase só mostra o resultado da
-- última instrução. Lista TODOS os espaços (para se ver o padrão das
-- referências), com os que parecem ser do apartamento 7 no topo, e quanto
-- histórico cada um tem (contratos, leituras, cobranças) — é isso que decide
-- entre criar dois espaços novos ou renomear o existente.
-- Cola-me o resultado completo.

SELECT
  (s.ref ILIKE '%7%')                                                        AS parece_apart_7,
  s.ref,
  s.type,
  s.status,
  s.has_own_meter                                                            AS contador_luz_proprio,
  s.has_own_water_meter                                                      AS contador_agua_proprio,
  t.name                                                                     AS inquilino_no_espaco,
  (SELECT count(*) FROM leases l WHERE l.space_id = s.id)                    AS contratos,
  (SELECT count(*) FROM leases l WHERE l.space_id = s.id AND l.status = 'ativo') AS contratos_ativos,
  (SELECT count(*) FROM electricity_readings r WHERE r.space_id = s.id)      AS leituras_luz,
  (SELECT count(*) FROM water_readings r WHERE r.space_id = s.id)            AS leituras_agua,
  (SELECT count(*) FROM electricity_charges c JOIN leases l ON l.id = c.lease_id WHERE l.space_id = s.id) AS cobrancas_luz,
  (SELECT count(*) FROM water_charges c JOIN leases l ON l.id = c.lease_id WHERE l.space_id = s.id)       AS cobrancas_agua,
  s.notes,
  s.id
FROM spaces s
LEFT JOIN tenants t ON t.id = s.tenant_id
ORDER BY (s.ref ILIKE '%7%') DESC, s.ref;
