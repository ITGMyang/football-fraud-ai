export function safeNextPath(value) {
  const next = String(value || '/');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function authRedirectUrl(siteUrl, path) {
  const safePath = safeNextPath(path);
  try {
    const origin = new URL(siteUrl).origin;
    return new URL(safePath, `${origin}/`).toString();
  } catch {
    return new URL(safePath, window.location.origin).toString();
  }
}

export function authErrorMessage(error) {
  const message = String(error?.message || error || '');
  if (/invalid login credentials/i.test(message)) return 'Incorrect email or password';
  if (/email not confirmed/i.test(message)) return 'Open the confirmation email before signing in';
  if (/already registered|already been registered/i.test(message)) return 'This email is already registered. Sign in instead.';
  if (/password should be|weak password/i.test(message)) return 'Password must be at least 8 characters';
  if (/rate limit|too many requests/i.test(message)) return 'Too many attempts. Try again later.';
  if (/network|fetch|load failed/i.test(message)) return 'The sign-in service is temporarily unavailable';
  return message || 'Sign-in failed. Try again later.';
}

export function guestAccessLabel({ authenticated = false, guestPredictionUsed = false, billing = {} } = {}) {
  if (authenticated && billing.active) {
    const expiry = formatBillingExpiry(billing.validUntil);
    return {
      tone: 'signed-in',
      title: 'Active Pass: All AI Models Unlocked',
      detail: expiry ? `Valid until ${expiry}. Predictions remain private to this account.` : 'Predictions remain private to this account.'
    };
  }
  if (authenticated && billing.tier === 'locked') {
    return {
      tone: 'used',
      title: 'Free Prediction Used',
      detail: 'Choose a 24-hour, weekly, or monthly pass to continue with every AI model.'
    };
  }
  if (authenticated) {
    return {
      tone: 'available',
      title: 'Free Account: 1 Qwen Prediction Remaining',
      detail: 'The result will be saved to this account. Purchase a pass to use every AI model.'
    };
  }
  if (guestPredictionUsed) {
    return {
      tone: 'used',
      title: 'Guest Trial Used',
      detail: 'Sign in to receive one free Qwen prediction for your account.'
    };
  }
  return {
    tone: 'available',
    title: 'Guest Trial: 1 AI Prediction Remaining',
    detail: 'Browse public content without signing in. This trial uses Qwen.'
  };
}

function formatBillingExpiry(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}
