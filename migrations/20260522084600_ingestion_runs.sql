CREATE TABLE ingestion_runs
(
    id text NOT NULL,
    status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    started_at text NOT NULL,
    finished_at text,
    heartbeat_at text NOT NULL,
    failure_reason text,
    PRIMARY KEY (id)
);

CREATE UNIQUE INDEX one_running_ingestion
    ON ingestion_runs(status)
    WHERE status = 'running';
