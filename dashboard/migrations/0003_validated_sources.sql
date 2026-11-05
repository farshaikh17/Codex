-- Exclude oversized and invalid legacy entries; preserve diagnostic history.
UPDATE cloud_sources SET enabled=0,last_status='DISABLED',last_error='Source validation: board exceeds the 512 KiB free-tier processing budget' WHERE id='greenhouse:canonical';
UPDATE cloud_sources SET enabled=0,last_status='DISABLED',last_error='Superseded by validated public employer endpoint' WHERE id IN ('lever:highlevel','lever:zapier','lever:iterate');
INSERT OR IGNORE INTO cloud_sources(id,kind,slug,name) VALUES
 ('lever:gohighlevel','lever','gohighlevel','GoHighLevel'),
 ('lever:drivetrain','lever','drivetrain','Drivetrain');
