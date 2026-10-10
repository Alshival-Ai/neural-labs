import type { NativeEvent } from './nativeApi';
export const ANTHROPIC_ADMIN_RECONNECT = 'An administrator needs to reconnect this Anthropic account.';
export const ANTHROPIC_RECONNECT = 'Your Anthropic connection needs to be renewed. Reconnect in Settings → Model Provider.';
export function nativeFailure(event: NativeEvent): string | undefined {
  const data = event.payload;
  const text = typeof data.result === 'string' ? data.result : '';
  if (data.code === 'authentication-required' || data.error === 'authentication_failed'
      || event.type === 'result' && data.is_error === true && /OAuth.*(?:revoked|expired)|API Error: 401|authentication_error|Failed to authenticate|Not logged in|Please run \/login/i.test(text)) return ['shared','team','background'].includes(String(data.connectionScope)) ? ANTHROPIC_ADMIN_RECONNECT : ANTHROPIC_RECONNECT;
  if (data.code === 'usage-limit') return 'Your account has reached a usage limit. Try again when usage is available.';
  if (data.code === 'model-unavailable') return 'The selected model is unavailable. Choose a model in Settings → Model Provider.';
  if (data.code === 'provider-unavailable') return 'The provider is temporarily unavailable. Please try again.';
  if (data.code === 'approval-or-lease-failed') return 'The permission response could not be completed, or your connection changed. Check the conversation before retrying.';
  return undefined;
}
