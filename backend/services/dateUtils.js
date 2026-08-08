const MANILA_TIMEZONE = 'Asia/Manila';

const dateKeyManila = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: MANILA_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(date);

const todayKey = (date = new Date()) => dateKeyManila(date);

const yesterdayKey = (date = new Date()) => {
  const todayStartInManila = new Date(`${dateKeyManila(date)}T00:00:00+08:00`);
  const yesterdayStartInManila = new Date(todayStartInManila.getTime() - 86400000);
  return dateKeyManila(yesterdayStartInManila);
};

module.exports = {
  MANILA_TIMEZONE,
  dateKeyManila,
  todayKey,
  yesterdayKey,
};
