const MESSAGES = {
  not_allowed: 'This Google account is not allowed to use Headline Desk. Ask the admin to add your email or domain.',
  unverified: 'Google did not confirm a verified email for this account.',
  state: 'Sign-in expired or was interrupted. Please try again.',
  cancelled: 'Sign-in was cancelled.',
  google: 'Google sign-in failed. Please try again.',
};
const code = new URLSearchParams(location.search).get('error');
if (code) {
  const el = document.getElementById('error');
  el.textContent = MESSAGES[code] ?? 'Sign-in failed.';
  el.hidden = false;
}
