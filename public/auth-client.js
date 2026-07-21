import { authErrorMessage, authRedirectUrl, guestAccessLabel, safeNextPath } from './auth-utils.js';

const elements = {
  modal: document.querySelector('#authModal'),
  trigger: document.querySelector('#authTrigger'),
  signOut: document.querySelector('#signOutButton'),
  close: document.querySelector('#authClose'),
  form: document.querySelector('#authForm'),
  email: document.querySelector('#authEmail'),
  password: document.querySelector('#authPassword'),
  submit: document.querySelector('#authSubmit'),
  google: document.querySelector('#googleLogin'),
  telegram: document.querySelector('#telegramLogin'),
  forgot: document.querySelector('#forgotPassword'),
  status: document.querySelector('#authStatus'),
  resetForm: document.querySelector('#resetPasswordForm'),
  resetPassword: document.querySelector('#newPassword'),
  resetSubmit: document.querySelector('#resetPasswordSubmit'),
  standardView: document.querySelector('#authStandardView'),
  resetView: document.querySelector('#authResetView')
};

let client = null;
let session = null;
let mode = 'login';
let authSiteUrl = '';
let readyResolve;
window.footballAuthReady = new Promise((resolve) => { readyResolve = resolve; });
window.footballAuth = {
  getAccessToken: () => session?.access_token || '',
  isAuthenticated: () => Boolean(session?.user),
  guestAccessLabel,
  open: (message = '') => {
    if (message) showStatus(message, 'error');
    openAuth();
  },
  signOut: () => signOut()
};

bindEvents();
initialize();

async function initialize() {
  try {
    const response = await fetch('/api/auth/config');
    const config = await response.json();
    if (!response.ok || !config.enabled) throw new Error(config.error || 'Supabase Auth 尚未配置');
    if (!window.supabase?.createClient) throw new Error('登录组件加载失败，请刷新页面');
    authSiteUrl = config.siteUrl || window.location.origin;
    if (elements.telegram) {
      elements.telegram.disabled = !config.telegramEnabled;
      elements.telegram.querySelector('span').textContent = config.telegramEnabled
        ? '使用 Telegram 登录'
        : 'Telegram 登录（待配置）';
    }
    client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
    });
    client.auth.onAuthStateChange((event, nextSession) => {
      session = nextSession;
      if (event === 'PASSWORD_RECOVERY') showResetView();
      renderSession();
      window.dispatchEvent(new CustomEvent('football-auth-change', { detail: { event, session } }));
    });
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    session = data.session;
    if (window.location.pathname === '/auth/reset' && session) showResetView();
    finishOAuthRoute();
    renderSession();
  } catch (error) {
    showStatus(authErrorMessage(error), 'error');
    openAuth(true);
  } finally {
    readyResolve();
  }
}

function bindEvents() {
  elements.trigger?.addEventListener('click', () => openAuth());
  elements.signOut?.addEventListener('click', signOut);
  elements.close?.addEventListener('click', closeAuth);
  elements.modal?.querySelector('[data-auth-backdrop]')?.addEventListener('click', closeAuth);
  elements.google?.addEventListener('click', signInWithGoogle);
  elements.telegram?.addEventListener('click', signInWithTelegram);
  elements.forgot?.addEventListener('click', sendPasswordReset);
  elements.form?.addEventListener('submit', submitEmailAuth);
  elements.resetForm?.addEventListener('submit', updatePassword);
  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.authMode));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAuth();
  });
}

async function submitEmailAuth(event) {
  event.preventDefault();
  if (!client) return showStatus('登录服务还未准备好', 'error');
  const email = elements.email.value.trim();
  const password = elements.password.value;
  if (!email || !password) return showStatus('请输入邮箱和密码', 'error');
  if (password.length < 8) return showStatus('密码至少需要 8 位', 'error');
  setBusy(elements.submit, true, mode === 'signup' ? '注册中...' : '登录中...');
  try {
    if (mode === 'signup') {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
      });
      if (error) throw error;
      if (!data.session) {
        showStatus('注册成功，请打开确认邮件完成验证', 'success');
        setMode('login');
        return;
      }
    } else {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    finishLogin();
  } catch (error) {
    showStatus(authErrorMessage(error), 'error');
  } finally {
    setBusy(elements.submit, false);
  }
}

async function signInWithGoogle() {
  return signInWithProvider('google', elements.google, '正在跳转 Google...');
}

async function signInWithTelegram() {
  return signInWithProvider('custom:telegram', elements.telegram, '正在跳转 Telegram...');
}

