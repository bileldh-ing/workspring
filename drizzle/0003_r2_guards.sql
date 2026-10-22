-- Custom migration: foreign keys for polymorphic payment targets and append-only guards for R2 history tables.
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_timesheet_fk" FOREIGN KEY ("timesheet_id") REFERENCES "timesheets"("id");
--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_service_order_fk" FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id");
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_service_order_fk" FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id");
--> statement-breakpoint
CREATE TRIGGER timesheet_events_append_only BEFORE UPDATE ON timesheet_events FOR EACH ROW EXECUTE FUNCTION workspring_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER time_entry_events_append_only BEFORE UPDATE ON time_entry_events FOR EACH ROW EXECUTE FUNCTION workspring_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER order_events_append_only BEFORE UPDATE ON order_events FOR EACH ROW EXECUTE FUNCTION workspring_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER dispute_events_append_only BEFORE UPDATE ON dispute_events FOR EACH ROW EXECUTE FUNCTION workspring_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER interview_events_append_only BEFORE UPDATE ON interview_events FOR EACH ROW EXECUTE FUNCTION workspring_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER service_listing_events_append_only BEFORE UPDATE ON service_listing_events FOR EACH ROW EXECUTE FUNCTION workspring_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION workspring_forbid_mutation();
