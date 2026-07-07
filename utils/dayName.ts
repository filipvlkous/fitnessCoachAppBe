export function getDayName(num: number): string {
  const days = [
    'Pondělí',
    'Úterý',
    'Středa',
    'Čtvrtek',
    'Pátek',
    'Sobota',
    'Neděle',
  ];
  return days[num - 1] || 'Invalid day';
}
