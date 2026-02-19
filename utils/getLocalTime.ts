export const localDateStr = (date: Date | string) => {
  const localISO = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague', // your TZ
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));

  return localISO;
};
