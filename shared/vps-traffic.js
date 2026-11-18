export const GB = 1_000_000_000;

export function normalizeVpsTraffic(value) {
  if (!value?.enabled) return null;
  const quotaGb = Number(value.quotaGb);
  const resetDay = Number(value.resetDay);
  const resetTime = String(value.resetTime || '');
  const timeZone = String(value.timeZone || '').trim();
  if (
    !Number.isSafeInteger(Math.round(quotaGb * GB)) ||
    quotaGb <= 0 ||
    !Number.isInteger(resetDay) ||
    resetDay < 1 ||
    resetDay > 31 ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(resetTime) ||
    !timeZone
  ) {
    throw new Error('Invalid VPS traffic quota or billing schedule');
  }
  new Intl.DateTimeFormat('en-GB', { timeZone });
  const sourceUrl = String(value.sourceUrl || '').trim();
  const authBinding = String(value.authBinding || '').trim();
  const usageMode = value.usageMode || 'reported';
  if (!['reported', 'sum', 'max'].includes(usageMode))
    throw new Error('Invalid VPS traffic accounting mode');
  if (authBinding && !/^VPS_TRAFFIC_TOKEN_[A-Z0-9_]+$/.test(authBinding)) {
    throw new Error('Invalid VPS traffic token binding');
  }
  if (sourceUrl) {
    const url = new URL(sourceUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
      throw new Error(
        'VPS traffic source must be an HTTPS URL without credentials or query parameters'
      );
    }
  }
  return {
    enabled: true,
    quotaGb,
    resetDay,
    resetTime,
    timeZone,
    sourceUrl,
    authBinding,
    usageMode,
  };
}

function localParts(timestamp, timeZone) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(timestamp)
      .map(({ type, value }) => [type, value])
  );
}

export function vpsBillingPeriod(config, timestamp = Date.now()) {
  const local = localParts(timestamp, config.timeZone);
  const date = new Date(Date.UTC(Number(local.year), Number(local.month) - 1, 1));
  function monthStart() {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = Math.min(config.resetDay, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${config.resetTime}`;
  }
  const current = `${local.year}-${local.month}-${local.day}T${local.hour}:${local.minute}`;
  if (current < monthStart()) date.setUTCMonth(date.getUTCMonth() - 1);
  return monthStart();
}
