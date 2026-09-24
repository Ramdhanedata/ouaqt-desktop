-- The front desk as the owner's own hotel app ran it.

-- The floor a room is on, for the board's filter. Rooms numbered the usual
-- way (101, 204, 1203) start on the floor their number says.
alter table rooms add column floor integer;
update rooms set floor = cast(substr(number, 1, length(number) - 2) as integer)
 where floor is null and length(number) >= 3 and number not glob '*[^0-9]*';

-- What is wrong in a room, who is on it, and when it was put right.
create table if not exists maintenance_issues (
  id           text primary key,
  device_id    text not null,
  created_at   text not null,
  counter      integer not null,
  room_id      text not null references rooms (id),
  issue        text not null,
  assigned_to  text,
  status       text not null default 'open' check (status in ('open', 'resolved')),
  resolved_at  text,
  resolution   text
);
create index if not exists maintenance_room_idx on maintenance_issues (room_id, status);
