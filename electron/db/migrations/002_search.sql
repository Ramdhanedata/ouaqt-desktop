-- Finding a product while somebody waits.
--
-- FTS5 with the unicode61 tokenizer and diacritics removed, so "crème" is
-- found by typing "creme" and the Arabic name is found by its own letters.
-- The triggers keep the index in step with the table: a search index that
-- drifts is worse than none, because it is confidently wrong.
create virtual table if not exists products_search using fts5(
  name,
  name_arabic,
  barcode,
  content = 'products',
  content_rowid = 'rowid',
  tokenize = "unicode61 remove_diacritics 2"
);

create trigger if not exists products_search_insert after insert on products begin
  insert into products_search (rowid, name, name_arabic, barcode)
  values (new.rowid, new.name, new.name_arabic, new.barcode);
end;

create trigger if not exists products_search_delete after delete on products begin
  insert into products_search (products_search, rowid, name, name_arabic, barcode)
  values ('delete', old.rowid, old.name, old.name_arabic, old.barcode);
end;

create trigger if not exists products_search_update after update on products begin
  insert into products_search (products_search, rowid, name, name_arabic, barcode)
  values ('delete', old.rowid, old.name, old.name_arabic, old.barcode);
  insert into products_search (rowid, name, name_arabic, barcode)
  values (new.rowid, new.name, new.name_arabic, new.barcode);
end;
