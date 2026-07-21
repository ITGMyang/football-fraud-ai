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
  if (/invalid login credentials/i.test(message)) return '邮箱或密码不正确';
  if (/email not confirmed/i.test(message)) return '请先打开确认邮件完成验证';
  if (/already registered|already been registered/i.test(message)) return '这个邮箱已经注册，可以直接登录';
  if (/password should be|weak password/i.test(message)) return '密码至少需要 8 位';
  if (/rate limit|too many requests/i.test(message)) return '操作太频繁，请稍后再试';
  if (/network|fetch|load failed/i.test(message)) return '登录服务暂时不可用，请稍后重试';
  return message || '登录失败，请稍后重试';
}

export function guestAccessLabel({ authenticated = false, guestPredictionUsed = false, billing = {} } = {}) {
  if (authenticated && billing.active) {
    const expiry = formatBillingExpiry(billing.validUntil);
    return {
      tone: 'signed-in',
      title: '订阅有效：全部 AI 模型已解锁',
      detail: expiry ? `有效期至 ${expiry}，预测结果只保存在当前账号下。` : '预测结果只保存在当前账号下。'
    };
  }
  if (authenticated && billing.tier === 'locked') {
    return {
      tone: 'used',
      title: '免费预测已用完',
      detail: '选择 24 小时卡、周卡或月卡后可继续使用全部 AI 模型。'
    };
  }
  if (authenticated) {
    return {
      tone: 'available',
      title: '免费账户：剩余 1 次 Qwen 预测',
      detail: '预测结果会保存在当前账号下。订阅后可使用全部 AI 模型。'
    };
  }
  if (guestPredictionUsed) {
    return {
      tone: 'used',
      title: '访客体验次数已用完',
      detail: '登录后可获得当前账号的一次免费 Qwen 预测。'
    };
  }
  return {
    tone: 'available',
    title: '访客体验：剩余 1 次 AI 预测',
    detail: '无需登录即可浏览公开内容。本次体验使用 Qwen。'
  };
}

function formatBillingExpiry(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}
