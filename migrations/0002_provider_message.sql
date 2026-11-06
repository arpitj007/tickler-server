-- A message from a provider for the owner, e.g. the Amazon SNS subscription confirmation.
ALTER TABLE provider_configs ADD COLUMN last_message TEXT;