async function signInWithProvider(provider, button, pendingLabel) {
  if (!client) return showStatus('登录服务还未准备好', 'error');
  setBusy(button, true, pendingLabel);
  try {
    sessionStorage.setItem('footballFraud.authNext', currentNextPath());
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: authRedirectUrl(authSiteUrl, '/auth/callback') }
    });
    if (error) throw error;
  } catch (error) {
    showStatus(authErrorMessage(error), 'error');
    setBusy(button, false);
  }
}

async function sendPasswordReset() {
  if (!client) return showStatus('登录服务还未准备好', 'error');
  const email = elements.email.value.trim();
  if (!email) return showStatus('先输入需要找回的邮箱', 'error');
  setBusy(elements.forgot, true, '发送中...');
  try {
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: authRedirectUrl(authSiteUrl, '/auth/reset')
    });
    if (error) throw error;
    showStatus('重设密码邮件已发送，请检查收件箱', 'success');
  } catch (error) {
    showStatus(authErrorMessage(error), 'error');
  } finally {
    setBusy(elements.forgot, false);
  }
}

async function updatePassword(event) {
  event.preventDefault();
  const password = elements.resetPassword.value;
  if (password.length < 8) return showStatus('新密码至少需要 8 位', 'error');
  setBusy(elements.resetSubmit, true, '保存中...');
  try {
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
    showStatus('密码已更新', 'success');
    window.history.replaceState({}, '', '/');
    finishLogin();
  } catch (error) {
    showStatus(authErrorMessage(error), 'error');
  } finally {
    setBusy(elements.resetSubmit, false);
  }
}

async function signOut() {
  if (!client) return;
  await client.auth.signOut();
  window.location.assign(`/login?next=${encodeURIComponent(currentNextPath())}`);
}

function renderSession() {
  const signedIn = Boolean(session?.user);
  if (elements.trigger) {
    elements.trigger.textContent = signedIn ? displayUser(session.user) : '登录 + 注册';
    elements.trigger.classList.toggle('is-signed-in', signedIn);
  }
  if (elements.signOut) elements.signOut.hidden = !signedIn;
  if (signedIn) closeAuth(true);
  else if (window.location.pathname === '/login') openAuth();
  else closeAuth(true);
}

function setMode(nextMode) {
  mode = nextMode === 'signup' ? 'signup' : 'login';
  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    const active = button.dataset.authMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  elements.submit.textContent = mode === 'signup' ? '创建账号' : '登录';
  elements.password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  elements.forgot.hidden = mode === 'signup';
  showStatus('');
}

function showResetView() {
  if (elements.standardView) elements.standardView.hidden = true;
  if (elements.resetView) elements.resetView.hidden = false;
  openAuth(true);
}

function openAuth(required = false) {
  if (!elements.modal) return;
  elements.modal.hidden = false;
  elements.modal.dataset.required = required ? 'true' : 'false';
  document.body.classList.add('auth-open');
  requestAnimationFrame(() => elements.email?.focus());
}

function closeAuth(force = false) {
  if (!elements.modal || (!force && elements.modal.dataset.required === 'true')) return;
  elements.modal.hidden = true;
  document.body.classList.remove('auth-open');
}

function finishLogin() {
  const next = safeNextPath(sessionStorage.getItem('footballFraud.authNext') || currentNextPath());
  sessionStorage.removeItem('footballFraud.authNext');
  if (window.location.pathname.startsWith('/auth/') || window.location.pathname === '/login') {
    window.history.replaceState({}, '', next);
  }
  closeAuth(true);
  window.dispatchEvent(new CustomEvent('football-auth-change', { detail: { event: 'SIGNED_IN', session } }));
}

function finishOAuthRoute() {
  if (!session || !window.location.pathname.startsWith('/auth/')) return;
  const next = safeNextPath(sessionStorage.getItem('footballFraud.authNext') || '/');
  sessionStorage.removeItem('footballFraud.authNext');
  window.history.replaceState({}, '', next);
}

function currentNextPath() {
  const queryNext = new URLSearchParams(window.location.search).get('next');
  if (queryNext) return safeNextPath(queryNext);
  if (window.location.pathname === '/login' || window.location.pathname.startsWith('/auth/')) return '/';
  return safeNextPath(`${window.location.pathname}${window.location.search}`);
}

function displayUser(user) {
  return user.user_metadata?.full_name || user.email || '已登录';
}

function showStatus(message, kind = '') {
  if (!elements.status) return;
  elements.status.textContent = message;
  elements.status.className = `auth-status${kind ? ` ${kind}` : ''}`;
}

function setBusy(button, busy, label = '') {
  if (!button) return;
  if (busy) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : (button.dataset.label || button.textContent);
}
