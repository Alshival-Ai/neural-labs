// Only stable, actionable categories leave the provider boundary. Never echo
// arbitrary provider output (which can include account or request details).
export function providerFailure(row) {
  const text = typeof row?.result === 'string' ? row.result : '';
  if (row?.error === 'authentication_failed' || /(?:OAuth.*(?:revoked|expired)|API Error: 401|authentication_error|Failed to authenticate|Not logged in|Please run \/login)/i.test(text)) return 'authentication-required';
  if (/rate.?limit|usage limit|quota|API Error: 429/i.test(text)) return 'usage-limit';
  if (/model.*(?:unavailable|not found|not supported)|API Error: 404/i.test(text)) return 'model-unavailable';
  return row?.is_error ? 'provider-unavailable' : null;
}
