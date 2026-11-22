-- Automatic checks of reports: why it was accepted/rejected (or left for a human), and when.
ALTER TABLE reports ADD COLUMN resolution TEXT;
ALTER TABLE reports ADD COLUMN checked_at INTEGER;
