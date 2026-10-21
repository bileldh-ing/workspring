-- Custom migration: financial ledger and event history are append-only.
-- Corrections must be made with compensating entries (see docs/PAYMENTS_AND_LEDGER.md).
CREATE OR REPLACE FUNCTION workspring_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (% not allowed)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION workspring_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER provider_webhook_events_append_only BEFORE UPDATE OR DELETE ON provider_webhook_events
  FOR EACH ROW EXECUTE FUNCTION workspring_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER milestone_events_append_only BEFORE UPDATE ON milestone_events
  FOR EACH ROW EXECUTE FUNCTION workspring_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER contract_events_append_only BEFORE UPDATE ON contract_events
  FOR EACH ROW EXECUTE FUNCTION workspring_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION workspring_forbid_mutation();
--> statement-breakpoint
-- Default platform fee rule (versioned; snapshotted onto every offer/contract).
INSERT INTO platform_fee_rules (version, freelancer_fee_bps, client_fee_bps, description, is_active)
VALUES (1, 1000, 0, 'R1 default: 10% service fee deducted from milestone releases; no client fee. Test mode only until legal/provider review.', true)
ON CONFLICT (version) DO NOTHING;
