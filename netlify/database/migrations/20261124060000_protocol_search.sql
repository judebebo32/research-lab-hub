-- Full-text search over every section of a protocol (HTML tags stripped).
-- Title matches rank highest, then project/experiment, then the body.
ALTER TABLE protocols ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(project, '') || ' ' || coalesce(experiment, '')), 'B') ||
  setweight(to_tsvector('english', regexp_replace(
    coalesce(objective, '') || ' ' || coalesce(materials, '') || ' ' || coalesce(equipment, '') || ' ' ||
    coalesce(steps, '') || ' ' || coalesce(safety, '') || ' ' || coalesce(notes, ''),
    '<[^>]+>|\[\[(image|video):\d+\]\]|&nbsp;', ' ', 'g')), 'C')
) STORED;
CREATE INDEX protocols_search_idx ON protocols USING GIN (search_vector);
