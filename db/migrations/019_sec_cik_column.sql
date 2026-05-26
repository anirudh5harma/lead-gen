-- 019_sec_cik_column.sql
-- Add SEC Central Index Key to the catalog so the SEC EDGAR adapter can
-- poll per-company submissions. Same shape as greenhouse_id / lever_id /
-- ashby_id / workable_id — one column per upstream key. Public-company-
-- only; private startups won't have a CIK.

alter table tracked_companies add column sec_cik text;

create index tracked_companies_sec_cik_idx
  on tracked_companies (sec_cik)
  where sec_cik is not null;
