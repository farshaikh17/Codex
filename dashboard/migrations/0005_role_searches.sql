-- Phrase searches reduce generic developer adverts that merely mention operations.
UPDATE cloud_sources SET slug='technical operations',name='Remotive — technical operations' WHERE id='board:remotive:operations';
UPDATE cloud_sources SET slug='implementation manager',name='Remotive — implementation managers',next_due=-1 WHERE id='board:remotive:implementation';
